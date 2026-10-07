import {
  applicableCriteria,
  CRITERIA,
  isMovie,
  DEFAULT_SETTINGS,
  DEFAULT_WEIGHTS,
  EPISODE_AVG_KEY,
  STORE_VERSION,
  emptyCriteria,
  newId,
  type Anime,
  type AnimeSeason,
  type AnimeSource,
  type CriterionKey,
  type CriterionScores,
  type ComponentKey,
  type Episode,
  type Settings,
  type StoreData,
  type TierItem,
  type TierList,
  type TierRow,
  type TierSourceKind,
  type Weights
} from './types'
import { tierHue, tierOf, type Tier } from './palette'

/* ------------------------------------------------------------------ */
/* Episode helpers                                                     */
/* ------------------------------------------------------------------ */

export function episodeAverage(anime: Anime): number | null {
  const scored = anime.episodes.filter(
    (e) => e.score !== null && Number.isFinite(e.score as number)
  )
  if (scored.length === 0) return null
  const total = scored.reduce((sum, e) => sum + (e.score as number), 0)
  return total / scored.length
}

/** How many episodes actually carry a rating. */
export function scoredEpisodeCount(anime: Anime): number {
  return anime.episodes.filter((e) => e.score !== null && Number.isFinite(e.score)).length
}

export function episodeCount(anime: Anime): number {
  return anime.episodes.length
}

/** Next episode number to hand out (max + 1). */
export function nextEpisodeNumber(anime: Anime): number {
  return anime.episodes.reduce((max, e) => Math.max(max, e.number), 0) + 1
}

/**
 * Create `count` unrated episodes numbered from 1, optionally attaching titles
 * supplied by the reference source (AniList) by episode number.
 */
export function buildEpisodes(
  count: number,
  titles: { number: number; title?: string; season?: number }[] = []
): Episode[] {
  const byNumber = new Map(titles.map((t) => [t.number, t]))
  const safe = Math.max(0, Math.min(2000, Math.floor(count)))

  return Array.from({ length: safe }, (_, index) => {
    const number = index + 1
    const source = byNumber.get(number)
    return {
      id: crypto.randomUUID(),
      number,
      title: source?.title || undefined,
      season: source?.season,
      score: null
    }
  })
}

/** Append unrated episodes continuing from the highest existing number. */
export function appendEpisodes(
  existing: Episode[],
  count: number,
  titles: { number: number; title?: string; season?: number }[] = []
): Episode[] {
  const start = existing.reduce((max, e) => Math.max(max, e.number), 0)
  const byNumber = new Map(titles.map((t) => [t.number, t]))
  const safe = Math.max(0, Math.min(2000, Math.floor(count)))

  const added: Episode[] = Array.from({ length: safe }, (_, index) => {
    const number = start + index + 1
    const source = byNumber.get(number)
    return {
      id: crypto.randomUUID(),
      number,
      title: source?.title || undefined,
      season: source?.season,
      score: null
    }
  })

  return [...existing, ...added]
}

/**
 * Fill in the season of every episode from the season episode counts.
 *
 * Episode titles are not a reliable source for this: AniList only returns them
 * for some seasons (Attack on Titan's Season 1 only), so an episode count based
 * on titles would leave later seasons unlabelled.
 */
export function applySeasonSpans(episodes: Episode[], seasons?: AnimeSeason[]): Episode[] {
  if (!seasons || seasons.length < 2) return episodes

  // Episode number at which each season starts, ignoring seasons whose length
  // AniList does not know.
  const spans: { season: number; from: number; to: number }[] = []
  let cursor = 1
  for (const s of [...seasons].sort((a, b) => a.season - b.season)) {
    const count = s.episodes ?? 0
    if (count <= 0) continue
    spans.push({ season: s.season, from: cursor, to: cursor + count - 1 })
    cursor += count
  }
  if (spans.length < 2) return episodes

  return episodes.map((episode) => {
    const span = spans.find((s) => episode.number >= s.from && episode.number <= s.to)
    return span ? { ...episode, season: span.season } : episode
  })
}

/**
 * Episode numbers between 1 and the announced total that are not listed yet.
 * Returns [] when the total is unknown.
 */
export function missingEpisodeNumbers(
  existing: Episode[],
  totalEpisodes?: number
): number[] {
  if (!totalEpisodes || totalEpisodes <= 0) return []
  const have = new Set(existing.map((e) => e.number))

  const missing: number[] = []
  for (let n = 1; n <= Math.min(totalEpisodes, 1000); n += 1) {
    if (!have.has(n)) missing.push(n)
  }
  return missing
}

export function sortEpisodes(episodes: Episode[]): Episode[] {
  return [...episodes].sort((a, b) => a.number - b.number)
}

/* ------------------------------------------------------------------ */
/* Global score                                                        */
/* ------------------------------------------------------------------ */

export function criterionValue(anime: Anime, key: CriterionKey): number | null {
  const value = anime.criteria?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function componentValue(anime: Anime, key: ComponentKey): number | null {
  return key === EPISODE_AVG_KEY ? episodeAverage(anime) : criterionValue(anime, key)
}

export interface ScorePart {
  key: ComponentKey
  label: string
  short: string
  hue: number
  /** 0–100, or null when unrated */
  value: number | null
  weight: number
}

export function scoreParts(anime: Anime, weights: Weights): ScorePart[] {
  // A film has no opening, so that component is left out entirely: not rated,
  // not weighted, and not shown in the breakdown.
  const criteriaParts: ScorePart[] = applicableCriteria(anime).map((c) => ({
    key: c.key,
    label: c.label,
    short: c.short,
    hue: c.hue,
    value: criterionValue(anime, c.key),
    weight: weights[c.key] ?? 1
  }))

  // A film has no episodes either, so the episode average never applies.
  // A film has no episodes either, so the episode average never applies.
  // An OVA does have episodes and keeps it.
  if (isMovie(anime)) return criteriaParts

  return [
    ...criteriaParts,
    {
      key: EPISODE_AVG_KEY,
      label: 'Episode average',
      short: 'EPS',
      hue: 292,
      value: episodeAverage(anime),
      weight: weights[EPISODE_AVG_KEY] ?? 1
    }
  ]
}

/**
 * Weighted mean of every *rated* component. Unrated components and zero-weight
 * components are excluded so a half-filled entry still gets a fair score.
 */
export function globalScore(anime: Anime, weights: Weights = DEFAULT_WEIGHTS): number | null {
  const parts = scoreParts(anime, weights)
  let weightedSum = 0
  let weightTotal = 0
  for (const part of parts) {
    if (part.value === null) continue
    if (part.weight <= 0) continue
    weightedSum += part.value * part.weight
    weightTotal += part.weight
  }
  if (weightTotal === 0) return null
  return weightedSum / weightTotal
}

/* ------------------------------------------------------------------ */
/* Rankings                                                            */
/* ------------------------------------------------------------------ */

export interface RankedAnime {
  anime: Anime
  score: number | null
  episodeAvg: number | null
  rank: number
}

/** Sort by global score descending; entries sharing a score share a rank. */
export function rankAnime(list: Anime[], weights: Weights = DEFAULT_WEIGHTS): RankedAnime[] {
  const scored = list
    .map((anime) => ({
      anime,
      score: globalScore(anime, weights),
      episodeAvg: episodeAverage(anime)
    }))
    .sort((a, b) => {
      if (a.score === null && b.score === null) return a.anime.title.localeCompare(b.anime.title)
      if (a.score === null) return 1
      if (b.score === null) return -1
      if (b.score !== a.score) return b.score - a.score
      return a.anime.title.localeCompare(b.anime.title)
    })

  let lastScore: number | null = null
  let lastRank = 0
  return scored.map((entry, index) => {
    let rank: number
    if (entry.score === null) {
      rank = 0
    } else if (lastScore !== null && entry.score === lastScore) {
      rank = lastRank
    } else {
      rank = index + 1
      lastRank = rank
      lastScore = entry.score
    }
    return { ...entry, rank }
  })
}

/** Rank for a single criterion (used by the per-criteria view). */
export function rankByCriterion(
  list: Anime[],
  key: ComponentKey,
  weights: Weights = DEFAULT_WEIGHTS
): { anime: Anime; value: number | null; rank: number }[] {
  const scored = list
    .map((anime) => ({ anime, value: componentValue(anime, key) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.anime.title.localeCompare(b.anime.title)
      if (a.value === null) return 1
      if (b.value === null) return -1
      if (b.value !== a.value) return b.value - a.value
      return a.anime.title.localeCompare(b.anime.title)
    })

  void weights
  let lastValue: number | null = null
  let lastRank = 0
  return scored.map((entry, index) => {
    let rank: number
    if (entry.value === null) {
      rank = 0
    } else if (lastValue !== null && entry.value === lastValue) {
      rank = lastRank
    } else {
      rank = index + 1
      lastRank = rank
      lastValue = entry.value
    }
    return { ...entry, rank }
  })
}

/* ------------------------------------------------------------------ */
/* Grades                                                              */
/* ------------------------------------------------------------------ */

export interface Grade {
  letter: string
  hue: number
}

/**
 * Letter grades.
 *
 * S 90-100 · A 75-89.9 · B 65-74.9 · C 50-64.9 · D 30-49.9 · E 10-29.9 · F 0-9.9
 *
 * The hue is the middle of the tier's slice in the palette, so that everything
 * drawing a flat colour from a grade — a bar, a dot, a gauge — follows the same
 * palette the badges do. See palette.ts for the slices themselves.
 */
export function grade(score: number | null): Grade {
  if (score === null) return { letter: '—', hue: 0 }
  if (score >= 90) return { letter: 'S', hue: tierHue(tierOf('S') as Tier) }
  if (score >= 75) return { letter: 'A', hue: tierHue(tierOf('A') as Tier) }
  if (score >= 65) return { letter: 'B', hue: tierHue(tierOf('B') as Tier) }
  if (score >= 50) return { letter: 'C', hue: tierHue(tierOf('C') as Tier) }
  if (score >= 30) return { letter: 'D', hue: tierHue(tierOf('D') as Tier) }
  if (score >= 10) return { letter: 'E', hue: tierHue(tierOf('E') as Tier) }
  return { letter: 'F', hue: tierHue(tierOf('F') as Tier) }
}

/* ------------------------------------------------------------------ */
/* Migration / normalisation                                           */
/* ------------------------------------------------------------------ */

function normaliseWeight(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

export function normaliseWeights(input: unknown): Weights {
  const raw = (input ?? {}) as Partial<Record<ComponentKey, unknown>>
  const weights = { ...DEFAULT_WEIGHTS }
  for (const key of Object.keys(DEFAULT_WEIGHTS) as ComponentKey[]) {
    weights[key] = normaliseWeight(raw[key], DEFAULT_WEIGHTS[key])
  }
  return weights
}

export function normaliseAnime(input: Partial<Anime>): Anime {
  const criteria: CriterionScores = emptyCriteria()
  for (const c of CRITERIA) {
    const value = input.criteria?.[c.key]
    criteria[c.key] =
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(100, value))
        : null
  }

  const episodes: Episode[] = Array.isArray(input.episodes)
    ? input.episodes
        .filter((e): e is Episode => !!e && typeof e === 'object')
        .map((e, index) => ({
          id: e.id ?? crypto.randomUUID(),
          number: Number.isFinite(e.number) ? Number(e.number) : index + 1,
          title: e.title,
          season:
            typeof e.season === 'number' && Number.isFinite(e.season) && e.season > 0
              ? Math.floor(e.season)
              : undefined,
          // Unrated episodes stay unrated — they must not drag the average down.
          score:
            typeof e.score === 'number' && Number.isFinite(e.score)
              ? Math.max(0, Math.min(100, e.score))
              : null
        }))
    : []

  const seasons: AnimeSeason[] | undefined = Array.isArray(input.seasons)
    ? input.seasons
        .filter((s): s is AnimeSeason => !!s && typeof s.anilistId === 'number')
        .map((s, index) => ({
          season: Number.isFinite(s.season) ? Number(s.season) : index + 1,
          anilistId: s.anilistId,
          malId: typeof s.malId === 'number' ? s.malId : null,
          title: s.title ?? `Season ${index + 1}`,
          year: Number.isFinite(s.year) ? Number(s.year) : undefined,
          episodes: Number.isFinite(s.episodes) ? Number(s.episodes) : undefined,
          runtimeMinutes: Number.isFinite(s.runtimeMinutes) ? Number(s.runtimeMinutes) : undefined,
          parts: Array.isArray(s.parts)
            ? s.parts
                .filter((p) => !!p && typeof p.anilistId === 'number')
                .map((p) => ({
                  anilistId: p.anilistId,
                  title: p.title ?? 'Part',
                  year: Number.isFinite(p.year) ? Number(p.year) : undefined,
                  episodes: Number.isFinite(p.episodes) ? Number(p.episodes) : undefined
                }))
            : undefined
        }))
    : undefined

  const source: AnimeSource | undefined =
    input.source && typeof input.source.anilistId === 'number'
      ? {
          provider: 'anilist',
          anilistId: input.source.anilistId,
          malId: typeof input.source.malId === 'number' ? input.source.malId : null,
          siteUrl: input.source.siteUrl ?? `https://anilist.co/anime/${input.source.anilistId}`
        }
      : undefined

  const genres = Array.isArray(input.genres)
    ? [...new Set(input.genres.filter((g): g is string => typeof g === 'string' && g.trim() !== ''))]
    : undefined

  const now = new Date().toISOString()
  return {
    id: input.id ?? crypto.randomUUID(),
    title: input.title ?? 'Untitled',
    englishTitle: input.englishTitle,
    year: Number.isFinite(input.year) ? Number(input.year) : undefined,
    studio: input.studio,
    status: input.status ?? 'completed',
    episodes,
    totalEpisodes: Number.isFinite(input.totalEpisodes)
      ? Number(input.totalEpisodes)
      : undefined,
    criteria,
    notes: input.notes,
    favorite: !!input.favorite,
    source,
    format: typeof input.format === 'string' && input.format ? input.format : undefined,
    seasons,
    coverImage: typeof input.coverImage === 'string' && input.coverImage ? input.coverImage : undefined,
    runtimeMinutes: Number.isFinite(input.runtimeMinutes) ? Number(input.runtimeMinutes) : undefined,
    genres: genres && genres.length > 0 ? genres : undefined,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  }
}

export function normaliseStore(input: unknown): StoreData {
  const raw = (input ?? {}) as Partial<StoreData>
  const rawSettings = raw.settings as Partial<Settings> | undefined
  const settings: Settings = {
    weights: normaliseWeights(rawSettings?.weights ?? DEFAULT_SETTINGS.weights),
    checkForUpdatesOnStartup:
      typeof rawSettings?.checkForUpdatesOnStartup === 'boolean'
        ? rawSettings.checkForUpdatesOnStartup
        : DEFAULT_SETTINGS.checkForUpdatesOnStartup,
    language:
      rawSettings?.language === 'fr' || rawSettings?.language === 'en'
        ? rawSettings.language
        : DEFAULT_SETTINGS.language
  }
  return {
    version: STORE_VERSION,
    anime: Array.isArray(raw.anime) ? raw.anime.map(normaliseAnime) : [],
    // A file written before the tab existed has no key here, hence the default.
    // Entries that are not objects are dropped rather than turned into empty
    // lists, so a damaged file cannot invent blank tier lists.
    tierLists: Array.isArray(raw.tierLists)
      ? (raw.tierLists as unknown[])
          .filter((entry) => !!entry && typeof entry === 'object')
          .map(normaliseTierList)
      : [],
    settings
  }
}

/** Reads one tier list back, dropping anything malformed rather than throwing. */
export function normaliseTierList(input: unknown): TierList {
  const raw = (input ?? {}) as Partial<TierList> & { kind?: unknown }
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newId()

  const rows: TierRow[] = Array.isArray(raw.rows)
    ? raw.rows
        .filter((r): r is TierRow => !!r && typeof r === 'object')
        .map((r) => {
          const row = r as TierRow & Record<string, unknown>
          return {
            id: typeof row.id === 'string' && row.id ? row.id : newId(),
            label: typeof row.label === 'string' && row.label ? row.label : '?',
            letter: typeof row.letter === 'string' && row.letter ? row.letter : '?',
            // The styling overrides have to be carried through too, or a colour
            // chosen in the options panel would be lost on the next reload.
            color: typeof row.color === 'string' && row.color !== '' ? row.color : undefined,
            textColor:
              typeof row.textColor === 'string' && row.textColor !== '' ? row.textColor : undefined,
            font: typeof row.font === 'string' && row.font !== '' ? row.font : undefined,
            fontSize:
              typeof row.fontSize === 'number' && Number.isFinite(row.fontSize) && row.fontSize > 0
                ? Math.min(64, Math.round(row.fontSize))
                : undefined
          }
        })
    : []

  // A row that no longer exists would leave an item unreachable, so anything
  // pointing at a missing row falls back to the pool.
  const rowIds = new Set(rows.map((r) => r.id))
  const items: TierItem[] = Array.isArray(raw.items)
    ? raw.items
        .filter((i): i is TierItem => !!i && typeof i === 'object')
        .map((i) => {
          const item = i as TierItem & { kind?: unknown }
          return {
            id: typeof item.id === 'string' && item.id ? item.id : newId(),
            label: typeof item.label === 'string' ? item.label : '',
            sublabel: typeof item.sublabel === 'string' ? item.sublabel : '',
            image: typeof item.image === 'string' ? item.image : undefined,
            rowId: typeof item.rowId === 'string' && rowIds.has(item.rowId) ? item.rowId : null,
            // A list saved before the kinds were mixed carries `op` or `ed` per
            // item; both mean a theme now. Anything unrecognised is dropped.
            kind: normaliseItemKind(item.kind),
            animeId: typeof item.animeId === 'string' ? item.animeId : undefined,
            anilistId: typeof item.anilistId === 'number' ? item.anilistId : undefined
          }
        })
    : []

  const now = new Date().toISOString()
  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Tier list',
    rows: rows.length > 0 ? rows : [],
    items,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  }
}

/** Reads an element's kind, folding the older `op`/`ed` values into `theme`. */
function normaliseItemKind(value: unknown): TierSourceKind | undefined {
  if (value === 'anime' || value === 'season' || value === 'character' || value === 'ost') {
    return value
  }
  if (value === 'op' || value === 'ed' || value === 'theme') return 'theme'
  return undefined
}


