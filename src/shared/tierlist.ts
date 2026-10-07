/**
 * Contract for the tier list sources, shared between the main process (which owns
 * the network) and the renderer (which owns the UI).
 *
 * Types only — no runtime code, so both builds can import it safely.
 *
 * Two sources are needed, and they are different in kind:
 *
 *   - **characters** come from AniList, which the app already talks to, batched
 *     twenty ids to a request like everything else.
 *   - **openings and endings** come from AnimeThemes, because AniList has no theme
 *     field at all. AnimeThemes is keyed on its own ids, so a library entry is
 *     matched by looking for an AniList link in the candidate's resources. That
 *     check is what keeps a remake or a season from being paired with the wrong
 *     themes, which is the class of bug already hit with Dragon Ball and Naruto.
 */

import type { Failure } from './errors'

/** One character, as the tier list picker needs it. */
export interface TierCharacter {
  anilistId: number
  name: string
  image: string | null
  /** `MAIN`, `SUPPORTING` or `BACKGROUND`, as AniList reports it. */
  role: string
  favourites: number
  /** Title of the anime the character belongs to, for the second line. */
  animeTitle: string | null
}

/**
 * One anime, from the whole catalogue rather than from the library.
 *
 * A tier list is often about shows the user has not rated, so the search reaches
 * the full catalogue. `inLibrary` is carried so a result can say whether it is
 * already tracked, which is the only thing the library is needed for here.
 */
export interface TierAnime {
  anilistId: number
  title: string
  englishTitle: string | null
  image: string | null
  format: string | null
  year: number | null
  episodes: number | null
  genres: string[]
  inLibrary: boolean
  /** The library entry's id, when there is one, so a tile can link back. */
  libraryId: string | null
}

/** Everything a single search returns, in one request. */
export interface TierSearchResult {
  anime: TierAnime[]
  characters: TierCharacter[]
}

/** One opening or ending. */
export interface TierTheme {
  /** `OP` or `ED`. */
  type: string
  /**
   * The catalogue's own slug, such as `OP1`, `ED2` or `ED1-TV`.
   *
   * This is the reliable label. AnimeThemes leaves its numeric `sequence` field
   * null for many entries while always filling the slug, so reading the number
   * from `sequence` produced labels with no number at all — and, worse, made two
   * distinct openings of the same show compare equal.
   */
  slug: string
  /** AniList id of the entry this theme belongs to. */
  anilistId: number
  title: string
  artists: string[]
  /**
   * The hosted video of the theme, when the catalogue has one.
   *
   * Deliberately NOT used as a tile image: AnimeThemes serves WebM files and no
   * poster frame, so an `<img>` pointing at this renders nothing. The tile uses
   * the anime's cover instead, which is what the interface can actually show.
   */
  videoUrl: string | null
}

/** What the renderer asks for: an AniList id and a title to search with. */
export interface ThemeLookupEntry {
  anilistId: number
  /** Used for the AnimeThemes search; the id is what the match is verified on. */
  title: string
}

export interface TierThemesResult {
  themes: TierTheme[]
  /** Entries whose themes could not be found or matched. */
  unmatched: number
}

export type TierSearchOutcome = { ok: true; data: TierSearchResult } | Failure
export type TierThemesOutcome = { ok: true; data: TierThemesResult } | Failure
