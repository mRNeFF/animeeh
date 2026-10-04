/**
 * Verifies that episode titles land on the right episode numbers for a
 * franchise whose seasons aired in several cours.
 *
 * Re:Zero is the hard case:
 *   S1  25 eps    (one part)
 *   S2  25 eps    (13 + 12, two parts)
 *   S3  16 eps
 *   S4  19 eps
 *   total 85
 *
 * So S3 must start at episode 51 and S4 at episode 67. Before the fix, the
 * second part of S2 was never queried and a part's length was taken from its
 * highest *titled* episode, which put S3 at 39 and S4 at 55.
 *
 * Usage: node scripts/check-episode-numbering.mjs
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'animeeh-epnum-'))
const outFile = join(outDir, 'episodes.mjs')

await build({
  entryPoints: [join(root, 'src/main/episodes.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: outFile,
  logLevel: 'error'
})

const { loadEpisodeNames } = await import(pathToFileURL(outFile).href)

/** Re:Zero, as the app stores it: merged seasons, each with its parts. */
const REZERO = [
  [21355], // S1
  [108632, 119661], // S2, two cours
  [163134], // S3
  [189046] // S4
]

const EXPECTED_STARTS = [
  { season: 1, number: 1, title: 'The End of the Beginning and the Beginning of the End' },
  { season: 2, number: 26, title: "Each One's Promise" },
  { season: 3, number: 51, title: 'Theatrical Malice' },
  { season: 4, number: 67, title: "The Reason I'm Taking You With Me / Gorgeous Tiger Reloaded" }
]

let failures = 0

function check(label, actual, expected) {
  const ok = String(actual) === String(expected)
  if (!ok) failures += 1
  console.log(`   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`)
}

console.log('Loading episode names for Re:Zero…\n')
const result = await loadEpisodeNames(REZERO)

const byNumber = new Map(result.episodes.map((e) => [e.number, e]))
const named = result.episodes.length
const maxNumber = result.episodes.reduce((m, e) => Math.max(m, e.number), 0)

console.log(`source        : ${result.source}`)
console.log(`named episodes: ${named}`)
console.log(`highest number: ${maxNumber} (the franchise has 85 episodes)`)
console.log(`seasons with no names: ${result.missingSeasons.length > 0 ? result.missingSeasons.join(', ') : 'none'}`)
console.log('')

// How many episodes carry a name per season, derived from the season spans.
const spanFor = [
  { season: 1, from: 1, to: 25 },
  { season: 2, from: 26, to: 50 },
  { season: 3, from: 51, to: 66 },
  { season: 4, from: 67, to: 85 }
]
for (const span of spanFor) {
  const inSpan = result.episodes.filter((e) => e.number >= span.from && e.number <= span.to)
  console.log(`  S${span.season} (${span.from}-${span.to}): ${inSpan.length} named`)
}

console.log('\nFirst titled episode of each season:')
for (const expected of EXPECTED_STARTS) {
  const found = byNumber.get(expected.number)
  console.log(`   #${expected.number} -> ${found ? `"${found.title}"` : '(nothing)'}`)
}

console.log('\nChecks:')
check('highest episode number', maxNumber, 85)
for (const expected of EXPECTED_STARTS) {
  const found = byNumber.get(expected.number)
  check(`episode ${expected.number} carries the season's first title`, found?.title ?? '(nothing)', expected.title)
}

// The season label must match the span, not the part index.
for (const expected of EXPECTED_STARTS) {
  const found = byNumber.get(expected.number)
  check(`episode ${expected.number} is labelled season ${expected.season}`, found?.season ?? '?', expected.season)
}

// No title may appear in two different seasons.
const seen = new Map()
let duplicated = false
for (const episode of result.episodes) {
  const previous = seen.get(episode.title)
  if (previous !== undefined && previous !== episode.season) duplicated = true
  seen.set(episode.title, episode.season)
}
check('no title reused across two seasons', duplicated, false)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
