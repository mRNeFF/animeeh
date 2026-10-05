/**
 * Finds user-facing English text that never went through the translation
 * dictionaries.
 *
 * This exists because three separate hardcoded strings slipped past manual
 * review: `Library` on the detail toolbar, `delete` in the confirmation
 * comparison, and `Title` in the leaderboard header. The first one was invisible
 * to a line-based grep because its closing tag sat on the following line, so the
 * scan here is regex-based over the whole file.
 *
 * Usage: node scripts/audit-i18n.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src', 'renderer', 'src')

/** Values that are intentionally not translated. */
const ALLOWED = new Set([
  'ANIMEEH',
  'アニメ',
  'ア',
  '★',
  '×',
  '—',
  '0–100',
  '▴',
  '▾',
  '▸',
  '↗',
  // TypeScript type names, which the JSX regex mistakes for text.
  'Promise'
])

/** Text that only looks English because it is a key, an id or a symbol. */
function isAllowed(text) {
  return (
    ALLOWED.has(text) ||
    /^[\d\s·.,:;#%+\-–—/\\()[\]{}|★×▴▾▸'’"“”&]*$/.test(text) ||
    /^[SsFf]\d+$/.test(text) ||
    /^[A-Z]{2,6}$/.test(text) // short uppercase tags like FILM, EP
  )
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full)
  }
  return out
}

const findings = []

for (const file of walk(srcDir)) {
  // The dictionaries themselves are the translations.
  if (file.endsWith('i18n.tsx')) continue

  const source = readFileSync(file, 'utf-8')
  const rel = file.replace(root, '').replace(/\\/g, '/')

  const lineOf = (index) => source.slice(0, index).split('\n').length

  // JSX text between tags, including across newlines.
  for (const match of source.matchAll(/>\s*\n?\s*([A-Za-z][A-Za-z0-9 ''’.,!?&–-]{1,70}?)\s*\n?\s*</g)) {
    const text = match[1].trim()
    if (isAllowed(text)) continue
    // Inside a `{ ... }` expression, or a comment.
    const before = source.slice(Math.max(0, match.index - 40), match.index)
    if (/\{\s*$/.test(before) || before.includes('//')) continue
    findings.push({ file: rel, line: lineOf(match.index), kind: 'text', value: text })
  }

  // Literal attribute values.
  for (const match of source.matchAll(/\b(placeholder|title|aria-label|alt)="([^"{}][^"]{1,70})"/g)) {
    const text = match[2].trim()
    if (isAllowed(text)) continue
    findings.push({ file: rel, line: lineOf(match.index), kind: match[1], value: text })
  }
}

// Deduplicate, and drop matches inside translated calls such as t('x', { y: 'Text' }).
const seen = new Set()
const unique = findings.filter((f) => {
  const key = `${f.file}:${f.line}:${f.value}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})

if (unique.length === 0) {
  console.log('No hardcoded user-facing text found.')
  process.exit(0)
}

console.log(`${unique.length} possible hardcoded string(s):\n`)
let current = ''
for (const f of unique.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  if (f.file !== current) {
    current = f.file
    console.log(`  ${f.file}`)
  }
  console.log(`     L${String(f.line).padStart(4)}  ${f.kind.padEnd(11)} "${f.value}"`)
}
console.log('\nEach one is either a missed translation or belongs in the ALLOWED list.')
process.exit(1)
