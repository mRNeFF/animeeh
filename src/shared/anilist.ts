/**
 * Contract shared between the Electron main process (which owns the network
 * access) and the renderer (which owns the UI).
 *
 * Types only — no runtime code, so both builds can import it safely.
 */

/** One season of a franchise. */
export interface AnimeSeasonRef {
  /** 1-based position in the franchise chain. */
  season: number
  anilistId: number
  /** MyAnimeList id (AniList links to it) — null when AniList has none. */
  malId: number | null
  title: string
  year: number | null
  format: string | null
  /** Episode count for this season, or null when AniList does not know. */
  episodes: number | null
}

/**
 * A single entry in the search list. Sequels of the same franchise are merged
 * into one result, so `seasons` holds every season gathered under it.
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
  studio: string | null
  coverImage: string | null
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

export type AniListOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }
