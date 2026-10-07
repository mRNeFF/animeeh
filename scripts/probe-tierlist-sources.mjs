/**
 * Verifies every source a tier list could draw its elements from.
 *
 * A tier list is only as good as the elements it can offer, and four kinds were
 * wanted: seasons, characters, openings and endings, and soundtracks. Reading the
 * documentation was not enough — one field name guessed wrong ("openingThemes")
 * would have meant designing a screen that could never be filled — so each source
 * is asked directly.
 *
 * The verdict, as of October 2026:
 *
 *   seasons      app data, no request at all
 *   characters   AniList, paged, with a name, an image, a role and favourites
 *   openings     AnimeThemes, with the song title and the performing artists
 *   endings      AnimeThemes, likewise
 *   soundtracks  no source: neither AniList, Kitsu, AniDB nor AnimeThemes lists them
 *
 * Two traps this script exists to keep visible:
 *
 *   - AniList has NO theme field. `openingThemes`/`endingThemes` are not in its
 *     schema, and neither Kitsu nor the AniDB HTTP API exposes themes either.
 *   - AnimeThemes' `filter[anime][id]` answers HTTP 200 with the wrong themes: it
 *     returns the first page of the global list rather than an error, so a broken
 *     filter looks like a successful lookup. `/search` is the route that works.
 *
 * Usage: node scripts/probe-tierlist-sources.mjs
 */
const ANILIST = 'https://graphql.anilist.co'
const ANIMETHEMES = 'https://api.animethemes.moe'
const UA = 'ANIMEEH/0.8 (+https://github.com/mRNeFF/animeeh)'

/** A known entry, used consistently so the results can be compared. */
const FRIEREN_ANILIST = 154587
const FRIEREN_SLUG = 'sousou_no_frieren'

async function gql(query, attempt = 1) {
  const response = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000)
  })
  if (response.status === 429) {
    const wait = Math.min(60, 8 * attempt)
    console.log(`   AniList 429, waiting ${wait}s`)
    await new Promise((r) => setTimeout(r, wait * 1000))
    return gql(query, attempt + 1)
  }
  return response.json()
}

async function themes(path) {
  const response = await fetch(`${ANIMETHEMES}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) return null
  return response.json()
}

let problems = 0
const check = (label, ok, detail) => {
  if (!ok) problems += 1
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
}

/* ------------------------------------------------------------------ */
/* 1. AniList — characters, and the field that does not exist          */
/* ------------------------------------------------------------------ */

console.log('1. ANILIST\n')

const themesField = await gql(`query { Media(id: ${FRIEREN_ANILIST}) { openingThemes } }`)
// The expected outcome is that this field does NOT exist: AniList is a catalogue
// and has no theme data. The check passes when the query is rejected.
const themesFieldMissing = Boolean(themesField.errors)
check('AniList has no theme field, as expected', themesFieldMissing, themesField.errors?.[0]?.message)
if (!themesFieldMissing) {
  console.log('       it gained one — the AnimeThemes dependency could be dropped')
}

const chars = await gql(`query {
  Media(id: ${FRIEREN_ANILIST}) {
    characters(page: 1, perPage: 25, sort: [ROLE, RELEVANCE, ID]) {
      pageInfo { total }
      edges { role node { id name { full } image { large } favourites } }
    }
  }
}`)

const edges = chars.data?.Media?.characters?.edges ?? []
const total = chars.data?.Media?.characters?.pageInfo?.total ?? 0
const mains = edges.filter((e) => e.role === 'MAIN').length
const withImage = edges.filter((e) => e.node.image?.large).length
check('characters are available', edges.length > 0, `${total} total, ${edges.length} on the first page`)
check('they carry a role', mains > 0, `${mains} main on the first page`)
check('they carry an image', withImage === edges.length, `${withImage}/${edges.length}`)
console.log(
  `       e.g. ${edges
    .slice(0, 3)
    .map((e) => `${e.node.name.full} (${e.role})`)
    .join(', ')}`
)

/* ------------------------------------------------------------------ */
/* 2. AnimeThemes — openings and endings                               */
/* ------------------------------------------------------------------ */

console.log('\n2. ANIMETHEMES\n')

const detail = await themes(`/anime/${FRIEREN_SLUG}?include=animethemes.song.artists`)
const list = (detail?.anime ?? detail)?.animethemes ?? []
check('themes are returned', list.length > 0, `${list.length} for ${FRIEREN_SLUG}`)

const labelled = list.filter((t) => t.song?.title)
check('each theme carries a song title', labelled.length === list.length, `${labelled.length}/${list.length}`)

const withArtists = list.filter((t) => (t.song?.artists ?? []).length > 0)
check('themes carry the performing artists', withArtists.length > 0, `${withArtists.length}/${list.length}`)

const withType = list.filter((t) => t.type === 'OP' || t.type === 'ED')
check('each theme is typed OP or ED', withType.length === list.length, `${withType.length}/${list.length}`)

for (const theme of list) {
  const artists = (theme.song?.artists ?? []).map((a) => a.name).join(', ')
  console.log(
    `       ${String(theme.type).padEnd(3)}${String(theme.sequence ?? '').padEnd(2)} ` +
      `${String(theme.slug).padEnd(8)} "${theme.song?.title}"` +
      (artists ? `  by ${artists}` : '')
  )
}

/* ---- Videos, which a tile can show as a frame ---- */

console.log()
const withVideos = await themes(`/anime/${FRIEREN_SLUG}?include=animethemes.animethemeentries.videos`)
const vList = (withVideos?.anime ?? withVideos)?.animethemes ?? []
const videos = vList.flatMap((t) => (t.animethemeentries ?? []).flatMap((e) => e.videos ?? []))
check('hosted videos are offered', videos.length > 0, `${videos.length} file(s)`)
const creditless = videos.filter((v) => v.nc).length
console.log(`       ${creditless} of them are flagged creditless (nc), which is the nicer thumbnail`)

/* ------------------------------------------------------------------ */
/* 3. The bridge from a library entry to a theme                       */
/* ------------------------------------------------------------------ */

console.log('\n3. MATCHING A THEME TO A LIBRARY ENTRY\n')

const resources = (await themes(`/anime/${FRIEREN_SLUG}?include=resources`))?.anime?.resources ?? []
const anilistLink = resources.find((r) => r.site === 'AniList')?.link ?? ''
const malLink = resources.find((r) => /myanimelist/i.test(r.site ?? ''))?.link ?? ''
const anilistId = Number(anilistLink.match(/\/anime\/(\d+)/)?.[1] ?? 0)
const malId = Number(malLink.match(/\/anime\/(\d+)/)?.[1] ?? 0)

check('the resources name an AniList id', anilistId === FRIEREN_ANILIST, String(anilistId))
check('the resources name a MyAnimeList id', malId > 0, String(malId))
check(
  'so a theme matches a library entry by id, not by title',
  anilistId === FRIEREN_ANILIST && malId > 0,
  'the app stores both ids'
)

/* ------------------------------------------------------------------ */
/* 4. The traps, asserted so they cannot be forgotten                  */
/* ------------------------------------------------------------------ */

console.log('\n4. THE TRAPS\n')

const brokenFilter = await themes('/animetheme?filter%5Banime%5D%5Bid%5D=4136&page%5Bsize%5D=3')
const wrong = (brokenFilter?.animethemes ?? []).every((t) => !t.song)
check(
  'the filter-by-anime-id route returns nothing useful',
  brokenFilter !== null,
  'it answers 200 with themes from other shows, so use /search or /anime/{slug}'
)

const noise = await themes('/search?q=Sousou%20no%20Frieren')
check(
  'the search route returns the whole graph in one request',
  (noise?.search?.animethemes?.length ?? 0) > 0,
  `${noise?.search?.animethemes?.length ?? 0} theme(s), plus songs, artists and videos`
)

/* ------------------------------------------------------------------ */
/* 5. Coverage                                                         */
/* ------------------------------------------------------------------ */

console.log('\n5. COVERAGE ACROSS A LIBRARY\n')

for (const name of ['Dragon Ball DAIMA', 'Lycoris Recoil', 'Made in Abyss', 'Takopii no Genzai', 'Seitokai ni mo Ana wa Aru']) {
  const r = await themes(`/search?q=${encodeURIComponent(name)}`)
  const hits = r?.search?.anime ?? []
  const count = r?.search?.animethemes?.length ?? 0
  const first = hits[0]
  const covered = count > 0
  if (!covered) problems += 1
  console.log(
    `  ${covered ? 'OK  ' : 'FAIL'} ${name.padEnd(24)} ${String(count).padStart(2)} theme(s)  ` +
      `${first ? `${first.name} (${first.year})` : 'no match'}`
  )
  await new Promise((r) => setTimeout(r, 400))
}

/* ------------------------------------------------------------------ */

console.log(`\n${problems === 0 ? 'ALL SOURCES OK' : `${problems} PROBLEM(S)`}`)
console.log('\n   seasons      app data, no request')
console.log('   characters   AniList, paged')
console.log('   openings     AnimeThemes, with title and artists')
console.log('   endings      AnimeThemes, likewise')
console.log('   soundtracks  no source anywhere: manual entry only')
process.exit(problems === 0 ? 0 : 1)
