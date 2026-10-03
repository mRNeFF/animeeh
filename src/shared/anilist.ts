/**
 * Contract shared between the Electron main process (which owns the network
 * access) and the renderer (which owns the UI).
 *
 * Types only — no runtime code, so both builds can import it safely.
 */

/** One episode title as returned by AniList's streamingEpisodes. */
export interface AniListEpisode {
  number: number
  title: string
}

/** A single search hit, normalised for the UI. */
export interface AnimeSearchResult {
  anilistId: number
  /** MyAnimeList id (AniList links to it) — null when AniList has none. */
  malId: number | null
  /** Romaji title, used as the primary one. */
  title: string
  englishTitle: string | null
  format: string | null
  year: number | null
  /** Total episodes, or null when AniList does not know yet. */
  episodes: number | null
  studio: string | null
  coverImage: string | null
  siteUrl: string
}

/** Search hit plus the per-episode titles, fetched on selection. */
export interface AnimeDetails extends AnimeSearchResult {
  episodeTitles: AniListEpisode[]
}

export type AniListOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }
