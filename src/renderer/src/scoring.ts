import {
  CRITERIA,
  DEFAULT_SETTINGS,
  DEFAULT_WEIGHTS,
  EPISODE_AVG_KEY,
  STORE_VERSION,
  emptyCriteria,
  type Anime,
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
  const scored = anime.episodes.filter((e) => Number.isFinite(e.score))
  if (scored.length === 0) return null
  const total = scored.reduce((sum, e) => sum + e.score, 0)
  return total / scored.length
}

export function episodeCount(anime: Anime): number {
  return anime.episodes.length
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
          score: Number.isFinite(e.score) ? Math.max(0, Math.min(100, Number(e.score))) : 0
        }))
    : []

  const now = new Date().toISOString()
  return {
    id: input.id ?? crypto.randomUUID(),
    title: input.title ?? 'Untitled',
    englishTitle: input.englishTitle,
    year: Number.isFinite(input.year) ? Number(input.year) : undefined,
    studio: input.studio,
    status: input.status ?? 'completed',
    episodes,
    criteria,
    notes: input.notes,
    favorite: !!input.favorite,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  }
}

export function normaliseStore(input: unknown): StoreData {
  const raw = (input ?? {}) as Partial<StoreData>
  const settings: Settings = {
    weights: normaliseWeights(raw.settings?.weights ?? DEFAULT_SETTINGS.weights)
  }
  return {
    version: STORE_VERSION,
    anime: Array.isArray(raw.anime) ? raw.anime.map(normaliseAnime) : [],
    settings
  }
}
