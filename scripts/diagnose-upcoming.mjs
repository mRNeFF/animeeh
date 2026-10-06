/**
 * Explains why a given upcoming entry does or does not reach the calendar.
 *
 * The release calendar only surfaces a continuation when every one of a series
 * of conditions holds. Rather than guess which one failed, this walks the same
 * path the app takes and reports each step, for a chosen franchise.
 *
 * Usage: node scripts/diagnose-upcoming.mjs "Made in Abyss"
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ANILIST = 'https://graphql.anilist.co'

const dataFile = join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')
const needle = (process.argv[2] ?? 'Made in Abyss').toLowerCase()

async function gql(query) {
  const response = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })
  const json = await response.json()
  if (json.errors) throw new Error(json.errors[0].message)
  return json.data
}

if (!existsSync(dataFile)) {
  console.error(`No data file at ${dataFile}`)
  process.exit(2)
}

const data = JSON.parse(readFileSync(dataFile, 'utf-8'))
const matches = (data.anime ?? []).filter((a) => (a.title ?? '').toLowerCase().includes(needle))

console.log(`entries in the library matching "${needle}": ${matches.length}`)
for (const a of matches) {
  const ids = new Set()
  if (a.source?.anilistId) ids.add(a.source.anilistId)
  for (const s of a.seasons ?? []) {
    if (s.anilistId) ids.add(s.anilistId)
    for (const p of s.parts ?? []) if (p.anilistId) ids.add(p.anilistId)
  }
  console.log(`  "${a.title}" [${a.format}] status=${a.status} ids=${[...ids].join(', ')}`)
}

if (matches.length === 0) process.exit(0)

const libraryIds = new Set()
for (const a of data.anime ?? []) {
  if (a.source?.anilistId) libraryIds.add(a.source.anilistId)
  for (const s of a.seasons ?? []) {
    if (s.anilistId) libraryIds.add(s.anilistId)
    for (const p of s.parts ?? []) if (p.anilistId) libraryIds.add(p.anilistId)
  }
}

/* Walk the relations of the matching entries, exactly as the app does. ----- */

const allIds = []
for (const a of matches) {
  if (a.source?.anilistId) allIds.push(a.source.anilistId)
  for (const s of a.seasons ?? []) if (s.anilistId) allIds.push(s.anilistId)
}

const aliases = [...new Set(allIds)]
  .map(
    (id, i) =>
      `m${i}: Media(id: ${id}) {
        id
        title { romaji }
        format
        status
        airingSchedule(notYetAired: true, perPage: 5) { nodes { episode airingAt } }
        relations {
          edges {
            relationType
            node {
              id title { romaji } format status
              season seasonYear
              startDate { year month day }
              nextAiringEpisode { episode airingAt }
            }
          }
        }
      }`
  )
  .join('\n')

const result = await gql(`query {\n${aliases}\n}`)

const now = Math.floor(Date.now() / 1000)
const horizon = now + 21 * 86_400

console.log('\n--- STEP 1: is the entry itself airing? ---')
for (const [key, media] of Object.entries(result)) {
  const nodes = (media.airingSchedule?.nodes ?? []).filter(
    (n) => n.airingAt >= now && n.airingAt <= horizon
  )
  console.log(
    `  ${key} [${media.id}] ${media.title.romaji} (${media.format}, ${media.status})` +
      ` -> ${nodes.length} episode(s) in the 21-day window`
  )
}

console.log('\n--- STEP 2: every relation, and whether the calendar keeps it ---')
for (const [key, media] of Object.entries(result)) {
  const edges = media.relations?.edges ?? []
  const interesting = edges.filter((e) =>
    ['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'ALTERNATIVE', 'PARENT', 'SUMMARY', 'SPIN_OFF'].includes(
      e.relationType
    )
  )
  if (interesting.length === 0) continue

  console.log(`\n  ${media.title.romaji} [${media.id}]:`)
  for (const e of interesting) {
    const n = e.node
    const d = n.startDate
    const date = d?.year
      ? `${d.year}-${String(d.month ?? '??').padStart(2, '0')}-${String(d.day ?? '??').padStart(2, '0')}`
      : 'none'

    const reasons = []
    if (e.relationType !== 'SEQUEL') reasons.push(`relation is ${e.relationType}, not SEQUEL`)
    if (n.status !== 'NOT_YET_RELEASED' && n.status !== 'RELEASING') reasons.push(`status is ${n.status}`)
    if (libraryIds.has(n.id)) reasons.push('already in the library')

    const kept = reasons.length === 0
    console.log(
      `     ${kept ? 'KEPT  ' : 'DROPPED'} ${e.relationType.padEnd(11)} [${n.id}] ` +
        `${n.title.romaji.slice(0, 42).padEnd(44)} ${String(n.format).padEnd(6)} ` +
        `status=${String(n.status).padEnd(16)} start=${date}`
    )
    if (!kept) console.log(`              reason: ${reasons.join(' ; ')}`)
  }
}

console.log('\n--- STEP 3: is it reachable through discovery? ---')
const nowDate = new Date()
const month = nowDate.getMonth() + 1
const season = month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL'
console.log(`  discovery lists ${season} ${nowDate.getFullYear()} with status RELEASING only`)

for (const [, media] of Object.entries(result)) {
  for (const e of media.relations?.edges ?? []) {
    const n = e.node
    if (n.status !== 'NOT_YET_RELEASED') continue
    const d = n.startDate
    const label =
      d?.month === month && d?.year === nowDate.getFullYear()
        ? 'starts this month'
        : `starts ${d?.year ?? '?'}-${d?.month ?? '?'}`
    console.log(`     [${n.id}] ${n.title.romaji.slice(0, 46).padEnd(48)} ${label} -> excluded, status is NOT_YET_RELEASED`)
  }
}
