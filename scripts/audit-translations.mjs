/**
 * Finds translations that exist but are not actually translated.
 *
 * The key-completeness check is enforced by TypeScript, so a *missing* French
 * key cannot happen. What it cannot catch is a French entry whose value is
 * still the English text, which reads as an untranslated string in the UI.
 *
 * Usage: node scripts/audit-translations.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'src/renderer/src/i18n.tsx'), 'utf-8')

/**
 * Values that are legitimately identical in both languages: proper nouns,
 * acronyms, brand names and symbols.
 */
const SAME_IN_BOTH = new Set([
  'ANIMEEH',
  'Films',
  'Film',
  'OST',
  'Opening',
  'Global',
  'MAL {malId}',
  'AniList #{id}',
  'MyAnimeList ↗',
  'MAL',
  'S',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F'
])

/**
 * Pull the entries of one dictionary block by key.
 *
 * Both quote styles must be handled: a value containing an apostrophe, such as
 * "Fiche de l'animé", is written with double quotes. Missing that made the first
 * version of this script report four keys as untranslated when they were fine.
 */
function readDictionary(name) {
  const start = source.indexOf(`const ${name}`)
  if (start < 0) throw new Error(`dictionary ${name} not found`)
  const end = source.indexOf('\n}', start)
  const block = source.slice(start, end)

  const entries = new Map()
  const pattern = /'([a-zA-Z0-9.]+)':\s*\n?\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
  for (const match of block.matchAll(pattern)) {
    entries.set(match[1], match[2] ?? match[3] ?? '')
  }
  return entries
}

const en = readDictionary('en')
const fr = readDictionary('fr')

console.log(`key counts: en=${en.size} fr=${fr.size}`)

const identical = []
for (const [key, enValue] of en) {
  const frValue = fr.get(key)
  if (frValue === undefined) continue
  if (enValue !== frValue) continue
  if (SAME_IN_BOTH.has(enValue)) continue
  // Pure numbers, symbols or placeholders carry no language.
  if (!/[A-Za-z]{2,}/.test(enValue)) continue
  identical.push({ key, value: enValue })
}

if (identical.length === 0) {
  console.log('\nNo untranslated values found.')
} else {
  console.log(`\n${identical.length} value(s) identical in both languages:\n`)
  for (const item of identical) {
    console.log(`  ${item.key.padEnd(38)} "${item.value}"`)
  }
  console.log('\nEach is either a legitimate proper noun or a missed translation.')
}

/* ------------------------------------------------------------------ */
/* User-facing text coming from the main process                       */
/* ------------------------------------------------------------------ */

// Errors raised in the main process are shown inside the renderer, so English
// messages there surface as untranslated text too.
const mainFiles = [
  'src/main/anilist.ts',
  'src/main/episodes.ts',
  'src/main/tvmaze.ts',
  'src/main/updater.ts',
  'src/main/index.ts'
]

const mainStrings = []
for (const rel of mainFiles) {
  let text
  try {
    text = readFileSync(join(root, rel), 'utf-8')
  } catch {
    continue
  }
  for (const match of text.matchAll(/new Error\(\s*'([^']{8,120})'/g)) {
    mainStrings.push({ file: rel, value: match[1] })
  }
  for (const match of text.matchAll(/message:\s*\n?\s*'([^']{8,160})'/g)) {
    mainStrings.push({ file: rel, value: match[1] })
  }
}

if (mainStrings.length > 0) {
  console.log(`\n${mainStrings.length} English message(s) raised in the main process,`);
  console.log('which surface in the UI as-is:\n')
  for (const item of mainStrings) {
    console.log(`  ${item.file.padEnd(22)} "${item.value}"`)
  }
}

const problems = identical.length + mainStrings.length
console.log(`\n${problems === 0 ? 'TRANSLATION AUDIT CLEAN' : `${problems} thing(s) to review`}`)
process.exit(0)
