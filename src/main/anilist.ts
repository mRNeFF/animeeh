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
  AnimeSeasonPart,
  AnimeSeasonRef,
  AniListEpisode
} from '../shared/anilist'

import { CodedError } from '../shared/errors'

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
 * Franchises AniList does not connect with SEQUEL/PREQUEL, but that belong in
 * one entry.
 *
 * Kept explicit on purpose. The obvious automation would be to follow the
 * ALTERNATIVE relation, but that relation also links Fullmetal Alchemist (2003)
 * to Brotherhood — two separate adaptations — so following it generally would
 * wrongly merge unrelated shows. Each exception is listed and reasoned about
 * individually.
 */
const FRANCHISE_GROUPS: number[][] = [
  // Steins;Gate and Steins;Gate 0. AniList only links them through the
  // "Divide By Zero" OVA:
  //   9253  --ALTERNATIVE--> 21624 (OVA)
  //   21127 --PREQUEL-------> 21624 (OVA)
  // Season order falls out of the year, putting Steins;Gate 0 second.
  [9253, 21127]
]

/** The curated group an AniList id belongs to, if any. */
function franchiseGroupFor(id: number): number[] | null {
  return FRANCHISE_GROUPS.find((group) => group.includes(id)) ?? null
}


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
      throw new CodedError('AniList timed out', 'timeout', { service: 'anilist' })
    }
    throw new CodedError('Could not reach AniList', 'unreachable', { service: 'anilist' })
  }

  if (response.status === 429) {
    throw new CodedError('Too many requests to AniList', 'rateLimit', {
      service: 'anilist',
      status: 429
    })
  }
  if (!response.ok) {
    throw new CodedError('AniList HTTP error', 'http', {
      service: 'anilist',
      status: response.status
    })
  }

  const payload = (await response.json()) as GraphQLResponse<T>
  if (payload.errors && payload.errors.length > 0) {
    // AniList's own wording is descriptive but English; keep it as the detail.
    throw new CodedError(payload.errors[0]?.message ?? 'AniList returned an error', 'http', {
      service: 'anilist'
    })
  }
  if (!payload.data) throw new CodedError('Empty response from AniList', 'empty', { service: 'anilist' })

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
  duration: number | null
  seasonYear: number | null
  startDate: { year: number | null } | null
  coverImage?: { large?: string | null } | null
  /** Only present on queries that request it; the relations sub-selection omits it. */
  genres?: string[] | null
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

function sumEpisodes(counts: (number | null)[]): number | null {
  const known = counts.filter((n): n is number => typeof n === 'number' && n > 0)
  if (known.length === 0) return null
  return known.reduce((total, n) => total + n, 0)
}

/** Episode count of one entry, or null when AniList does not know it. */
function episodeCountOf(media: RawMedia): number | null {
  return typeof media.episodes === 'number' && media.episodes > 0 ? media.episodes : null
}

function toPart(media: RawMedia): AnimeSeasonPart {
  return {
    anilistId: media.id,
    malId: media.idMal ?? null,
    title: pickTitle(media),
    year: yearOf(media),
    episodes: episodeCountOf(media)
  }
}

/**
 * Build one season from the broadcast parts merged into it. The first part
 * names the season and its episode count is the sum across all parts.
 */
function toSeasonRef(parts: RawMedia[], position: number): AnimeSeasonRef {
  const first = parts[0]
  return {
    season: position,
    anilistId: first.id,
    malId: first.idMal ?? null,
    title: pickTitle(first),
    year: yearOf(first),
    format: first.format ?? null,
    episodes: sumEpisodes(parts.map(episodeCountOf)),
    parts: parts.map(toPart)
  }
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
    episodes: sumEpisodes(seasons.map((s) => s.episodes)),
    duration: typeof root.duration === 'number' && root.duration > 0 ? root.duration : null,
    studio: firstStudio(root),
    coverImage: root.coverImage?.large ?? null,
    genres: (root.genres ?? []).filter((g): g is string => typeof g === 'string' && g !== ''),
    siteUrl: root.siteUrl ?? `https://anilist.co/anime/${root.id}`,
    seasons
  }
}

/* ------------------------------------------------------------------ */
/* Franchise grouping                                                  */
/* ------------------------------------------------------------------ */

/**
 * Reduce a title to a key shared by the broadcast parts of the *same* season,
 * so "…2nd Season" and "…2nd Season Part 2" collapse together while
 * "…2nd Season" and "…3rd Season" stay apart.
 *
 * Unlike franchiseKey, season numbers are deliberately kept: only the
 * part/cour markers are removed.
 */
export function seasonPartKey(title: string): string {
  let s = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')

  // Parenthesised part markers, e.g. "Title (Part 2)".
  s = s.replace(/\(\s*(?:part|cour|partie)\s*\d+\s*\)/g, ' ')
  s = s.replace(/\[\s*(?:part|cour|partie)\s*\d+\s*\]/g, ' ')

  // Bare part markers, including the two-cour form "2nd Cour".
  s = s
    .replace(/\b\d+(?:st|nd|rd|th)\s+cour\b/g, ' ')
    .replace(/\b(?:part|cour|partie)\s+\d+\b/g, ' ')

  s = s.replace(/[^a-z0-9]+/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Merge the broadcast parts of a season by walking the ordered chain and
 * folding consecutive entries that share a season key. Parts are always
 * adjacent, so this never joins two unrelated seasons.
 */
export function groupSeasonParts(chain: RawMedia[]): RawMedia[][] {
  const groups: RawMedia[][] = []
  let current: RawMedia[] = []
  let currentKey = ''

  for (const media of chain) {
    const key = seasonPartKey(pickTitle(media))
    if (current.length > 0 && key === currentKey) {
      current.push(media)
      continue
    }
    if (current.length > 0) groups.push(current)
    current = [media]
    currentKey = key
  }

  if (current.length > 0) groups.push(current)
  return groups
}

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
 * Which kinds of entry a search should return.
 *
 * - `series`: everything except films, so a franchise's recap movies never
 *   appear among its seasons.
 * - `film`: only films.
 */
export type SearchKind = 'series' | 'film'

const FILM_FORMAT = 'MOVIE'

/**
 * Merge search hits that belong to the same franchise. Non-series formats are
 * never merged, so films and OVAs keep their own rows.
 */
export function groupSearchResults(media: RawMedia[], kind: SearchKind = 'series'): AnimeSearchResult[] {
  const wanted = media.filter((item) => {
    const isFilm = (item.format ?? '') === FILM_FORMAT
    return kind === 'film' ? isFilm : !isFilm
  })

  // Films are standalone entries: no franchise folding, one row each, and the
  // AniList relevance order is kept rather than sorted by year — sorting would
  // push a loosely matching older film above an exact hit.
  if (kind === 'film') {
    return wanted.map((item) => toSearchResult(item, [toSeasonRef([item], 1)]))
  }

  const buckets: RawMedia[][] = []
  const byKey = new Map<string, RawMedia[]>()

  for (const item of wanted) {
    if (!SERIES_FORMATS.has(item.format ?? '')) {
      // Non-series entries are never merged by title, but a curated group can
      // still fold them in below.
      buckets.push([item])
      continue
    }
    const key = franchiseKey(pickTitle(item))
    const existing = byKey.get(key)
    if (existing) {
      existing.push(item)
      continue
    }
    const bucket = [item]
    byKey.set(key, bucket)
    buckets.push(bucket)
  }

  // Fold together any buckets that a curated franchise group spans. Without
  // this, "Steins;Gate" and "Steins;Gate 0" would still show as two rows.
  const consumed = new Set<RawMedia[]>()
  const merged: RawMedia[][] = []

  for (const bucket of buckets) {
    if (consumed.has(bucket)) continue

    let combined = [...bucket]
    consumed.add(bucket)

    for (const other of buckets) {
      if (consumed.has(other)) continue
      const sharesGroup = combined.some((a) => {
        const group = franchiseGroupFor(a.id)
        return group !== null && other.some((b) => group.includes(b.id))
      })
      if (!sharesGroup) continue
      consumed.add(other)
      combined = [...combined, ...other]
    }

    merged.push(combined)
  }

  return merged.map((members) => {
    const ordered = [...members].sort(byYearThenId)
    const seasons = groupSeasonParts(ordered).map((parts, index) => toSeasonRef(parts, index + 1))
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
  duration
  seasonYear
  startDate { year }
  coverImage { large }
  genres
  siteUrl
  studios(isMain: true) { nodes { name } }
`

/**
 * Film searches filter server-side instead of client-side. AniList returns
 * mostly series for a mixed query, so filtering afterwards left a handful of
 * films out of 25 rows.
 */
const FILM_SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 25) {
    media(search: $search, type: ANIME, format: MOVIE, sort: SEARCH_MATCH) {
      ${MEDIA_FIELDS}
    }
  }
}`

/** Series searches ask AniList to leave films out entirely. */
const SERIES_SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 25) {
    media(search: $search, type: ANIME, format_not: MOVIE, sort: SEARCH_MATCH) {
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
  if (!data.Media) throw new CodedError('AniList has no such entry', 'http', { service: 'anilist' })

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

  // Pull in franchises AniList leaves disconnected (see FRANCHISE_GROUPS).
  const curated = franchiseGroupFor(startId)
  if (curated) {
    for (const id of curated) {
      if (entries.has(id)) continue
      try {
        entries.set(id, await fetchWithRelations(id))
      } catch {
        /* skip unreachable group member */
      }
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
async function fetchEpisodeTitles(groups: RawMedia[][]): Promise<AniListEpisode[]> {
  const flat = groups.flat().filter((m) => Number.isSafeInteger(m.id))
  if (flat.length === 0) return []

  // AniList id -> unified season number.
  const seasonOf = new Map<number, number>()
  groups.forEach((parts, index) => {
    for (const part of parts) seasonOf.set(part.id, index + 1)
  })

  const aliases = flat.map((m, i) => `s${i}: Media(id: ${m.id}) { streamingEpisodes { title } }`)
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

  flat.forEach((media, index) => {
    const declared = episodeCountOf(media) ?? 0
    const parsed = parseSeasonTitles(data[`s${index}`]?.streamingEpisodes)

    // AniList's streamingEpisodes reflects the streaming service, and Crunchyroll
    // reports the whole franchise: Attack on Titan's Seasons 2 and 3 each return
    // Season 1's 25 episodes. Only trust a list whose length matches the part
    // and which has not already been used.
    const signature = parsed.map((p) => p.title).join('|')
    const alreadyUsed = signature !== '' && usedSignatures.has(signature)
    const countMismatch = declared > 0 && parsed.length !== declared
    const trusted = parsed.length > 0 && !alreadyUsed && !countMismatch

    if (trusted) usedSignatures.add(signature)

    const titles = trusted ? parsed : []
    const count = Math.max(declared, titles.length)
    const byNumber = new Map(titles.map((p) => [p.number, p.title]))
    const season = seasonOf.get(media.id) ?? 1

    for (let n = 1; n <= count; n += 1) {
      const title = byNumber.get(n)
      if (title) out.push({ number: absolute, season, title })
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

export async function searchAnime(
  query: string,
  kind: SearchKind = 'series'
): Promise<AnimeSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY_LENGTH) return []

  const key = `search:${kind}:${trimmed.toLowerCase()}`
  const cached = cacheGet<AnimeSearchResult[]>(key)
  if (cached) return cached

  const data = await graphql<{ Page: { media: RawMedia[] } }>(
    kind === 'film' ? FILM_SEARCH_QUERY : SERIES_SEARCH_QUERY,
    { search: trimmed }
  )
  const results = groupSearchResults((data.Page?.media ?? []).filter(Boolean), kind)

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
  if (chain.length === 0) throw new CodedError('AniList has no such entry', 'http', { service: 'anilist' })

  // Fold the broadcast parts of a season together ("2nd Season" + "2nd Season
  // Part 2") so a split season counts once.
  const groups = groupSeasonParts(chain)
  const seasons = groups.map((parts, index) => toSeasonRef(parts, index + 1))
  const episodeTitles = await fetchEpisodeTitles(groups)

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
