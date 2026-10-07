/**
 * Tier lists: the pure part.
 *
 * Everything here is data in, data out, with no React and no network, so the
 * awkward cases — an entry deleted after being placed, a row renamed, items
 * sorted by a score that has since changed — can be tested directly rather than
 * through the interface.
 *
 * The board itself is a table of rows plus a pool of unplaced items. That shape is
 * deliberate: an item knows which row it is in, and nothing else knows about
 * ordering, so moving something is a single field change and cannot leave a row
 * referring to an item that has moved on.
 */
import { GRADE_LETTERS, tierGradient, tierOf, tierTextColor } from './palette'
import { globalScore } from './scoring'
import {
  newId,
  type Anime,
  type TierItem,
  type TierList,
  type TierRow,
  type Weights
} from './types'

/**
 * The default rows, best first.
 *
 * The letters come from the grade palette, so a row is coloured by the same
 * system as a badge and the two cannot drift apart.
 */
export function defaultRows(): TierRow[] {
  return GRADE_LETTERS.map((letter) => ({
    id: newId(),
    label: letter,
    letter
  }))
}

/** A fresh, empty tier list. Nothing restricts what may be put in it. */
export function createTierList(name: string): TierList {
  const now = new Date().toISOString()
  return {
    id: newId(),
    name,
    rows: defaultRows(),
    items: [],
    createdAt: now,
    updatedAt: now
  }
}

/** The colour a row's label takes. Unknown letters fall back to a neutral grey. */
export function rowGradient(row: TierRow): string {
  const tier = tierOf(row.letter)
  // The same gradient a grade badge uses, so a row and a badge cannot drift apart.
  return tier === null ? 'linear-gradient(160deg, #2b3d5e, #1e2c49)' : tierGradient(tier)
}

/** The letter colour that reads on a row's gradient. */
export function rowTextColor(row: TierRow): string {
  const tier = tierOf(row.letter)
  return tier === null ? '#a8b6cb' : tierTextColor(tier)
}

/* ------------------------------------------------------------------ */
/* Building elements from the library                                  */
/* ------------------------------------------------------------------ */

/**
 * One element per library entry.
 *
 * The score is carried in the sublabel so the pool can be read without looking
 * every entry up, and `animeId` keeps the link for the grade badge and for the
 * repair pass.
 */
export function itemsFromAnime(anime: Anime[], weights: Weights): TierItem[] {
  return anime.map((entry) => {
    const score = globalScore(entry, weights)
    return {
      id: newId(),
      label: entry.title,
      sublabel: [entry.year ? String(entry.year) : null, score === null ? null : score.toFixed(1)]
        .filter(Boolean)
        .join(' · '),
      image: entry.coverImage,
      rowId: null,
      animeId: entry.id,
      anilistId: entry.source?.anilistId ?? undefined
    }
  })
}

/**
 * One element per season, across every entry that groups more than one.
 *
 * A single-season entry contributes nothing: it would only duplicate the entry
 * itself, which is already available as the `anime` kind.
 */
export function itemsFromSeasons(anime: Anime[]): TierItem[] {
  const items: TierItem[] = []
  for (const entry of anime) {
    const seasons = entry.seasons ?? []
    if (seasons.length < 2) continue
    for (const season of seasons) {
      items.push({
        id: newId(),
        label: season.title || `${entry.title} S${season.season}`,
        sublabel:
          [season.year ? String(season.year) : null, season.episodes ? `${season.episodes} ep.` : null]
            .filter(Boolean)
            .join(' · ') || entry.title,
        image: entry.coverImage,
        rowId: null,
        animeId: entry.id,
        anilistId: season.anilistId
      })
    }
  }
  return items
}

/* ------------------------------------------------------------------ */
/* Reading the board                                                   */
/* ------------------------------------------------------------------ */

export interface BoardView {
  /** The rows, in order, each with the items it holds. */
  rows: { row: TierRow; items: TierItem[] }[]
  /** Everything not yet placed. */
  pool: TierItem[]
}

/**
 * Splits a tier list into rows and pool.
 *
 * An item whose row is missing ends up in the pool rather than disappearing,
 * which is what keeps a list readable after its rows have been edited.
 */
export function boardView(list: TierList): BoardView {
  const byRow = new Map<string, TierItem[]>()
  for (const row of list.rows) byRow.set(row.id, [])

  const pool: TierItem[] = []
  for (const item of list.items) {
    const bucket = item.rowId === null ? null : byRow.get(item.rowId)
    if (bucket) bucket.push(item)
    else pool.push(item)
  }

  return {
    rows: list.rows.map((row) => ({ row, items: byRow.get(row.id) ?? [] })),
    pool
  }
}

/** How many items sit in each row, keyed by row id. */
export function countsByRow(list: TierList): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of list.rows) counts.set(row.id, 0)
  for (const item of list.items) {
    if (item.rowId === null) continue
    counts.set(item.rowId, (counts.get(item.rowId) ?? 0) + 1)
  }
  return counts
}

/* ------------------------------------------------------------------ */
/* Editing                                                             */
/* ------------------------------------------------------------------ */

function touch(list: TierList): TierList {
  return { ...list, updatedAt: new Date().toISOString() }
}

/**
 * Moves an element into a row, or back to the pool with `rowId: null`.
 *
 * Returns a new list; the caller never mutates.
 */
export function moveItem(list: TierList, itemId: string, rowId: string | null): TierList {
  let moved = false
  const items = list.items.map((item) => {
    if (item.id !== itemId) return item
    if (item.rowId === rowId) return item
    moved = true
    return { ...item, rowId }
  })
  return moved ? touch({ ...list, items }) : list
}

/** Adds elements, skipping any that are already in the list. */
export function addItems(list: TierList, incoming: TierItem[]): TierList {
  if (incoming.length === 0) return list
  // Two elements are the same when they point at the same AniList id, or carry
  // the same label for the kinds that have no id at all, such as OSTs.
  const seen = new Set(
    list.items.map((i) => (i.anilistId ? `a:${i.anilistId}` : `l:${i.label.toLowerCase()}`))
  )
  const fresh = incoming.filter((item) => {
    const key = item.anilistId ? `a:${item.anilistId}` : `l:${item.label.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return fresh.length === 0 ? list : touch({ ...list, items: [...list.items, ...fresh] })
}

export function removeItem(list: TierList, itemId: string): TierList {
  const items = list.items.filter((item) => item.id !== itemId)
  return items.length === list.items.length ? list : touch({ ...list, items })
}

export function renameList(list: TierList, name: string): TierList {
  const trimmed = name.trim()
  if (!trimmed || trimmed === list.name) return list
  return touch({ ...list, name: trimmed })
}

export function renameRow(list: TierList, rowId: string, label: string): TierList {
  const trimmed = label.trim()
  if (!trimmed) return list
  return touch({
    ...list,
    rows: list.rows.map((row) => (row.id === rowId ? { ...row, label: trimmed } : row))
  })
}

/**
 * Places every element according to the score already given to its entry.
 *
 * This is the answer to the real objection about tier lists: placing sixty items
 * from nothing is work nobody wants. The scores are already there, so the first
 * pass is free and the user only adjusts. Elements with no score stay in the pool,
 * since guessing where they belong would be worse than leaving them out.
 */
export function sortByScore(list: TierList, anime: Anime[], weights: Weights): TierList {
  const byId = new Map(anime.map((entry) => [entry.id, entry]))
  const rowFor = (score: number): string | null => {
    const tier = tierOf(score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : score >= 10 ? 'E' : 'F')
    if (tier === null) return null
    return list.rows.find((row) => row.letter === tier.letter)?.id ?? null
  }

  let placed = 0
  const items = list.items.map((item) => {
    // Only elements that came from the library have a score to read.
    const entry = item.animeId ? byId.get(item.animeId) : undefined
    const score = entry ? globalScore(entry, weights) : null
    if (score === null) return item
    const rowId = rowFor(score)
    if (rowId === null) return item
    if (item.rowId !== rowId) placed += 1
    return { ...item, rowId }
  })

  return placed === 0 ? list : touch({ ...list, items })
}

/** Clears every placement, returning all elements to the pool. */
export function clearPlacements(list: TierList): TierList {
  if (list.items.every((item) => item.rowId === null)) return list
  return touch({ ...list, items: list.items.map((item) => ({ ...item, rowId: null })) })
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

export interface TierListStats {
  items: number
  placed: number
  pool: number
  /** True when nothing is placed yet, so the board can show how to start. */
  empty: boolean
}

export function statsOf(list: TierList): TierListStats {
  const placed = list.items.filter((item) => item.rowId !== null).length
  return {
    items: list.items.length,
    placed,
    pool: list.items.length - placed,
    empty: placed === 0
  }
}

/**
 * Which library entries the list refers to have since been deleted.
 *
 * Reported rather than acted on: the element stays on the board with its label, so
 * the placement is not lost, and the interface can mark it as no longer linked.
 */
export function orphanAnimeIds(list: TierList, anime: Anime[]): Set<string> {
  const live = new Set(anime.map((entry) => entry.id))
  const orphans = new Set<string>()
  for (const item of list.items) {
    if (item.animeId && !live.has(item.animeId)) orphans.add(item.animeId)
  }
  return orphans
}
