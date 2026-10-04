/**
 * Episode names.
 *
 * AniList is the reference source for titles, but it has no episode list of its
 * own: `streamingEpisodes` mirrors the streaming service and only covered 73%
 * of this library, with nothing at all for Vinland Saga, Cyberpunk or Oshi no
 * Ko. Kitsu keeps a real per-anime episode list and maps to AniList ids, so it
 * is tried first and AniList's list is the fallback.
 *
 * Each season of a franchise is a separate entry on both services, so a
 * multi-season entity is filled season by season and renumbered continuously,
 * matching how the app stores episodes.
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

/** Every titled episode of one Kitsu anime, following pagination. */
async function kitsuEpisodeNames(kitsuId: string): Promise<{ number: number; title: string }[]> {
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

  return items
    .filter((e) => e.attributes?.canonicalTitle)
    .map((e, index) => ({
      // Kitsu leaves `number` null for specials; fall back to arrival order.
      number: typeof e.attributes?.number === 'number' ? e.attributes.number : index + 1,
      title: (e.attributes?.canonicalTitle ?? '').trim()
    }))
    .filter((e) => e.title !== '')
    .sort((a, b) => a.number - b.number)
}

/* ------------------------------------------------------------------ */
/* AniList fallback                                                    */
/* ------------------------------------------------------------------ */

interface AniListMedia {
  episodes?: number | null
  streamingEpisodes?: { title?: string | null }[] | null
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

interface AniListEpisodeNames {
  list: { number: number; title: string }[]
  /** Episode count AniList declares for this season, 0 when unknown. */
  declared: number
}

async function anilistEpisodeNames(anilistId: number): Promise<AniListEpisodeNames> {
  const key = `anilist:${anilistId}`
  const cached = cacheGet<AniListEpisodeNames>(key)
  if (cached) return cached

  const response = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: 'query ($id: Int) { Media(id: $id) { episodes streamingEpisodes { title } } }',
      variables: { id: anilistId }
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`AniList responded with ${response.status}`)

  const payload = (await response.json()) as { data?: { Media?: AniListMedia | null } }
  const media = payload.data?.Media
  const titles = parseTitles(media?.streamingEpisodes)
  const declared = typeof media?.episodes === 'number' && media.episodes > 0 ? media.episodes : 0

  // AniList repeats the whole franchise on every season, so a list whose length
  // disagrees with this season's episode count cannot be trusted for it.
  const result: AniListEpisodeNames = {
    list: declared > 0 && titles.length !== declared ? [] : titles,
    declared
  }

  cacheSet(key, result)
  return result
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Collect episode names for a franchise, in season order.
 *
 * `seasons` are the AniList ids of each season, earliest first. A single-season
 * entity passes one entry. Each season is resolved independently so a season
 * Kitsu does not know about still gets its AniList fallback.
 */
export async function loadEpisodeNames(seasons: number[]): Promise<EpisodeNamesResult> {
  const unique = [...new Set(seasons.filter((n) => Number.isSafeInteger(n) && n > 0))]
  if (unique.length === 0) throw new Error('No reference id for this anime')

  const episodes: EpisodeName[] = []
  const missingSeasons: number[] = []
  let usedKitsu = false
  let usedAniList = false
  let absolute = 1

  for (const [index, anilistId] of unique.entries()) {
    const seasonNumber = index + 1
    let found: { number: number; title: string }[] = []
    let declared = 0

    // Kitsu first: its list is a real per-season episode list.
    try {
      const kitsuId = await kitsuAnimeId(anilistId)
      if (kitsuId) {
        found = await kitsuEpisodeNames(kitsuId)
        if (found.length > 0) usedKitsu = true
      }
    } catch {
      // fall through to AniList
    }

    // AniList fallback when Kitsu has nothing for this season.
    if (found.length === 0) {
      try {
        const fallback = await anilistEpisodeNames(anilistId)
        found = fallback.list
        declared = fallback.declared
        if (found.length > 0) usedAniList = true
      } catch {
        // leave this season empty
      }
    }

    if (found.length === 0) {
      missingSeasons.push(seasonNumber)
      // Still advance the counter so later seasons keep their real numbers.
      absolute += declared
      continue
    }

    const byNumber = new Map(found.map((e) => [e.number, e.title]))
    const count = Math.max(declared, ...found.map((e) => e.number))

    for (let n = 1; n <= count; n += 1) {
      const title = byNumber.get(n)
      if (title) episodes.push({ number: absolute, season: seasonNumber, title })
      absolute += 1
    }
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
