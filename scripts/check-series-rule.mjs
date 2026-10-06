/**
 * Tests the "different series or continuation?" rule against every real pair.
 *
 * Asking AniList for each franchise costs a request per hop, and the rate limit
 * is reached after a handful, which makes iterating on this rule painful. The
 * pairs below were collected once and are checked offline instead, so the rule
 * can be corrected quickly and verified exhaustively.
 *
 * Usage: node scripts/check-series-rule.mjs
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(mkdtempSync(join(tmpdir(), 'rule-')), 'a.mjs')

// The rule lives in anilist.ts; it is exported for this test.
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

if (typeof mod.looksLikeDifferentSeries !== 'function') {
  console.error('looksLikeDifferentSeries is not exported; add it to the module exports.')
  process.exit(2)
}
const looksLikeDifferentSeries = mod.looksLikeDifferentSeries

if (typeof mod.shouldChainLink !== 'function') {
  console.error('shouldChainLink is not exported; add it to the module exports.')
  process.exit(2)
}
const shouldChainLink = mod.shouldChainLink

/**
 * Every consecutive season pair found in a real library, plus the Dragon Ball
 * cases. `split` true means the rule must treat them as two series.
 */
const CASES = [
  // Continuations: must stay merged.
  ['Shingeki no Kyojin', 'Shingeki no Kyojin Season 2', false],
  ['Shingeki no Kyojin Season 3', 'Shingeki no Kyojin: The Final Season', false],
  ['Sousou no Frieren', 'Sousou no Frieren 2nd Season', false],
  ['Sousou no Frieren 2nd Season', 'Sousou no Frieren 3rd Season', false],
  ['Re:Zero kara Hajimeru Isekai Seikatsu', 'Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season', false],
  ['Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e', 'Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 2nd Season', false],
  ['Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 3rd Season', 'Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 4th Season 2-nensei-hen Ichi Gakki', false],
  ['Jigokuraku', 'Jigokuraku 2nd Season', false],
  ['VINLAND SAGA', 'VINLAND SAGA SEASON 2', false],
  ['Jujutsu Kaisen', 'Jujutsu Kaisen 2nd Season', false],
  ['Jujutsu Kaisen 2nd Season', 'Jujutsu Kaisen: Shimetsu Kaiyuu - Zenpen', false],
  ['Mushoku Tensei: Isekai Ittara Honki Dasu', 'Mushoku Tensei II: Isekai Ittara Honki Dasu', false],
  ['Mushoku Tensei II: Isekai Ittara Honki Dasu', 'Mushoku Tensei III: Isekai Ittara Honki Dasu', false],
  // Numbers, not words.
  ['Boku no Hero Academia', 'Boku no Hero Academia 2', false],
  ['Boku no Hero Academia 2', 'Boku no Hero Academia 3', false],
  ['Boku no Hero Academia 7', 'Boku no Hero Academia FINAL SEASON', false],
  ['Yakusoku no Neverland', 'Yakusoku no Neverland 2', false],
  ['Steins;Gate', 'Steins;Gate 0', false],
  // Subtitle after a colon.
  ['Tokyo Revengers', 'Tokyo Revengers: Seiya Kessen-hen', false],
  ['Tokyo Revengers: Seiya Kessen-hen', 'Tokyo Revengers: Tenjiku-hen', false],
  ['Ore dake Level Up na Ken', 'Ore dake Level Up na Ken: Season 2 - Arise from the Shadow', false],
  ['Kaguya-sama wa Kokurasetai: Tensaitachi no Renai Zunousen', 'Kaguya-sama wa Kokurasetai: Ultra Romantic', false],
  ['Kaguya-sama wa Kokurasetai: Ultra Romantic', 'Kaguya-sama wa Kokurasetai: First Kiss wa Owaranai', false],
  // Symbols.
  ['Tokyo Ghoul', 'Tokyo Ghoul √A', false],
  ['Tokyo Ghoul √A', 'Tokyo Ghoul:re', false],
  ['Tokyo Ghoul:re', 'Tokyo Ghoul:re 2', false],
  ['Chainsaw Man', 'Chainsaw Man: Reze-hen', false],
  // Roman numerals continue a series.
  ['Overlord', 'Overlord II', false],
  ['Overlord III', 'Overlord IV', false],

  // Different series: must split.
  ['Dragon Ball', 'Dragon Ball Z', true],
  ['Dragon Ball Z', 'Dragon Ball GT', true],
  ['Dragon Ball Z', 'Dragon Ball Super', true],
  ['Dragon Ball Super', 'Dragon Ball DAIMA', true],
  ['Dragon Ball Z', 'Dragon Ball Z Kai', true],
  ['Dragon Ball GT', 'Dragon Ball Super', true],
  ['Dragon Ball', 'Dragon Ball DAIMA', true],
  // The over-merges the first rule let through, which cost the Dragon Ball split.
  ['Dragon Ball Z', 'Dragon Ball Kai (2014)', true],
  ['Dragon Ball Kai (2014)', 'Dragon Ball Super', true],
  ['Dragon Ball Kai', 'Dragon Ball Super', true],
  ['Dragon Ball Z', 'Dragon Ball GT', true],
  // Other franchises that share a name but are separate works.
  ['Bleach', 'Bleach: Sennen Kessen-hen', false],
  ['Dr. STONE', 'Dr. STONE: Stone Wars', false],
  ['HUNTER×HUNTER', 'HUNTER×HUNTER OVA', true],

  // Naruto and Naruto: Shippuden are two series, but the title rule cannot see
  // it: "Shippuden" reads as a subtitle, exactly as "Sennen Kessen-hen" does for
  // Bleach, and Bleach's final arc genuinely is a subtitle. Titles alone cannot
  // tell the two cases apart, so Naruto is separated by FRANCHISE_SPLITS.
  //
  // The asymmetry below is the whole problem in two lines: with a colon the rule
  // reads a subtitle and merges, without one it reads a distinct name and splits.
  // AniList writes "NARUTO: Shippuuden", so the merging branch is the one that
  // fired in practice.
  ['Naruto', 'Naruto: Shippuden', false],
  ['Naruto', 'Naruto Shippuden', true]
]

let failures = 0
console.log('continuations and distinct series, by the rule:\n')

for (const [a, b, expected] of CASES) {
  const actual = looksLikeDifferentSeries(a, b)
  const ok = actual === expected
  if (!ok) failures += 1
  const label = expected ? 'SPLIT' : 'MERGE'
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${label}  ${a.slice(0, 34).padEnd(36)} + ${b.slice(0, 40)}`
  )
  if (!ok) console.log(`         got ${actual ? 'SPLIT' : 'MERGE'}, expected ${label}`)
}

console.log(`\n${failures === 0 ? `ALL ${CASES.length} CASES PASS` : `${failures} FAILURE(S)`}`)

/* ---------------------------------------------------------------- */
/* The curated decisions, which override the title rule              */
/* ---------------------------------------------------------------- */

/**
 * A pair the title rule cannot settle, checked through the function the app
 * actually calls.
 *
 * The cases above assert what the TITLE RULE does, and for these two pairs its
 * answer is "merge" — which is wrong for Naruto and right for Steins;Gate. What
 * matters is the final decision, so this checks that too.
 */
const CURATED = [
  // AniList ids, so the split is exercised the way the app exercises it.
  { from: { id: 20, title: 'NARUTO' }, to: { id: 1735, title: 'NARUTO: Shippuuden' }, link: false, why: 'two series' },
  { from: { id: 1735, title: 'NARUTO: Shippuuden' }, to: { id: 20, title: 'NARUTO' }, link: false, why: 'two series, other direction' },
  { from: { id: 223, title: 'Dragon Ball' }, to: { id: 813, title: 'Dragon Ball Z' }, link: false, why: 'two series' },
  { from: { id: 6033, title: 'Dragon Ball Kai' }, to: { id: 20635, title: 'Dragon Ball Kai (2014)' }, link: true, why: 'one entry, a recut' },
  { from: { id: 9253, title: 'Steins;Gate' }, to: { id: 21127, title: 'Steins;Gate 0' }, link: true, why: 'one entry by curation' }
]

console.log('\ncurated decisions, through shouldChainLink:\n')
let curatedFailures = 0
for (const c of CURATED) {
  const actual = shouldChainLink(c.from, c.to)
  const ok = actual === c.link
  if (!ok) curatedFailures += 1
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${c.link ? 'LINK' : 'SPLIT'}  ` +
      `${c.from.title.slice(0, 22).padEnd(24)} / ${c.to.title.slice(0, 24).padEnd(26)} ${c.why}`
  )
}
console.log(
  `\n${curatedFailures === 0 ? `ALL ${CURATED.length} CURATED DECISIONS PASS` : `${curatedFailures} CURATED FAILURE(S)`}`
)

const total = failures + curatedFailures
process.exit(total === 0 ? 0 : 1)
