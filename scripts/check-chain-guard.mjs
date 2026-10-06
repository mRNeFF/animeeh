/**
 * Would a "same base title" guard break the franchises already merged?
 *
 * The Dragon Ball problem: Dragon Ball, Z, GT, Super and Daima are linked by
 * SEQUEL, so the chain walk merges them, yet they are distinct series. The
 * proposed guard is to only follow a link when the target's base title matches,
 * which would separate them.
 *
 * Before applying it, every multi-season franchise in the library is checked:
 * for each consecutive pair of seasons, does the base title match? Any pair that
 * does not would be split, and that must be a deliberate outcome, not a
 * surprise. Steins;Gate is expected to fail here and is covered by a curated
 * exception.
 *
 * Usage: node scripts/check-chain-guard.mjs
 */
import { build } from 'esbuild'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataFile = join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')

const out = join(mkdtempSync(join(tmpdir(), 'guard-')), 'a.mjs')
await build({
  entryPoints: [join(root, 'src/main/anilist.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: out,
  logLevel: 'error'
})

const mod = await import(pathToFileURL(out).href)
// franchiseKey is exported for the tests; fall back to a local copy if not.
const franchiseKey =
  mod.franchiseKey ??
  ((title) =>
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\bthe final season\b/g, ' ')
      .replace(/\bfinal season\b/g, ' ')
      .replace(/\b\d+(?:st|nd|rd|th) season\b/g, ' ')
      .replace(/\bseason \d+\b/g, ' ')
      .replace(/\b\d+(?:st|nd|rd|th) cour\b/g, ' ')
      .replace(/\bpart \d+\b/g, ' ')
      .replace(/\bcour \d+\b/g, ' ')
      .replace(/\s+(?:i{1,3}|iv|v|vi{1,3}|ix|x)\s*$/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())

/** Strip roman numerals wherever they appear, not only at the end. */
function looseKey(title) {
  return franchiseKey(title)
    .replace(/\s+(?:i{1,3}|iv|v|vi{1,3}|ix|x)\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

if (!existsSync(dataFile)) {
  console.error(`No data file at ${dataFile}`)
  process.exit(2)
}

const data = JSON.parse(readFileSync(dataFile, 'utf-8'))

const strictFailures = []
const looseFailures = []

for (const a of data.anime ?? []) {
  const seasons = a.seasons ?? []
  if (seasons.length < 2) continue

  console.log(`\n${a.title}  (${seasons.length} seasons)`)
  for (let i = 0; i < seasons.length; i += 1) {
    const s = seasons[i]
    if (i === 0) {
      console.log(`   S${s.season}  ${s.title}`)
      continue
    }
    const prev = seasons[i - 1]
    const sameStrict = franchiseKey(s.title) === franchiseKey(prev.title)
    const sameLoose = looseKey(s.title) === looseKey(prev.title)
    const mark = sameLoose ? 'OK  ' : 'SPLIT'
    console.log(
      `   S${s.season}  ${s.title}\n` +
        `         prev base "${franchiseKey(prev.title)}"` +
        `  vs "${franchiseKey(s.title)}"` +
        `  strict=${sameStrict ? 'match' : 'differ'} loose=${sameLoose ? 'match' : 'differ'}  ${mark}`
    )
    if (!sameStrict) strictFailures.push({ anime: a.title, pair: `${prev.title} -> ${s.title}` })
    if (!sameLoose) looseFailures.push({ anime: a.title, pair: `${prev.title} -> ${s.title}` })
  }
}

console.log(`\n${'='.repeat(88)}`)
console.log(`pairs that a STRICT base-key guard would split: ${strictFailures.length}`)
for (const f of strictFailures) console.log(`   ${f.anime}\n      ${f.pair}`)

console.log(`\npairs a LOOSE guard (roman numerals stripped anywhere) would split: ${looseFailures.length}`)
for (const f of looseFailures) console.log(`   ${f.anime}\n      ${f.pair}`)

console.log(`\n--- Dragon Ball, both rules ---`)
for (const title of ['Dragon Ball', 'Dragon Ball Z', 'Dragon Ball GT', 'Dragon Ball Super', 'Dragon Ball DAIMA', 'Dragon Ball Kai']) {
  console.log(`   ${title.padEnd(22)} strict "${franchiseKey(title)}"  loose "${looseKey(title)}"`)
}
