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

/**
 * The label size for a row, from the length of its text.
 *
 * A fixed 26px suited a one-letter label and overflowed the moment a row was
 * renamed: "Chefs-d'oeuvre" ran straight across the row beside it. The size now
 * falls away as the text grows, and the container clips as a last resort, so
 * nothing can escape whatever is typed.
 */
export function labelFontSize(row: TierRow): number {
  if (typeof row.fontSize === 'number' && row.fontSize > 0) return row.fontSize
  const length = row.label.trim().length
  if (length <= 1) return 26
  if (length <= 2) return 22
  if (length <= 4) return 17
  if (length <= 7) return 13
  if (length <= 11) return 11
  return 9
}

/**
 * The colour a row's label takes.
 *
 * An explicit colour wins; otherwise the grade palette, so a row and a badge read
 * the same thing.
 */
export function rowBackground(row: TierRow): string {
  if (typeof row.color === 'string' && row.color !== '') return row.color
  return rowGradient(row)
}

/** The label colour: an explicit one, else the one chosen for contrast. */
export function rowLabelColor(row: TierRow): string {
  if (typeof row.textColor === 'string' && row.textColor !== '') return row.textColor
  return rowTextColor(row)
}

/**
 * The colour a row's label takes. Unknown letters fall back to a neutral grey.
 */
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

/** The fonts a row label may take. Websafe only, so nothing has to be loaded. */
export const LABEL_FONTS: { key: string; label: string; stack: string }[] = [
  { key: 'ui', label: 'Interface', stack: "Inter, 'Segoe UI', system-ui, sans-serif" },
  { key: 'sans', label: 'Sans', stack: 'Arial, Helvetica, sans-serif' },
  { key: 'serif', label: 'Serif', stack: "Georgia, 'Times New Roman', serif" },
  { key: 'mono', label: 'Mono', stack: "ui-monospace, 'Cascadia Mono', Consolas, monospace" },
  { key: 'rounded', label: 'Rounded', stack: "'Trebuchet MS', 'Segoe UI', sans-serif" }
]

/** Resolves a stored font key to a CSS stack. */
export function fontStack(key: string | undefined): string {
  if (!key) return LABEL_FONTS[0].stack
  return LABEL_FONTS.find((font) => font.key === key)?.stack ?? LABEL_FONTS[0].stack
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

/**
 * Adds a row at the end.
 *
 * Its letter is the first one not already in use, so a new row is coloured
 * differently from the existing ones. When all seven are taken, the row still
 * appears with no letter of its own and takes the neutral colour — better than
 * refusing to add it, since the palette is only a starting point.
 */
export function addRow(list: TierList): TierList {
  const used = new Set(list.rows.map((row) => row.letter))
  const free = GRADE_LETTERS.find((letter) => !used.has(letter))
  const row: TierRow = {
    id: newId(),
    label: free ?? '',
    letter: free ?? ''
  }
  return touch({ ...list, rows: [...list.rows, row] })
}

/**
 * Removes a row, returning its elements to the pool.
 *
 * The elements are released rather than deleted: a row is a place, and losing what
 * was in it because the place was removed would be a surprise. Deleting an element
 * is its own action, in its right-click menu.
 */
export function removeRow(list: TierList, rowId: string): TierList {
  if (!list.rows.some((row) => row.id === rowId)) return list
  if (list.rows.length <= 1) return list
  return touch({
    ...list,
    rows: list.rows.filter((row) => row.id !== rowId),
    items: list.items.map((item) => (item.rowId === rowId ? { ...item, rowId: null } : item))
  })
}

/** Moves a row up or down, since the order of the tiers is itself a ranking. */
export function moveRow(list: TierList, rowId: string, delta: number): TierList {
  const index = list.rows.findIndex((row) => row.id === rowId)
  if (index === -1) return list
  const target = index + delta
  if (target < 0 || target >= list.rows.length) return list
  const rows = [...list.rows]
  const [row] = rows.splice(index, 1)
  rows.splice(target, 0, row)
  return touch({ ...list, rows })
}

/** The list as it is, with the time of the change. */
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
