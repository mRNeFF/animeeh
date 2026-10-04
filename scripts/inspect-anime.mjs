/**
 * One-off inspection helper: prints AniList relations and the episode names
 * Kitsu returns, for whatever search terms are passed on the command line.
 *
 * Usage: node scripts/inspect-anime.mjs "Steins;Gate"
 */
const KITSU = 'https://kitsu.io/api/edge'
const ANILIST = 'https://graphql.anilist.co'

const terms = process.argv.slice(2)
if (terms.length === 0) {
  console.error('Usage: node scripts/inspect-anime.mjs "<search term>" [...]')
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
  const url = `${KITSU}${path}`
  const response = await fetch(url, { headers: { Accept: 'application/vnd.api+json' } })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Kitsu HTTP ${response.status} on ${url}\n      ${body.slice(0, 200)}`)
  }
  return response.json()
}

const SEARCH = `
query ($search: String) {
  Page(perPage: 10) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id idMal title { romaji english } format seasonYear episodes
      relations { edges { relationType node { id title { romaji } format seasonYear episodes } } }
    }
  }
}`

for (const term of terms) {
  console.log(`\n${'='.repeat(78)}\nSEARCH: "${term}\n${'='.repeat(78)}`)

  let data
  try {
    data = await gql(SEARCH, { search: term })
  } catch (err) {
    console.log(`AniList error: ${err.message}`)
    continue
  }

  const media = data.Page.media
  if (media.length === 0) {
    console.log('no AniList result')
    continue
  }

  for (const m of media.slice(0, 4)) {
    console.log(
      `\n[${m.id}] anilist  mal=${m.idMal}  ${m.title.romaji} | ${m.format} ${m.seasonYear} | ${m.episodes ?? '?'} eps`
    )
    const chain = m.relations.edges.filter((e) =>
      ['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'ALTERNATIVE', 'PARENT', 'SPIN_OFF', 'SUMMARY'].includes(
        e.relationType
      )
    )
    for (const e of chain) {
      console.log(
        `    ${e.relationType.padEnd(12)} [${e.node.id}] ${e.node.title.romaji} | ${e.node.format} ${e.node.seasonYear} | ${e.node.episodes ?? '?'} eps`
      )
    }

    // What Kitsu has for this exact entry.
    try {
      const mapping = await kitsu(
        `/mappings?filter[externalSite]=anilist/anime&filter[externalId]=${m.id}&include=item`
      )
      const item = mapping.data?.[0]?.relationships?.item?.data
      if (!item || item.type !== 'anime') {
        console.log('    kitsu: no mapping')
      } else {
        const eps = await kitsu(`/anime/${item.id}/episodes?page[limit]=20`)
        const named = (eps.data ?? []).filter((e) => e.attributes?.canonicalTitle)
        console.log(
          `    kitsu: id=${item.id}  ${named.length} names on page 1, ${eps.meta?.count ?? '?'} episodes total`
        )
        for (const e of named.slice(0, 3)) {
          console.log(`        E${e.attributes.number} "${e.attributes.canonicalTitle}"`)
        }
      }
    } catch (err) {
      console.log(`    kitsu: ${err.message}`)
    }
    await new Promise((r) => setTimeout(r, 900))
  }
}
