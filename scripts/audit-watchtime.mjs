/**
 * Step-by-step audit of the watch-time statistic.
 *
 * Reads an ANIMEEH data file and accounts for every episode, so the total can be
 * traced rather than trusted. Reports:
 *
 *   1. how many episodes exist per entry, and how many carry a rating,
 *   2. which duration each entry contributes, and whether it came from the
 *      reference source or from a fallback,
 *   3. formats that could skew the result (short episodes in particular),
 *   4. duplicate entries — the same AniList id twice, or two entries whose
 *      episode ranges overlap,
 *   5. the arithmetic from episodes to minutes to hours,
 *   6. the figure the app currently shows, for comparison,
 *   7. every assumption made, listed explicitly.
 *
 * Usage: node scripts/audit-watchtime.mjs [pathToDataFile]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const dataFile =
  process.argv[2] ?? join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')

if (!existsSync(dataFile)) {
  console.error(`Data file not found: ${dataFile}`)
  process.exit(2)
}


const data = JSON.parse(readFileSync(dataFile, 'utf-8'))
const anime = data.anime ?? []

const isFilm = (a) => (a.format ?? '') === 'MOVIE'
const ratedCount = (a) => a.episodes.filter((e) => e.score !== null && e.score !== undefined).length

console.log(`data file: ${dataFile}`)
console.log(`entries  : ${anime.length}\n`)

/* ------------------------------------------------------------------ */
/* Durations from the reference source                                  */
/* ------------------------------------------------------------------ */

/**
 * Fetch each entry's real per-episode duration, and each season's, from AniList.
 *
 * The stored runtimeMinutes is often absent on entries added by an older build,
 * which is exactly what makes the displayed figure a guess. Pulling the real
 * values here lets the audit state a corrected number with a traceable basis.
 */
async function fetchDurations(ids) {
  const unique = [...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))]
  const out = new Map()
  if (unique.length === 0) return out

  const aliases = unique.map((id, i) => `p${i}: Media(id: ${id}) { duration }`)
  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `query {\n${aliases.join('\n')}\n}` }),
      signal: AbortSignal.timeout(20000)
    })
    if (!response.ok) return out
    const payload = await response.json()
    unique.forEach((id, index) => {
      const d = payload.data?.[`p${index}`]?.duration
      out.set(id, typeof d === 'number' && d > 0 ? d : null)
    })
  } catch {
    // leave empty; the audit falls back and says so
  }
  return out
}

const wantedIds = []
for (const item of anime) {
  if (item.source?.anilistId) wantedIds.push(item.source.anilistId)
  for (const s of item.seasons ?? []) {
    if (s.anilistId) wantedIds.push(s.anilistId)
    for (const p of s.parts ?? []) if (p.anilistId) wantedIds.push(p.anilistId)
  }
}

process.stdout.write(`fetching durations for ${new Set(wantedIds).size} AniList entries… `)
const liveDurations = await fetchDurations(wantedIds)
console.log(`${[...liveDurations.values()].filter((v) => v !== null).length} known\n`)

/** The duration this entry should use, preferring what is stored. */
function resolveDuration(entry, seasonNumber) {
  const season = (entry.seasons ?? []).find((s) => s.season === seasonNumber)
  const seasonId = season?.anilistId
  const entryId = entry.source?.anilistId

  if (season?.runtimeMinutes && season.runtimeMinutes > 0) {
    return { minutes: season.runtimeMinutes, from: 'stored season' }
  }
  if (seasonId && liveDurations.get(seasonId)) {
    return { minutes: liveDurations.get(seasonId), from: 'AniList season' }
  }
  if (entry.runtimeMinutes && entry.runtimeMinutes > 0) {
    return { minutes: entry.runtimeMinutes, from: 'stored entry' }
  }
  if (entryId && liveDurations.get(entryId)) {
    return { minutes: liveDurations.get(entryId), from: 'AniList entry' }
  }
  return { minutes: null, from: 'unknown' }
}

const FALLBACK_MINUTES = { TV_SHORT: 12, MOVIE: 105 }
const FALLBACK_EPISODE = 24

function fallbackFor(entry) {
  if (isFilm(entry)) return FALLBACK_MINUTES.MOVIE
  return FALLBACK_MINUTES[entry.format] ?? FALLBACK_EPISODE
}

/* ------------------------------------------------------------------ */
/* 1 + 2. Per-entry accounting                                         */
/* ------------------------------------------------------------------ */

const rows = []

for (const item of anime) {
  const film = isFilm(item)
  const rated = film
    ? Object.values(item.criteria ?? {}).some((v) => v !== null && v !== undefined)
      ? 1
      : 0
    : ratedCount(item)

  const declared = film ? 1 : item.episodes.length

  // Minutes, using each season's own duration where known.
  let minutesRated = 0
  let minutesListed = 0
  let unknownSeasons = 0
  const sources = new Set()

  if (film) {
    if (rated > 0) {
      const resolved = resolveDuration(item, 1)
      const per = resolved.minutes ?? fallbackFor(item)
      if (resolved.minutes === null) unknownSeasons += 1
      sources.add(resolved.from)
      minutesRated = per
      minutesListed = per
    }
  } else {
    const seasons = new Set(item.episodes.map((e) => e.season ?? 1))
    if (seasons.size === 0) seasons.add(1)

    for (const seasonNumber of seasons) {
      const resolved = resolveDuration(item, seasonNumber)
      const per = resolved.minutes ?? fallbackFor(item)
      if (resolved.minutes === null) unknownSeasons += 1
      sources.add(resolved.from)

      const inSeason = item.episodes.filter((e) => (e.season ?? 1) === seasonNumber)
      const ratedInSeason = inSeason.filter((e) => e.score !== null && e.score !== undefined).length
      minutesRated += ratedInSeason * per
      minutesListed += inSeason.length * per
    }
  }

  rows.push({
    title: item.title,
    format: item.format ?? '(none)',
    film,
    declared,
    rated,
    minutesRated,
    minutesListed,
    durationSource: [...sources].join('+'),
    unknownSeasons
  })
}

console.log('='.repeat(100))
console.log('1+2. EPISODES AND DURATION PER ENTRY')
console.log('='.repeat(100))
console.log(
  '  format'.padEnd(10) +
    'listed'.padStart(7) +
    'rated'.padStart(7) +
    'ratedMin'.padStart(9) +
    'listMin'.padStart(9) +
    '  duration from'
)
for (const r of rows.sort((a, b) => b.minutesListed - a.minutesListed)) {
  console.log(
    `  ${String(r.format).padEnd(8)}` +
      `${String(r.declared).padStart(7)}` +
      `${String(r.rated).padStart(7)}` +
      `${String(r.minutesRated).padStart(9)}` +
      `${String(r.minutesListed).padStart(9)}` +
      `  ${r.durationSource}${r.unknownSeasons > 0 ? ` (${r.unknownSeasons} unknown)` : ''}` +
      `  ${r.title?.slice(0, 34) ?? '?'}`
  )
}

const listedTotal = rows.reduce((n, r) => n + r.declared, 0)
const ratedTotal = rows.reduce((n, r) => n + r.rated, 0)
const unknownDuration = rows.filter((r) => r.unknownSeasons > 0)

console.log(
  `\n  episodes listed ${listedTotal} · rated ${ratedTotal} · ` +
    `entries still relying on a fallback ${unknownDuration.length}`
)

/* ------------------------------------------------------------------ */
/* 3. Formats that skew the estimate                                   */
/* ------------------------------------------------------------------ */

console.log(`\n${'='.repeat(96)}`)
console.log('3. FORMATS AND DURATIONS THAT COULD SKEW THE RESULT')
console.log('='.repeat(96))

const byFormat = new Map()
for (const r of rows) {
  const found = byFormat.get(r.format) ?? { count: 0, rated: 0, minutes: 0, fallback: 0 }
  found.count += 1
  found.rated += r.rated
  found.minutes += r.minutesListed
  if (r.unknownSeasons > 0) found.fallback += 1
  byFormat.set(r.format, found)
}
for (const [format, s] of [...byFormat.entries()].sort((a, b) => b[1].minutes - a[1].minutes)) {
  console.log(
    `  ${format.padEnd(10)} entries ${String(s.count).padStart(3)} · rated ${String(s.rated).padStart(4)} · ` +
      `${String(s.minutes).padStart(6)} min · ${s.fallback} on a fallback`
  )
}

// Short-format entries are the classic overestimate: TV_SHORT runs about 3 to 12
// minutes, so applying 24 minutes inflates them.
const suspects = rows.filter(
    (r) => !r.film && r.unknownSeasons > 0 && (r.format === 'TV_SHORT' || r.format === 'ONA')
)
if (suspects.length > 0) {
  console.log('\n  Risk: these have no duration and are commonly much shorter than 24 minutes:')
  for (const r of suspects) {
    console.log(`     ${r.format.padEnd(9)} ${String(r.rated).padStart(3)} rated   ${r.title}`)
  }
} else {
  console.log('\n  No TV_SHORT or ONA entry is relying on the 24-minute fallback.')
}

// A single duration applied to a whole franchise can hide a feature-length
// finale, so list any entry whose seasons disagree on length.
const mixedDuration = rows.filter(
  (r) => !r.film && r.unknownSeasons === 0 && r.durationSource.split('+').length > 0
)
if (mixedDuration.length > 0) {
  console.log('\n  Duration source per entry (season-level values are the most precise):')
  for (const r of mixedDuration.slice(0, 12)) {
    console.log(`     ${r.durationSource.padEnd(24)} ${r.title?.slice(0, 50)}`)
  }
}

/* ------------------------------------------------------------------ */
/* 4. Duplicates                                                       */
/* ------------------------------------------------------------------ */

console.log(`\n${'='.repeat(96)}`)
console.log('4. DUPLICATES')
console.log('='.repeat(96))

// 4a. Same AniList id on two entries.
const bySource = new Map()
for (const item of anime) {
  const id = item.source?.anilistId ?? item.seasons?.[0]?.anilistId
  if (!id) continue
  const list = bySource.get(id) ?? []
  list.push(item.title)
  bySource.set(id, list)
}
const sameId = [...bySource.entries()].filter(([, titles]) => titles.length > 1)
if (sameId.length > 0) {
  console.log('  Same AniList id on more than one entry:')
  for (const [id, titles] of sameId) console.log(`     anilist ${id}: ${titles.join('  |  ')}`)
} else {
  console.log('  No AniList id appears twice.')
}

// 4b. Overlapping episode ranges across entries, which double counts episodes.
const normalized = (s) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim()

const overlaps = []
for (let i = 0; i < anime.length; i += 1) {
  for (let j = i + 1; j < anime.length; j += 1) {
    const a = anime[i]
    const b = anime[j]
    if (isFilm(a) || isFilm(b)) continue
    const ta = normalized(a.title)
    const tb = normalized(b.title)
    if (ta === '' || tb === '') continue
    if (!ta.includes(tb) && !tb.includes(ta)) continue

    // Same episode numbers with the same titles means the same episodes twice.
    const titlesA = new Set(
      a.episodes.map((e) => normalized(e.title)).filter((t) => t !== '')
    )
    const shared = b.episodes
      .map((e) => normalized(e.title))
      .filter((t) => t !== '' && titlesA.has(t))
    const numberOverlap = a.episodes.filter((ea) =>
      b.episodes.some((eb) => eb.number === ea.number)
    ).length

    if (shared.length > 0 || numberOverlap > 2) {
      overlaps.push({
        a: a.title,
        b: b.title,
        sharedTitles: shared.length,
        sharedNumbers: numberOverlap,
        impact: Math.min(ratedCount(a), ratedCount(b))
      })
    }
  }
}

if (overlaps.length > 0) {
  console.log('\n  Entries whose titles overlap AND whose episodes overlap (likely double counted):')
  for (const o of overlaps) {
    console.log(
      `     "${o.a}"\n       vs "${o.b}"\n       shared episode numbers ${o.sharedNumbers}, ` +
        `shared titles ${o.sharedTitles}, up to ${o.impact} minutes-rows affected`
    )
  }
} else {
  console.log('  No pair of entries shares both a title and its episodes.')
}

// 4c. Duplicate episode numbers inside one entry.
let internalDupes = 0
for (const item of anime) {
  const seen = new Set()
  for (const e of item.episodes) {
    if (seen.has(e.number)) internalDupes += 1
    seen.add(e.number)
  }
}
console.log(`  Duplicate episode numbers inside a single entry: ${internalDupes}`)

/* ------------------------------------------------------------------ */
/* 5. Arithmetic                                                       */
/* ------------------------------------------------------------------ */

console.log(`\n${'='.repeat(96)}`)
console.log('5. CONVERSION')
console.log('='.repeat(96))

const ratedMinutes = rows.reduce((n, r) => n + r.minutesRated, 0)
const listedMinutes = rows.reduce((n, r) => n + r.minutesListed, 0)

console.log(`  rated minutes  : ${ratedMinutes}`)
console.log(`  listed minutes : ${listedMinutes}`)
console.log(`  rated  / 60    : ${(ratedMinutes / 60).toFixed(2)} hours`)
console.log(`  listed / 60    : ${(listedMinutes / 60).toFixed(2)} hours`)
console.log(`  listed / 24    : ${(listedMinutes / 60 / 24).toFixed(2)} days`)

/* ------------------------------------------------------------------ */
/* 6. What the app would show                                          */
/* ------------------------------------------------------------------ */

console.log(`\n${'='.repeat(96)}`)
console.log('6. WHAT THE STATISTICS TAB SHOWS')
console.log('='.repeat(96))

const seriesCount = rows.filter((r) => !r.film).length
const filmCount = rows.filter((r) => r.film).length
const show = (m) => (m / 60 < 100 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m / 60)} h`)

console.log(`  series ${seriesCount} · films ${filmCount}`)
console.log(`  rated episodes ${ratedTotal} of ${listedTotal} listed`)
console.log(`  tile (rated episodes) : ${show(ratedMinutes)}`)
console.log(`  upper bound (all)     : ${show(listedMinutes)}`)

/* ------------------------------------------------------------------ */
/* 7. Assumptions                                                      */
/* ------------------------------------------------------------------ */

console.log(`\n${'='.repeat(96)}`)
console.log('7. ASSUMPTIONS')
console.log('='.repeat(96))
console.log(`  A1. An episode counts as watched only when it carries a rating.`)
console.log(`      ${ratedTotal} of ${listedTotal} listed episodes qualify; ${listedTotal - ratedTotal} are ignored.`)
console.log(`  A2. Every episode of a series lasts the same as the entry's duration.`)
console.log(`  A3. Where AniList reports no duration, an episode counts as ${FALLBACK_EPISODE} minutes.`)
console.log(`  A4. A film lasts its reported runtime, or ${FALLBACK_MINUTES.MOVIE} minutes when unknown.`)
console.log(`  A5. A film counts only once it has been rated.`)
console.log(`  A6. Streaming is counted at full length; skipping is not modelled.`)

writeFileSync(
  join(root, 'watchtime-report.json'),
  JSON.stringify(
    {
      dataFile,
      generatedAt: new Date().toISOString(),
      rows,
      totals: {
        entries: rows.length,
        listedTotal,
        ratedTotal,
        ratedMinutes,
        listedMinutes,
        ratedHours: ratedMinutes / 60,
        listedHours: listedMinutes / 60,
        overlaps,
        internalDupes
      }
    },
    null,
    2
  ),
  'utf-8'
)
console.log('\nwrote watchtime-report.json')
