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
 *
 * A day's episodes stay listed until the day is over, including the ones that
 * have already aired. `notYetAired` cannot express that, so the part of today
 * that has already gone out is fetched back separately — see `fetchAiringWindow`.
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
/* The day's window                                                    */
/* ------------------------------------------------------------------ */

/**
 * Local midnight, in Unix seconds.
 *
 * The renderer groups episodes by the user's local day, so "today" has to mean
 * the day the user is actually looking at, not a UTC day. Both windows are
 * anchored to this, which is what keeps an episode listed until the day it aired
 * is over rather than until the minute it aired.
 */
function startOfToday(): number {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  return Math.floor(midnight.getTime() / 1000)
}

/** A schedule node with its media, as `Page.airingSchedules` returns it. */
interface RawScheduleNode {
  episode: number
  airingAt: number
  media: RawMedia | null
}

const AIRING_PAGE_SIZE = 50
/** Ceiling per window, so a pathological answer cannot page forever. */
const AIRING_MAX_PAGES = 8

/**
 * Every episode of `ids` airing between `from` and `to`, whoever's list they belong to.
 *
 * This exists because `Media.airingSchedule(notYetAired: true)` cannot answer for
 * a day that is already under way: it excludes anything that has aired, and a
 * lower bound cannot be asked for there — `airingAt_greater` is not an argument
 * on that field, and `notYetAired: false` returns a show's *oldest* nodes rather
 * than its recent ones. The top-level `Page.airingSchedules` accepts the whole id
 * list, an `airingAt` window and an explicit `sort`, and that last part is also
 * what makes paging deterministic rather than merely usually right.
 *
 * `owner` decides whose list an episode is on, so the same call serves the
 * tracked panel and the discovery panel.
 */
async function fetchAiringWindow(
  ids: number[],
  from: number,
  to: number,
  owner: Map<number, ScheduleRequestEntry>
): Promise<AiringEpisode[]> {
  const out: AiringEpisode[] = []
  if (ids.length === 0) return out

  for (let page = 1; page <= AIRING_MAX_PAGES; page += 1) {
    const data = await graphql<{
      Page?: {
        pageInfo?: { hasNextPage?: boolean | null } | null
        airingSchedules?: RawScheduleNode[] | null
      } | null
    }>(`query {
      Page(page: ${page}, perPage: ${AIRING_PAGE_SIZE}) {
        pageInfo { hasNextPage }
        airingSchedules(
          mediaId_in: ${JSON.stringify(ids)}
          airingAt_greater: ${from}
          airingAt_lesser: ${to}
          sort: TIME
        ) {
          episode
          airingAt
          media { id title { romaji english } coverImage { large } }
        }
      }
    }`)

    for (const node of data.Page?.airingSchedules ?? []) {
      const media = node.media
      if (!media || !media.id) continue
      const entry = owner.get(media.id)
      out.push({
        anilistId: media.id,
        title: titleOf(media),
        coverImage: media.coverImage?.large ?? null,
        episode: node.episode,
        airingAt: node.airingAt,
        seasonNumber: null,
        inLibrary: entry !== undefined,
        libraryStatus: entry?.status ?? null
      })
    }

    if (!data.Page?.pageInfo?.hasNextPage) break
  }

  return out
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
  /**
   * Entries that produced at least one episode, as a set rather than a count.
   * One entry is one show, and a show can contribute from both windows below —
   * counting per window would report it twice, and counting only the upcoming
   * window would say nothing is airing on a day whose episode has already gone out.
   */
  const airingIds = new Set<number>()

  /** Collect the upcoming episodes of one entry, from data already fetched. */
  const collectEpisodes = (media: RawMedia, entry: ScheduleRequestEntry | undefined): void => {
    const nodes = (media.airingSchedule?.nodes ?? []).filter(
      (n) => n.airingAt >= now && n.airingAt <= horizon
    )
    if (nodes.length > 0) airingIds.add(media.id)
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

  /* ---- the part of today that has already aired ---- */
  /**
   * Everything above comes from `notYetAired: true`, which by definition cannot
   * return an episode that has aired. So a show's episode vanished from the
   * calendar the moment it started, and the old `airingAt >= now` filter made
   * that permanent rather than momentary. A user opening the calendar in the
   * evening should still see what aired this morning, so the day's earlier
   * episodes are fetched back and merged in.
   *
   * The window is [local midnight, now], which is exactly the stretch the
   * upcoming window cannot cover; the two overlap by a minute so that an episode
   * landing on the boundary is not lost, and the dedupe below is what keeps that
   * overlap from showing the same episode twice. The lower bound is nudged back a
   * second because AniList's `airingAt_greater` is exclusive, and an episode at
   * exactly midnight is a real, if awkward, case.
   */
  const airedToday = await fetchAiringWindow([...owner.keys()], startOfToday() - 1, now + 60, owner)
  const seenEpisodes = new Set(
    episodes.map((e) => `${e.anilistId}-${e.episode}-${e.airingAt}`)
  )
  for (const episode of airedToday) {
    const key = `${episode.anilistId}-${episode.episode}-${episode.airingAt}`
    if (seenEpisodes.has(key)) continue
    seenEpisodes.add(key)
    airingIds.add(episode.anilistId)
    episodes.push(episode)
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
        }
      }
    }`)

    const candidates = (data.Page?.media ?? []).filter((media) => !owner.has(media.id))

    /*
     * The same day window as the tracked list, for the same reason: an episode of
     * a new show that aired this morning should not vanish from the calendar the
     * moment it starts. Only the earliest episode per show is kept, which is what
     * this panel has always shown.
     */
    const window = await fetchAiringWindow(
      candidates.map((media) => media.id),
      startOfToday() - 1,
      horizon,
      owner
    )

    const earliest = new Map<number, AiringEpisode>()
    for (const episode of window) {
      const current = earliest.get(episode.anilistId)
      if (!current || episode.airingAt < current.airingAt) {
        earliest.set(episode.anilistId, episode)
      }
    }

    // A show with nothing inside the window is not useful here.
    for (const media of candidates) {
      const episode = earliest.get(media.id)
      if (episode) discovery.push({ ...episode, inLibrary: false, libraryStatus: null })
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
      airingEntries: airingIds.size,
      upcomingSeasons: sortedSeasons.length,
      skipped
    }
  }
}
