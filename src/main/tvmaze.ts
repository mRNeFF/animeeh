/**
 * TVMaze episode titles, used only as a last resort.
 *
 * Kitsu publishes a real episode list per anime but leaves whole seasons without
 * titles (Tokyo Revengers S2-S4, Classroom of the Elite S2, The Promised
 * Neverland S2), and AniList's per-season list is unusable because it repeats
 * the whole franchise. TVMaze fills some of those gaps.
 *
 * It is used under a strict condition: TVMaze must break the show into seasons
 * whose episode counts match this franchise *exactly*. Tokyo Revengers is
 * grouped as a single season of 52 on TVMaze while the app has four seasons
 * totalling 63, so it is rejected rather than guessed at. That guard exists
 * because misaligned titles are the exact bug being fixed.
 */

const TVMAZE = 'https://api.tvmaze.com'
const TIMEOUT_MS = 15_000
const PACING_MS = 1_100

/** Strip accents, punctuation and case so titles can be compared. */
function normalise(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

let lastCall = 0

async function getJson<T>(url: string): Promise<T | null> {
  const wait = PACING_MS - (Date.now() - lastCall)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'ANIMEEH (episode title lookup)' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

interface TvmazeShow {
  id?: number
  name?: string
}

interface TvmazeEpisode {
  season?: number
  number?: number | null
  name?: string | null
}

/**
 * Look up one show's episodes by title.
 *
 * `expectedCounts` is the app's season layout for the seasons that actually
 * have episodes, for example [12, 13, 13, 16]. Seasons of unknown length are
 * not passed, since they occupy no slots. The result is only returned when
 * TVMaze's own season layout matches it element for element; otherwise null.
 */
export async function tvmazeSeasonTitles(
  searchTitle: string,
  expectedCounts: number[]
): Promise<Map<number, Map<number, string>> | null> {
  if (expectedCounts.length === 0) return null

  const show = await getJson<TvmazeShow>(
    `${TVMAZE}/singlesearch/shows?q=${encodeURIComponent(searchTitle)}`
  )
  if (!show?.id) return null

  // Guard against a search that latched onto a different show.
  if (show.name && normalise(show.name) !== normalise(searchTitle)) {
    const a = normalise(show.name)
    const b = normalise(searchTitle)
    if (!a.includes(b) && !b.includes(a)) return null
  }

  const episodes = await getJson<TvmazeEpisode[]>(`${TVMAZE}/shows/${show.id}/episodes`)
  if (!Array.isArray(episodes) || episodes.length === 0) return null

  // TVMaze's own season breakdown, in season order.
  const counts = new Map<number, number>()
  for (const episode of episodes) {
    const season = episode.season ?? 1
    counts.set(season, (counts.get(season) ?? 0) + 1)
  }
  const tvSeasons = [...counts.keys()].sort((a, b) => a - b)
  const tvCounts = tvSeasons.map((s) => counts.get(s) ?? 0)

  // TVMaze may not list a season that has not aired yet, so our layout must
  // match TVMaze's as a *prefix*: every season TVMaze knows must line up
  // exactly, and any extra seasons on our side simply get nothing.
  if (tvCounts.length === 0 || expectedCounts.length < tvCounts.length) return null
  for (const [index, count] of tvCounts.entries()) {
    if (count !== expectedCounts[index]) return null
  }

  // Map TVMaze season index -> app season key -> episode number -> title.
  // `expectedCounts` only covers seasons with episodes, so the index among
  // those is the key callers use.
  const result = new Map<number, Map<number, string>>()
  tvSeasons.forEach((tvSeason, index) => {
    const titles = new Map<number, string>()
    for (const episode of episodes) {
      if ((episode.season ?? 1) !== tvSeason) continue
      const name = episode.name?.trim()
      if (!name || typeof episode.number !== 'number') continue
      // TVMaze uses "Episode 7" as a placeholder when it has no real title,
      // and a placeholder is worse than leaving the field empty.
      if (/^episode\s+\d+$/i.test(name)) continue
      titles.set(episode.number, name)
    }
    if (titles.size > 0) result.set(index + 1, titles)
  })

  return result.size > 0 ? result : null
}
