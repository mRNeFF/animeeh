/**
 * Contract shared between the Electron main process (which owns the network
 * access) and the renderer (which owns the UI).
 *
 * Types only — no runtime code, so both builds can import it safely.
 */

/** One broadcast part (cour) inside a season. */
export interface AnimeSeasonPart {
  anilistId: number
  malId: number | null
  title: string
  year: number | null
  episodes: number | null
}

/** One season of a franchise. */
export interface AnimeSeasonRef {
  /** 1-based position in the franchise chain. */
  season: number
  /** AniList id of the season's first part — the season's identity. */
  anilistId: number
  malId: number | null
  title: string
  year: number | null
  format: string | null
  /** Episode count for the whole season, summed across its parts. */
  episodes: number | null
  /**
   * AniList duration in minutes for one episode of this season. Seasons of the
   * same franchise can differ, so the watch time uses each season's own value.
   */
  duration: number | null
  /**
   * Broadcast parts merged into this season. A season split into cours
   * ("2nd Season" + "2nd Season Part 2") has two; most have one.
   */
  parts: AnimeSeasonPart[]
}

/**
 * A single entry in the search list. Sequels of the same franchise are merged
 * into one result, and the parts of a split season are merged into one season.
 */
export interface AnimeSearchResult {
  /** AniList id of the earliest season — the franchise's identity. */
  anilistId: number
  malId: number | null
  /** Title of the earliest season, used as the primary one. */
  title: string
  englishTitle: string | null
  format: string | null
  year: number | null
  /** Sum of the known per-season episode counts; null when none are known. */
  episodes: number | null
  /**
   * AniList duration in minutes: per episode for a series, total runtime for a
   * film. Used to estimate watch time.
   */
  duration: number | null
  studio: string | null
  coverImage: string | null
  /** Genres from the reference source. */
  genres: string[]
  siteUrl: string
  /** Seasons merged into this entry; always at least one. */
  seasons: AnimeSeasonRef[]
}

/** One episode, numbered across the whole franchise. */
export interface AniListEpisode {
  /** 1-based, continuing across seasons (S1E1 = 1, S2E1 = 1 + S1 length). */
  number: number
  /** 1-based season this episode belongs to. */
  season: number
  title: string
}

/** Search hit plus the assembled franchise, fetched on selection. */
export interface AnimeDetails extends AnimeSearchResult {
  episodeTitles: AniListEpisode[]
}

import type { Failure } from './errors'

export type AniListOutcome<T> = { ok: true; data: T } | Failure
