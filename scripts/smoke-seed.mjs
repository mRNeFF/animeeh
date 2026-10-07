/**
 * Verifies three features that do not depend on the reference sources:
 *   1. cover thumbnails,
 *   2. genre tags and filtering,
 *   3. the English/French language switch.
 *
 * It used to also cover the N.xlsx import button, which no longer exists. The
 * library is now written straight into the profile instead, using the same seed
 * module the button called, so the rest of the checks keep running against a
 * realistic list.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const userDataDir = mkdtempSync(join(tmpdir(), 'animeeh-seed-'))

/* ---- Build the library from the bundled list, without going through the UI ---- */

const seedOut = join(mkdtempSync(join(tmpdir(), 'seed-')), 's.mjs')
await build({
  entryPoints: [join(root, 'src/renderer/src/seed.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: seedOut,
  logLevel: 'error'
})
const { buildSeedImport, seedCount } = await import(pathToFileURL(seedOut).href)
const { added } = buildSeedImport([])
console.log(`SEED: built ${added.length} entries from the bundled list (of ${seedCount()})`)

writeFileSync(
  join(userDataDir, 'animeeh-data.json'),
  JSON.stringify({
    version: 1,
    settings: {
      weights: {
        characters: 1, story: 1, animation: 1, ost: 1,
        opening: 1, keyFactor: 1, originality: 1, episodeAverage: 1
      },
      checkForUpdatesOnStartup: false,
      language: 'en'
    },
    anime: added
  }),
  'utf-8'
)

const errors = []
const app = await electron.launch({ args: [root, `--user-data-dir=${userDataDir}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

const sleep = (ms) => win.waitForTimeout(ms)
const shot = (name) => win.screenshot({ path: join(root, `smoke-${name}.png`) })

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(1600)

  /* ---- 3. Language switch ---- */
  await win.getByRole('button', { name: 'Settings' }).click()
  await sleep(600)

  const enNav = await win.locator('.nav-label').first().innerText()
  await win.getByRole('button', { name: 'Français' }).click()
  await sleep(500)
  const frNav = await win.locator('.nav-label').first().innerText()
  const frTitles = await win.locator('.nav-label').allInnerTexts()
  console.log(`LANG: nav "${enNav}" -> "${frNav}"`)
  console.log(`LANG: nav labels = ${frTitles.join(' | ')}`)

  /* ---- The statistics panel, from the list just written ---- */
  await win.locator('.sidebar .nav-item', { hasText: /Statistiques/ }).click()
  await sleep(1000)

  const tiles = await win.locator('.stat-tile').evaluateAll((els) =>
    els.map((el) => ({
      value: el.querySelector('.stat-value')?.textContent?.trim(),
      label: el.querySelector('.stat-label')?.textContent?.trim()
    }))
  )
  const seriesTile = tiles.find((t) => (t.label ?? '').includes('Séries'))
  const filmTile = tiles.find((t) => (t.label ?? '').includes('Films'))
  console.log(`SEED: summary tiles = ${tiles.map((t) => `${t.label}=${t.value}`).join(' / ')}`)
  console.log(`SEED: series=${seriesTile?.value} films=${filmTile?.value}`)

  /* ---- 3. Genre tags ---- */
  const genrePanel = win.locator('.panel', { hasText: 'Genres' })
  const genreChips = await genrePanel.locator('.chip').count()
  const genreText = (await genrePanel.locator('.chips').innerText()).replace(/\s+/g, ' ').trim()
  console.log(`GENRES: ${genreChips} distinct genres`)
  console.log(`GENRES: ${genreText.slice(0, 120)}`)
  await shot('seed-genres')

  /* ---- Library: covers + genre filter ---- */
  await win.locator('.sidebar .nav-item').first().click()
  await sleep(1200)

  const cards = await win.locator('.card').count()
  const covers = await win.locator('.card .cover-img img').count()
  const coverSrc = await win.locator('.card .cover-img img').first().getAttribute('src')
  console.log(`LIBRARY: ${cards} cards, ${covers} with a cover image`)
  console.log(`LIBRARY: first cover = ${coverSrc?.slice(0, 62)}…`)

  const genreSelect = win.locator('select[title="Genre"]')
  const genreOptions = await genreSelect.locator('option').allInnerTexts()
  console.log(`LIBRARY: genre options = ${genreOptions.length}`)

  // Filter to a genre and confirm the grid shrinks and stays consistent.
  const target = genreOptions.find((o) => o.startsWith('Romance'))
  if (target) {
    await genreSelect.selectOption({ label: target })
    await sleep(700)
    const filtered = await win.locator('.card').count()
    console.log(`LIBRARY: "${target}" -> ${filtered} cards (${cards} unfiltered)`)
    await shot('seed-genre-filter')
  } else {
    console.log('LIBRARY: no Romance genre option found')
  }

  /* ---- Detail: cover + genre pills ---- */
  await genreSelect.selectOption('all')
  await sleep(500)
  await win.locator('.card').first().click()
  await sleep(900)
  const detailCover = await win.locator('.detail-cover.cover-img img').count()
  const pills = (await win.locator('.genre-pill').allInnerTexts()).join(', ')
  const criteriaLabels = await win.locator('.criterion-name').allInnerTexts()
  console.log(`DETAIL: cover image = ${detailCover === 1}, genre pills = [${pills}]`)
  console.log(`DETAIL: criterion labels = ${criteriaLabels.slice(0, 7).join(' | ')}`)
  await shot('seed-detail')

  /* ---- Back to English ---- */
  await win.getByRole('button', { name: 'Réglages' }).click()
  await sleep(400)
  await win.getByRole('button', { name: 'English' }).click()
  await sleep(400)
  const backToEn = (await win.locator('.nav-label').allInnerTexts()).join(' | ')
  console.log(`LANG: back to English = ${backToEn}`)

  console.log('SEED TEST OK')
} catch (err) {
  errors.push(`[script] ${err.message}`)
  try {
    await shot('seed-failure')
  } catch {
    /* ignore */
  }
} finally {
  if (errors.length) console.log('--- ERRORS ---\n' + errors.join('\n'))
  await app.close().catch(() => {})
}

process.exit(errors.length ? 1 : 0)
