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
  TierAnime,
  TierCharacter,
  TierSearchOutcome,
  TierSearchResult,
  TierTheme,
  TierThemesOutcome,
  ThemeLookupEntry
} from '../shared/tierlist'

const ANILIST = process.env['ANIMEEH_ANILIST_ENDPOINT'] ?? 'https://graphql.anilist.co'
const ANIMETHEMES = process.env['ANIMEEH_ANIMETHEMES_ENDPOINT'] ?? 'https://api.animethemes.moe'
const USER_AGENT = 'ANIMEEH (https://github.com/mRNeFF/animeeh)'

/**
 * Titles that are not works: promotional videos and commercials.
 *
 * AniList files them as anime, so they turn up in every search — "Tengoku Daimakyou
 * PV" beside the series — and they are noise in a ranking, since nobody tiers a
 * trailer. Matched as a whole word at the end of a title only, so a real title that
 * merely contains those letters is untouched.
 */
const PROMO_SUFFIX = /(?:\s|\()(?:pvs?|cms?|teasers?|trailers?|previews?)\)?\s*$/i

function isPromo(title: string): boolean {
  return PROMO_SUFFIX.test(title.trim())
}

const REQUEST_TIMEOUT_MS = 20_000
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
  // A rate limit is worth waiting out rather than reporting: AniList allows about
  // thirty requests a minute, and a user typing quickly can reach that on their
  // own. Two retries with a growing wait cover a momentary burst, and a limit that
  // persists is still reported as a limit.
  for (let attempt = 0; attempt <= 2; attempt += 1) {
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
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)))
        continue
      }
      throw new CodedError('Rate limited', 'rateLimit', { status: 429, service })
    }
    if (!response.ok) {
      throw new CodedError(`HTTP ${response.status}`, 'http', { status: response.status, service })
    }
    return (await response.json()) as T
  }

  // Unreachable, but TypeScript needs a return on every path.
  throw new CodedError('Rate limited', 'rateLimit', { status: 429, service })
}

/* ------------------------------------------------------------------ */
/* Searching everything, in one request                                */
/* ------------------------------------------------------------------ */

interface RawSearchMedia {
  id?: number
  title?: { romaji?: string | null; english?: string | null } | null
  coverImage?: { large?: string | null } | null
  format?: string | null
  episodes?: number | null
  genres?: string[] | null
  startDate?: { year?: number | null } | null
}

interface RawSearchCharacter {
  id?: number
  name?: { full?: string | null } | null
  image?: { large?: string | null } | null
  favourites?: number | null
  media?: { nodes?: RawSearchMedia[] | null } | null
}

/**
 * Anime and characters for one query, in a single AniList request.
 *
 * Both searches are aliased into one `Page`, so a search box costs one request
 * rather than two. That matters because the box is typed into: at ten keystrokes
 * a debounce still means a handful of requests, and AniList allows about thirty a
 * minute.
 *
 * The catalogue is searched, not the library: a tier list is often about shows the
 * user has not rated. The library is only consulted to mark which results are
 * already tracked.
 */
export async function searchEverything(
  query: string,
  library: { anilistId: number; id: string }[]
): Promise<TierSearchOutcome> {
  const trimmed = query.trim()
  if (trimmed.length < 2) {
    return { ok: true, data: { anime: [], characters: [] } }
  }

  const byAnilist = new Map(library.map((entry) => [entry.anilistId, entry.id]))

  /**
   * One round trip, for one term.
   *
   * Both searches are aliased into a single `Page`, so a search box costs one
   * request rather than two. That matters because the box is typed into: at ten
   * keystrokes a debounce still means a handful of requests, and AniList allows
   * about thirty a minute.
   *
   * The catalogue is searched, not the library: a tier list is often about shows
   * the user has not rated. The library is only consulted to mark which results are
   * already tracked.
   */
  const run = async (term: string): Promise<TierSearchResult> => {
    const data = await fetchJson<{
      data?: {
        media?: { media?: RawSearchMedia[] | null } | null
        chars?: { characters?: RawSearchCharacter[] | null } | null
      }
      errors?: { message: string }[]
    }>(
      ANILIST,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query: `query ($q: String) {
            media: Page(page: 1, perPage: 24) {
              media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
                id title { romaji english } coverImage { large } format episodes genres startDate { year }
              }
            }
            chars: Page(page: 1, perPage: 24) {
              characters(search: $q, sort: [FAVOURITES_DESC]) {
                id name { full } image { large } favourites
                media(perPage: 1) { nodes { id title { romaji } } }
              }
            }
          }`,
          variables: { q: term }
        })
      },
      'anilist'
    )

    if (data.errors?.length) {
      throw new CodedError(data.errors[0].message, 'http', { service: 'anilist' })
    }

    const anime: TierAnime[] = (data.data?.media?.media ?? []).flatMap((media) => {
      if (typeof media.id !== 'number') return []
      const title = media.title?.romaji?.trim() || media.title?.english?.trim()
      if (!title) return []
      // Trailers and commercials are catalogued as anime but are not works.
      if (isPromo(title)) return []
      const libraryId = byAnilist.get(media.id) ?? null
      return [
        {
          anilistId: media.id,
          title,
          englishTitle: media.title?.english?.trim() ?? null,
          image: media.coverImage?.large ?? null,
          format: media.format ?? null,
          year: media.startDate?.year ?? null,
          episodes: media.episodes ?? null,
          genres: media.genres ?? [],
          inLibrary: libraryId !== null,
          libraryId
        }
      ]
    })

    const characters: TierCharacter[] = (data.data?.chars?.characters ?? []).flatMap((character) => {
      if (typeof character.id !== 'number') return []
      const name = character.name?.full?.trim()
      if (!name) return []
      const from = character.media?.nodes?.[0]
      return [
        {
          anilistId: character.id,
          name,
          image: character.image?.large ?? null,
          // A global character search does not report a role, since a character
          // can be main in one entry and a cameo in another.
          role: '',
          favourites: character.favourites ?? 0,
          animeTitle: from?.title?.romaji?.trim() ?? null
        }
      ]
    })

    return { anime, characters }
  }

  try {
    let found = await run(trimmed)

    /**
     * A full name often finds nothing, because the catalogue stores only part of
     * it. "Levi Ackerman" returns zero while "Levi" finds him, since the entry is
     * named "Levi" — and the anime search behaves the same way.
     *
     * So a two-word query with no results is retried on each of its words and the
     * answers are merged, rather than picking one word and hoping. Picking the
     * longest would have been wrong here: "ackerman" returns the whole family and
     * not the character asked for.
     *
     * The merged characters are ranked by favourites, which is a sound proxy for
     * "the one people mean" and is what puts Levi (38173) above Mikasa Ackerman
     * (25485) when both words are searched. Two extra requests, only in the case
     * where the user would otherwise see an empty list.
     */
    if (found.anime.length === 0 && found.characters.length === 0 && /\s/.test(trimmed)) {
      const words = [...new Set(trimmed.split(/\s+/).filter((word) => word.length >= 3))].slice(0, 2)
      const animeById = new Map<number, TierAnime>()
      const charactersById = new Map<number, TierCharacter>()
      for (const word of words) {
        const part = await run(word)
        for (const entry of part.anime) {
          if (!animeById.has(entry.anilistId)) animeById.set(entry.anilistId, entry)
        }
        for (const character of part.characters) {
          const seen = charactersById.get(character.anilistId)
          if (!seen || character.favourites > seen.favourites) {
            charactersById.set(character.anilistId, character)
          }
        }
      }
      found = {
        anime: [...animeById.values()].slice(0, 24),
        characters: [...charactersById.values()]
          .sort((a, b) => b.favourites - a.favourites)
          .slice(0, 24)
      }
    }

    return { ok: true, data: found }
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
