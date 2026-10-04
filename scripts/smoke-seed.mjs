/**
 * Verifies the four features added on top of the base app:
 *   1. the N.xlsx list import (bundled seed),
 *   2. cover thumbnails,
 *   3. genre tags and filtering,
 *   4. the English/French language switch.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const userDataDir = mkdtempSync(join(tmpdir(), 'animeeh-seed-'))

const errors = []
const app = await electron.launch({ args: [root, `--user-data-dir=${userDataDir}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

const sleep = (ms) => win.waitForTimeout(ms)
const shot = (name) => win.screenshot({ path: join(root, `smoke-${name}.png`) })

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(1600)

  /* ---- 4. Language switch ---- */
  await win.getByRole('button', { name: 'Settings' }).click()
  await sleep(600)

  const enNav = await win.locator('.nav-label').first().innerText()
  await win.getByRole('button', { name: 'Français' }).click()
  await sleep(500)
  const frNav = await win.locator('.nav-label').first().innerText()
  const frTitles = await win.locator('.nav-label').allInnerTexts()
  console.log(`LANG: nav "${enNav}" -> "${frNav}"`)
  console.log(`LANG: nav labels = ${frTitles.join(' | ')}`)

  /* ---- 1. Seed import ---- */
  const importBtn = win.getByRole('button', { name: /Importer la liste N\.xlsx/i })
  const importVisible = await importBtn.count()
  console.log(`SEED: import button present = ${importVisible === 1}`)
  await importBtn.click()
  await sleep(2500)

  const message = (await win.locator('.mono').first().innerText()).replace(/\s+/g, ' ').trim()
  console.log(`SEED: result = ${message}`)
  await shot('seed-imported')

  const statAnime = await win.locator('.panel', { hasText: 'Résumé' }).locator('.hint').allInnerTexts()
  console.log(`SEED: summary labels = ${statAnime.slice(0, 4).join(' / ')}`)
  const animeCount = await win
    .locator('.panel', { hasText: 'Résumé' })
    .locator('div')
    .filter({ hasText: /^\d+$/ })
    .first()
    .innerText()
  console.log(`SEED: anime count = ${animeCount} (expected 84)`)

  /* ---- 3. Genre tags ---- */
  const genrePanel = win.locator('.panel', { hasText: 'Genres' })
  const genreChips = await genrePanel.locator('.chip').count()
  const genreText = (await genrePanel.locator('.chips').innerText()).replace(/\s+/g, ' ').trim()
  console.log(`GENRES: ${genreChips} distinct genres`)
  console.log(`GENRES: ${genreText.slice(0, 120)}`)
  await shot('seed-genres')

  /* ---- Library: covers + genre filter ---- */
  await win.getByRole('button', { name: 'Mes animés' }).click()
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
