/**
 * Verifies the two additions:
 *   1. seasons rendered as collapsible panels with their episodes inside,
 *   2. "Load all episode names" in Settings.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const userDataDir = mkdtempSync(join(tmpdir(), 'animeeh-seasons-'))

const errors = []
const app = await electron.launch({ args: [root, `--user-data-dir=${userDataDir}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

const sleep = (ms) => win.waitForTimeout(ms)
const shot = (name) => win.screenshot({ path: join(root, `smoke-${name}.png`) })

/** Insert one anime directly, so the test does not depend on a live search. */
const FRIEREN = {
  id: 'panel-1',
  title: 'Sousou no Frieren',
  status: 'completed',
  episodes: [],
  criteria: {
    characters: 95,
    story: 96,
    animation: 92,
    ost: 88,
    opening: 90,
    keyFactor: 85,
    originality: 89
  },
  totalEpisodes: 38,
  source: {
    provider: 'anilist',
    anilistId: 154587,
    malId: 52991,
    siteUrl: 'https://anilist.co/anime/154587'
  },
  seasons: [
    { season: 1, anilistId: 154587, malId: 52991, title: 'Sousou no Frieren', year: 2023, episodes: 28 },
    { season: 2, anilistId: 182255, malId: 58567, title: 'Sousou no Frieren 2nd Season', year: 2026, episodes: 10 }
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}

const dataFile = join(userDataDir, 'animeeh-data.json')

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(1200)

  /* ---- Seed one multi-season anime with no episodes ---- */
  await win.evaluate(
    ([file, anime]) => {
      return window.animeeh.save({
        version: 1,
        settings: {
          weights: {
            characters: 1, story: 1, animation: 1, ost: 1,
            opening: 1, keyFactor: 1, originality: 1, episodeAverage: 1
          },
          checkForUpdatesOnStartup: false,
          language: 'en'
        },
        anime: [anime]
      })
    },
    [dataFile, FRIEREN]
  )
  await win.reload()
  await sleep(2000)

  /* ---- Settings: bulk load ---- */
  await win.getByRole('button', { name: 'Settings' }).click()
  await sleep(800)

  const panelCount = await win.locator('.panel', { hasText: 'Episode names' }).count()
  const beforeText = (
    await win.locator('.panel', { hasText: 'Episode names' }).locator('.hint').last().innerText()
  ).trim()
  console.log(`BULK: panel present = ${panelCount === 1}`)
  console.log(`BULK: ${beforeText}`)

  await win.getByRole('button', { name: /Load all episode names/i }).click()

  // Wait for the run to finish: the summary element only appears at the end.
  const bulkPanel = win.locator('.panel', { hasText: 'Episode names' })
  await bulkPanel.locator('.bulk-result').waitFor({ state: 'visible', timeout: 180000 })
  const summary = (await bulkPanel.locator('.bulk-result').innerText()).trim()
  console.log(`BULK: result = ${summary}`)
  await shot('seasons-bulk-loaded')

  /* ---- Detail: seasons as panels ---- */
  await win.getByRole('button', { name: 'My Anime' }).click()
  await sleep(900)
  await win.locator('.card').first().click()

  // Wait for the episodes to be in the DOM before measuring anything.
  await win.locator('.season-block').first().waitFor({ state: 'visible', timeout: 20000 })
  await win.locator('.season-body .ep-row').first().waitFor({ state: 'visible', timeout: 20000 })
  await sleep(400)

  const blocks = await win.locator('.season-block').count()
  const headers = await win.locator('.season-header').allInnerTexts()
  console.log(`PANELS: ${blocks} season block(s)`)
  for (const h of headers) console.log(`   ${h.replace(/\s+/g, ' ').trim()}`)

  // Only the first season is open by default.
  const openBefore = await win.locator('.season-header.open').count()
  const rowsBefore = await win.locator('.season-body .ep-row').count()
  const declared = await win.locator('.season-header').first().innerText()
  console.log(`PANELS: ${openBefore} open by default, ${rowsBefore} episode rows visible`)
  console.log(`PANELS: first header = ${declared.replace(/\s+/g, ' ').trim()}`)

  // Expanding the second season must reveal its episodes inside its own block.
  await win.locator('.season-header').nth(1).click()
  await sleep(600)

  const openAfter = await win.locator('.season-header.open').count()
  const secondBody = win.locator('.season-block').nth(1).locator('.season-body')
  await secondBody.locator('.ep-row').first().waitFor({ state: 'visible', timeout: 10000 })

  // The header row is also .ep-row, so subtract it.
  const secondRows = (await secondBody.locator('.ep-row').count()) - 1
  const firstTitle = await secondBody.locator('.ep-title').first().inputValue()
  // Season 1 holds 28 episodes, so season 2 must start at 29.
  const firstNumber = (await secondBody.locator('.ep-num').first().innerText()).trim()
  console.log(`PANELS: after expanding season 2 -> ${openAfter} open, ${secondRows} rows in block 2`)
  console.log(`PANELS: first episode of season 2 = #${firstNumber} "${firstTitle}" (expected #29)`)

  // Scoped check: block 2's episodes must not leak into block 1.
  const block1Rows = (await win.locator('.season-block').first().locator('.season-body .ep-row').count()) - 1
  console.log(`PANELS: block 1 holds ${block1Rows} rows, block 2 holds ${secondRows} (28 + 10 expected)`)
  await shot('seasons-panels')

  // Toggle all. Both seasons are open now, so the control reads "Collapse all".
  const toggleAll = win.locator('.seasons-toolbar button')
  console.log(`PANELS: toggle all reads "${(await toggleAll.innerText()).trim()}"`)
  await toggleAll.click()
  await sleep(500)
  const collapsed = await win.locator('.season-body').count()
  console.log(`PANELS: after collapsing all -> ${collapsed} season bodies rendered (expected 0)`)

  await toggleAll.click()
  await sleep(500)
  const expanded = await win.locator('.season-body').count()
  console.log(`PANELS: after expanding all -> ${expanded} season bodies rendered (expected 2)`)

  /* ---- Persistence ---- */
  const stored = JSON.parse(readFileSync(dataFile, 'utf-8'))
  const saved = stored.anime[0]
  const titled = saved.episodes.filter((e) => (e.title ?? '').trim() !== '')
  const rated = saved.episodes.filter((e) => e.score !== null)
  const seasons = new Set(saved.episodes.map((e) => e.season))
  console.log(
    `PERSIST: ${saved.episodes.length} episodes stored, ${titled.length} titled, ` +
      `${rated.length} rated, seasons = ${[...seasons].join(', ')}`
  )

  if (saved.episodes.length !== 38) throw new Error(`expected 38 episodes, got ${saved.episodes.length}`)
  if (titled.length === 0) throw new Error('no episode names were stored')
  if (rated.length !== 0) throw new Error(`episodes should arrive unrated, found ${rated.length} rated`)

  console.log('SEASONS TEST OK')
} catch (err) {
  errors.push(`[script] ${err.message}`)
  try {
    await shot('seasons-failure')
  } catch {
    /* ignore */
  }
} finally {
  if (errors.length) console.log('--- ERRORS ---\n' + errors.join('\n'))
  await app.close().catch(() => {})
}

process.exit(errors.length ? 1 : 0)
