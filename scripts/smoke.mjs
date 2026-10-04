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

  // Episodes now live inside collapsible season panels. Expand them all so the
  // whole franchise is in the DOM, then read from the blocks.
  await win.locator('.season-block').first().waitFor({ state: 'visible', timeout: 20000 })
  await win.locator('.seasons-toolbar button').click()
  await sleep(700)

  const seasons = await win.locator('.season-block').count()
  // Count episode numbers: only real episode rows carry one, so this is immune
  // to a season rendering an empty state instead of a header row.
  const epRows = await win.locator('.season-body .ep-num').count()
  const epSummary = (await win.locator('.section-title .hint').last().innerText()).replace(/\s+/g, ' ')
  const episodesField = await win.locator('.detail-fields .field').last().locator('input').inputValue()
  const firstEpScore = await win.locator('.season-body .score-input').first().inputValue()
  const firstEpTitle = await win.locator('.season-body .ep-title').first().inputValue()

  // Season 1 holds 28 episodes, so season 2's first episode is number 29.
  const secondBlock = win.locator('.season-block').nth(1)
  const s2Number = (await secondBlock.locator('.ep-num').first().innerText()).trim()
  const s2Title = await secondBlock.locator('.ep-title').first().inputValue()
  const seasonBadges = await win.locator('.season-badge').count()
  const badgesInBlocks = await win.locator('.season-block .ep-season').count()
  const seasonStrip = await win.locator('.season-chip').count()
  const anilistLink = (await win.locator('.al-link').first().innerText()).replace(/\s+/g, ' ')

  console.log(`ANILIST created: ${epRows} episode rows across ${seasons} season panels, field="${episodesField}"`)
  console.log(`ANILIST summary: ${epSummary}`)
  console.log(`ANILIST first episode: title="${firstEpTitle}" score="${firstEpScore}" (empty = unrated)`)
  console.log(`ANILIST season badges: ${seasonBadges} in headers, ${badgesInBlocks} left in rows (expected 0)`)
  console.log(`ANILIST season chips: ${seasonStrip}`)
  console.log(`ANILIST start of S2: #${s2Number} title="${s2Title}" (expected #29)`)
  console.log(`ANILIST link: ${anilistLink}`)
  await shot('10-anilist-created')

  // ---- Season parts must merge (Re:Zero 2nd Season + Part 2 = one season) ----
  await win.getByRole('button', { name: 'My Anime' }).click()
  await sleep(400)
  await win.getByRole('button', { name: 'Add anime' }).first().click()
  await sleep(400)

  await win.locator('.al-block input.input').fill('re:zero')
  await win.locator('.al-result').first().waitFor({ state: 'visible', timeout: 25000 })
  const rezeroRow = (await win.locator('.al-result').first().innerText()).replace(/\s+/g, ' ').trim()
  console.log(`PARTS: re:zero first row = ${rezeroRow}`)

  await win.locator('.al-result').first().click()
  await sleep(4000)

  await win.locator('.al-selected .pill-button').click()
  await sleep(400)
  const rezeroSeasons = (await win.locator('.al-season-list').innerText())
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' | ')
    .replace(/\s+/g, ' ')
  const mergedBadges = await win.locator('.al-season-parts').count()
  console.log(`PARTS: merged seasons text = ${rezeroSeasons}`)
  console.log(`PARTS: seasons flagged as merged = ${mergedBadges} (expected 1, for 2nd Season)`)
  await shot('11-season-parts-merged')

  await win.getByRole('button', { name: 'Cancel' }).click()
  await sleep(300)

  // ---- Confirm persistence: reload and check the data survived ----  await win.reload()
  await sleep(1500)
  const cardCount = await win.locator('.card').count()
  console.log(`PERSISTENCE: ${cardCount} cards after reload (expected 3)`)

  // Reload lands on the library view, so open the entry to read its score.
  await win.locator('.card', { hasText: 'Sousou no Frieren' }).first().click()
  await sleep(900)
  const unratedGlobal = await win.locator('.gauge-score').innerText()
  // Episodes live in collapsed panels; expand so the counts are complete.
  await win.locator('.seasons-toolbar button').click()
  await sleep(600)
  const persistedSeasons = await win.locator('.season-block').count()
  const persistedEpisodes = await win.locator('.season-body .ep-num').count()
  const persistedTitle = await win.locator('.season-body .ep-title').first().inputValue()
  console.log(
    `PERSISTENCE: Frieren TV global=${unratedGlobal} (— expected: nothing rated yet), ` +
      `${persistedEpisodes} episodes kept across ${persistedSeasons} seasons`
  )
  console.log(`PERSISTENCE: first episode title kept = "${persistedTitle}"`)

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
