/**
 * Focused check: how does Kitsu number the episodes of a season that aired in
 * two cours, and does the mapping differ per cours?
 *
 * The app merges "2nd Season" and "2nd Season Part 2" into one season, but each
 * part is a separate AniList entry with its own Kitsu counterpart. If Kitsu
 * numbers a part's episodes from 1 while the app expects continuation, every
 * title after that point lands on the wrong episode.
 *
 * Usage: node scripts/inspect-episode-numbering.mjs 108632 119661 21355
 */
const ANILIST = 'https://graphql.anilist.co'
const KITSU = 'https://kitsu.io/api/edge'

const ids = process.argv.slice(2).map(Number).filter(Number.isFinite)
if (ids.length === 0) {
  console.error('Usage: node scripts/inspect-episode-numbering.mjs <anilistId> [...]')
  process.exit(2)
}

async function gql(query, variables) {
  const response = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  const json = await response.json()
  if (json.errors) throw new Error(json.errors[0].message)
  return json.data
}

async function kitsu(path) {
  const response = await fetch(`${KITSU}${path}`, {
    headers: { Accept: 'application/vnd.api+json' }
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status} ${body.slice(0, 120)}`)
  }
  return response.json()
}

let last = 0
async function paced(fn) {
  const wait = 900 - (Date.now() - last)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  last = Date.now()
  return fn()
}

for (const id of ids) {
  console.log(`\n${'='.repeat(74)}`)
  const media = await gql(
    'query ($id: Int) { Media(id: $id) { id title { romaji } format seasonYear episodes } }',
    { id }
  )
  const m = media.Media
  console.log(`ANILIST ${id}: ${m?.title?.romaji} | ${m?.format} ${m?.seasonYear} | declares ${m?.episodes ?? '?'} eps`)

  const mapping = await paced(() =>
    kitsu(`/mappings?filter[externalSite]=anilist/anime&filter[externalId]=${id}&include=item`)
  )
  const item = mapping.data?.[0]?.relationships?.item?.data
  if (!item || item.type !== 'anime') {
    console.log('  KITSU: no mapping')
    continue
  }

  const animeMeta = await paced(() => kitsu(`/anime/${item.id}`))
  const attrs = animeMeta.data?.attributes ?? {}
  console.log(
    `  KITSU ${item.id}: "${attrs.canonicalTitle}" | ${attrs.episodeCount ?? '?'} eps | ${attrs.startDate}`
  )

  // Walk every page so the numbering is fully visible.
  const all = []
  for (let offset = 0; offset < 200; offset += 20) {
    const page = await paced(() => kitsu(`/anime/${item.id}/episodes?page[limit]=20&page[offset]=${offset}`))
    const data = page.data ?? []
    all.push(...data)
    if (data.length < 20) break
  }

  const numbers = all.map((e) => e.attributes?.number)
  const seasons = [...new Set(all.map((e) => e.attributes?.seasonNumber))]
  console.log(`  KITSU episodes: ${all.length} rows, seasonNumber(s) = ${seasons.join(', ')}`)
  console.log(`  number range  : ${Math.min(...numbers)} .. ${Math.max(...numbers)}`)

  const withTitles = all.filter((e) => e.attributes?.canonicalTitle)
  console.log(`  named         : ${withTitles.length}/${all.length}`)
  for (const e of all.slice(0, 3)) {
    console.log(`      S${e.attributes.seasonNumber} E${e.attributes.number} "${e.attributes.canonicalTitle}"`)
  }
  console.log('      …')
  for (const e of all.slice(-2)) {
    console.log(`      S${e.attributes.seasonNumber} E${e.attributes.number} "${e.attributes.canonicalTitle}"`)
  }
}
