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
  [9253, 21127],

  // Fate/Zero and Fate/stay night. AniList links them directly, so this group
  // is not about a missing link but about the title rule: "Fate/Zero 2nd Season"
  // and "Fate/stay night" reduce to different signatures, which would separate a
  // franchise that has been stored as one entry since before the rule existed.
  // Kept merged so that re-adding the franchise reproduces the existing seasons
  // rather than silently changing them. Fate/Apocrypha and the other Fate
  // spin-offs are deliberately not listed, so they stay their own entries.
  [10087, 11741, 356, 19603, 20792]
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

/**
 * Entries AniList links as sequels that are nevertheless separate series.
 *
 * Dragon Ball is the case. Every installment is "Dragon Ball" plus one short
 * word, and AniList chains them all with SEQUEL, so walking the links produced a
 * single entry of 825 episodes spanning Dragon Ball, Z, GT, Super and DAIMA.
 * Their titles carry no number and no subtitle to tell them apart, which is
 * precisely the signal the general rule relies on, so the answer is stated here
 * instead.
 *
 * Ids in the same group still join: Kai and its 2014 recut are one season list.
 * Keying by id rather than by title keeps this working whatever AniList names
 * the entries.
 */
const FRANCHISE_SPLITS: Record<number, string> = {
  223: 'dragon-ball',
  813: 'dragon-ball-z',
  225: 'dragon-ball-gt',
  21175: 'dragon-ball-super',
  170083: 'dragon-ball-daima',
  6033: 'dragon-ball-kai',
  20635: 'dragon-ball-kai',
  // The 2026 retelling of the Battle of Gods arc, kept apart so Super stands
  // alone at its 131 episodes.
  206814: 'dragon-ball-super-beerus'
}

/** True when two ids are known to be different series. */
function splitByCuration(from: number, to: number): boolean {
  const a = FRANCHISE_SPLITS[from]
  const b = FRANCHISE_SPLITS[to]
  return a !== undefined && b !== undefined && a !== b
}

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

/**
 * Minutes for one episode, or the total runtime for a film.
 *
 * AniList's `duration` is per episode for a series and the whole runtime for a
 * film, which is exactly what the statistics need in both cases.
 */
function episodeDurationOf(media: RawMedia): number | null {
  return typeof media.duration === 'number' && media.duration > 0 ? media.duration : null
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
    duration: episodeDurationOf(first),
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
 * - `series`: everything that is not a film or an OVA, so a franchise's recaps,
 *   films and side OVAs never appear among its seasons.
 * - `film`: films and OVAs, the entries that are not part of a weekly run.
 */
export type SearchKind = 'series' | 'film'

/** Formats that belong under Films rather than in the series library. */
const FILM_LIKE_FORMATS = new Set(['MOVIE', 'OVA'])

/** Roman numerals continue a series rather than starting a new one. */
const ROMAN_SUFFIX = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x)$/i

/**
 * Reduce a title to the identity of the series it belongs to.
 *
 * "Boku no Hero Academia 2", "Sousou no Frieren 2nd Season", "Tokyo Ghoul √A",
 * "Tokyo Revengers: Tenjiku-hen" and "Overlord II" all reduce to their base
 * series, so two entries are the same series exactly when their signatures match.
 *
 * Only decoration is removed, never a name:
 *   1. a subtitle after a colon, but only past the first word, so that
 *      "Re:Zero kara Hajimeru Isekai Seikatsu" does not collapse to "re";
 *   2. a season, part or cour marker and everything following it;
 *   3. trailing decoration: a year in parentheses, a number, a roman numeral, or
 *      a short symbol-bearing token such as "√A".
 *
 * Dragon Ball is why the answer cannot rest on titles alone: "Z", "GT", "Super"
 * and "DAIMA" survive all three steps by design, since they are real words, so
 * those entries are separated by FRANCHISE_SPLITS instead.
 */
function seriesSignature(title: string): string {
  let value = title.trim().toLowerCase().replace(/\s+/g, ' ')

  // A colon introduces a subtitle when it ends a word ("Bleach: Sennen
  // Kessen-hen") or is followed by a word of three characters or fewer
  // ("Tokyo Ghoul:re"). A longer run means the colon is part of the name, which
  // is what keeps "Re:Zero kara Hajimeru Isekai Seikatsu" intact.
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== ':') continue
    const head = value.slice(i + 1).split(' ')[0]
    if (head.length <= 3) {
      value = value.slice(0, i)
      break
    }
  }

  value = value.replace(
    /\b(?:\d+(?:st|nd|rd|th)\s+season|season\s*\d+|final\s+season|\d+(?:st|nd|rd|th)\s+cour|cour\s*\d+|part\s*\d+)\b.*$/,
    ' '
  )

  const words = value.split(' ').filter(Boolean)
  const isDecoration = (word: string, index: number): boolean => {
    const bare = word.replace(/[^\p{L}\p{N}]/gu, '')
    if (/^\(\d{4}\)$/.test(word)) return true
    if (/^\d+$/.test(bare)) return true
    if (ROMAN_SUFFIX.test(bare)) return true
    if (index > 0 && /[^\p{L}\p{N}]/u.test(word) && bare.length <= 3) return true
    return false
  }
  while (words.length > 1 && isDecoration(words[words.length - 1], words.length - 1)) {
    words.pop()
  }

  return words.join(' ')
}

/**
 * Does `candidate` start a different series in the same universe, rather than
 * continue the current one?
 *
 * Read as a comparison of signatures, so a different series is the default and a
 * continuation has to be earned by decoration the signature removes. That
 * direction matters: an earlier version merged unless both remainders were
 * single plain words, which merged "Dragon Ball Z" with "Dragon Ball Kai (2014)"
 * precisely because a year in parentheses is not a plain word.
 *
 * Also compared on signatures rather than by walking the titles in step, because
 * "Boku no Hero Academia 7" and "Boku no Hero Academia FINAL SEASON" diverge
 * immediately after the shared part and neither is a prefix of the other.
 */
export function looksLikeDifferentSeries(current: string, candidate: string): boolean {
  const a = seriesSignature(current)
  const b = seriesSignature(candidate)
  if (a === '' || b === '') return false
  return a !== b
}

/**
 * Should the chain walk follow a link from one entry to another?
 *
 * The single place that decides, so the app and the checks cannot drift apart.
 * Three questions, in order of authority:
 *   1. a curated group that names both entries always links them;
 *   2. a curated split that names both entries never does;
 *   3. otherwise the titles decide.
 */
export function shouldChainLink(
  from: { id: number; title: string },
  to: { id: number; title: string }
): boolean {
  const curated = franchiseGroupFor(from.id)
  if (curated !== null && curated.includes(to.id)) return true
  if (splitByCuration(from.id, to.id)) return false
  return !looksLikeDifferentSeries(from.title, to.title)
}

/**
 * Merge search hits that belong to the same franchise.
 *
 * Non-series formats are never merged by title, so films and OVAs keep their own
 * rows.
 */
export function groupSearchResults(media: RawMedia[], kind: SearchKind = 'series'): AnimeSearchResult[] {
  const wanted = media.filter((item) =>
    kind === 'film'
      ? FILM_LIKE_FORMATS.has(item.format ?? '')
      : !FILM_LIKE_FORMATS.has(item.format ?? '')
  )

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
 * films out of 25 rows. OVAs are included: they are listed under Films too.
 */
const FILM_SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 25) {
    media(search: $search, type: ANIME, format_in: [MOVIE, OVA], sort: SEARCH_MATCH) {
      ${MEDIA_FIELDS}
    }
  }
}`

/** Series searches ask AniList to leave films and OVAs out entirely. */
const SERIES_SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 25) {
    media(search: $search, type: ANIME, format_not_in: [MOVIE, OVA], sort: SEARCH_MATCH) {
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

      // A curated group always wins, so Steins;Gate and Steins;Gate 0 stay one
      // entry even though their titles read as different series. Otherwise the
      // link is followed only when the two titles belong to the same series,
      // which keeps Dragon Ball, Z, GT, Super and DAIMA apart while season
      // numbering and subtitles still join their own series.
      if (!shouldChainLink({ id, title: pickTitle(media) }, { id: node.id, title: pickTitle(node) })) {
        continue
      }

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
