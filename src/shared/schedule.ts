/**
 * Release calendar contract, shared between main and renderer.
 *
 * The calendar is a *cache*, not stored data: everything in it can be rebuilt
 * from AniList, so it lives in its own file and never touches the user's list.
 *
 * Types only — no runtime code.
 */
import type { ServiceName } from './errors'

/** One upcoming episode of a show. */
export interface AiringEpisode {
  anilistId: number
  title: string
  coverImage: string | null
  /** Episode number within its season. */
  episode: number
  /** Unix seconds. */
  airingAt: number
  /** The season number this episode belongs to, when it is a later season. */
  seasonNumber: number | null
  /** True when this show is in the user's library. */
  inLibrary: boolean
  /** The user's own status for it, when `inLibrary`. */
  libraryStatus: string | null
}

/** A season the user does not have yet, that follows something they do have. */
export interface UpcomingSeason {
  /** The show in the user's library this follows. */
  fromAnilistId: number
  fromTitle: string
  seasonId: number
  title: string
  /** AniList status: NOT_YET_RELEASED or RELEASING. */
  status: string
  /**
   * How precise the start date is. AniList often knows only the season, so the
   * UI must not imply a day it does not have.
   */
  precision: 'day' | 'month' | 'year' | 'none'
  /** YYYY-MM-DD, YYYY-MM, YYYY, or null. */
  startDate: string | null
  /** Airing season label, e.g. FALL 2026, when AniList gives one. */
  seasonLabel: string | null
  /** Unix seconds of the first episode, when it is close enough to know. */
  firstEpisodeAt: number | null
  format: string | null
}

/** Summary of what a refresh found, so an empty calendar can be explained. */
export interface ScheduleCounts {
  /** Library entries that carry an AniList id. */
  libraryEntries: number
  /** Entries currently airing, which is where episodes come from. */
  airingEntries: number
  /** Entries with an announced continuation. */
  upcomingSeasons: number
  /** Entries AniList could not be asked about. */
  skipped: number
}

export interface ScheduleResult {
  /** ISO timestamp of when this was fetched. */
  fetchedAt: string
  /** How many days ahead the episode window covers. */
  windowDays: number
  /** Upcoming episodes of shows the user has. */
  episodes: AiringEpisode[]
  /** Continuations of shows the user has, not yet in the library. */
  seasons: UpcomingSeason[]
  /** Newly starting shows, not in the library. Discovered, not tracked. */
  discovery: AiringEpisode[]
  counts: ScheduleCounts
}

export type ScheduleOutcome =
  | { ok: true; data: ScheduleResult }
  | {
      ok: false
      error: string
      code?: string
      detail?: string
      service?: ServiceName
    }

/** How long a fetched schedule is considered fresh. */
export const SCHEDULE_TTL_MS = 6 * 60 * 60 * 1000
