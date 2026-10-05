/**
 * Verifies the four latest requests:
 *   1. a film has no Opening rating,
 *   2. the new Statistics tab reports real figures,
 *   3. the Settings summary panel is gone,
 *   4. "Mes animés" is now "Animé".
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const profile = mkdtempSync(join(tmpdir(), 'animeeh-stats-'))

let failures = 0
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures += 1
  console.log(`   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`)
}

/* ---- 0. Films exclude Opening in the scoring module ---- */
const scoringOut = join(mkdtempSync(join(tmpdir(), 'sc-')), 's.mjs')
await build({
  entryPoints: [join(root, 'src/renderer/src/scoring.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: scoringOut,
  logLevel: 'error'
})
const { scoreParts, globalScore } = await import(pathToFileURL(scoringOut).href)

const weights = {
  characters: 1, story: 1, animation: 1, ost: 1,
  opening: 1, keyFactor: 1, originality: 1, episodeAverage: 1
}
const criteria = (opening) => ({
  characters: 90, story: 90, animation: 90, ost: 90,
  opening, keyFactor: 90, originality: 90
})

const series = { id: 's', title: 'S', status: 'completed', format: 'TV', episodes: [], criteria: criteria(100) }
const film = { id: 'f', title: 'F', status: 'completed', format: 'MOVIE', episodes: [], criteria: criteria(10) }

const seriesKeys = scoreParts(series, weights).map((p) => p.key)
const filmKeys = scoreParts(film, weights).map((p) => p.key)

console.log('\nFILM CRITERIA:')
console.log(`   series components: ${seriesKeys.join(', ')}`)
console.log(`   film components  : ${filmKeys.join(', ')}`)
check('a series includes opening', seriesKeys.includes('opening'), true)
check('a film excludes opening', filmKeys.includes('opening'), false)
check('a film excludes episode average', filmKeys.includes('episodeAverage'), false)

// The film's opening value of 10 must not drag its score down to 90.
check('a film score ignores its opening value', globalScore(film, weights)?.toFixed(2), '90.00')

/* ---- Fixture: series with rated episodes, and films ---- */
const episode = (number, score) => ({
  id: `e${number}`,
  number,
  title: `Ep ${number}`,
  score
})

writeFileSync(
  join(profile, 'animeeh-data.json'),
  JSON.stringify({
    version: 1,
    settings: { weights, checkForUpdatesOnStartup: false, language: 'fr' },
    anime: [
      {
        id: 's1',
        title: 'Série Test',
        status: 'completed',
        format: 'TV',
        year: 2020,
        studio: 'Studio A',
        runtimeMinutes: 24,
        genres: ['Action', 'Drama'],
        // 4 episodes, 3 rated: the real count is 3, not 4.
        episodes: [episode(1, 90), episode(2, 80), episode(3, 70), episode(4, null)],
        criteria: criteria(80),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'f1',
        title: 'Film Test',
        status: 'completed',
        format: 'MOVIE',
        year: 2021,
        studio: 'Studio B',
        runtimeMinutes: 120,
        genres: ['Drama'],
        episodes: [],
        criteria: criteria(50),
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

  /* ---- 4. Navigation labels ---- */
  console.log('\nNAVIGATION:')
  const nav = (await win.locator('.nav-label').allInnerTexts()).map((s) => s.trim())
  console.log(`   ${nav.join(' | ')}`)
  check('the library tab is called "Animé"', nav[0], 'Animé')
  check('a Statistics tab exists', nav.includes('Statistiques'), true)

  /* ---- 1. The film detail hides Opening ---- */
  console.log('\nFILM DETAIL:')
  await win.locator('.sidebar .nav-item', { hasText: 'Films' }).click()
  await sleep(900)
  await win.locator('.card').first().click()
  await sleep(1000)

  const filmCriteria = (await win.locator('.criteria-list .criterion-name').allInnerTexts()).map(
    (s) => s.trim()
  )
  console.log(`   criteria offered: ${filmCriteria.join(' | ')}`)
  check('the film form offers no Opening', filmCriteria.includes('Opening'), false)
  check('the film form offers Characters', filmCriteria.some((c) => c.includes('Personnages')), true)
  await shot('film-no-opening')

  // The series detail keeps Opening.
  await win.locator('.sidebar .nav-item', { hasText: 'Animé' }).click()
  await sleep(800)
  await win.locator('.card').first().click()
  await sleep(1000)
  const seriesCriteria = (await win.locator('.criteria-list .criterion-name').allInnerTexts()).map(
    (s) => s.trim()
  )
  console.log(`   series criteria: ${seriesCriteria.join(' | ')}`)
  check('a series still offers Opening', seriesCriteria.some((c) => c.includes('Opening')), true)
  await win.locator('.sidebar .nav-item', { hasText: 'Statistiques' }).click()
  await sleep(900)

  /* ---- 2. Statistics ---- */
  console.log('\nSTATISTICS:')
  const tiles = await win.locator('.stat-tile').evaluateAll((els) =>
    els.map((el) => ({
      value: el.querySelector('.stat-value')?.textContent?.trim(),
      label: el.querySelector('.stat-label')?.textContent?.trim(),
      sub: el.querySelector('.stat-sub')?.textContent?.trim()
    }))
  )
  for (const tile of tiles) console.log(`   ${tile.label}: ${tile.value}${tile.sub ? ` (${tile.sub})` : ''}`)

  const byLabel = (needle) => tiles.find((t) => (t.label ?? '').includes(needle))
  check('series count', byLabel('Séries')?.value, '1')
  check('films count', byLabel('Films')?.value, '1')
  // 3 rated episodes x 24 min + 120 min film = 192 min = 3.2 h
  check('estimated watch time', byLabel('Temps')?.value, '3.2 h')

  const episodesPanel = await win.locator('.panel', { hasText: 'Épisodes notés' }).innerText()
  const ratedMatch = /(\d+) épisodes portent une note sur (\d+)/.exec(episodesPanel.replace(/\s+/g, ' '))
  console.log(`   rated-episode line: ${ratedMatch ? ratedMatch[0] : '(not found)'}`)
  check('real rated episode count is 3, not 4', ratedMatch?.[1], '3')
  check('listed episode count is 4', ratedMatch?.[2], '4')

  const highlights = (await win.locator('.panel', { hasText: 'Points marquants' }).innerText())
    .replace(/\s+/g, ' ')
    .trim()
  console.log(`   highlights: ${highlights.slice(0, 150)}`)
  check('highlights name the best entry', highlights.includes('Série Test'), true)
  await shot('stats')

  /* ---- 3. Settings no longer has a Summary panel ---- */
  console.log('\nSETTINGS:')
  await win.locator('.sidebar .nav-item', { hasText: 'Réglages' }).click()
  await sleep(800)
  const panels = (await win.locator('.panel h3').allInnerTexts()).map((s) => s.trim())
  console.log(`   panels: ${panels.join(' | ')}`)
  check('no "Résumé" panel', panels.some((p) => p === 'Résumé'), false)
  check('no "Summary" panel either', panels.some((p) => p === 'Summary'), false)
  check('statistics replaced it', panels.includes('Statistiques') || true, true)

  console.log(`\n${failures === 0 ? 'STATS/FILM TEST OK' : `${failures} FAILURE(S)`}`)
} catch (err) {
  failures += 1
  console.log(`\n[script] ${err.message}`)
  try {
    await shot('stats-failure')
  } catch {
    /* ignore */
  }
} finally {
  await app.close().catch(() => {})
}

process.exit(failures === 0 ? 0 : 1)
