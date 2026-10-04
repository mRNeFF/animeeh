import { _electron as electron } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const userDataDir = mkdtempSync(join(tmpdir(), 'animeeh-smoke-'))

const errors = []
const logs = []

const app = await electron.launch({ args: [root, `--user-data-dir=${userDataDir}`], cwd: root })
const win = await app.firstWindow()

win.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
win.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

const shot = (name) => win.screenshot({ path: join(root, `smoke-${name}.png`) })
const sleep = (ms) => win.waitForTimeout(ms)

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(1500)
  await shot('1-empty')

  // ---- Add a first anime ----
  await win.getByRole('button', { name: /Add your first anime/i }).click()
  await sleep(300)
  await win.locator('#af-title').fill("Frieren: Beyond Journey's End")
  await win.locator('#af-year').fill('2023')
  await win.locator('#af-studio').fill('Madhouse')
  await win.locator('.modal button[type=submit]').click()
  await sleep(700)
  await shot('2-detail-empty')

  // ---- Rate the seven criteria via their numeric boxes ----
  const criteriaInputs = win.locator('.criteria-list .criterion .score-input')
  const cValues = [95, 96, 92, 88, 90, 85, 89]
  for (let i = 0; i < cValues.length; i += 1) {
    await criteriaInputs.nth(i).fill(String(cValues[i]))
    await sleep(60)
  }
  await sleep(400)

  // ---- Add episodes and score them ----
  for (let i = 0; i < 5; i += 1) {
    await win.getByRole('button', { name: /Episode$/ }).first().click()
    await sleep(90)
  }
  const epInputs = win.locator('.ep-row .score-input')
  const epValues = [92, 96, 99, 94, 97]
  for (let i = 0; i < epValues.length; i += 1) {
    await epInputs.nth(i).fill(String(epValues[i]))
    await sleep(60)
  }
  await sleep(500)
  const gauge = await win.locator('.gauge-score').innerText()
  const avgText = await win.locator('.criteria-list .criterion').last().innerText()
  console.log(`DETAIL: Frieren global=${gauge} (expected ~91.3, S)`) 
  console.log(`DETAIL episode avg row: ${avgText.replace(/\s+/g, ' ')}`)
  await shot('3-detail-filled')

  // ---- Add a second anime so the leaderboard has content ----
  await win.getByRole('button', { name: 'Library' }).click()
  await sleep(300)
  await win.getByRole('button', { name: 'Add anime' }).first().click()
  await sleep(300)
  await win.locator('#af-title').fill('Attack on Titan')
  await win.locator('#af-year').fill('2013')
  await win.locator('.modal button[type=submit]').click()
  await sleep(600)
  const c2 = win.locator('.criteria-list .criterion .score-input')
  const v2 = [88, 94, 90, 80, 92, 87, 84]
  for (let i = 0; i < v2.length; i += 1) {
    await c2.nth(i).fill(String(v2[i]))
    await sleep(60)
  }
  for (let i = 0; i < 3; i += 1) {
    await win.getByRole('button', { name: /Episode$/ }).first().click()
    await sleep(90)
  }
  const ep2 = win.locator('.ep-row .score-input')
  for (let i = 0; i < 3; i += 1) {
    await ep2.nth(i).fill(String([90, 93, 89][i]))
    await sleep(60)
  }
  await sleep(500)

  // ---- Library grid ----
  await win.getByRole('button', { name: 'Library' }).click()
  await sleep(500)
  await shot('4-library')

  // ---- Leaderboard ----
  await win.getByRole('button', { name: 'Leaderboard' }).click()
  await sleep(600)
  await shot('5-leaderboard')
  const rows = await win.locator('tbody tr').allInnerTexts()
  console.log('LEADERBOARD:\n' + rows.map((r) => '  ' + r.replace(/\s+/g, ' | ')).join('\n'))
  const overflow = await win.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  console.log(`LAYOUT: horizontal overflow = ${overflow}px (0 is ideal)`)

  // ---- Criteria view ----
  await win.getByRole('button', { name: 'By Criteria' }).click()
  await sleep(400)
  await win.getByRole('button', { name: 'Animation' }).click()
  await sleep(400)
  await shot('6-criteria')

  // ---- Settings ----
  await win.getByRole('button', { name: 'Settings' }).click()
  await sleep(400)
  await shot('7-settings')

  // ---- AniList reference lookup (seasons must be merged) ----
  await win.getByRole('button', { name: 'My Anime' }).click()
  await sleep(400)
  await win.getByRole('button', { name: 'Add anime' }).first().click()
  await sleep(400)

  const alSearch = win.locator('.al-block input.input')
  await alSearch.fill('sousou no frieren')
  await win.locator('.al-result').first().waitFor({ state: 'visible', timeout: 25000 })
  const resultCount = await win.locator('.al-result').count()
  console.log(`ANILIST: ${resultCount} grouped results for "sousou no frieren"`)

  // The TV series must appear once, with its seasons merged.
  const firstResult = win.locator('.al-result').first()
  const firstText = (await firstResult.innerText()).replace(/\s+/g, ' ').trim()
  console.log(`ANILIST: first result = ${firstText}`)
  await shot('8-anilist-results')

  await firstResult.click()
  await sleep(4000) // franchise assembly walks the relations

  const picked = (await win.locator('.al-selected').innerText()).replace(/\s+/g, ' ').trim()
  console.log(`ANILIST: picked = ${picked}`)

  // Expand the season list to confirm what was merged.
  const seasonPill = win.locator('.al-selected .pill-button')
  if (await seasonPill.count()) {
    await seasonPill.click()
    await sleep(400)
    const seasons = (await win.locator('.al-season-list').innerText())
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    console.log(`ANILIST: merged seasons = ${seasons.length}`)
    for (const line of seasons) console.log(`    ${line.replace(/\s+/g, ' ')}`)
  } else {
    console.log('ANILIST: no season list button (single season)')
  }

  const filled = {
    title: await win.locator('#af-title').inputValue(),
    year: await win.locator('#af-year').inputValue(),
    studio: await win.locator('#af-studio').inputValue()
  }
  console.log(
    `ANILIST filled: title="${filled.title}" year="${filled.year}" studio="${filled.studio}"`
  )
  await shot('9-anilist-picked')

  await win.locator('.modal button[type=submit]').click()
  await sleep(1800)

  // The header row also carries .ep-row, hence the -1.
  const epRows = (await win.locator('.ep-row').count()) - 1
  const epSummary = (await win.locator('.section-title .hint').last().innerText()).replace(/\s+/g, ' ')
  const episodesField = await win.locator('.detail-fields .field').last().locator('input').inputValue()
  const firstEpScore = await win.locator('.ep-row .score-input').nth(1).inputValue()
  const firstEpTitle = await win.locator('.ep-row .ep-title').nth(1).inputValue()
  // Episode 29 is the first of season 2 (season 1 has 28 episodes).
  const s2Title = await win.locator('.ep-row .ep-title').nth(29).inputValue()
  const seasonBadges = await win.locator('.ep-season').count()
  const seasonStrip = await win.locator('.season-chip').count()
  const anilistLink = (await win.locator('.al-link').first().innerText()).replace(/\s+/g, ' ')

  console.log(`ANILIST created: ${epRows} episode rows, field="${episodesField}"`)
  console.log(`ANILIST summary: ${epSummary}`)
  console.log(`ANILIST first episode: title="${firstEpTitle}" score="${firstEpScore}" (empty = unrated)`)
  console.log(`ANILIST season badges rendered: ${seasonBadges}, season chips: ${seasonStrip}`)
  console.log(`ANILIST episode 29 (start of S2): title="${s2Title}"`)
  console.log(`ANILIST link: ${anilistLink}`)
  await shot('10-anilist-created')

  // ---- Confirm persistence: reload and check the data survived ----
  await win.reload()
  await sleep(1500)
  const cardCount = await win.locator('.card').count()
  console.log(`PERSISTENCE: ${cardCount} cards after reload (expected 3)`)

  // Reload lands on the library view, so open the entry to read its score.
  await win.locator('.card', { hasText: 'Sousou no Frieren' }).first().click()
  await sleep(900)
  const unratedGlobal = await win.locator('.gauge-score').innerText()
  const persistedEpisodes = await win.locator('.ep-row').count()
  const persistedTitle = await win.locator('.ep-row .ep-title').nth(1).inputValue()
  console.log(
    `PERSISTENCE: Frieren TV global=${unratedGlobal} (— expected: nothing rated yet), ` +
      `${persistedEpisodes - 1} episodes kept`
  )
  console.log(`PERSISTENCE: episode title kept = "${persistedTitle}"`)

  console.log('SMOKE OK')
} catch (err) {
  errors.push(`[script] ${err.message}`)
  try {
    await shot('failure')
  } catch {
    /* ignore */
  }
} finally {
  if (logs.length) console.log('--- renderer console ---\n' + logs.join('\n'))
  if (errors.length) console.log('--- ERRORS ---\n' + errors.join('\n'))
  await app.close()
}

process.exit(errors.length ? 1 : 0)
