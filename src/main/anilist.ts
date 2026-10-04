/**
 * AniList GraphQL client.
 *
 * AniList is used as the MyAnimeList reference source: it needs no
 * registration, and every entry carries `idMal`, the MyAnimeList id, plus the
 * Romaji/English titles, episode count and studio.
 *
 * Sequels are merged so a franchise becomes one entity: search results are
 * grouped by normalised title, and picking a result walks the SEQUEL/PREQUEL
 * relations to assemble the real season chain.
 *
 * Runs in the main process only — the renderer reaches it through IPC, so the
 * network stays out of the sandboxed UI.
 */
import type {
  AnimeDetails,
  AnimeSearchResult,
  AnimeSeasonRef,
  AniListEpisode
} from '../shared/anilist'

const ENDPOINT = process.env['ANIMEEH_ANILIST_ENDPOINT'] ?? 'https://graphql.anilist.co'
const REQUEST_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 30 * 60 * 1000
const MAX_CACHE_ENTRIES = 300

/**
 * Relations that form the main season chain. SIDE_STORY, SPIN_OFF, SUMMARY,
 * ALTERNATIVE and CHARACTER are deliberately excluded: they point at OVAs,
 * recap films and spin-offs rather than at the next season.
 */
const CHAIN_RELATIONS = new Set(['SEQUEL', 'PREQUEL'])

/**
 * Formats allowed inside a chain. This filter is what keeps Attack on Titan's
 * PREQUEL link to the "Kuinaki Sentaku" OVA out of the season list.
 */
const SERIES_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA'])

/** Safety bound so a pathological relation graph cannot explode the call count. */
const MAX_FRANCHISE_ENTRIES = 15

/* ------------------------------------------------------------------ */
/* Small TTL cache (AniList rate-limits to ~30 requests/minute)        */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  at: number
  value: unknown
}

const cache = new Map<string, CacheEntry>()

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  // Refresh insertion order so hot entries survive eviction.
  cache.delete(key)
  cache.set(key, hit)
  return hit.value as T
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value })
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

interface GraphQLResponse<T> {
  data?: T
  errors?: { message?: string }[]
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  let response: Response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    const name = (err as Error).name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error('AniList did not respond (timed out). Check your connection.')
    }
    throw new Error(`Could not reach AniList: ${(err as Error).message}`)
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after')
    throw new Error(
      retryAfter
        ? `Too many requests to AniList. Try again in ${retryAfter}s.`
        : 'Too many requests to AniList. Please wait a moment.'
    )
  }
  if (!response.ok) {
    throw new Error(`AniList responded with ${response.status}`)
  }

  const payload = (await response.json()) as GraphQLResponse<T>
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? 'AniList returned an error')
  }
  if (!payload.data) throw new Error('Empty response from AniList')

  return payload.data
}

/* ------------------------------------------------------------------ */
/* Raw shapes and normalisation                                        */
/* ------------------------------------------------------------------ */

interface RawMedia {
  id: number
  idMal: number | null
  title: { romaji?: string | null; english?: string | null; native?: string | null } | null
  format: string | null
  episodes: number | null
  seasonYear: number | null
  startDate: { year: number | null } | null
  coverImage?: { large?: string | null } | null
  siteUrl?: string | null
  studios?: { nodes: { name: string }[] } | null
  relations?: { edges: { relationType: string; node: RawMedia | null }[] | null } | null
}

function yearOf(media: RawMedia): number | null {
  return media.seasonYear ?? media.startDate?.year ?? null
}

function pickTitle(media: RawMedia): string {
  return (
    media.title?.romaji?.trim() ||
    media.title?.english?.trim() ||
    media.title?.native?.trim() ||
    `AniList #${media.id}`
  )
}

function firstStudio(media: RawMedia): string | null {
  const nodes = media.studios?.nodes ?? []
  const named = nodes.filter((n) => n?.name)
  return named.length > 0 ? named.map((n) => n.name).join(', ') : null
}

function byYearThenId(a: RawMedia, b: RawMedia): number {
  const ya = yearOf(a) ?? 9999
  const yb = yearOf(b) ?? 9999
  if (ya !== yb) return ya - yb
  return a.id - b.id
}

function toSeasonRef(media: RawMedia, position: number): AnimeSeasonRef {
  return {
    season: position,
    anilistId: media.id,
    malId: media.idMal ?? null,
    title: pickTitle(media),
    year: yearOf(media),
    format: media.format ?? null,
    episodes: typeof media.episodes === 'number' ? media.episodes : null
  }
}

function sumEpisodes(seasons: AnimeSeasonRef[]): number | null {
  const known = seasons
    .map((s) => s.episodes)
    .filter((n): n is number => typeof n === 'number' && n > 0)
  if (known.length === 0) return null
  return known.reduce((total, n) => total + n, 0)
}

/** Build a search result around the franchise's earliest season. */
function toSearchResult(root: RawMedia, seasons: AnimeSeasonRef[]): AnimeSearchResult {
  return {
    anilistId: root.id,
    malId: root.idMal ?? null,
    title: pickTitle(root),
    englishTitle: root.title?.english?.trim() || null,
    format: root.format ?? null,
    year: yearOf(root),
    episodes: sumEpisodes(seasons),
    studio: firstStudio(root),
    coverImage: root.coverImage?.large ?? null,
    siteUrl: root.siteUrl ?? `https://anilist.co/anime/${root.id}`,
    seasons
  }
}

/* ------------------------------------------------------------------ */
/* Franchise grouping                                                  */
/* ------------------------------------------------------------------ */

/**
 * Reduce a title to a key shared by its seasons, so "Sousou no Frieren",
 * "…2nd Season" and "…3rd Season" collapse together.
 */
export function franchiseKey(title: string): string {
  let s = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')

  // Drop parenthetical and bracketed asides.
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')

  // Punctuation and separators become spaces so "Title: Sub" and "Title" match.
  s = s.replace(/[^a-z0-9]+/g, ' ')

  // Season markers.
  s = s
    .replace(/\bthe\s+final\s+season\b/g, ' ')
    .replace(/\bfinal\s+season\b/g, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\s+season\b/g, ' ')
    .replace(/\bseason\s+\d+\b/g, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\s+cour\b/g, ' ')
    .replace(/\bpart\s+\d+\b/g, ' ')
    .replace(/\bcour\s+\d+\b/g, ' ')

  // Trailing roman numerals ("Mushoku Tensei II"). Anchored to the end so a
  // leading article, as in "I Want to Eat Your Pancreas", is never touched.
  s = s.replace(/\s+(?:i{1,3}|iv|v|vi{1,3}|ix|x)\s*$/g, ' ')

  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Merge search hits that belong to the same franchise. Non-series formats are
 * never merged, so films and OVAs keep their own rows.
 */
export function groupSearchResults(media: RawMedia[]): AnimeSearchResult[] {
  const groups = new Map<string, RawMedia[]>()

  for (const item of media) {
    if (!SERIES_FORMATS.has(item.format ?? '')) {
      groups.set(`#${item.id}`, [item])
      continue
    }
    const key = franchiseKey(pickTitle(item))
    const existing = groups.get(key)
    if (existing) existing.push(item)
    else groups.set(key, [item])
  }

  return [...groups.values()].map((members) => {
    const ordered = [...members].sort(byYearThenId)
    const seasons = ordered.map((m, index) => toSeasonRef(m, index + 1))
    return toSearchResult(ordered[0], seasons)
  })
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  format
  episodes
  seasonYear
  startDate { year }
  coverImage { large }
  siteUrl
  studios(isMain: true) { nodes { name } }
`

const SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 25) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      ${MEDIA_FIELDS}
    }
  }
}`

/** One entry plus its neighbours, used to walk the season chain. */
const RELATIONS_QUERY = `
query ($id: Int) {
  Media(id: $id) {
    ${MEDIA_FIELDS}
    relations {
      edges {
        relationType
        node {
          id
          idMal
          title { romaji english native }
          format
          episodes
          seasonYear
          startDate { year }
        }
      }
    }
  }
}`

async function fetchWithRelations(id: number): Promise<RawMedia> {
  const key = `relations:${id}`
  const cached = cacheGet<RawMedia>(key)
  if (cached) return cached

  const data = await graphql<{ Media: RawMedia | null }>(RELATIONS_QUERY, { id })
  if (!data.Media) throw new Error(`AniList has no anime #${id}`)

  cacheSet(key, data.Media)
  return data.Media
}

/**
 * Order seasons along the sequel chain with a topological sort, so the result
 * does not depend on the order relations happened to arrive in. Entries left
 * over (cycles, disconnected) are appended by year.
 */
function orderChain(
  entries: Map<number, RawMedia>,
  sequelEdges: [number, number][]
): number[] {
  const ids = [...entries.keys()]
  const adjacency = new Map<number, number[]>(ids.map((id) => [id, []]))
  const indegree = new Map<number, number>(ids.map((id) => [id, 0]))

  for (const [from, to] of sequelEdges) {
    if (from === to || !entries.has(from) || !entries.has(to)) continue
    adjacency.get(from)?.push(to)
    indegree.set(to, (indegree.get(to) ?? 0) + 1)
  }

  const compare = (a: number, b: number): number =>
    byYearThenId(entries.get(a) as RawMedia, entries.get(b) as RawMedia)

  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0).sort(compare)
  const ordered: number[] = []
  const seen = new Set<number>()

  while (ready.length > 0) {
    const id = ready.shift() as number
    if (seen.has(id)) continue
    seen.add(id)
    ordered.push(id)

    for (const next of adjacency.get(id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 1) - 1)
      if ((indegree.get(next) ?? 0) <= 0 && !seen.has(next)) {
        ready.push(next)
        ready.sort(compare)
      }
    }
  }

  const leftovers = ids.filter((id) => !seen.has(id)).sort(compare)
  return [...ordered, ...leftovers]
}

/**
 * Walk SEQUEL/PREQUEL links outwards from `startId` to collect the whole season
 * chain, then return it in broadcast order. Each hop costs one request, so
 * results are cached.
 */
async function assembleFranchise(startId: number): Promise<RawMedia[]> {
  const entries = new Map<number, RawMedia>()
  const discovered = new Set<number>([startId])
  const summaries = new Map<number, RawMedia>()
  const sequelEdges: [number, number][] = []
  const queue: number[] = [startId]

  while (queue.length > 0 && entries.size < MAX_FRANCHISE_ENTRIES) {
    const id = queue.shift() as number
    if (entries.has(id)) continue

    let media: RawMedia
    try {
      media = await fetchWithRelations(id)
    } catch (err) {
      // The starting entry must succeed; a failing neighbour is skipped rather
      // than losing the whole franchise.
      if (id === startId) throw err
      continue
    }

    entries.set(id, media)

    for (const edge of media.relations?.edges ?? []) {
      if (!CHAIN_RELATIONS.has(edge.relationType)) continue
      const node = edge.node
      if (!node || !SERIES_FORMATS.has(node.format ?? '')) continue

      const from = edge.relationType === 'SEQUEL' ? id : node.id
      const to = edge.relationType === 'SEQUEL' ? node.id : id
      sequelEdges.push([from, to])

      if (!discovered.has(node.id)) {
        discovered.add(node.id)
        summaries.set(node.id, node)
        queue.push(node.id)
      }
    }
  }

  // Anything only seen as a neighbour summary and not fetched yet.
  for (const id of discovered) {
    if (entries.has(id)) continue
    const summary = summaries.get(id)
    if (summary) {
      entries.set(id, summary)
      continue
    }
    try {
      entries.set(id, await fetchWithRelations(id))
    } catch {
      /* skip unreachable neighbour */
    }
  }

  return orderChain(entries, sequelEdges).map((id) => entries.get(id) as RawMedia)
}

/**
 * AniList episode titles look like "Episode 7 - The Land Where Souls Rest".
 * Strip the prefix so only the real title is kept.
 */
function parseSeasonTitles(
  list: { title?: string | null }[] | null | undefined
): { number: number; title: string }[] {
  if (!Array.isArray(list)) return []

  const parsed: { number: number; title: string }[] = []
  for (const item of list) {
    const raw = item?.title?.trim()
    if (!raw) continue

    const match = /^episode\s+(\d+)\s*[-–—:.]\s*(.+)$/i.exec(raw)
    if (match) parsed.push({ number: Number(match[1]), title: match[2].trim() })
    else parsed.push({ number: parsed.length + 1, title: raw })
  }
  return parsed
}

/**
 * Fetch every season's episode titles in a single request using GraphQL
 * aliases, then renumber them across the franchise.
 */
async function fetchEpisodeTitles(chain: RawMedia[]): Promise<AniListEpisode[]> {
  const safe = chain.filter((m) => Number.isSafeInteger(m.id))
  if (safe.length === 0) return []

  const aliases = safe.map((m, i) => `s${i}: Media(id: ${m.id}) { streamingEpisodes { title } }`)
  let data: Record<string, { streamingEpisodes?: { title?: string | null }[] | null }> = {}
  try {
    data = await graphql<typeof data>(`query {\n${aliases.join('\n')}\n}`, {})
  } catch {
    // Episode titles are a bonus: the counts still work without them.
    return []
  }

  const out: AniListEpisode[] = []
  const usedSignatures = new Set<string>()
  let absolute = 1

  safe.forEach((media, index) => {
    const declared = typeof media.episodes === 'number' && media.episodes > 0 ? media.episodes : 0
    const parsed = parseSeasonTitles(data[`s${index}`]?.streamingEpisodes)

    // AniList's streamingEpisodes reflects the streaming service, and Crunchyroll
    // reports the whole franchise: Attack on Titan's Seasons 2 and 3 each return
    // Season 1's 25 episodes. Only trust a list whose length matches the season
    // and which has not already been used for an earlier one.
    const signature = parsed.map((p) => p.title).join('|')
    const alreadyUsed = signature !== '' && usedSignatures.has(signature)
    const countMismatch = declared > 0 && parsed.length !== declared
    const trusted = parsed.length > 0 && !alreadyUsed && !countMismatch

    if (trusted) usedSignatures.add(signature)

    const titles = trusted ? parsed : []
    const count = Math.max(declared, titles.length)
    const byNumber = new Map(titles.map((p) => [p.number, p.title]))

    for (let n = 1; n <= count; n += 1) {
      const title = byNumber.get(n)
      if (title) out.push({ number: absolute, season: index + 1, title })
      absolute += 1
    }
  })

  return out
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Minimum query length before AniList returns anything meaningful. */
export const MIN_QUERY_LENGTH = 2

export async function searchAnime(query: string): Promise<AnimeSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY_LENGTH) return []

  const key = `search:${trimmed.toLowerCase()}`
  const cached = cacheGet<AnimeSearchResult[]>(key)
  if (cached) return cached

  const data = await graphql<{ Page: { media: RawMedia[] } }>(SEARCH_QUERY, { search: trimmed })
  const results = groupSearchResults((data.Page?.media ?? []).filter(Boolean))

  cacheSet(key, results)
  return results
}

/**
 * Assemble one franchise: every season in broadcast order, with the episodes
 * renumbered across the whole chain.
 */
export async function getAnimeDetails(anilistId: number): Promise<AnimeDetails> {
  const key = `franchise:${anilistId}`
  const cached = cacheGet<AnimeDetails>(key)
  if (cached) return cached

  const chain = await assembleFranchise(anilistId)
  if (chain.length === 0) throw new Error(`AniList has no anime #${anilistId}`)

  const seasons = chain.map((media, index) => toSeasonRef(media, index + 1))
  const episodeTitles = await fetchEpisodeTitles(chain)

  // chain[0] is the earliest season, so it becomes the entry's identity even
  // when the user picked a later one.
  const details: AnimeDetails = { ...toSearchResult(chain[0], seasons), episodeTitles }

  cacheSet(key, details)
  // Cache under every member so picking another season is instant and returns
  // the identical franchise.
  for (const media of chain) {
    if (media.id !== chain[0].id) cacheSet(`franchise:${media.id}`, details)
  }

  return details
}
