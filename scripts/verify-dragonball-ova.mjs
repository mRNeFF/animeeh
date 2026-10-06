/**
 * Visual confirmation of the two changes, against the live AniList API.
 *
 * 1. Searching "dragon ball" as a series returns Dragon Ball, Z, GT, Super and
 *    DAIMA as separate rows, each with a single season.
 * 2. Searching "re:zero" from the Films tab returns its OVA, which can be added
 *    and then appears in the Films tab rather than the series library.
 *
 * Both are screenshotted, since the point is to see the result rather than only
 * assert on it.
 *
 * Usage: npm run build && node scripts/verify-dragonball-ova.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const profile = mkdtempSync(join(tmpdir(), 'animeeh-verify-'))

let failures = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}` +
      (ok ? '' : ` (expected ${JSON.stringify(expected)})`)
  )
}

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => {
  failures += 1
  console.log(`[pageerror] ${e.message}`)
})

// The search debounces, and the app then fetches from AniList.
const waitForResults = async (timeout = 25000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const rows = await win.locator('.al-result').allInnerTexts()
    if (rows.length > 0) return rows
    await win.waitForTimeout(400)
  }
  return []
}

const readRows = async () =>
  (await win.locator('.al-result').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())

try {
  await win.waitForTimeout(1500)

  /* ---- 1. Dragon Ball, as a series search ---- */
  await win.getByRole('button', { name: /^(Anime|Animé)/ }).click()
  await win.waitForTimeout(500)
  await win.getByRole('button', { name: /^(Add anime|Ajouter un animé)/ }).click()
  await win.waitForTimeout(600)
  await win.locator('.al-block input.input').fill('dragon ball')

  const dragonRows = await waitForResults()
  console.log(`\nDRAGON BALL — ${dragonRows.length} row(s) in the series search:`)
  const expectedTitles = [
    'Dragon Ball',
    'Dragon Ball Z',
    'Dragon Ball GT',
    'Dragon Ball Super',
    'Dragon Ball DAIMA'
  ]
  for (const title of expectedTitles) {
    const row = dragonRows.find((r) => r.startsWith(title))
    const separate = row !== undefined
    const seasons = row ? (row.match(/(\d+) saison/) ?? [])[1] : undefined
    console.log(
      `   ${separate ? 'OK  ' : 'FAIL'} ${title.padEnd(20)} ` +
        (row ? row.replace(/\n/g, ' ').slice(0, 62) : 'NOT FOUND')
    )
    if (!separate) failures += 1
    if (separate && seasons !== undefined && seasons !== '1') {
      console.log(`        expected 1 season, got ${seasons}`)
      failures += 1
    }
  }
  await win.screenshot({ path: join(root, 'verify-dragonball-search.png') })

  /* ---- 2. Picking a series must assemble only that series ---- */
  console.log('\nPICKING EACH SERIES — the assembled season list must hold one season:')
  const EXPECTED = {
    'Dragon Ball': 153,
    'Dragon Ball Z': 291,
    'Dragon Ball GT': 64,
    'Dragon Ball Super': 131,
    'Dragon Ball DAIMA': 20
  }
  for (const [title, episodes] of Object.entries(EXPECTED)) {
    const row = dragonRows.find((r) => r.startsWith(title))
    if (!row) continue
    await win.locator('.al-result').nth(dragonRows.indexOf(row)).click()
    // The form fetches the full franchise, which costs several AniList calls.
    const deadline = Date.now() + 30000
    let pill = ''
    while (Date.now() < deadline) {
      const pills = await win.locator('.al-block .pill').allInnerTexts()
      pill = pills.map((s) => s.replace(/\s+/g, ' ').trim()).find((s) => /season|saison/i.test(s)) ?? ''
      if (pill !== '') break
      await win.waitForTimeout(400)
    }
    const oneSeason = /^1 (season|saison)/i.test(pill)
    if (!oneSeason) failures += 1
    console.log(`   ${oneSeason ? 'OK  ' : 'FAIL'} ${title.padEnd(18)} ${pill.padEnd(14)} (expected 1 season, ${episodes} eps)`)

    // Back to the result list for the next one.
    await win.getByRole('button', { name: /^(Cancel|Annuler)/ }).click()
    await win.waitForTimeout(700)
    if (title !== 'Dragon Ball DAIMA') {
      await win.getByRole('button', { name: /^(Add anime|Ajouter un animé)/ }).click()
      await win.waitForTimeout(600)
      await win.locator('.al-block input.input').fill('dragon ball')
      await waitForResults()
    }
  }
  await win.waitForTimeout(600)

  /* ---- 3. Re:Zero OVA, from the Films tab ---- */
  await win.getByRole('button', { name: /^(Films)/ }).first().click()
  await win.waitForTimeout(900)

  const navNames = await win.locator('button').evaluateAll((els) =>
    els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30)
  )
  console.log(`\nBUTTONS on the Films view:\n   ${JSON.stringify(navNames)}`)

  await win.getByRole('button', { name: /^(Add film or OVA|Ajouter un film ou un OVA)/ }).click()
  await win.waitForTimeout(600)

  const placeholder = await win.locator('.al-block input.input').getAttribute('placeholder')
  console.log(`\nFILM SEARCH placeholder: "${placeholder}"`)

  await win.locator('.al-block input.input').fill('re:zero')
  const filmRows = await waitForResults()
  console.log(`\nRE:ZERO — ${filmRows.length} row(s) in the film search:`)
  for (const row of filmRows) console.log(`   ${row.replace(/\n/g, ' ').slice(0, 78)}`)
  await win.screenshot({ path: join(root, 'verify-rezero-ova-search.png') })

  const ovaRow = filmRows.find((r) => /OVA/i.test(r))
  check('the Re:Zero OVA is offered', ovaRow !== undefined, true)
  if (ovaRow) check('nothing but OVAs and films are listed', filmRows.every((r) => /OVA|MOVIE|Film/i.test(r)), true)

  /* ---- 3. Add it and confirm it lands under Films ---- */
  if (ovaRow) {
    const index = filmRows.indexOf(ovaRow)
    await win.locator('.al-result').nth(index).click()
    await win.waitForTimeout(2500)

    const submit = win.locator('.modal button.btn.primary').last()
    const submitVisible = await submit.isVisible().catch(() => false)
    const submitDisabled = await submit.isDisabled().catch(() => true)
    const submitText = submitVisible ? (await submit.innerText()).trim() : ''
    const titleValue = await win.locator('.modal input.input').first().inputValue().catch(() => '')
    console.log(
      `\nSUBMIT: visible=${submitVisible} disabled=${submitDisabled} ` +
        `label="${submitText}" firstField="${titleValue}"`
    )

    if (submitVisible && !submitDisabled) {
      await submit.click()
      await win.waitForTimeout(2000)
    }

    const modalStillOpen = await win.locator('.modal').isVisible().catch(() => false)
    const errorText = modalStillOpen
      ? (await win.locator('.modal .err, .modal .error').allInnerTexts().catch(() => [])).join(' | ')
      : ''
    console.log(`        modal still open after submit: ${modalStillOpen}${errorText ? ` err="${errorText}"` : ''}`)

    // Reading the cards needs to be on the Films view with the store refreshed.
    await win.getByRole('button', { name: /^(Films)/ }).first().click()
    await win.waitForTimeout(900)
    const filmCards = (await win.locator('.card .card-title').allInnerTexts()).map((s) => s.trim())

    await win.getByRole('button', { name: /^(Anime|Animé)/ }).first().click()
    await win.waitForTimeout(900)
    const seriesCards = (await win.locator('.card .card-title').allInnerTexts()).map((s) => s.trim())

    console.log(`\nAFTER ADDING — Films tab: ${JSON.stringify(filmCards)}`)
    console.log(`                Anime tab: ${JSON.stringify(seriesCards)}`)
    check('the OVA is in the Films tab', filmCards.some((t) => /OVA/i.test(t)), true)
    check('the OVA is not in the series library', seriesCards.some((t) => /OVA/i.test(t)), false)
    await win.getByRole('button', { name: /^(Films)/ }).first().click()
    await win.waitForTimeout(600)
    await win.screenshot({ path: join(root, 'verify-ova-in-films.png') })
  }
} catch (err) {
  failures += 1
  console.log(`\n[error] ${err.message}`)
} finally {
  await app.close()
}

console.log(`\n${failures === 0 ? 'LIVE VERIFICATION OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
