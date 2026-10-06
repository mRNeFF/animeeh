/**
 * Scans every source and script file for genuinely damaged text.
 *
 * A Windows console in codepage 1252 shows correct UTF-8 as question marks, so
 * printed output cannot be trusted. This reads the bytes as UTF-8 and looks for
 * the two signatures of real damage:
 *
 *   U+FFFD     the replacement character, written when decoding already failed
 *   mojibake   UTF-8 bytes read as Latin-1, e.g. "é" becoming "Ã©"
 *
 * It exists because editing files through PowerShell's Set-Content silently
 * wrote some accented text in the console's codepage, damaging it.
 *
 * Usage: node scripts/audit-encoding.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, keep = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'out' || entry === 'release' || entry === '.git') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, keep)
    else if (/\.(tsx|ts|mjs|js|css|html|json|md|yml)$/.test(entry)) keep.push(full)
  }
  return keep
}

/** Sequences produced by reading UTF-8 bytes as Latin-1. */
const MOJIBAKE = /[\u00C2\u00C3][\u0080-\u00BF]/

const files = walk(root)
const damaged = []
let replacementCount = 0

for (const file of files) {
  const rel = file.replace(root, '').replace(/\\/g, '/')
  // The audit itself contains the patterns it looks for.
  if (rel.includes('audit-encoding')) continue

  let text
  try {
    text = readFileSync(file, 'utf-8')
  } catch {
    continue
  }

  const lines = text.split('\n')
  lines.forEach((line, index) => {
    const replacements = (line.match(/\uFFFD/g) ?? []).length
    const mojibake = MOJIBAKE.test(line)
    if (replacements === 0 && !mojibake) return

    replacementCount += replacements
    damaged.push({
      file: rel,
      line: index + 1,
      kind: replacements > 0 ? 'U+FFFD' : 'mojibake',
      replacements,
      text: line.trim()
    })
  })
}

if (damaged.length === 0) {
  console.log(`scanned ${files.length} files`)
  console.log('ENCODING CLEAN — no damaged text found')
  process.exit(0)
}

console.log(`scanned ${files.length} files\n`)
console.log(`${damaged.length} damaged line(s), ${replacementCount} replacement character(s)\n`)

let current = ''
for (const d of damaged) {
  if (d.file !== current) {
    current = d.file
    console.log(`  ${d.file}`)
  }
  const note = d.kind === 'U+FFFD' ? `x${d.replacements}` : 'mojibake'
  console.log(`     L${String(d.line).padStart(4)} [${note}] ${d.text.slice(0, 96)}`)
}

const byFile = new Map()
for (const d of damaged) byFile.set(d.file, (byFile.get(d.file) ?? 0) + 1)

console.log('\nsummary by file:')
for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${file}`)
}

process.exit(1)
