/**
 * Minimal xlsx reader: enough to turn a worksheet into a grid of strings.
 *
 * An .xlsx is a ZIP of XML. Rather than pull in a spreadsheet library, unzip it
 * with the OS tooling and parse the two parts that matter:
 *
 *   xl/sharedStrings.xml  - the string pool cells point into
 *   xl/worksheets/sheetN.xml - the cells
 *
 * Handles the cell shapes Excel actually emits: shared strings (t="s"),
 * inline strings (t="inlineStr"), formula results (t="str") and numbers.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Unzip `file` to a temp folder and return its path. */
export function unzip(file) {
  const dir = mkdtempSync(join(tmpdir(), 'animeeh-xlsx-'))
  // tar ships with Windows 10+ and understands zip; -x extracts, -f file.
  execFileSync('tar', ['-x', '-f', file, '-C', dir], { stdio: 'pipe' })
  return dir
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

/** All <si> entries, concatenating the runs inside each one. */
function readSharedStrings(dir) {
  const path = join(dir, 'xl', 'sharedStrings.xml')
  if (!existsSync(path)) return []

  const xml = readFileSync(path, 'utf-8')
  const out = []
  for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const runs = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1])
    out.push(decodeEntities(runs.join('')))
  }
  return out
}

/** Column letters ("AB") to a 0-based index. */
export function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? 'A'
  let index = 0
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

/**
 * Read one worksheet into a grid of strings, `null` for empty cells.
 * Row and column indices are 0-based and gaps are filled.
 */
export function readSheet(file, sheetFile = 'xl/worksheets/sheet1.xml') {
  const dir = unzip(file)
  const shared = readSharedStrings(dir)
  const xml = readFileSync(join(dir, sheetFile), 'utf-8')

  const grid = []
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = []
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1]
      const body = cellMatch[2]
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? 'A1'
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1]

      let value = null
      if (type === 's') {
        const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? -1)
        value = shared[idx] ?? null
      } else if (type === 'inlineStr') {
        const runs = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1])
        value = decodeEntities(runs.join('')) || null
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
        value = raw === undefined ? null : decodeEntities(raw)
      }

      const col = columnIndex(ref)
      while (cells.length < col) cells.push(null)
      cells[col] = value
    }
    grid.push(cells)
  }

  return { grid, dir }
}
