/**
 * What does AniList actually hold for Made in Abyss?
 *
 * The calendar did not announce a Made in Abyss film, and a three-hop chain walk
 * did not reach one either, so the question is whether AniList has one at all and
 * how it is linked to the entries in the library.
 *
 * Prints every Made in Abyss entry AniList returns, with its status and date, then
 * the relations of the two ids the library holds, so the link type that connects
 * them is visible.
 *
 * Usage: node scripts/diagnose-made-in-abyss.mjs
 */
const ENDPOINT = 'https://graphql.anilist.co'

const FIELDS = `
  id
  title { romaji english }
  format
  status
  season
  seasonYear
  startDate { year month day }
  episodes
`

async function ask(query, attempt = 1) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })
  if (response.status === 429) {
    const wait = Math.min(60, 8 * attempt)
    console.log(`   429, waiting ${wait}s`)
    await new Promise((r) => setTimeout(r, wait * 1000))
    return ask(query, attempt + 1)
  }
  const json = await response.json()
  if (json.errors) throw new Error(json.errors[0].message)
  return json.data
}

/* ---- 1. Everything AniList calls Made in Abyss ---- */

const search = await ask(`query {
  Page(page: 1, perPage: 40) {
    media(search: "made in abyss", type: ANIME, sort: SEARCH_MATCH) { ${FIELDS} }
  }
}`)

const all = search.Page.media
console.log(`\n${'='.repeat(94)}`)
console.log(`AniList entries matching "made in abyss": ${all.length}`)
console.log('='.repeat(94))

const dateOf = (m) =>
  m.startDate?.year
    ? `${m.startDate.year}-${String(m.startDate.month ?? 0).padStart(2, '0')}-${String(
        m.startDate.day ?? 0
      ).padStart(2, '0')}`
    : 'no date'

for (const m of all) {
  const flag = m.status === 'NOT_YET_RELEASED' || m.status === 'RELEASING' ? ' <<<' : ''
  console.log(
    `  [${String(m.id).padEnd(7)}] ${String(m.format ?? '?').padEnd(6)} ${String(m.status).padEnd(17)} ` +
      `${dateOf(m).padEnd(12)} ${m.title.romaji.slice(0, 38)}${flag}`
  )
}

const upcoming = all.filter((m) => m.status === 'NOT_YET_RELEASED' || m.status === 'RELEASING')
console.log(`\n  upcoming or airing: ${upcoming.length}`)
for (const m of upcoming) {
  console.log(`     [${m.id}] ${m.format} ${m.title.romaji} (${dateOf(m)})`)
}

/* ---- 2. How the library's ids link to them ---- */

const LIBRARY_IDS = [
  { id: 97986, note: 'Made in Abyss, the TV season the library holds' },
  { id: 101344, note: 'Made in Abyss: Hourou Suru Tasogare, the film it holds' }
]

for (const target of LIBRARY_IDS) {
  const data = await ask(`query { Media(id: ${target.id}) {
    ${FIELDS}
    relations { edges { relationType node { ${FIELDS} } } }
  } }`)
  const media = data.Media
  if (!media) {
    console.log(`\n  [${target.id}] not found`)
    continue
  }
  console.log(`\n${'='.repeat(94)}`)
  console.log(`[${media.id}] ${media.title.romaji} — ${target.note}`)
  console.log('='.repeat(94))
  console.log(`  format ${media.format} · status ${media.status} · ${dateOf(media)}`)
  console.log(`  relations (${media.relations.edges.length}):`)
  for (const edge of media.relations.edges) {
    const n = edge.node
    const flag = n.status === 'NOT_YET_RELEASED' || n.status === 'RELEASING' ? '  <<< upcoming' : ''
    console.log(
      `     ${String(edge.relationType).padEnd(13)} [${String(n.id).padEnd(7)}] ` +
        `${String(n.format ?? '?').padEnd(6)} ${dateOf(n).padEnd(12)} ${n.title.romaji.slice(0, 34)}${flag}`
    )
  }
}

/* ---- 3. Does the chain walk reach an upcoming entry from those ids? ---- */

console.log(`\n${'='.repeat(94)}`)
console.log('walking SEQUEL and PREQUEL from the library ids, up to 4 hops')
console.log('='.repeat(94))

const seen = new Set(LIBRARY_IDS.map((l) => l.id))
let frontier = LIBRARY_IDS.map((l) => l.id)
const reachedUpcoming = []

for (let hop = 1; hop <= 4 && frontier.length > 0; hop += 1) {
  const aliases = frontier
    .map((id, i) => `m${i}: Media(id: ${id}) { id title { romaji } relations { edges { relationType node { id } } } }`)
    .join('\n')
  const data = await ask(`query {\n${aliases}\n}`)
  const next = []
  for (let i = 0; i < frontier.length; i += 1) {
    const media = data[`m${i}`]
    if (!media) continue
    for (const edge of media.relations.edges) {
      if (edge.relationType !== 'SEQUEL' && edge.relationType !== 'PREQUEL') continue
      const target = edge.node?.id
      if (!target || seen.has(target)) continue
      seen.add(target)
      next.push(target)
    }
  }
  console.log(`  hop ${hop}: from ${frontier.length} id(s), reached ${next.length} new`)

  // Check what is upcoming among the newly reached.
  if (next.length > 0) {
    const check = next
      .map((id, i) => `m${i}: Media(id: ${id}) { ${FIELDS} }`)
      .join('\n')
    const found = await ask(`query {\n${check}\n}`)
    next.forEach((id, i) => {
      const m = found[`m${i}`]
      if (m && (m.status === 'NOT_YET_RELEASED' || m.status === 'RELEASING')) {
        reachedUpcoming.push(m)
        console.log(`     upcoming: [${m.id}] ${m.format} ${m.title.romaji} (${dateOf(m)})`)
      }
    })
  }
  frontier = next
}

console.log(`\n  upcoming entries reachable by walking: ${reachedUpcoming.length}`)
if (reachedUpcoming.length === 0) {
  console.log('  none — so no amount of chain walking would announce a Made in Abyss film')
  console.log('  from these two ids, which means the library is missing the entry that')
  console.log('  the announcement hangs from.')
}
