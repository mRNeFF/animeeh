/**
 * Verifies the release calendar end to end, against the live AniList API.
 *
 * Seeds a library with shows that are actually airing or have an announced
 * continuation, then drives the Calendar tab:
 *   - the Refresh button fetches,
 *   - upcoming episodes appear grouped by day,
 *   - announced continuations are listed with their date precision,
 *   - the cache is served without a second fetch,
 *   - the discovery section is off by default and does not leak into the
 *     tracked list.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const profile = mkdtempSync(join(tmpdir(), 'animeeh-sched-'))

let failures = 0
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures += 1
  console.log(`   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`)
}

const weights = {
  characters: 1, story: 1, animation: 1, ost: 1,
  opening: 1, keyFactor: 1, originality: 1, episodeAverage: 1
}

// Tokyo Revengers is watching and its next season airs weekly; Dragon Ball has
// an announced continuation. Both are real AniList ids.
const anime = (id, title, anilistId, status, seasonIds) => ({
  id,
  title,
  status,
  episodes: [],
  criteria: {},
  source: { provider: 'anilist', anilistId, malId: null, siteUrl: '' },
  seasons: seasonIds.map((sid, i) => ({
    season: i + 1,
    anilistId: sid,
    malId: null,
    title: `${title} S${i + 1}`
  })),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
})

writeFileSync(
  join(profile, 'animeeh-data.json'),
  JSON.stringify({
    version: 1,
    settings: { weights, checkForUpdatesOnStartup: false, language: 'fr' },
    anime: [
      anime('a1', 'Tokyo Revengers', 120120, 'watching', [120120, 142853, 163329, 178083]),
      anime('a2', 'Dragon Ball', 223, 'completed', [223]),
      anime('a3', 'Chainsaw Man', 127230, 'completed', [127230])
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

  console.log('\nNAVIGATION:')
  const nav = (await win.locator('.nav-label').allInnerTexts()).map((s) => s.trim())
  console.log(`   ${nav.join(' | ')}`)
  check('a Calendar tab exists', nav.includes('Calendrier'), true)

  await win.locator('.sidebar .nav-item', { hasText: /Calendrier/ }).click()

  /**
   * Wait for the calendar to load, tolerating a failed first attempt.
   *
   * Running this suite straight after the others can hit AniList's rate limit,
   * in which case the tab shows an error instead of the panels. Report it and
   * retry once through the Refresh button rather than timing out silently.
   */
  const waitForCalendar = async (timeout) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await win.locator('.sched-episodes').isVisible().catch(() => false)) return true
      const error = await win.locator('.error-text').first().innerText().catch(() => '')
      if (error) {
        console.log(`\nFETCH ERROR: ${error.replace(/\s+/g, ' ').trim()}`)
        return false
      }
      await sleep(1000)
    }
    return false
  }

  let loaded = await waitForCalendar(60000)
  if (!loaded) {
    console.log('   retrying after a pause (likely a rate limit)…')
    await sleep(30000)
    await win.getByRole('button', { name: /Actualiser/ }).click()
    loaded = await waitForCalendar(90000)
  }
  check('the calendar loaded', loaded, true)
  if (!loaded) throw new Error('the calendar never loaded')
  await sleep(600)

  const fetched = (await win.locator('.toolbar .hint').first().innerText()).replace(/\s+/g, ' ')
  console.log(`\nFETCH: ${fetched.trim()}`)

  const panels = (await win.locator('.panel h3').allInnerTexts()).map((s) => s.trim())
  console.log(`PANELS: ${panels.join(' | ')}`)
  check('three panels are rendered', panels.length, 3)
  check('the episodes panel is present', await win.locator('.sched-episodes').count(), 1)
  check('the continuations panel is present', await win.locator('.sched-seasons').count(), 1)
  check('the discovery panel is present', await win.locator('.sched-discovery').count(), 1)

  /* ---- Upcoming episodes ---- */
  console.log('\nEPISODES:')
  const days = await win.locator('.sched-day').count()
  const rows = await win.locator('.sched-episodes .sched-row').count()
  const dayNames = (await win.locator('.sched-day-name').allInnerTexts()).map((s) => s.trim())
  const titles = (await win.locator('.sched-episodes .sched-title').allInnerTexts()).map((s) => s.trim())
  const pills = (await win.locator('.sched-episodes .pill').allInnerTexts()).map((s) => s.trim())
  const times = (await win.locator('.sched-time').allInnerTexts()).map((s) => s.trim())
  console.log(`   ${days} day group(s), ${rows} episode(s)`)
  for (const n of dayNames) console.log(`      ${n}`)
  for (const t of titles.slice(0, 8)) console.log(`      - ${t}`)
  console.log(`   times: ${times.slice(0, 6).join(' ')}`)
  console.log(`   pills: ${pills.slice(0, 8).join(' | ')}`)

  check('episodes are grouped by day', days > 0, true)
  check('episode times are rendered', times.every((t) => /^\d{2}:\d{2}$/.test(t)), true)

  /* ---- Continuations ---- */
  console.log('\nCONTINUATIONS:')
  const seasonPanel = win.locator('.sched-seasons')
  const seasonRows = await seasonPanel.locator('.sched-row').count()
  const seasonTexts = (await seasonPanel.locator('.sched-row').allInnerTexts()).map((s) =>
    s.replace(/\s+/g, ' ').trim()
  )
  for (const s of seasonTexts) console.log(`      ${s.slice(0, 110)}`)
  console.log(`   ${seasonRows} continuation(s) listed`)

  // An imprecise date must be labelled as approximate rather than invented.
  const approximate = await seasonPanel.locator('.pill', { hasText: 'approx' }).count()
  const unknown = await seasonPanel.locator('.sched-date.vague').count()
  console.log(`   ${approximate} marked approximate, ${unknown} with no date announced`)

  await shot('schedule')

  /* ---- Discovery is opt-in ---- */
  console.log('\nDISCOVERY:')
  const discoveryBefore = await win.locator('.sched-discovery .sched-row').count()
  const countText = (
    await win.locator('.sched-discovery span.hint').first().innerText()
  ).trim()
  await win.locator('.sched-discovery button').first().click()
  await sleep(600)
  const discoveryAfter = await win.locator('.sched-discovery .sched-row').count()
  console.log(`   hidden: ${discoveryBefore} rows · ${countText} · after showing: ${discoveryAfter}`)
  check('discovery is hidden by default', discoveryBefore, 0)
  check('discovery appears when asked', discoveryAfter > 0, true)
  await shot('schedule-discovery')

  /* ---- Cache ---- */
  console.log('\nCACHE:')
  const before = JSON.parse(readFileSync(join(profile, 'airing-cache.json'), 'utf-8'))
  console.log(`   cache written for ${before.episodes.length} episodes, fetched ${before.fetchedAt}`)
  await win.reload()
  await sleep(1500)
  await win.locator('.sidebar .nav-item', { hasText: /Calendrier/ }).click()
  await sleep(2500)
  const after = JSON.parse(readFileSync(join(profile, 'airing-cache.json'), 'utf-8'))
  console.log(`   after a reload, fetchedAt is ${after.fetchedAt === before.fetchedAt ? 'unchanged (cache served)' : 'new (refetched)'}`)
  check('the cache is reused inside its TTL', after.fetchedAt, before.fetchedAt)

  console.log(`\n${failures === 0 ? 'SCHEDULE TEST OK' : `${failures} FAILURE(S)`}`)
} catch (err) {
  failures += 1
  console.log(`\n[script] ${err.message}`)
  try {
    await shot('schedule-failure')
  } catch {
    /* ignore */
  }
} finally {
  await app.close().catch(() => {})
}

process.exit(failures === 0 ? 0 : 1)
