/**
 * Would the series rule split any franchise already stored in the library?
 *
 * Every consecutive season pair in the data file must read as a continuation, so
 * this compares each pair with the real exported rule rather than a copy of it.
 * Reimplementing the logic here was a mistake worth recording: the first version
 * of this script tested a locally retyped rule, so it kept passing while the real
 * rule was broken.
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
if (typeof mod.shouldChainLink !== 'function') {
  console.error('shouldChainLink is not exported from src/main/anilist.ts')
  process.exit(2)
}
const shouldChainLink = mod.shouldChainLink

if (!existsSync(dataFile)) {
  console.error(`No data file at ${dataFile}`)
  process.exit(2)
}

const data = JSON.parse(readFileSync(dataFile, 'utf-8'))

/** Franchises that are deliberately a single entry across separate AniList ids. */
const CURATED_MERGES = new Set(['Steins;Gate', 'Steins;Gate 0'])

let splits = 0
let pairs = 0
const offenders = []

for (const a of data.anime ?? []) {
  const seasons = a.seasons ?? []
  if (seasons.length < 2) continue

  console.log(`\n${a.title}  (${seasons.length} seasons)`)
  for (let i = 1; i < seasons.length; i += 1) {
    const prev = seasons[i - 1]
    const current = seasons[i]
    pairs += 1
    // The exact decision the app makes when it walks the chain.
    const linked = shouldChainLink(
      { id: prev.anilistId, title: prev.title },
      { id: current.anilistId, title: current.title }
    )
    if (!linked) {
      splits += 1
      offenders.push({ anime: a.title, pair: `${prev.title}  ->  ${current.title}` })
    }
    console.log(`   S${prev.season} -> S${current.season}  ${linked ? 'linked' : 'SPLIT'}  ${current.title}`)
  }
}

console.log(`\n${'='.repeat(88)}`)
console.log(`${pairs} consecutive season pair(s) in your library, ${splits} of which the rule would split`)
for (const f of offenders) {
  console.log(`   ${f.anime}\n      ${f.pair}`)
}

// The Dragon Ball family is the one case that must split, so it is asserted here
// to catch a rule that has quietly become permissive again.
const DRAGON_BALL = [
  'Dragon Ball',
  'Dragon Ball Z',
  'Dragon Ball GT',
  'Dragon Ball Super',
  'Dragon Ball DAIMA'
]
let dragonBallFailures = 0
console.log('\nDragon Ball, which must stay separate:')
for (let i = 0; i < DRAGON_BALL.length; i += 1) {
  for (let j = i + 1; j < DRAGON_BALL.length; j += 1) {
    // Ids as AniList reports them, so the curated split is exercised too.
    const ids = { 'Dragon Ball': 223, 'Dragon Ball Z': 813, 'Dragon Ball GT': 225, 'Dragon Ball Super': 21175, 'Dragon Ball DAIMA': 170083 }
    const linked = shouldChainLink(
      { id: ids[DRAGON_BALL[i]], title: DRAGON_BALL[i] },
      { id: ids[DRAGON_BALL[j]], title: DRAGON_BALL[j] }
    )
    if (linked) dragonBallFailures += 1
    console.log(`   ${linked ? 'FAIL' : 'OK  '} separate  ${DRAGON_BALL[i]} / ${DRAGON_BALL[j]}`)
  }
}

const ok = splits === 0 && dragonBallFailures === 0
console.log(`\n${ok ? 'LIBRARY INTACT AND DRAGON BALL SEPARATE' : `${splits + dragonBallFailures} PROBLEM(S)`}`)
if (CURATED_MERGES.size > 0 && splits === 0) {
  console.log('(Steins;Gate relies on the curated merge, not on the title rule.)')
}
process.exit(ok ? 0 : 1)
