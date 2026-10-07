/**
 * The tier list sources, fetched in the main process.
 *
 * Two very different services, with two different failure modes:
 *
 *   - **AniList** provides characters. Batched through GraphQL aliases like the
 *     rest of the app, because it allows about 30 requests a minute.
 *   - **AnimeThemes** provides openings and endings, because AniList has no theme
 *     field at all. It allows 90 requests a minute, so it is paced at roughly one
 *     request a second.
 *
 * Matching a library entry to its themes is the delicate part, and it is done by
 * ID rather than by title. AnimeThemes carries `AniList` and `MyAnimeList` links in
 * its resources, so a candidate is only accepted once its AniList link names the
 * id that was asked for. Title matching alone would pair a remake, a film and a
 * season with each other — the exact failure already seen with Dragon Ball and
 * Naruto — so it is used only to find candidates, never to accept one.
 *
 * One trap is worth recording: AnimeThemes' `filter[anime][id]` answers HTTP 200
 * with themes from unrelated shows rather than an error, so a wrong filter looks
 * like a successful lookup. `/search` and `/anime/{slug}` are the routes used here.
 */
import { CodedError } from '../shared/errors'
import type {
  TierCharacter,
  TierCharactersOutcome,
  TierTheme,
  TierThemesOutcome,
  ThemeLookupEntry
} from '../shared/tierlist'

const ANILIST = process.env['ANIMEEH_ANILIST_ENDPOINT'] ?? 'https://graphql.anilist.co'
const ANIMETHEMES = process.env['ANIMEEH_ANIMETHEMES_ENDPOINT'] ?? 'https://api.animethemes.moe'
const USER_AGENT = 'ANIMEEH (https://github.com/mRNeFF/animeeh)'

const REQUEST_TIMEOUT_MS = 20_000
const BATCH = 20
/** AnimeThemes allows 90 a minute; a second between calls stays well inside it. */
const THEME_PACING_MS = 700
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
/** How many search candidates are checked before giving up on an entry. */
const MAX_CANDIDATES = 3

/* ------------------------------------------------------------------ */
/* Small TTL cache                                                     */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  at: number
  value: unknown
}

const cache = new Map<string, CacheEntry>()

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.value as T
}

function cacheSet(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value })
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

async function fetchJson<T>(url: string, init: RequestInit, service: 'anilist' | 'animethemes'): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'TimeoutError'
    throw new CodedError(
      aborted ? 'Request timed out' : `Could not reach the service`,
      aborted ? 'timeout' : 'unreachable',
      { service }
    )
  }
  if (response.status === 429) {
    throw new CodedError('Rate limited', 'rateLimit', { status: 429, service })
  }
  if (!response.ok) {
    throw new CodedError(`HTTP ${response.status}`, 'http', { status: response.status, service })
  }
  return (await response.json()) as T
}

/* ------------------------------------------------------------------ */
/* Characters, from AniList                                            */
/* ------------------------------------------------------------------ */

interface RawCharacterEdge {
  role?: string | null
  node?: {
    id?: number
    name?: { full?: string | null } | null
    image?: { large?: string | null } | null
    favourites?: number | null
  } | null
}

/**
 * The characters of several entries, batched.
 *
 * Only the first page is taken. A long-running show can list hundreds of
 * characters and most are supernumeraries; the first page is ordered by role and
 * relevance, so it holds the ones anyone would want to rank.
 */
async function fetchCharactersFor(
  batch: { anilistId: number; animeId: string }[]
): Promise<{ found: TierCharacter[]; missing: number }> {
  const aliases = batch
    .map(
      (entry, index) => `p${index}: Media(id: ${entry.anilistId}) {
        characters(page: 1, perPage: 25, sort: [ROLE, RELEVANCE, ID]) {
          edges { role node { id name { full } image { large } favourites } }
        }
      }`
    )
    .join('\n')

  const data = await fetchJson<{ data?: Record<string, { characters?: { edges?: RawCharacterEdge[] } } | null>; errors?: { message: string }[] }>(
    ANILIST,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: `query {\n${aliases}\n}` })
    },
    'anilist'
  )

  if (data.errors?.length) {
    throw new CodedError(data.errors[0].message, 'http', { service: 'anilist' })
  }

  const found: TierCharacter[] = []
  let missing = 0

  batch.forEach((entry, index) => {
    const edges = data.data?.[`p${index}`]?.characters?.edges ?? []
    if (edges.length === 0) {
      missing += 1
      return
    }
    for (const edge of edges) {
      const node = edge.node
      if (!node?.id) continue
      const name = node.name?.full?.trim()
      if (!name) continue
      found.push({
        anilistId: node.id,
        name,
        image: node.image?.large ?? null,
        role: edge.role ?? 'SUPPORTING',
        favourites: node.favourites ?? 0,
        animeId: entry.animeId
      })
    }
  })

  return { found, missing }
}

export async function loadCharacters(
  entries: { anilistId: number; animeId: string }[]
): Promise<TierCharactersOutcome> {
  const usable = entries.filter((entry) => Number.isSafeInteger(entry.anilistId) && entry.anilistId > 0)
  if (usable.length === 0) {
    return { ok: false, code: 'noReference', service: 'anilist', error: 'no entries with an AniList id' }
  }

  try {
    const characters: TierCharacter[] = []
    let missing = 0
    for (let i = 0; i < usable.length; i += BATCH) {
      const slice = usable.slice(i, i + BATCH)
      const result = await fetchCharactersFor(slice)
      characters.push(...result.found)
      missing += result.missing
    }
    return { ok: true, data: { characters, missing } }
  } catch (err) {
    const coded = err as CodedError
    return {
      ok: false,
      code: coded.code ?? 'unreachable',
      status: coded.meta?.status,
      service: 'anilist',
      error: coded.message
    }
  }
}

/* ------------------------------------------------------------------ */
/* Openings and endings, from AnimeThemes                              */
/* ------------------------------------------------------------------ */

let lastThemeCall = 0

async function paced<T>(run: () => Promise<T>): Promise<T> {
  const wait = THEME_PACING_MS - (Date.now() - lastThemeCall)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastThemeCall = Date.now()
  return run()
}

interface AnimeThemesSearchHit {
  id: number
  name: string
  slug: string
  year?: number | null
}

interface AnimeThemesTheme {
  type?: string | null
  sequence?: number | null
  slug?: string | null
  song?: { title?: string | null; artists?: { name?: string | null }[] | null } | null
  animethemeentries?: { videos?: AnimeThemesVideo[] | null }[] | null
}

interface AnimeThemesVideo {
  basename?: string | null
  link?: string | null
  nc?: boolean | null
  resolution?: number | null
}

interface AnimeThemesResources {
  site?: string | null
  link?: string | null
}

/**
 * The AniList id a candidate record belongs to, read from its external links.
 *
 * Returning null means "could not confirm", and an unconfirmed candidate is
 * rejected rather than accepted on a title similarity.
 */
async function anilistIdOf(slug: string): Promise<number | null> {
  const key = `aT:anilistId:${slug}`
  const cached = cacheGet<number | null>(key)
  if (cached !== undefined && cached !== null) return cached

  const data = await paced(() =>
    fetchJson<{ anime?: { resources?: AnimeThemesResources[] | null } | null }>(
      `${ANIMETHEMES}/anime/${encodeURIComponent(slug)}?include=resources`,
      { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } },
      'animethemes'
    )
  )

  const link = (data.anime?.resources ?? []).find((r) => r.site === 'AniList')?.link ?? ''
  const match = link.match(/\/anime\/(\d+)/)
  const id = match ? Number(match[1]) : null
  if (id !== null) cacheSet(key, id)
  return id
}

/** The themes of a candidate, with titles, artists and a thumbnail per entry. */
async function themesOf(slug: string, anilistId: number): Promise<TierTheme[]> {
  const key = `aT:themes:${anilistId}`
  const cached = cacheGet<TierTheme[]>(key)
  if (cached) return cached

  const data = await paced(() =>
    fetchJson<{ anime?: { animethemes?: AnimeThemesTheme[] | null } | null }>(
      // The nested paths must be fully qualified. Writing `animethemeentries.videos`
      // without the `animethemes.` prefix is answered with HTTP 422 rather than a
      // silent omission, which is how this was caught.
      `${ANIMETHEMES}/anime/${encodeURIComponent(slug)}?include=animethemes.song.artists,animethemes.animethemeentries.videos`,
      { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } },
      'animethemes'
    )
  )

  const themes: TierTheme[] = []
  for (const theme of data.anime?.animethemes ?? []) {
    const type = (theme.type ?? '').toUpperCase()
    if (type !== 'OP' && type !== 'ED') continue
    const title = theme.song?.title?.trim()
    if (!title) continue
    const slug = (theme.slug ?? '').trim()
    if (slug === '') continue

    // The creditless cut is preferred when the catalogue marks one: it has no
    // credits burned over the frame, so it is the nicer one to link to.
    const videos = (theme.animethemeentries ?? []).flatMap((entry) => entry.videos ?? [])
    const preferred =
      videos.find((video) => video.nc && (video.resolution ?? 0) >= 720) ??
      videos.find((video) => video.link || video.basename) ??
      null

    themes.push({
      type,
      slug,
      anilistId,
      title,
      artists: (theme.song?.artists ?? [])
        .map((artist) => artist.name?.trim())
        .filter((name): name is string => Boolean(name)),
      // A link to the video file itself, not to an image. There is no poster
      // frame in the catalogue, so the tile uses the anime's cover instead.
      videoUrl: preferred?.link ?? null
    })
  }

  // AnimeThemes lists a television cut and a full cut of the same song as two
  // entries. Two tiles with one title is noise, so the first of each slug wins.
  // Keying on the slug rather than the numeric sequence matters: that field is
  // null for many entries, which would have made every opening of a show compare
  // equal and collapse them into one.
  const deduped = new Map<string, TierTheme>()
  for (const theme of themes) {
    if (!deduped.has(theme.slug)) deduped.set(theme.slug, theme)
  }

  const out = [...deduped.values()]
  cacheSet(key, out)
  return out
}

/**
 * The themes of several library entries.
 *
 * Each entry costs a search plus one confirmation, and the confirmation is skipped
 * once a slug has been resolved before, so a second run of the same library is
 * much cheaper. Progress is not reported from here: the renderer drives this in
 * small batches so it can show a bar.
 */
export async function loadThemes(entries: ThemeLookupEntry[]): Promise<TierThemesOutcome> {
  const usable = entries.filter(
    (entry) => Number.isSafeInteger(entry.anilistId) && entry.anilistId > 0 && entry.title.trim() !== ''
  )
  if (usable.length === 0) {
    return { ok: false, code: 'noReference', service: 'animethemes', error: 'no entries to look up' }
  }

  const themes: TierTheme[] = []
  let unmatched = 0

  try {
    for (const entry of usable) {
      const cached = cacheGet<TierTheme[]>(`aT:themes:${entry.anilistId}`)
      if (cached) {
        themes.push(...cached)
        continue
      }

      const search = await paced(() =>
        fetchJson<{ search?: { anime?: AnimeThemesSearchHit[] | null } | null }>(
          `${ANIMETHEMES}/search?q=${encodeURIComponent(entry.title)}`,
          { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } },
          'animethemes'
        )
      )

      const candidates = (search.search?.anime ?? []).slice(0, MAX_CANDIDATES)
      let matched: TierTheme[] | null = null

      for (const candidate of candidates) {
        if (!candidate.slug) continue
        const id = await anilistIdOf(candidate.slug)
        if (id !== entry.anilistId) continue
        matched = await themesOf(candidate.slug, entry.anilistId)
        break
      }

      if (matched === null) {
        // Cached as empty so a second pass does not search again for an entry
        // AnimeThemes simply does not have.
        cacheSet(`aT:themes:${entry.anilistId}`, [])
        unmatched += 1
        continue
      }
      themes.push(...matched)
    }

    return { ok: true, data: { themes, unmatched } }
  } catch (err) {
    const coded = err as CodedError
    return {
      ok: false,
      code: coded.code ?? 'unreachable',
      status: coded.meta?.status,
      service: 'animethemes',
      error: coded.message
    }
  }
}
