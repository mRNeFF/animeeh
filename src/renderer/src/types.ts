/* ------------------------------------------------------------------ */
/* Ranking criteria                                                     */
/* ------------------------------------------------------------------ */

export const CRITERIA = [
  { key: 'characters', label: 'Characters', short: 'CHA', hue: 268 },
  { key: 'story', label: 'Story', short: 'STO', hue: 212 },
  { key: 'animation', label: 'Animation', short: 'ANI', hue: 158 },
  { key: 'ost', label: 'OST', short: 'OST', hue: 46 },
  { key: 'opening', label: 'Opening', short: 'OP', hue: 330 },
  { key: 'keyFactor', label: 'Key Factor', short: 'KEY', hue: 8 },
  { key: 'originality', label: 'Originality', short: 'ORI', hue: 190 }
] as const

export type CriterionKey = (typeof CRITERIA)[number]['key']

/** The episode average acts as an additional, derived ranking component. */
export const EPISODE_AVG_KEY = 'episodeAverage' as const

export type ComponentKey = CriterionKey | typeof EPISODE_AVG_KEY

export type Weights = Record<ComponentKey, number>

export const EPISODE_AVG_CRITERION = {
  key: EPISODE_AVG_KEY,
  label: 'Episode average',
  short: 'EPS',
  hue: 292
} as const

/** All global-score components, in display order. */
export const COMPONENTS = [...CRITERIA, EPISODE_AVG_CRITERION] as const

export const COMPONENT_LABELS: Record<ComponentKey, string> = COMPONENTS.reduce(
  (acc, c) => ({ ...acc, [c.key]: c.label }),
  {} as Record<ComponentKey, string>
)

/* ------------------------------------------------------------------ */
/* Watch status                                                        */
/* ------------------------------------------------------------------ */

export const STATUSES = [
  { key: 'completed', label: 'Completed' },
  { key: 'watching', label: 'Watching' },
  { key: 'planned', label: 'Plan to watch' },
  { key: 'on_hold', label: 'On hold' },
  { key: 'dropped', label: 'Dropped' }
] as const

export type Status = (typeof STATUSES)[number]['key']

export const STATUS_LABELS: Record<Status, string> = STATUSES.reduce(
  (acc, s) => ({ ...acc, [s.key]: s.label }),
  {} as Record<Status, string>
)

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

export interface Episode {
  id: string
  /** Episode number as the user counts it, continuing across seasons. */
  number: number
  title?: string
  /** 0–100, or `null` when the episode has not been rated yet. */
  score: number | null
  /** 1-based season, set when the entry groups several seasons. */
  season?: number
}

/** One broadcast part (cour) inside a season. */
export interface AnimeSeasonPart {
  anilistId: number
  title: string
  year?: number
  episodes?: number
}

/** One season of a grouped franchise, kept for reference. */
export interface AnimeSeason {
  season: number
  anilistId: number
  malId: number | null
  title: string
  year?: number
  /** Episode count for the whole season, summed across its parts. */
  episodes?: number
  /** AniList minutes per episode for this season. */
  runtimeMinutes?: number
  /**
   * Broadcast parts merged into this season. A season split into cours
   * ("2nd Season" + "2nd Season Part 2") has two; most have one.
   */
  parts?: AnimeSeasonPart[]
}

/** Where an entry's reference data came from. */
export interface AnimeSource {
  provider: 'anilist'
  anilistId: number
  /** MyAnimeList id, when AniList links one. */
  malId: number | null
  siteUrl: string
}

/** Every criterion is optional: `null` means "not rated yet". */
export type CriterionScores = Record<CriterionKey, number | null>

export interface Anime {
  id: string
  title: string
  englishTitle?: string
  year?: number
  studio?: string
  status: Status
  episodes: Episode[]
  /** Total episode count announced by the source, used to track progress. */
  totalEpisodes?: number
  criteria: CriterionScores
  notes?: string
  favorite?: boolean
  source?: AnimeSource
  /**
   * AniList format of the entry: TV, TV_SHORT, ONA, OVA, MOVIE, SPECIAL.
   * `MOVIE` is what the Films tab sorts on.
   */
  format?: string
  /**
   * Every season merged into this entry, in broadcast order. Absent for
   * hand-entered anime and for single-season shows.
   */
  seasons?: AnimeSeason[]
  /** Cover art URL from the reference source. */
  coverImage?: string
  /**
   * Minutes from the reference source: per episode for a series, total runtime
   * for a film. Lets the statistics estimate watch time.
   */
  runtimeMinutes?: number
  /** Genres from the reference source, used for filtering and tagging. */
  genres?: string[]
  createdAt: string
  updatedAt: string
}

export interface Settings {
  weights: Weights
  /** Check GitHub for a new release shortly after launch. */
  checkForUpdatesOnStartup: boolean
  /** Interface language. */
  language: Language
}

export type Language = 'en' | 'fr'

export interface StoreData {
  version: number
  anime: Anime[]
  /** The user's own tier lists. Absent from files written before the tab existed. */
  tierLists: TierList[]
  settings: Settings
}

/* ------------------------------------------------------------------ */
/* Tier lists                                                          */
/* ------------------------------------------------------------------ */

/** What a tier list is made of — here only to label a filter, never to restrict. */
export type TierSourceKind = 'anime' | 'season' | 'character' | 'theme' | 'ost'

/** A mixed tier list holds whatever the user wants, from any source. */
export const TIER_LIST_KINDS: readonly TierSourceKind[] = [
  'anime',
  'season',
  'character',
  'theme',
  'ost'
]

/** One row of a tier list: the S/A/B label and everything dropped into it. */
export interface TierRow {
  id: string
  /** Shown in the row's label. Renamable, so it is free text. */
  label: string
  /** Which grade tier the row takes its colour from. */
  letter: string
}

/**
 * One element of a tier list.
 *
 * `animeId` is kept whenever the element comes from the library, so the list can
 * be rebuilt or repaired after the entry is re-added, and so a missing entry can
 * be shown as missing rather than silently vanishing.
 */
export interface TierItem {
  id: string
  label: string
  sublabel: string
  /** Cover, portrait or theme thumbnail, depending on the source. */
  image?: string
  /** The row it sits in, or null while it is still in the pool. */
  rowId: string | null
  /** What it is, shown as a small badge on the tile. */
  kind?: TierSourceKind
  /** Which library entry it came from, when it did. */
  animeId?: string
  /** AniList id, for a character, an anime or a theme's show. */
  anilistId?: number
}

export interface TierList {
  id: string
  name: string
  /**
   * Deliberately absent: a list is not restricted to one kind of element.
   *
   * An earlier version asked which kind a list was before creating it, which made
   * a mixed ranking impossible and put a decision in front of the user before
   * they had anything to decide with. The filters in the picker do the narrowing
   * instead, per search rather than once and for all.
   */
  rows: TierRow[]
  items: TierItem[]
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

export const DEFAULT_WEIGHTS: Weights = {
  characters: 1,
  story: 1,
  animation: 1,
  ost: 1,
  opening: 1,
  keyFactor: 1,
  originality: 1,
  episodeAverage: 1
}

export const DEFAULT_SETTINGS: Settings = {
  weights: { ...DEFAULT_WEIGHTS },
  checkForUpdatesOnStartup: true,
  language: 'en'
}

export const STORE_VERSION = 1

/**
 * A stable unique id.
 *
 * Used for tier lists, their rows and their elements. `crypto.randomUUID` is
 * available in both the Electron renderer and Node, with a fallback so a test
 * environment without it still works.
 */
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`
}

export function emptyCriteria(): CriterionScores {
  return CRITERIA.reduce(    (acc, c) => ({ ...acc, [c.key]: null }),
    {} as CriterionScores
  )
}

/** AniList format of a film: one sitting, no episode list, no opening. */
export const MOVIE_FORMAT = 'MOVIE'

/** AniList format of a direct-to-video entry: a short run, sold on its own. */
export const OVA_FORMAT = 'OVA'

/**
 * A film: a single work with no episode list and no opening sequence to rate.
 *
 * Distinct from `isFilmLike` on purpose. An OVA is listed under Films, but it
 * does have episodes and may have an opening, so the criteria and the episode
 * list must treat the two differently.
 */
export function isMovie(anime: { format?: string }): boolean {
  return (anime.format ?? '') === MOVIE_FORMAT
}

/**
 * Entries that are not part of a weekly run, and therefore belong under Films
 * rather than in the series library: films and OVAs.
 */
export function isFilmLike(anime: { format?: string }): boolean {
  const format = anime.format ?? ''
  return format === MOVIE_FORMAT || format === OVA_FORMAT
}

/**
 * Criteria that do not apply to a film.
 *
 * A film has no opening sequence to speak of, so asking for an Opening rating
 * would be asking for a number with no meaning. An OVA keeps it: those usually
 * do have one.
 */
const MOVIE_EXCLUDED: ReadonlySet<CriterionKey> = new Set<CriterionKey>(['opening'])

/** The criteria worth rating for this entry, in display order. */
export function applicableCriteria(
  anime: { format?: string }
): readonly (typeof CRITERIA)[number][] {
  if (!isMovie(anime)) return CRITERIA
  return CRITERIA.filter((c) => !MOVIE_EXCLUDED.has(c.key))
}

/** True when this criterion should be offered for this entry. */
export function criterionApplies(anime: { format?: string }, key: CriterionKey): boolean {
  return applicableCriteria(anime).some((c) => c.key === key)
}



export function createAnime(partial: Partial<Anime> = {}): Anime {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: 'Untitled',
    status: 'completed',
    episodes: [],
    criteria: emptyCriteria(),
    createdAt: now,
    updatedAt: now,
    ...partial
  }
}
