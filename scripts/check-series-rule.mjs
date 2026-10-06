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
  ['Dragon Ball Z', 'Dragon Ball Z Kai', true]
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
process.exit(failures === 0 ? 0 : 1)
