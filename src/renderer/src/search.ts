/**
 * Accent- and case-insensitive text search, for the leaderboard find bar.
 *
 * The highlight needs to know *where* in the original title a match sits, and
 * folding a string changes its length: "É" folds to "E", while a character
 * written as "e" plus a combining accent folds to a single "e". Mapping the
 * folded copy back to the original is what keeps the highlight from drifting off
 * the matched word on any accented title.
 */

/** A half-open range `[start, end)` of an original string. */
export interface TextRange {
  start: number
  end: number
}

/** A piece of a string, flagged when it is part of a match. */
export interface TextSegment {
  text: string
  match: boolean
}

/**
 * A lowercase, accent-free copy of `value`, alongside the offsets each of its
 * characters occupies in `value`.
 *
 * `starts[i]` and `ends[i]` bound the original character that produced the
 * folded character `text[i]`. Several folded characters can share one original
 * character, which is exactly the "e" plus combining accent case.
 */
export function foldForSearch(value: string): {
  text: string
  starts: number[]
  ends: number[]
} {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  let offset = 0

  for (const character of value) {
    const folded = character
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
    for (const out of folded) {
      text += out
      starts.push(offset)
      ends.push(offset + character.length)
    }
    offset += character.length
  }

  return { text, starts, ends }
}

/** The folded form of `value`, which is all a plain containment test needs. */
export function fold(value: string): string {
  return foldForSearch(value).text
}

/**
 * Every occurrence of `needle` in `haystack`, as ranges of `haystack`.
 *
 * Occurrences do not overlap, so "aa" occurs once in "aaa". That matches how a
 * reader counts matches and keeps the highlight from stacking.
 */
export function findRanges(haystack: string, needle: string): TextRange[] {
  const query = fold(needle)
  if (query === '') return []

  const { text, starts, ends } = foldForSearch(haystack)
  const ranges: TextRange[] = []

  let from = text.indexOf(query)
  while (from !== -1) {
    ranges.push({ start: starts[from], end: ends[from + query.length - 1] })
    from = text.indexOf(query, from + query.length)
  }

  return ranges
}

/** True when `haystack` contains `needle`, ignoring case and accents. */
export function includesQuery(haystack: string | undefined, needle: string): boolean {
  if (!haystack) return false
  const query = fold(needle)
  if (query === '') return false
  return fold(haystack).includes(query)
}

/**
 * Splits `text` into alternating plain and matched segments, ready to render.
 *
 * Always returns at least one segment so a caller can map over the result
 * unconditionally.
 */
export function highlightSegments(text: string, needle: string): TextSegment[] {
  const ranges = findRanges(text, needle)
  if (ranges.length === 0) return [{ text, match: false }]

  const segments: TextSegment[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), match: false })
    segments.push({ text: text.slice(range.start, range.end), match: true })
    cursor = range.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false })

  return segments
}
