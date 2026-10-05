/**
 * Regression test for the reported bugs:
 *   1. the delete confirmation asked for "supprimer" but demanded "delete",
 *   2. the top-right button stayed "Add anime" inside the Films tab,
 *   3. picking a film used to assemble the whole franchise around it
 *      (Chainsaw Man: Reze-hen came back as the Chainsaw Man TV series),
 *   4. film search results showed series-style noise (format, episode counts).
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const profile = mkdtempSync(join(tmpdir(), 'animeeh-bugs-'))

let failures = 0
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures += 1
  console.log(`   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`)
}

// One film, so the Films tab has something to show.
writeFileSync(
  join(profile, 'animeeh-data.json'),
  JSON.stringify({
    version: 1,
    settings: {
      weights: {
        characters: 1, story: 1, animation: 1, ost: 1,
        opening: 1, keyFactor: 1, originality: 1, episodeAverage: 1
      },
      checkForUpdatesOnStartup: false,
      language: 'fr'
    },
    anime: [
      {
        id: 'f1',
        title: 'Kimi no Na wa.',
        status: 'completed',
        format: 'MOVIE',
        year: 2016,
        episodes: [],
        criteria: {
          characters: 90, story: 95, animation: 95, ost: 90,
          opening: 80, keyFactor: 90, originality: 95
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]
  }),
  'utf-8'
)

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => {
  failures += 1
  console.log(`[pageerror] ${e.message}`)
})

const sleep = (ms) => win.waitForTimeout(ms)
const shot = (name) => win.screenshot({ path: join(root, `smoke-${name}.png`) })

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(1800)

  /* ---- 1. Delete confirmation must accept the French word ---- */
  console.log('\nBUG 1: delete confirmation')
  await win.getByRole('button', { name: /^Films/ }).click()
  await sleep(800)
  await win.locator('.card').first().click()
  await sleep(900)

  await win.getByRole('button', { name: /^Supprimer$/ }).click()
  await sleep(500)

  const prompt = (await win.locator('.modal-sub').innerText()).replace(/\s+/g, ' ').trim()
  const heading = (await win.locator('.modal h3').innerText()).trim()
  const placeholder = await win.locator('.modal input.input').getAttribute('placeholder')
  console.log(`   heading: "${heading}"`)
  console.log(`   body   : "${prompt}"`)
  console.log(`   hint   : placeholder="${placeholder}"`)

  const confirmBtn = win.locator('.modal button.btn.danger')
  await win.locator('.modal input.input').fill('supprimer')
  await sleep(300)
  const acceptedFrench = await confirmBtn.isEnabled()
  await win.locator('.modal input.input').fill('delete')
  await sleep(300)
  const acceptedEnglish = await confirmBtn.isEnabled()

  check('the prompt names the French word', prompt.includes('supprimer'), true)
  check('the placeholder is the French word', placeholder, 'supprimer')
  check('typing "supprimer" enables the button', acceptedFrench, true)
  check('typing "delete" no longer enables it', acceptedEnglish, false)

  // Back out without deleting.
  await win.locator('.modal button.btn.ghost').click()
  await sleep(600)

  const buttons = (await win.locator('button').allInnerTexts())
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  console.log(`   buttons visible: ${buttons.slice(0, 14).join(' | ')}`)

  const backLabel = (await win.locator('.toolbar .btn.ghost').first().innerText()).trim()
  console.log(`   detail back button: "${backLabel}"`)
  check('the back button is translated', backLabel, 'Bibliothèque')

  // Leave the detail view via the sidebar, which is always present.
  await win.locator('.sidebar .nav-item', { hasText: 'Mes animés' }).click()
  await sleep(700)

  /* ---- 2. Top-right button label follows the tab ---- */
  console.log('\nBUG 2: add button label')
  await win.getByRole('button', { name: /^Mes animés/ }).click()
  await sleep(600)
  const seriesLabel = (await win.locator('.topbar-actions .btn.primary').innerText()).trim()
  await win.getByRole('button', { name: /^Films/ }).click()
  await sleep(600)
  const filmLabel = (await win.locator('.topbar-actions .btn.primary').innerText()).trim()
  console.log(`   series tab: "${seriesLabel}"`)
  console.log(`   films tab : "${filmLabel}"`)
  check('series tab says "Ajouter un animé"', seriesLabel, 'Ajouter un animé')
  check('films tab says "Ajouter un film"', filmLabel, 'Ajouter un film')

  /* ---- 3 and 4. Film search stays films-only, and picking keeps it ---- */
  console.log('\nBUG 3/4: film search and picking')
  await win.locator('.topbar-actions .btn.primary').click()
  await sleep(600)
  const formTitle = (await win.locator('.modal h3').innerText()).trim()
  console.log(`   form title: "${formTitle}"`)
  check('the form knows it is adding a film', formTitle, 'Ajouter un film')

  await win.locator('.al-block input.input').fill('chainsaw man')
  await win.locator('.al-result').first().waitFor({ state: 'visible', timeout: 30000 })
  await sleep(600)

  const rows = await win.locator('.al-result').evaluateAll((els) =>
    els.map((el) => ({
      title: el.querySelector('.al-title')?.textContent?.trim(),
      tags: el.querySelector('.al-tags')?.textContent?.trim(),
      isFilm: !!el.querySelector('.al-film')
    }))
  )
  console.log('   results:')
  for (const r of rows) console.log(`      "${r.title}"  tags="${r.tags}"  filmTag=${r.isFilm}`)
  check('every result is tagged as a film', rows.every((r) => r.isFilm), true)
  check('no result shows an episode count', rows.some((r) => /eps|ép\./.test(r.tags ?? '')), false)
  await shot('film-search-clean')

  // Pick it and confirm the entry stays a single film.
  await win.locator('.al-result').first().click()
  await sleep(2500)

  const pickedTitle = await win.locator('#af-title').inputValue()
  const pillText = (await win.locator('.al-selected').innerText()).replace(/\s+/g, ' ').trim()
  const hasSeasonList = await win.locator('.al-season-list').count()
  const hasCreateEpisodes = await win.locator('.al-check').count()
  console.log(`   picked title : "${pickedTitle}"`)
  console.log(`   pills        : "${pillText}"`)
  console.log(`   season list  : ${hasSeasonList}, create-episodes box: ${hasCreateEpisodes}`)
  check('the film title is kept, not the series', pickedTitle, 'Chainsaw Man: Reze-hen')
  check('no season list for a film', hasSeasonList, 0)
  check('no episode creation for a film', hasCreateEpisodes, 0)
  await shot('film-picked')

  console.log(`\n${failures === 0 ? 'BUGFIX TEST OK' : `${failures} FAILURE(S)`}`)
} catch (err) {
  failures += 1
  console.log(`\n[script] ${err.message}`)
  try {
    await shot('bugfix-failure')
  } catch {
    /* ignore */
  }
} finally {
  await app.close().catch(() => {})
}

process.exit(failures === 0 ? 0 : 1)
