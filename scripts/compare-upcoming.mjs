/**
 * Compares what the release calendar finds today against what a transitive
 * chain walk would find.
 *
 * The calendar reads the relations of the library's own ids, one hop. A
 * continuation several seasons later is only reachable by following SEQUEL and
 * PREQUEL repeatedly, which is what assembleFranchise already does for episode
 * names. This measures the gap before anything is changed.
 *
 * Usage: node scripts/compare-upcoming.mjs [hops]
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ANILIST = 'https://graphql.anilist.co'
const MAX_HOPS = Number(process.argv[2] ?? 6)

const dataFile = join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')
if (!existsSync(dataFile)) {
  console.error(`No data file at ${dataFile}`)
  process.exit(2)
}

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

const data = JSON.parse(readFileSync(dataFile, 'utf-8'))

/** Every id the library covers, and the title it belongs to. */
const libraryIds = new Map()
for (const a of data.anime ?? []) {
  const own = new Set()
  if (a.source?.anilistId) own.add(a.source.anilistId)
  for (const s of a.seasons ?? []) {
    if (s.anilistId) own.add(s.anilistId)
    for (const p of s.parts ?? []) if (p.anilistId) own.add(p.anilistId)
  }
  for (const id of own) if (!libraryIds.has(id)) libraryIds.set(id, a.title ?? '')
}

console.log(`library ids: ${libraryIds.size}`)
console.log(`chain walk depth: ${MAX_HOPS} hops\n`)

const FIELDS = `
  id
  title { romaji }
  format
  status
  season
  seasonYear
  startDate { year month day }
  nextAiringEpisode { episode airingAt }
`

/** One batched request for a set of ids. */
async function fetchBatch(ids) {
  const aliases = ids.map((id, i) => `m${i}: Media(id: ${id}) { ${FIELDS} relations { edges { relationType node { id } } } }`).join('\n')
  const data = await gql(`query {\n${aliases}\n}`)
  const out = new Map()
  ids.forEach((id, i) => {
    const media = data[`m${i}`]
    if (media) out.set(id, media)
  })
  return out
}

/** Walk SEQUEL and PREQUEL links outwards, collecting everything reached. */
async function walk(seedIds, maxHops) {
  const reached = new Map()
  let frontier = [...seedIds]
  const seen = new Set(seedIds)

  for (let hop = 1; hop <= maxHops; hop += 1) {
    if (frontier.length === 0) break

    const next = []
    for (let i = 0; i < frontier.length; i += 20) {
      const batch = frontier.slice(i, i + 20)
      const results = await fetchBatch(batch)
      for (const [id, media] of results) {
        reached.set(id, media)
        for (const edge of media.relations?.edges ?? []) {
          if (edge.relationType !== 'SEQUEL' && edge.relationType !== 'PREQUEL') continue
          const target = edge.node?.id
          if (!target || seen.has(target)) continue
          seen.add(target)
          next.push(target)
        }
      }
    }
    console.log(`  hop ${hop}: fetched ${frontier.length}, discovered ${next.length} more`)
    frontier = next
  }

  for (const id of seen) if (!reached.has(id)) reached.set(id, null)
  return reached
}

console.log('walking the chain…')
const reached = await walk([...libraryIds.keys()], MAX_HOPS)

/* What each approach finds ------------------------------------------------- */

const now = Math.floor(Date.now() / 1000)

/** Entries the calendar would report today: one hop, from library ids. */
const oneHop = new Map()
{
  const ids = [...libraryIds.keys()]
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20)
    const results = await fetchBatch(batch)
    for (const [id, media] of results) {
      for (const edge of media.relations?.edges ?? []) {
        if (edge.relationType !== 'SEQUEL') continue
        const target = edge.node?.id
        if (!target || libraryIds.has(target) || oneHop.has(target)) continue
        oneHop.set(target, { from: media.title.romaji })
      }
    }
  }
}

const isUpcoming = (media) =>
  media && (media.status === 'NOT_YET_RELEASED' || media.status === 'RELEASING')

const dateOf = (media) => {
  const d = media.startDate
  if (!d?.year) return null
  return `${d.year}-${String(d.month ?? 0).padStart(2, '0')}-${String(d.day ?? 0).padStart(2, '0')}`
}

console.log(`\n${'='.repeat(100)}`)
console.log('ONE HOP (what the calendar shows today)')
console.log('='.repeat(100))
const oneHopUpcoming = []
for (const [id, info] of oneHop) {
  const media = reached.get(id)
  if (!isUpcoming(media)) continue
  oneHopUpcoming.push({ id, media, from: info.from })
}
for (const e of oneHopUpcoming) {
  console.log(
    `  [${e.id}] ${e.media.title.romaji.slice(0, 44).padEnd(46)} ${String(e.media.format).padEnd(6)} ` +
      `status=${e.media.status} start=${dateOf(e.media) ?? 'none'}`
  )
}
console.log(`  -> ${oneHopUpcoming.length} upcoming entry/entries`)

console.log(`\n${'='.repeat(100)}`)
console.log(`FULL CHAIN (${MAX_HOPS} hops)`)
console.log('='.repeat(100))
const chainUpcoming = []
for (const [id, media] of reached) {
  if (libraryIds.has(id)) continue
  if (!isUpcoming(media)) continue
  chainUpcoming.push({ id, media })
}
for (const e of chainUpcoming.sort((a, b) => (dateOf(a.media) ?? '9999').localeCompare(dateOf(b.media) ?? '9999'))) {
  console.log(
    `  [${e.id}] ${e.media.title.romaji.slice(0, 44).padEnd(46)} ${String(e.media.format).padEnd(6)} ` +
      `status=${e.media.status} start=${dateOf(e.media) ?? 'none'}`
  )
}
console.log(`  -> ${chainUpcoming.length} upcoming entry/entries`)

/* The gap ------------------------------------------------------------------ */

const seenIds = new Set(oneHopUpcoming.map((e) => e.id))
const missed = chainUpcoming.filter((e) => !seenIds.has(e.id))

console.log(`\n${'='.repeat(100)}`)
console.log(`MISSED BY THE CURRENT ONE-HOP APPROACH: ${missed.length}`)
console.log('='.repeat(100))
for (const e of missed) {
  const from = libraryIds.get(e.id)
  console.log(
    `  [${e.id}] ${e.media.title.romaji.slice(0, 46).padEnd(48)} ${String(e.media.format).padEnd(6)} ` +
      `start=${dateOf(e.media) ?? 'none'}`
  )
}

const films = missed.filter((e) => e.media.format === 'MOVIE')
console.log(`\nof which films: ${films.length}`)
for (const f of films) {
  console.log(`  ${f.media.title.romaji} (${dateOf(f.media) ?? 'no date'})`)
}

console.log(
  `\nsummary: one hop finds ${oneHopUpcoming.length}, the chain finds ${chainUpcoming.length}, ` +
    `so ${missed.length} are invisible today`
)
console.log(`fetched ${[...reached.values()].filter(Boolean).length} entries while walking`)
console.log(`\nnow: ${new Date(now * 1000).toISOString().slice(0, 16)}`)
