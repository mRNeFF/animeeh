import { applySeasonSpans } from './scoring'
import type { Anime, Episode } from './types'

export interface BulkProgress {
  running: boolean
  done: number
  total: number
  /** Anime that gained at least one episode name. */
  loaded: number
  /** Anime the sources had nothing for. */
  empty: number
  failed: number
  /** Title currently being processed, for display. */
  current: string | null
}

export interface BulkResult {
  loaded: number
  empty: number
  failed: number
  /** Anime left untouched because they already had names. */
  alreadyDone: number
}

export interface BulkOptions {
  onProgress?: (progress: BulkProgress) => void
  /** Return true to stop the run. */
  shouldCancel?: () => boolean
}

/** Season ids to query for one anime, earliest first. */
export function seasonIdsOf(anime: Anime): number[] {
  if (anime.seasons && anime.seasons.length > 0) {
    return anime.seasons.map((s) => s.anilistId)
  }
  return anime.source ? [anime.source.anilistId] : []
}

/** True when at least one episode already carries a name. */
function hasNames(anime: Anime): boolean {
  return anime.episodes.some((e) => (e.title ?? '').trim() !== '')
}

/**
 * Merge fetched names into an anime, creating any missing episodes.
 *
 * Titles are only written where the episode has none, so anything typed by hand
 * survives, and ratings are never touched. Episode numbers are preserved so an
 * existing score stays attached to its episode.
 */
export function mergeEpisodeNames(
  anime: Anime,
  names: { number: number; season: number; title: string }[]
): Episode[] {
  const byNumber = new Map(names.map((n) => [n.number, n]))
  const highest = names.reduce((max, n) => Math.max(max, n.number), 0)
  const target = Math.max(highest, anime.episodes.length)
  const existing = new Map(anime.episodes.map((e) => [e.number, e]))

  const merged: Episode[] = []
  for (let n = 1; n <= target; n += 1) {
    const current = existing.get(n)
    const found = byNumber.get(n)
    if (current) {
      merged.push({
        ...current,
        title: current.title ?? found?.title,
        season: current.season ?? found?.season
      })
    } else if (found) {
      merged.push({
        id: crypto.randomUUID(),
        number: n,
        title: found.title,
        season: found.season,
        score: null
      })
    }
  }

  // Seasons derived from the season spans, so badges are right even for
  // episodes the source had no title for.
  return applySeasonSpans(
    merged,
    anime.seasons && anime.seasons.length > 1 ? anime.seasons : undefined
  )
}

/**
 * Load episode names for every anime that has a reference but no names yet.
 *
 * Runs sequentially: the main process already paces Kitsu, and doing these in
 * parallel would only trip its rate limit. Progress is reported after each
 * anime so the UI can stay responsive and offer a stop button.
 */
export async function loadAllEpisodeNames(
  anime: Anime[],
  apply: (id: string, patch: Partial<Anime>) => void,
  options: BulkOptions = {}
): Promise<BulkResult> {
  const result: BulkResult = { loaded: 0, empty: 0, failed: 0, alreadyDone: 0 }

  const eligible: Anime[] = []
  for (const item of anime) {
    if (seasonIdsOf(item).length === 0) continue
    if (hasNames(item)) {
      result.alreadyDone += 1
      continue
    }
    eligible.push(item)
  }

  const total = eligible.length
  options.onProgress?.({
    running: total > 0,
    done: 0,
    total,
    loaded: 0,
    empty: 0,
    failed: 0,
    current: null
  })

  for (const [index, item] of eligible.entries()) {
    if (options.shouldCancel?.()) break

    options.onProgress?.({
      running: true,
      done: index,
      total,
      loaded: result.loaded,
      empty: result.empty,
      failed: result.failed,
      current: item.title
    })

    try {
      const outcome = await window.animeeh.loadEpisodeNames(seasonIdsOf(item))
      if (!outcome.ok) {
        result.failed += 1
      } else if (outcome.data.episodes.length === 0) {
        result.empty += 1
      } else {
        const episodes = mergeEpisodeNames(item, outcome.data.episodes)
        const gained = episodes.filter((e) => (e.title ?? '').trim() !== '').length
        apply(item.id, {
          episodes,
          totalEpisodes: item.totalEpisodes ?? (gained > 0 ? episodes.length : undefined)
        })
        result.loaded += 1
      }
    } catch {
      result.failed += 1
    }

    options.onProgress?.({
      running: index + 1 < total,
      done: index + 1,
      total,
      loaded: result.loaded,
      empty: result.empty,
      failed: result.failed,
      current: item.title
    })
  }

  return result
}
