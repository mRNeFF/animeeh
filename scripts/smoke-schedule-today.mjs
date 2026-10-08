/**
 * Verifies that the day's episodes stay on the calendar after they have aired.
 *
 * The claim to falsify is specific: an episode that aired earlier today must
 * still be listed tonight. So this finds a show that genuinely aired between
 * local midnight and now — from AniList itself, not a fixture — seeds the library
 * with it, and checks that the calendar shows it under today's heading.
 *
 * Before the fix this failed: the collection window started at `now`, so the
 * episode was dropped the moment it aired.
 *
 * Usage: node scripts/smoke-schedule-today.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENDPOINT = 'https://graphql.anilist.co'

let failures = 0
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures += 1
  console.log(`   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`)
}

/* ---- 1. A show that really aired earlier today ---------------------- */

const midnight = new Date()
midnight.setHours(0, 0, 0, 0)
const from = Math.floor(midnight.getTime() / 1000)
const now = Math.floor(Date.now() / 1000)

console.log(`local midnight ${midnight.toISOString()}  ·  now ${new Date(now * 1000).toISOString()}`)
console.log(`ahead of now today: ${Math.round((now - from) / 60)} minutes\n`)

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({
    query: `query {
      Page(page: 1, perPage: 40) {
        airingSchedules(
          airingAt_greater: ${from - 1}
          airingAt_lesser: ${now}
          sort: TIME
        ) {
          episode
          airingAt
          media { id title { romaji english } format status }
        }
      }
    }`
  })
})
const payload = await response.json()
if (payload.errors?.length) {
  console.log(`AniList rejected the probe: ${payload.errors[0].message}`)
  process.exit(1)
}

const animeFormats = new Set(['TV', 'TV_SHORT', 'ONA', 'OVA', 'MOVIE', 'SPECIAL'])
const candidates = (payload.data?.Page?.airingSchedules ?? []).filter(
  (node) => node.media?.id && animeFormats.has(node.media.format ?? '')
)

if (candidates.length === 0) {
  // Honest skip: nothing aired yet today, so there is nothing to assert.
  console.log('Nothing has aired yet today, so there is nothing to verify. Run this later in the day.')
  process.exit(0)
}

// Prefer a show still airing, so it also has upcoming episodes and the panel is
// populated for reasons beyond this one row.
const target =
  candidates.find((node) => node.media.status === 'RELEASING') ?? candidates[0]
const airingAt = target.airingAt
const title = target.media.title?.romaji || target.media.title?.english

console.log(`chosen: ${title}  (id ${target.media.id})`)
console.log(`  episode ${target.episode}, aired ${new Date(airingAt * 1000).toLocaleTimeString('fr-FR')}`)
console.log(`  ${Math.round((now - airingAt) / 60)} minutes ago, and ${candidates.length} shows aired earlier today\n`)

check('the chosen episode is in the past', airingAt < now, true)
check('and it is still today', airingAt >= from, true)

/* ---- 2. Seed a library with it, and open the calendar --------------- */

const weights = {
  characters: 1, story: 1, animation: 1, ost: 1,
  opening: 1, keyFactor: 1, originality: 1, episodeAverage: 1
}

const profile = mkdtempSync(join(tmpdir(), 'animeeh-today-'))
writeFileSync(
  join(profile, 'animeeh-data.json'),
  JSON.stringify({
    version: 1,
    settings: { weights, checkForUpdatesOnStartup: false, language: 'fr' },
    anime: [
      {
        id: 'a1',
        title,
        status: 'watching',
        episodes: [],
        criteria: {},
        source: { provider: 'anilist', anilistId: target.media.id, malId: null, siteUrl: '' },
        seasons: [
          { season: 1, anilistId: target.media.id, malId: null, title }
        ],
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  await sleep(2500)
  await win.locator('.sidebar .nav-item', { hasText: /Calendrier/ }).click()

  // The calendar fetches on mount when there is no cache; give it room and retry
  // once through Refresh, as the other calendar test does.
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (await win.locator('.sched-episodes').isVisible().catch(() => false)) break
    const error = await win.locator('.error-text').first().innerText().catch(() => '')
    if (error) {
      console.log(`\nFETCH ERROR: ${error.replace(/\s+/g, ' ').trim()}`)
      await win.locator('.sched-episodes button, .toolbar button').first().click().catch(() => {})
    }
    await sleep(1500)
  }

  await sleep(800)

  /* ---- 3. Today's heading, and the episode under it ---------------- */

  const expectedToday = new Date(now * 1000).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long'
  })
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

  const dayNames = (await win.locator('.sched-day-name').allInnerTexts()).map((s) => s.trim())
  const rows = await win.locator('.sched-episodes .sched-row').count()

  console.log(`TODAY: ${expectedToday}`)
  console.log(`   ${dayNames.length} day group(s), ${rows} row(s)`)
  for (const name of dayNames) console.log(`      ${name}`)

  // Scoped to today's own group, so this cannot pass because the episode appeared
  // under some later day — which is exactly what the old window would have done
  // with the following week's episode.
  const today = win.locator('.sched-day').filter({ hasText: expectedToday })
  const todayTitles = (await today.locator('.sched-title').allInnerTexts()).map((s) => s.trim())
  const todayPills = (await today.locator('.pill').allInnerTexts()).map((s) => s.trim())
  const todayTimes = (await today.locator('.sched-time').allInnerTexts()).map((s) => s.trim())

  console.log(`TODAY GROUP: ${todayTitles.length} row(s)`)
  for (let i = 0; i < todayTitles.length; i += 1) {
    console.log(`      ${todayTimes[i] ?? ''}  - ${todayTitles[i]}  ${todayPills[i] ?? ''}`)
  }

  await win.screenshot({ path: join(root, 'smoke-today-calendar.png') })

  check('today has a heading', dayNames.some((name) => same(name, expectedToday)), true)
  check('today is the first day shown', same(dayNames[0] ?? '', expectedToday), true)
  check(
    'the show is listed under today',
    todayTitles.some((t) => t === title),
    true
  )
  check(
    'with the episode that already aired',
    todayPills.some((p) => same(p, `Ép. ${target.episode}`)),
    true
  )
  check(
    'and a time earlier than now',
    todayTimes.some((t) => {
      const [h, m] = t.split(':').map(Number)
      const at = new Date(airingAt * 1000)
      return h === at.getHours() && m === at.getMinutes()
    }),
    true
  )
} catch (err) {
  failures += 1
  console.log(`\n[script] ${err.message}`)
  await win.screenshot({ path: join(root, 'smoke-today-failure.png') }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}

console.log(`\n${failures === 0 ? 'TODAY TEST OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
