/**
 * Drives the TierList tab end to end, against a copy of the real library.
 *
 * Covers the whole path the user takes: create a list, add elements from the
 * library, drag one into a row, use the keyboard route, rename a row, sort by
 * score, reload to prove it persisted, and delete the list.
 *
 * The real data file is copied into a throwaway profile rather than opened in
 * place, so nothing here can write to the actual library.
 *
 * Usage: node scripts/smoke-tierlist.mjs
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}` +
      (ok ? '' : ` (expected ${JSON.stringify(expected)})`)
  )
}

const real = join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')
if (!existsSync(real)) {
  console.error(`No library at ${real}`)
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'animeeh-tierlist-'))
copyFileSync(real, join(profile, 'animeeh-data.json'))
const copy = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
copy.settings.checkForUpdatesOnStartup = false
copy.settings.language = 'en'
// Start from no tier lists, so the empty state and creation are exercised.
copy.tierLists = []
writeFileSync(join(profile, 'animeeh-data.json'), JSON.stringify(copy), 'utf-8')

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => {
  failures += 1
  console.log(`[pageerror] ${e.message}`)
})

const sleep = (ms) => win.waitForTimeout(ms)
const board = () => win.locator('.tl-capture')
const tilesIn = (selector) => win.locator(`${selector} .tl-tile`)

try {
  await sleep(1800)

  /* ---- 1. The tab and the empty state ---- */
  console.log('\n1. THE TAB')
  const nav = await win.locator('.nav-label').allInnerTexts()
  check('TierList is in the navigation', nav.map((s) => s.trim()).includes('TierList'), true)
  check('between Films & OVA and Leaderboard', nav.map((s) => s.trim()).slice(0, 4), [
    'Anime',
    'Films & OVA',
    'TierList',
    'Leaderboard'
  ])

  await win.getByRole('button', { name: /^TierList/ }).click()
  await sleep(700)
  check('the empty state is shown', await win.locator('.empty h3').count(), 1)
  await win.screenshot({ path: join(root, 'smoke-tierlist-empty.png') })

  /* ---- 2. Creating asks what it is made of ---- */
  console.log('\n2. CREATING')
  await win.getByRole('button', { name: /Create a tierlist/i }).first().click()
  await sleep(500)
  const kinds = (await win.locator('.tl-kinds .btn').allInnerTexts()).map((s) => s.trim())
  check('every kind is offered', kinds.length, 6)
  check('including openings and endings', kinds.includes('Openings') && kinds.includes('Endings'), true)
  await win.screenshot({ path: join(root, 'smoke-tierlist-kinds.png') })

  await win.locator('.tl-kinds .btn', { hasText: 'Anime' }).first().click()
  await sleep(900)
  check('the board opened straight away', await board().count(), 1)
  check('with seven rows', await win.locator('.tl-row').count(), 7)

  const letters = await win.locator('.tl-label').allInnerTexts()
  check('labelled S to F', letters.map((s) => s.trim()[0]).join(''), 'SABCDEF')

  const rows = await win.locator('.tl-row').evaluateAll((els) =>
    els.map((el) => {
      const label = el.querySelector('.tl-label')
      const area = el.querySelector('.tl-area')
      return {
        letter: label?.textContent?.trim() ?? '',
        background: label ? getComputedStyle(label).backgroundImage.slice(0, 24) : '',
        color: label ? getComputedStyle(label).color : '',
        height: area ? Math.round(area.getBoundingClientRect().height) : 0
      }
    })
  )
  check('each row is coloured', rows.every((r) => r.background.includes('gradient')), true)
  check('the S row is not plain grey', rows[0].background !== 'linear-gradient(160deg, #2b3d5e', true)
  console.log(`   row colours — ${rows.map((r) => `${r.letter}:${r.background.slice(0, 18)}…`).join('  ')}`)

  /* ---- 3. Adding elements from the library ---- */
  console.log('\n3. ADDING ELEMENTS')
  await win.getByRole('button', { name: /Add elements/i }).click()
  await sleep(600)
  const offers = await win.locator('.tl-res').count()
  console.log(`   the picker offers ${offers} entries`)
  check('the picker lists the library', offers > 10, true)

  await win.locator('.tl-picker-actions .btn').click()
  await sleep(900)
  const poolCount = await tilesIn('.tl-pool-tiles').count()
  check('they land in the pool', poolCount, offers)
  await win.screenshot({ path: join(root, 'smoke-tierlist-pool.png') })

  await win.locator('.tl-picker .icon-btn').click()
  await sleep(500)

  /* ---- 4. Drag one into a row ---- */
  console.log('\n4. DRAGGING')
  // Playwright's dragTo, not raw mouse moves: moving the pointer does not raise
  // the HTML5 dragstart and drop events the board listens for.
  const first = tilesIn('.tl-pool-tiles').first()
  const target = win.locator('.tl-row').first().locator('.tl-area')
  const from = await first.boundingBox()
  const to = await target.boundingBox()
  check('both ends are on screen', from !== null && to !== null, true)
  await first.dragTo(target)
  await sleep(700)
  const inS = await tilesIn('.tl-row:nth-child(1) .tl-area').count()
  check('it is now in the S row', inS, 1)
  const poolAfter = await tilesIn('.tl-pool-tiles').count()
  check('and no longer in the pool', poolAfter, poolCount - 1)

  /* ---- 5. The keyboard route ---- */
  console.log('\n5. THE KEYBOARD')
  await tilesIn('.tl-pool-tiles').first().click()
  await sleep(250)
  const selectedText = await win.locator('.tl-sel').innerText().catch(() => '')
  check('the selection is shown', selectedText.includes('1'), true)

  await win.keyboard.press('a')
  await sleep(500)
  check('pressing A sends it to the A row', await tilesIn('.tl-row:nth-child(2) .tl-area').count(), 1)
  check('and the selection cleared', await win.locator('.tl-sel').count(), 0)

  // Ctrl-click adds to the selection rather than replacing it.
  await tilesIn('.tl-pool-tiles').nth(0).click()
  await tilesIn('.tl-pool-tiles').nth(1).click({ modifiers: ['Control'] })
  await sleep(250)
  const twoSelected = await win.locator('.tl-tile.on').count()
  check('control-click selects two', twoSelected, 2)
  await win.keyboard.press('b')
  await sleep(500)
  check('and B takes both', await tilesIn('.tl-row:nth-child(3) .tl-area').count(), 2)

  /* ---- 6. Sort by score ---- */
  console.log('\n6. SORT BY SCORE')
  await win.getByRole('button', { name: /Sort by score/i }).click()
  await sleep(900)
  const placedNow = await win.locator('.tl-area .tl-tile').count()
  console.log(`   ${placedNow} of ${poolAfter} elements placed by score`)
  check('the score pass placed most of them', placedNow > poolAfter / 2, true)
  const perRow = await win.locator('.tl-row').evaluateAll((els) =>
    els.map((el) => el.querySelectorAll('.tl-area .tl-tile').length)
  )
  console.log(`   per row S→F: ${perRow.join(' ')}`)
  check('the rows fill from the top down', perRow[0] >= perRow[6], true)
  await win.screenshot({ path: join(root, 'smoke-tierlist-board.png') })

  /* ---- 7. Renaming ---- */
  console.log('\n7. RENAMING')
  await win.locator('.tl-label').first().click()
  await sleep(300)
  await win.locator('.tl-label-input').fill('Chefs-d oeuvre')
  await win.keyboard.press('Enter')
  await sleep(400)
  check('the row was renamed', (await win.locator('.tl-label').first().innerText()).trim().startsWith('Chefs'), true)

  await win.locator('.tl-name').click()
  await sleep(300)
  await win.locator('.tl-name-input').fill('Mes animés')
  await win.keyboard.press('Enter')
  await sleep(400)
  check('the list was renamed', (await win.locator('.tl-name').innerText()).trim(), 'Mes animés')

  /* ---- 8. It persisted ---- */
  console.log('\n8. PERSISTENCE')
  await sleep(700)
  const onDisk = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
  check('the list is in the data file', onDisk.tierLists.length, 1)
  check('under its new name', onDisk.tierLists[0].name, 'Mes animés')
  check('with its elements', onDisk.tierLists[0].items.length, poolCount)
  check('and their placements', onDisk.tierLists[0].items.filter((i) => i.rowId !== null).length > 0, true)
  check('the renamed row survived', onDisk.tierLists[0].rows[0].label, 'Chefs-d oeuvre')

  await win.reload()
  await sleep(1900)
  await win.getByRole('button', { name: /^TierList/ }).click()
  await sleep(800)
  const cards = await win.locator('.tl-card:not(.new)').count()
  check('one card after reloading', cards, 1)
  check('named correctly', (await win.locator('.tl-card .name').first().innerText()).trim(), 'Mes animés')
  const previewBands = await win.locator('.tl-card .prow').count()
  check('the card previews the board', previewBands, 5)
  await win.screenshot({ path: join(root, 'smoke-tierlist-cards.png') })

  /* ---- 9. Back into it, then delete ---- */
  console.log('\n9. REOPENING AND DELETING')
  await win.locator('.tl-card .preview').first().click()
  await sleep(800)
  check('the board reopened', await board().count(), 1)
  check('with the placements intact', (await win.locator('.tl-area .tl-tile').count()) > 0, true)

  // The bar's first button is the back arrow, which is robust whatever it reads.
  await win.locator('.tl-bar .btn').first().click()
  await sleep(700)
  check('back on the grid', await win.locator('.tl-card:not(.new)').count(), 1)

  await win.locator('.tl-card .icon-btn').first().click()
  await sleep(700)
  check('deleting returns to the empty state', await win.locator('.empty h3').count(), 1)
  const afterDelete = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
  check('and the data file agrees', afterDelete.tierLists.length, 0)

  /* ---- 10. The other kinds offer the right things ---- */
  console.log('\n10. THE OTHER KINDS')
  await win.getByRole('button', { name: /Create a tierlist/i }).first().click()
  await sleep(400)
  await win.locator('.tl-kinds .btn', { hasText: /^Seasons/ }).click()
  await sleep(800)
  await win.getByRole('button', { name: /Add elements/i }).click()
  await sleep(600)
  const seasonOffers = await win.locator('.tl-res').count()
  console.log(`   seasons offered: ${seasonOffers}`)
  check('seasons come from multi-season entries', seasonOffers > 0, true)

  await win.locator('.tl-kinds .btn', { hasText: /^Seasons/ }).count().catch(() => 0)
  await win.locator('.tl-picker .icon-btn').click()
  await sleep(400)
  await win.locator('.tl-bar .btn').first().click()
  await sleep(500)

  await win.getByRole('button', { name: /Create a tierlist/i }).first().click()
  await sleep(400)
  await win.locator('.tl-kinds .btn', { hasText: /^Soundtracks/ }).click()
  await sleep(800)
  await win.getByRole('button', { name: /Add elements/i }).click()
  await sleep(600)
  const ostNote = await win.locator('.tl-picker .note').innerText().catch(() => '')
  check('the soundtrack tab explains itself', ostNote.length > 40, true)
  check('and offers a typed field', await win.locator('.tl-picker input.input').count(), 1)
  await win.screenshot({ path: join(root, 'smoke-tierlist-ost.png') })

  /* ---- 11. Openings, which need the network ---- */
  console.log('\n11. OPENINGS FROM ANIMETHEMES')
  await win.locator('.tl-picker .icon-btn').click()
  await sleep(400)
  await win.locator('.tl-bar .btn').first().click()
  await sleep(600)

  await win.getByRole('button', { name: /Create a tierlist/i }).first().click()
  await sleep(400)
  await win.locator('.tl-kinds .btn', { hasText: /^Openings/ }).click()
  await sleep(800)
  await win.getByRole('button', { name: /Add elements/i }).click()
  await sleep(600)

  const loadBtn = win.getByRole('button', { name: /Load the openings of my library/i })
  check('the openings tab offers a load', await loadBtn.count(), 1)
  const started = Date.now()
  await loadBtn.click()

  // Streamed batch by batch, so the first openings appear after a few seconds
  // rather than after the whole library has been walked.
  let offered = 0
  let firstAppearedAt = 0
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000)
    offered = await win.locator('.tl-res').count()
    if (offered > 0) {
      firstAppearedAt = Date.now() - started
      break
    }
  }
  console.log(`   ${offered} openings after ${firstAppearedAt} ms`)
  check('openings arrive before the whole library is walked', offered > 0, true)
  check('and reasonably quickly', firstAppearedAt < 20_000, true)

  const firstOp = await win.locator('.tl-res .a').first().innerText().catch(() => '')
  const firstOpSub = await win.locator('.tl-res .b').first().innerText().catch(() => '')
  console.log(`   first: "${firstOp}" — ${firstOpSub}`)
  check('they are labelled OP1, OP2, ED1…', /^(OP|ED)\d/.test(firstOpSub), true)

  // Let a few more batches land, then stop watching and take what there is.
  for (let i = 0; i < 12; i += 1) {
    await sleep(2000)
    const now = await win.locator('.tl-res').count()
    if (now > offered) offered = now
  }
  console.log(`   ${offered} openings after a further 24 s`)
  await win.screenshot({ path: join(root, 'smoke-tierlist-openings.png') })

  await win.locator('.tl-picker-actions .btn').click()
  await sleep(900)
  await win.locator('.tl-picker .icon-btn').click()
  await sleep(400)
  const opTiles = await tilesIn('.tl-pool-tiles').count()
  console.log(`   ${opTiles} tiles in the pool`)
  check('the openings are in the pool', opTiles > 0, true)
} catch (err) {
  failures += 1
  console.log(`\n[error] ${err.message}`)
  await win.screenshot({ path: join(root, 'smoke-tierlist-failure.png') }).catch(() => {})
} finally {
  await app.close()
}

console.log(`\n${failures === 0 ? 'TIERLIST TEST OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
