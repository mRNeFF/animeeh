import {
  CRITERIA,
  DEFAULT_SETTINGS,
  DEFAULT_WEIGHTS,
  EPISODE_AVG_KEY,
  STORE_VERSION,
  emptyCriteria,
  type Anime,
  type AnimeSource,
  type CriterionKey,
  type CriterionScores,
  type ComponentKey,
  type Episode,
  type Settings,
  type StoreData,
  type Weights
} from './types'

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
  titles: { number: number; title?: string }[] = []
): Episode[] {
  const byNumber = new Map(titles.map((t) => [t.number, t.title]))
  const safe = Math.max(0, Math.min(1000, Math.floor(count)))

  return Array.from({ length: safe }, (_, index) => {
    const number = index + 1
    return {
      id: crypto.randomUUID(),
      number,
      title: byNumber.get(number) || undefined,
      score: null
    }
  })
}

/** Append unrated episodes continuing from the highest existing number. */
export function appendEpisodes(
  existing: Episode[],
  count: number,
  titles: { number: number; title?: string }[] = []
): Episode[] {
  const start = existing.reduce((max, e) => Math.max(max, e.number), 0)
  const byNumber = new Map(titles.map((t) => [t.number, t.title]))
  const safe = Math.max(0, Math.min(1000, Math.floor(count)))

  const added: Episode[] = Array.from({ length: safe }, (_, index) => {
    const number = start + index + 1
    return {
      id: crypto.randomUUID(),
      number,
      title: byNumber.get(number) || undefined,
      score: null
    }
  })

  return [...existing, ...added]
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
  const criteriaParts: ScorePart[] = CRITERIA.map((c) => ({
    key: c.key,
    label: c.label,
    short: c.short,
    hue: c.hue,
    value: criterionValue(anime, c.key),
    weight: weights[c.key] ?? 1
  }))

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

export function grade(score: number | null): Grade {
  if (score === null) return { letter: '—', hue: 0 }
  if (score >= 90) return { letter: 'S', hue: 320 }
  if (score >= 80) return { letter: 'A', hue: 268 }
  if (score >= 70) return { letter: 'B', hue: 212 }
  if (score >= 60) return { letter: 'C', hue: 158 }
  if (score >= 50) return { letter: 'D', hue: 46 }
  return { letter: 'E', hue: 8 }
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
          // Unrated episodes stay unrated — they must not drag the average down.
          score:
            typeof e.score === 'number' && Number.isFinite(e.score)
              ? Math.max(0, Math.min(100, e.score))
              : null
        }))
    : []

  const source: AnimeSource | undefined =
    input.source && typeof input.source.anilistId === 'number'
      ? {
          provider: 'anilist',
          anilistId: input.source.anilistId,
          malId: typeof input.source.malId === 'number' ? input.source.malId : null,
          siteUrl: input.source.siteUrl ?? `https://anilist.co/anime/${input.source.anilistId}`
        }
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
        : DEFAULT_SETTINGS.checkForUpdatesOnStartup
  }
  return {
    version: STORE_VERSION,
    anime: Array.isArray(raw.anime) ? raw.anime.map(normaliseAnime) : [],
    settings
  }
}
