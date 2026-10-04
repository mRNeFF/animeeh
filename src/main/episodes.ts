/**
 * Episode names.
 *
 * AniList is the reference source for titles, but it has no episode list of its
 * own: `streamingEpisodes` mirrors the streaming service and only covered 73%
 * of this library, with nothing at all for Vinland Saga, Cyberpunk or Oshi no
 * Ko. Worse, for Re:Zero it returns the same 16 franchise-wide titles
 * (numbered 63-78) on all three of its seasons. Kitsu keeps a real per-anime
 * episode list and maps to AniList ids, so it supplies the titles and AniList
 * supplies the episode counts.
 *
 * A season that aired in two cours is two separate AniList and Kitsu entries.
 * `seasons` therefore arrives as one array of part ids per merged season, and
 * each part occupies its own stretch of the numbering.
 */
import type { EpisodeName, EpisodeNamesResult } from '../shared/episodes'

const KITSU = 'https://kitsu.io/api/edge'
const ANILIST = process.env['ANIMEEH_ANILIST_ENDPOINT'] ?? 'https://graphql.anilist.co'

const REQUEST_TIMEOUT_MS = 20_000
const CACHE_TTL_MS = 60 * 60 * 1000
const KITSU_PACING_MS = 900
const MAX_EPISODES_PER_SEASON = 500

/* ------------------------------------------------------------------ */
/* Cache                                                               */
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
  return hit.value as T
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value })
  while (cache.size > 400) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

let lastKitsuCall = 0

async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as T
}

/** Kitsu is paced because its documented limit is 60 requests/minute. */
async function kitsu<T>(path: string): Promise<T> {
  const key = `kitsu:${path}`
  const cached = cacheGet<T>(key)
  if (cached) return cached

  const wait = KITSU_PACING_MS - (Date.now() - lastKitsuCall)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lastKitsuCall = Date.now()
    try {
      const json = await fetchJson<T>(`${KITSU}${path}`, {
        Accept: 'application/vnd.api+json'
      })
      cacheSet(key, json)
      return json
    } catch (err) {
      if (attempt === 3) throw err
      await new Promise((r) => setTimeout(r, 2500 * attempt))
    }
  }
  throw new Error('Kitsu request failed')
}

/* ------------------------------------------------------------------ */
/* Kitsu                                                               */
/* ------------------------------------------------------------------ */

interface KitsuMapping {
  data?: {
    relationships?: { item?: { data?: { type?: string; id?: string } } }
  }[]
}

interface KitsuEpisodes {
  data?: {
    attributes?: { number?: number | null; canonicalTitle?: string | null }
  }[]
  meta?: { count?: number }
}

/** AniList id -> Kitsu anime id, through Kitsu's own mapping table. */
async function kitsuAnimeId(anilistId: number): Promise<string | null> {
  const json = await kitsu<KitsuMapping>(
    `/mappings?filter[externalSite]=anilist/anime&filter[externalId]=${anilistId}&include=item`
  )
  const item = json.data?.[0]?.relationships?.item?.data
  return item?.type === 'anime' ? (item.id ?? null) : null
}

/**
 * Every titled episode of one Kitsu anime, following pagination.
 *
 * Returns the total episode count as well: a part can have 13 episodes while
 * only one carries a title, and the count is what decides how many slots the
 * part occupies.
 */
async function kitsuEpisodeNames(
  kitsuId: string
): Promise<{ titles: Map<number, string>; count: number }> {
  const first = await kitsu<KitsuEpisodes>(
    `/anime/${kitsuId}/episodes?page[limit]=20&page[offset]=0`
  )
  const total = Math.min(first.meta?.count ?? first.data?.length ?? 0, MAX_EPISODES_PER_SEASON)
  const items = [...(first.data ?? [])]

  for (let offset = 20; offset < total; offset += 20) {
    const page = await kitsu<KitsuEpisodes>(
      `/anime/${kitsuId}/episodes?page[limit]=20&page[offset]=${offset}`
    )
    items.push(...(page.data ?? []))
  }

  const titles = new Map<number, string>()
  items.forEach((item, index) => {
    const title = item.attributes?.canonicalTitle?.trim()
    if (!title) return
    // Kitsu leaves `number` null for specials; fall back to arrival order.
    const number =
      typeof item.attributes?.number === 'number' ? item.attributes.number : index + 1
    titles.set(number, title)
  })

  return { titles, count: total }
}

/** AniList media shape for the batched part query. */
interface AniListMedia {
  episodes?: number | null
  streamingEpisodes?: { title?: string | null }[] | null
}

/* ------------------------------------------------------------------ */
/* AniList: declared episode counts, and titles only when trustworthy   */
/* ------------------------------------------------------------------ */

interface AniListPartInfo {
  /** Episode count AniList declares for this entry, 0 when unknown. */
  declared: number
  /** Titles, already parsed, in their local numbering. */
  titles: { number: number; title: string }[]
}

const EMPTY_PART: AniListPartInfo = { declared: 0, titles: [] }

/**
 * One batched request for every part's episode count and streamed titles.
 *
 * The counts are the important part: they decide how many episode slots a part
 * occupies, and getting that wrong shifts every following season.
 */
async function fetchAniListParts(ids: number[]): Promise<Map<number, AniListPartInfo>> {
  const result = new Map<number, AniListPartInfo>()
  const unique = [...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))]
  if (unique.length === 0) return result

  // GraphQL alias batching: one request for the whole franchise.
  const aliases = unique.map((id, i) => `p${i}: Media(id: ${id}) { episodes streamingEpisodes { title } }`)

  try {
    const response = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: `query {\n${aliases.join('\n')}\n}` }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) return result

    const payload = (await response.json()) as {
      data?: Record<string, AniListMedia | null>
    }

    unique.forEach((id, index) => {
      const media = payload.data?.[`p${index}`]
      const declared = typeof media?.episodes === 'number' && media.episodes > 0 ? media.episodes : 0
      result.set(id, { declared, titles: parseTitles(media?.streamingEpisodes) })
    })
  } catch {
    // Counts fall back to Kitsu below.
  }

  return result
}

/** Strip the "Episode 7 - " prefix AniList adds. */
function parseTitles(list: { title?: string | null }[] | null | undefined): {
  number: number
  title: string
}[] {
  if (!Array.isArray(list)) return []
  const out: { number: number; title: string }[] = []

  for (const item of list) {
    const raw = item?.title?.trim()
    if (!raw) continue
    const match = /^episode\s+(\d+)\s*[-–—:.]\s*(.+)$/i.exec(raw)
    if (match) out.push({ number: Number(match[1]), title: match[2].trim() })
    else out.push({ number: out.length + 1, title: raw })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Collect episode names for a franchise, in season order.
 *
 * `seasons` is one array of part ids per merged season: a season split into two
 * cours has two ids. Each part occupies its own stretch of the numbering, sized
 * by AniList's declared episode count rather than by how many titles came back
 * — a part with 13 episodes but a single titled row still takes 13 slots.
 */
export async function loadEpisodeNames(seasons: number[][]): Promise<EpisodeNamesResult> {
  const clean = seasons
    .map((parts) => parts.filter((n) => Number.isSafeInteger(n) && n > 0))
    .filter((parts) => parts.length > 0)

  if (clean.length === 0) throw new Error('No reference id for this anime')

  const anilistParts = await fetchAniListParts(clean.flat())

  const episodes: EpisodeName[] = []
  const missingSeasons: number[] = []
  let usedKitsu = false
  let usedAniList = false
  let absolute = 1

  for (const [seasonIndex, parts] of clean.entries()) {
    const seasonNumber = seasonIndex + 1
    let namedInSeason = 0

    for (const partId of parts) {
      const info = anilistParts.get(partId) ?? EMPTY_PART

      // Titles per part, in that part's own 1-based numbering.
      const titles = new Map<number, string>()

      // Kitsu is the reliable source for titles.
      let kitsuCount = 0
      try {
        const kitsuId = await kitsuAnimeId(partId)
        if (kitsuId) {
          const kitsu = await kitsuEpisodeNames(kitsuId)
          kitsuCount = kitsu.count
          for (const [number, title] of kitsu.titles) titles.set(number, title)
          if (kitsu.titles.size > 0) usedKitsu = true
        }
      } catch {
        // fall through to AniList titles
      }

      // How many slots this part occupies, most reliable source first.
      let declared = info.declared
      if (declared === 0) declared = kitsuCount
      if (declared === 0 && titles.size > 0) declared = Math.max(...titles.keys())

      // AniList titles are only used when the list matches this part exactly.
      // It repeats the whole franchise otherwise: Re:Zero returns the same 16
      // titles numbered 63-78 on all three of its early seasons, which would
      // otherwise be stamped onto season 1.
      if (info.titles.length > 0 && declared > 0 && info.titles.length === declared) {
        let added = false
        for (const entry of info.titles) {
          if (entry.number < 1 || entry.number > declared) continue
          if (!titles.has(entry.number)) {
            titles.set(entry.number, entry.title)
            added = true
          }
        }
        if (added) usedAniList = true
      }

      // A stray high number must never inflate the part's length.
      const count = Math.max(declared, titles.size > 0 ? Math.max(...titles.keys()) : 0)

      for (let n = 1; n <= count; n += 1) {
        const title = titles.get(n)
        if (title) {
          episodes.push({ number: absolute, season: seasonNumber, title })
          namedInSeason += 1
        }
        absolute += 1
      }
    }

    if (namedInSeason === 0) missingSeasons.push(seasonNumber)
  }

  if (episodes.length === 0) {
    throw new Error('No episode names found for this anime')
  }

  return {
    episodes,
    source: usedKitsu ? 'kitsu' : usedAniList ? 'anilist' : 'kitsu',
    missingSeasons
  }
}
