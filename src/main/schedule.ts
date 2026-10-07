/**
 * Release calendar.
 *
 * Builds three lists from AniList:
 *
 *   1. `episodes`  — upcoming episodes of shows the user already has, from
 *                    `airingSchedule(notYetAired: true)`. This is the reliable
 *                    part: every entry carries an exact timestamp.
 *   2. `seasons`   — continuations of those shows, found by walking their SEQUEL
 *                    relations. Much sparser: AniList often knows only the
 *                    broadcast season, so `precision` records how exact the date
 *                    really is and the UI must not imply more.
 *   3. `discovery` — shows starting this season that the user does not have.
 *                    Kept separate so the tracked list stays free of noise.
 *
 * Everything is batched through GraphQL aliases: one request covers 20 entries,
 * which matters because AniList allows about 30 requests a minute.
 */
import { CodedError } from '../shared/errors'
import type {
  AiringEpisode,
  ScheduleResult,
  UpcomingSeason
} from '../shared/schedule'

const ENDPOINT = process.env['ANIMEEH_ANILIST_ENDPOINT'] ?? 'https://graphql.anilist.co'
const TIMEOUT_MS = 25_000
const BATCH = 20
/** How far ahead episodes are collected. */
const WINDOW_DAYS = 21

/** Formats that are anime. A relation can point at something else entirely. */
const ANIME_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA', 'OVA', 'MOVIE', 'SPECIAL', 'MUSIC'])

/**
 * How far the SEQUEL chain is followed, and a ceiling on entries visited.
 *
 * One hop is what this used to do, and it kept a film releasing in three weeks
 * off the calendar: Made in Abyss: Mezameru Shinpi hangs three hops from the ids
 * the library holds, through entries that are themselves finished. Four hops
 * costs two or three extra batched requests, because the frontier shrinks fast
 * after the first.
 */
const CHAIN_HOPS = 4
const CHAIN_MAX_ENTRIES = 300

/** What the renderer sends: the shows it wants watched. */
export interface ScheduleRequestEntry {
  anilistId: number
  title: string
  /** The user's own status, carried through to the UI. */
  status: string
  /**
   * Every AniList id this entry covers: its own plus each season's and part's.
   *
   * This matters more than it looks. A library entry stores the *first* season's
   * id, so asking only for that id hides the later seasons: the user's Tokyo
   * Revengers entry pointed at season 1 while season 5 was about to air, and the
   * continuation was invisible because season 1's relations do not reach it.
   */
  seasonIds?: number[]
}

interface RawAiringNode {
  episode: number
  airingAt: number
}

interface RawMedia {
  id: number
  title: { romaji?: string | null; english?: string | null } | null
  coverImage?: { large?: string | null } | null
  format?: string | null
  status?: string | null
  season?: string | null
  seasonYear?: number | null
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null
  nextAiringEpisode?: RawAiringNode | null
  airingSchedule?: { nodes?: RawAiringNode[] | null } | null
  relations?: {
    edges?: {
      relationType: string
      node: RawMedia | null
    }[] | null
  } | null
}

async function graphql<T>(query: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
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

  const payload = (await response.json()) as { data?: T; errors?: { message?: string }[] }
  if (payload.errors?.length) {
    throw new CodedError(payload.errors[0]?.message ?? 'AniList error', 'http', {
      service: 'anilist'
    })
  }
  if (!payload.data) {
    throw new CodedError('Empty response from AniList', 'empty', { service: 'anilist' })
  }
  return payload.data
}

function titleOf(media: RawMedia | null | undefined): string {
  return (
    media?.title?.romaji?.trim() ||
    media?.title?.english?.trim() ||
    `AniList #${media?.id ?? '?'}`
  )
}

/** YYYY-MM-DD with the precision AniList actually provides. */
function startDateOf(media: RawMedia | null | undefined): {
  precision: UpcomingSeason['precision']
  value: string | null
} {
  const d = media?.startDate
  if (!d?.year) return { precision: 'none', value: null }
  if (d.month && d.day) {
    return {
      precision: 'day',
      value: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
    }
  }
  if (d.month) {
    return { precision: 'month', value: `${d.year}-${String(d.month).padStart(2, '0')}` }
  }
  return { precision: 'year', value: String(d.year) }
}

/** AniList's season labels, translated for display. */
const SEASON_PREFIX: Record<string, string> = {
  WINTER: 'winter',
  SPRING: 'spring',
  SUMMER: 'summer',
  FALL: 'fall'
}

function seasonLabelOf(media: RawMedia | null | undefined): string | null {
  const season = media?.season
  const year = media?.seasonYear
  if (!season || !year || !SEASON_PREFIX[season]) return null
  return `${SEASON_PREFIX[season]}:${year}`
}

/** The broadcast season happening right now, used for discovery. */
function currentSeason(): { season: string; year: number } {
  const now = new Date()
  const month = now.getMonth() + 1
  const season = month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL'
  return { season, year: now.getFullYear() }
}

/* ------------------------------------------------------------------ */
/* Library shows: episodes, and announced continuations                */
/* ------------------------------------------------------------------ */

const LIBRARY_QUERY = (ids: number[]): string => `
query {
  Page(page: 1, perPage: 50) {
    media(id_in: ${JSON.stringify(ids)}, type: ANIME) {
      id
      title { romaji english }
      coverImage { large }
      format
      status
      season
      seasonYear
      startDate { year month day }
      nextAiringEpisode { episode airingAt }
      airingSchedule(notYetAired: true, perPage: 20) { nodes { episode airingAt } }
      relations {
        edges {
          relationType
          node {
            id
            title { romaji english }
            coverImage { large }
            format
            status
            season
            seasonYear
            startDate { year month day }
            nextAiringEpisode { episode airingAt }
            airingSchedule(notYetAired: true, perPage: 10) { nodes { episode airingAt } }
          }
        }
      }
    }
  }
}`

export async function buildSchedule(
  entries: ScheduleRequestEntry[]
): Promise<ScheduleResult> {
  const now = Math.floor(Date.now() / 1000)
  const horizon = now + WINDOW_DAYS * 86_400

  // Only entries AniList can be asked about.
  const usable = entries.filter((e) => Number.isSafeInteger(e.anilistId) && e.anilistId > 0)

  // Every id an entry covers maps back to that entry. Querying all of them is
  // what makes a later season's announcement discoverable.
  const owner = new Map<number, ScheduleRequestEntry>()
  let skipped = 0
  for (const entry of entries) {
    const ids = new Set<number>([entry.anilistId, ...(entry.seasonIds ?? [])])
    let usableId = false
    for (const id of ids) {
      if (!Number.isSafeInteger(id) || id <= 0) continue
      usableId = true
      if (!owner.has(id)) owner.set(id, entry)
    }
    if (!usableId) skipped += 1
  }

  const episodes: AiringEpisode[] = []
  const seasons: UpcomingSeason[] = []
  let airingEntries = 0

  /** Collect the upcoming episodes of one entry, from data already fetched. */
  const collectEpisodes = (media: RawMedia, entry: ScheduleRequestEntry | undefined): void => {
    const nodes = (media.airingSchedule?.nodes ?? []).filter(
      (n) => n.airingAt >= now && n.airingAt <= horizon
    )
    if (nodes.length > 0) airingEntries += 1
    for (const node of nodes) {
      episodes.push({
        anilistId: media.id,
        title: titleOf(media),
        coverImage: media.coverImage?.large ?? null,
        episode: node.episode,
        airingAt: node.airingAt,
        seasonNumber: null,
        inLibrary: true,
        libraryStatus: entry?.status ?? null
      })
    }
  }

  /**
   * Record a continuation, without the "already seen?" bookkeeping.
   *
   * `status` is passed in rather than read from the node, because the caller has
   * already narrowed it to one of the two upcoming states.
   */
  const announce = (node: RawMedia, from: RawMedia, status: string): void => {
    const date = startDateOf(node)
    seasons.push({
      fromAnilistId: from.id,
      fromTitle: titleOf(from),
      seasonId: node.id,
      title: titleOf(node),
      status,
      precision: date.precision,
      startDate: date.value,
      seasonLabel: seasonLabelOf(node),
      firstEpisodeAt: node.nextAiringEpisode?.airingAt ?? null,
      format: node.format ?? null
    })
  }

  /**
   * Walk the SEQUEL chain outwards, one batch of entries per hop.
   *
   * A single hop is not enough, and this is what kept a film releasing in three
   * weeks off the calendar: Made in Abyss: Mezameru Shinpi hangs three hops from
   * the ids the library holds — season 1, then the 2020 film, then season 2, then
   * the film — and none of those intermediate steps is itself upcoming.
   *
   * So every reached entry is followed, not only the upcoming ones, while only
   * the upcoming ones are announced. Each hop is cheap after the first: the
   * frontier shrinks (138 ids lead to 47, then 25, then 10), because the library
   * ids are what cost the requests.
   */
  const seen = new Set<number>(owner.keys())
  let frontier = [...owner.keys()]

  for (let hop = 0; hop <= CHAIN_HOPS && frontier.length > 0; hop += 1) {
    const next: number[] = []

    for (let i = 0; i < frontier.length; i += BATCH) {
      const slice = frontier.slice(i, i + BATCH)
      const data = await graphql<{ Page: { media: RawMedia[] } }>(LIBRARY_QUERY(slice))

      for (const media of data.Page?.media ?? []) {
        const entry = owner.get(media.id)

        // Upcoming episodes. For the library's own entries, always; for a reached
        // continuation, only while it is airing, since its weekly episode is what
        // the user wants to see.
        if (hop === 0 || media.status === 'RELEASING') collectEpisodes(media, entry)

        for (const edge of media.relations?.edges ?? []) {
          if (edge.relationType !== 'SEQUEL') continue
          const node = edge.node
          if (!node) continue
          // A relation can point at an adaptation rather than an anime: Cyberpunk:
          // Edgerunners MADNESS is a manga linked as a SEQUEL, and a release
          // calendar must not list a manga.
          if (!ANIME_FORMATS.has(node.format ?? '')) continue
          // Already tracked means it is not a gap to surface.
          if (owner.has(node.id)) continue

          if (node.status === 'NOT_YET_RELEASED' || node.status === 'RELEASING') {
            announce(node, media, node.status)
          }

          // Follow it either way, since the film that leads to the next season is
          // finished by the time the season is announced.
          if (!seen.has(node.id) && seen.size < CHAIN_MAX_ENTRIES) {
            seen.add(node.id)
            next.push(node.id)
          }
        }
      }
    }

    frontier = next
  }

  // A continuation might be announced by more than one entry; keep one each.
  const uniqueSeasons = new Map<number, UpcomingSeason>()
  for (const season of seasons) {
    const existing = uniqueSeasons.get(season.seasonId)
    if (!existing) {
      uniqueSeasons.set(season.seasonId, season)
      continue
    }
    // Prefer the announcement hanging off an entry the user actually has, so the
    // line reads "after Made in Abyss" rather than after the intermediate film
    // the chain happened to pass through.
    const existingOwned = owner.has(existing.fromAnilistId)
    const candidateOwned = owner.has(season.fromAnilistId)
    if (!existingOwned && candidateOwned) uniqueSeasons.set(season.seasonId, season)
  }

  const sortedSeasons = [...uniqueSeasons.values()].sort((a, b) => {
    // Dated entries first, soonest first; undated ones last.
    const av = a.startDate ?? '9999'
    const bv = b.startDate ?? '9999'
    return av.localeCompare(bv)
  })

  /* --- discovery: new shows this season --- */
  const discovery: AiringEpisode[] = []
  try {
    const { season, year } = currentSeason()
    const data = await graphql<{ Page: { media: RawMedia[] } }>(`query {
      Page(page: 1, perPage: 30) {
        media(
          type: ANIME
          season: ${season}
          seasonYear: ${year}
          status: RELEASING
          sort: POPULARITY_DESC
        ) {
          id
          title { romaji english }
          coverImage { large }
          format
          status
          nextAiringEpisode { episode airingAt }
          airingSchedule(notYetAired: true, perPage: 5) { nodes { episode airingAt } }
        }
      }
    }`)

    for (const media of data.Page?.media ?? []) {
      if (owner.has(media.id)) continue
      const nodes = (media.airingSchedule?.nodes ?? []).filter(
        (n) => n.airingAt >= now && n.airingAt <= horizon
      )
      // A show with nothing before the horizon is not useful here.
      const first = nodes[0] ?? media.nextAiringEpisode
      if (!first || first.airingAt > horizon) continue

      discovery.push({
        anilistId: media.id,
        title: titleOf(media),
        coverImage: media.coverImage?.large ?? null,
        episode: first.episode,
        airingAt: first.airingAt,
        seasonNumber: null,
        inLibrary: false,
        libraryStatus: null
      })
    }
  } catch {
    // Discovery is a bonus; never fail the whole refresh for it.
  }

  episodes.sort((a, b) => a.airingAt - b.airingAt)
  discovery.sort((a, b) => a.airingAt - b.airingAt)

  return {
    fetchedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    episodes,
    seasons: sortedSeasons,
    discovery,
    counts: {
      libraryEntries: usable.length,
      airingEntries,
      upcomingSeasons: sortedSeasons.length,
      skipped
    }
  }
}
