/**
 * Tests the find-bar matching, with the accent handling as the point.
 *
 * The highlight has to point at the real characters of the original title, and
 * folding a string does not preserve offsets: a character written as "e" plus a
 * combining accent folds to a single "e". The round-trip check below is what
 * pins that down — joined back together, the segments must reproduce the input
 * exactly, or the table would render a mangled title.
 *
 * Usage: node scripts/check-search.mjs
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(mkdtempSync(join(tmpdir(), 'search-')), 'a.mjs')

await build({
  entryPoints: [join(root, 'src/renderer/src/search.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: out,
  logLevel: 'error'
})

const { findRanges, highlightSegments, includesQuery, fold } = await import(
  pathToFileURL(out).href
)

let failures = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${label}\n` +
      (ok
        ? ''
        : `         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}\n`)
  )
}

console.log('folding:\n')
check('lowercases', fold('FRIEREN'), 'frieren')
check('strips an accent', fold('Pokémon'), 'pokemon')
check('folds a decomposed accent', fold('Poke\u0301mon'), 'pokemon')
check('leaves the sharp s alone', fold('Straße'), 'straße')
check('keeps punctuation for offsets', fold('Re:Zero'), 're:zero')

console.log('\nranges:\n')
check('finds a plain word', findRanges('Sousou no Frieren', 'frieren'), [{ start: 10, end: 17 }])
check('is case-insensitive', findRanges('Sousou no Frieren', 'FRIEREN'), [{ start: 10, end: 17 }])
check('matches through an accent', findRanges('Pokémon', 'pokemon'), [{ start: 0, end: 7 }])
check(
  'matches through a decomposed accent',
  findRanges('Poke\u0301mon', 'pokemon'),
  [{ start: 0, end: 8 }]
)
check('finds a prefix', findRanges('Dragon Ball Z', 'dragon'), [{ start: 0, end: 6 }])
check(
  'finds every occurrence',
  findRanges('Dragon Ball Z', 'a'),
  [
    { start: 2, end: 3 },
    { start: 8, end: 9 }
  ]
)
check('does not overlap', findRanges('aaa', 'aa'), [{ start: 0, end: 2 }])
check('no match gives no range', findRanges('Sousou no Frieren', 'bleach'), [])
check('an empty query gives no range', findRanges('Sousou no Frieren', '   '), [])

console.log('\nround trip, the segments must rebuild the original:\n')
const TITLES = [
  'Sousou no Frieren',
  'Pokémon',
  'Poke\u0301mon',
  'Re:Zero kara Hajimeru Isekai Seikatsu',
  'HUNTER×HUNTER',
  'Boku no Hero Academia 2nd Season',
  'Dragon Ball DAIMA',
  'Steins;Gate',
  'Shingeki no Kyojin: The Final Season',
  '[]'
]
const QUERIES = ['', 'o', 'e', 'pokemon', 'zero', 'a', 'e\u0301', 'i', 'frieren', '2']
let roundTrips = 0
for (const title of TITLES) {
  for (const query of QUERIES) {
    const rebuilt = highlightSegments(title, query)
      .map((segment) => segment.text)
      .join('')
    roundTrips += 1
    if (rebuilt !== title) {
      failures += 1
      console.log(`  FAIL "${query}" in ${JSON.stringify(title)} rebuilt as ${JSON.stringify(rebuilt)}`)
    }
  }
}
console.log(`  ${roundTrips} combinations rebuilt exactly`)

console.log('\nhighlighting:\n')
check('marks only the matched part', highlightSegments('Sousou no Frieren', 'frieren'), [
  { text: 'Sousou no ', match: false },
  { text: 'Frieren', match: true }
])
check('marks nothing without a query', highlightSegments('Frieren', ''), [
  { text: 'Frieren', match: false }
])
check('marks the whole title when it all matches', highlightSegments('Frieren', 'frieren'), [
  { text: 'Frieren', match: true }
])
check(
  'marks several occurrences',
  highlightSegments('Dragon Ball', 'a'),
  [
    { text: 'Dr', match: false },
    { text: 'a', match: true },
    { text: 'gon B', match: false },
    { text: 'a', match: true },
    { text: 'll', match: false }
  ]
)
check(
  'includes the accent it folded over',
  highlightSegments('Pokémon', 'pokemon'),
  [{ text: 'Pokémon', match: true }]
)

console.log('\nrow matching:\n')
check('matches a title', includesQuery('Sousou no Frieren', 'frieren'), true)
check('ignores case and accents', includesQuery('Pokémon', 'POKEMON'), true)
check('rejects a miss', includesQuery('Sousou no Frieren', 'naruto'), false)
check('rejects an empty query', includesQuery('Sousou no Frieren', '  '), false)
check('tolerates a missing field', includesQuery(undefined, 'frieren'), false)
check('tolerates an empty field', includesQuery('', 'frieren'), false)

console.log(`\n${failures === 0 ? 'SEARCH MATCHING OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
