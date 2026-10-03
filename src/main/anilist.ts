/**
 * AniList GraphQL client.
 *
 * AniList is used as the MyAnimeList reference source: it needs no
 * registration, and every entry carries `idMal`, the MyAnimeList id, plus the
 * Romaji/English titles, episode count and studio.
 *
 * Runs in the main process only — the renderer reaches it through IPC, so the
 * network stays out of the sandboxed UI.
 */
import type { AnimeDetails, AnimeSearchResult, AniListEpisode } from '../shared/anilist'

const ENDPOINT = process.env['ANIMEEH_ANILIST_ENDPOINT'] ?? 'https://graphql.anilist.co'
const REQUEST_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 30 * 60 * 1000
const MAX_CACHE_ENTRIES = 200

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
/* Query + normalisation                                               */
/* ------------------------------------------------------------------ */

const SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      idMal
      title { romaji english native }
      format
      episodes
      seasonYear
      startDate { year }
      coverImage { large color }
      siteUrl
      studios(isMain: true) { nodes { name } }
    }
  }
}`

const DETAILS_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    title { romaji english native }
    format
    episodes
    seasonYear
    startDate { year }
    coverImage { large color }
    siteUrl
    studios(isMain: true) { nodes { name } }
    streamingEpisodes { title }
  }
}`

interface RawMedia {
  id: number
  idMal: number | null
  title: { romaji?: string | null; english?: string | null; native?: string | null } | null
  format: string | null
  episodes: number | null
  seasonYear: number | null
  startDate: { year: number | null } | null
  coverImage: { large?: string | null; color?: string | null } | null
  siteUrl: string | null
  studios: { nodes: { name: string }[] } | null
  streamingEpisodes?: { title?: string | null }[] | null
}

function firstStudio(media: RawMedia): string | null {
  const nodes = media.studios?.nodes ?? []
  const named = nodes.filter((n) => n?.name)
  return named.length > 0 ? named.map((n) => n.name).join(', ') : null
}

function pickTitle(media: RawMedia): string {
  return (
    media.title?.romaji?.trim() ||
    media.title?.english?.trim() ||
    media.title?.native?.trim() ||
    `AniList #${media.id}`
  )
}

function toSearchResult(media: RawMedia): AnimeSearchResult {
  return {
    anilistId: media.id,
    malId: media.idMal ?? null,
    title: pickTitle(media),
    englishTitle: media.title?.english?.trim() || null,
    format: media.format ?? null,
    // seasonYear is the broadcast year; startDate.year fills gaps.
    year: media.seasonYear ?? media.startDate?.year ?? null,
    episodes: typeof media.episodes === 'number' ? media.episodes : null,
    studio: firstStudio(media),
    coverImage: media.coverImage?.large ?? null,
    siteUrl: media.siteUrl ?? `https://anilist.co/anime/${media.id}`
  }
}

/**
 * AniList episode titles look like "Episode 7 - The Land Where Souls Rest".
 * Strip the prefix so only the real title is kept.
 */
function parseEpisodeTitles(list: { title?: string | null }[] | null | undefined): AniListEpisode[] {
  if (!Array.isArray(list)) return []

  const parsed: AniListEpisode[] = []
  for (const item of list) {
    const raw = item?.title?.trim()
    if (!raw) continue

    const match = /^episode\s+(\d+)\s*[-–—:.]\s*(.+)$/i.exec(raw)
    if (match) {
      parsed.push({ number: Number(match[1]), title: match[2].trim() })
    } else {
      parsed.push({ number: parsed.length + 1, title: raw })
    }
  }
  return parsed
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
  const results = (data.Page?.media ?? []).filter(Boolean).map(toSearchResult)

  cacheSet(key, results)
  return results
}

export async function getAnimeDetails(anilistId: number): Promise<AnimeDetails> {
  const key = `details:${anilistId}`
  const cached = cacheGet<AnimeDetails>(key)
  if (cached) return cached

  const data = await graphql<{ Media: RawMedia | null }>(DETAILS_QUERY, { id: anilistId })
  if (!data.Media) throw new Error(`AniList has no anime #${anilistId}`)

  const details: AnimeDetails = {
    ...toSearchResult(data.Media),
    episodeTitles: parseEpisodeTitles(data.Media.streamingEpisodes)
  }

  cacheSet(key, details)
  return details
}
