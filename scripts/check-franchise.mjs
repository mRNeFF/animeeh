/**
 * Focused check of the AniList franchise assembly, against the live API.
 *
 * src/main/anilist.ts has no Electron dependency, so it is bundled with esbuild
 * and imported directly. This is much faster to iterate on than driving the UI,
 * and it prints the raw decision data (which seasons were merged, how episodes
 * were renumbered).
 *
 * Usage: node scripts/check-franchise.mjs "sousou no frieren" "shingeki no kyojin"
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = mkdtempSync(join(tmpdir(), 'animeeh-anilist-'))
const outFile = join(outDir, 'anilist.mjs')

await build({
  entryPoints: [join(root, 'src/main/anilist.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: outFile,
  logLevel: 'error'
})

const mod = await import(pathToFileURL(outFile).href)

const queries = process.argv.slice(2)
if (queries.length === 0) {
  console.error('Usage: node scripts/check-franchise.mjs "<query>" ["<query>" ...]')
  process.exit(2)
}

let failures = 0

function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`)
}

for (const query of queries) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`SEARCH: "${query}"`)
  console.log('='.repeat(70))

  const results = await mod.searchAnime(query)

  console.log(`${results.length} grouped result(s):\n`)
  for (const r of results) {
    const seasons = r.seasons.map((s) => `S${s.season}:${s.anilistId}(${s.format},${s.year},${s.episodes})`)
    console.log(`  [${r.anilistId}] ${r.title}`)
    console.log(`      format=${r.format} year=${r.year} total=${r.episodes} studio=${r.studio}`)
    console.log(`      seasons(${r.seasons.length}) = ${seasons.join('  ')}`)
  }

  // Inspect the first TV-family result in depth.
  const target = results.find((r) => r.format === 'TV' || r.format === 'ONA' || r.format === 'TV_SHORT')
  if (!target) {
    console.log('\n  (no series-format result to expand)')
    continue
  }

  console.log(`\nASSEMBLING FRANCHISE for [${target.anilistId}] ${target.title} …`)
  const details = await mod.getAnimeDetails(target.anilistId)

  console.log(`  identity     : [${details.anilistId}] ${details.title}`)
  console.log(`  seasons      : ${details.seasons.length}`)
  for (const s of details.seasons) {
    const parts = (s.parts?.length ?? 1) > 1 ? `  [${s.parts.map((p) => p.title).join(' + ')}]` : ''
    console.log(
      `      S${s.season} [${s.anilistId}] ${s.title} | ${s.format} | ${s.year} | ${s.episodes ?? '?'} eps${parts}`
    )
  }

  const bySeason = new Map()
  for (const e of details.episodeTitles) {
    bySeason.set(e.season, (bySeason.get(e.season) ?? 0) + 1)
  }
  console.log(`  total episodes (sum of seasons): ${details.episodes}`)
  console.log(`  episode title entries: ${details.episodeTitles.length}`)
  for (const [season, count] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`      S${season}: ${count} titled episodes`)
  }

  const first = details.episodeTitles[0]
  const last = details.episodeTitles[details.episodeTitles.length - 1]
  if (first) console.log(`  first: #${first.number} S${first.season} "${first.title}"`)
  if (last) console.log(`  last : #${last.number} S${last.season} "${last.title}"`)

  // Season numbers must be contiguous starting at 1.
  const seasonNumbers = details.seasons.map((s) => s.season)
  const contiguous = seasonNumbers.every((n, i) => n === i + 1)
  console.log()
  check('seasons are contiguous from 1', contiguous, true)

  // No episode format from a filtered-out relation type should appear: an OVA
  // season would show up here.
  const hasNonSeries = details.seasons.some(
    (s) => s.format !== 'TV' && s.format !== 'TV_SHORT' && s.format !== 'ONA'
  )
  check('no non-series season (OVA/MOVIE/SPECIAL) merged in', hasNonSeries, false)

  // Episode numbers must strictly increase.
  let increasing = true
  for (let i = 1; i < details.episodeTitles.length; i += 1) {
    if (details.episodeTitles[i].number <= details.episodeTitles[i - 1].number) increasing = false
  }
  check('episode numbers strictly increase', increasing, true)

  // AniList repeats the franchise's episode list on every season (Attack on
  // Titan S2/S3 both return S1's episodes), so no season may end up with more
  // titles than it declares episodes.
  const oversized = details.seasons.filter((s) => {
    if (typeof s.episodes !== 'number' || s.episodes <= 0) return false
    const titled = details.episodeTitles.filter((e) => e.season === s.season).length
    return titled > s.episodes
  })
  console.log(
    oversized.length === 0
      ? '   OK   no season has more titles than episodes'
      : `   FAIL seasons with too many titles: ${oversized.map((s) => `S${s.season}`).join(', ')}`
  )
  if (oversized.length > 0) failures += 1

  // No two seasons may share an identical title list.
  const signatures = new Map()
  let duplicated = false
  for (const season of details.seasons) {
    const titles = details.episodeTitles
      .filter((e) => e.season === season.season)
      .map((e) => e.title)
      .join('|')
    if (titles === '') continue
    if (signatures.has(titles)) duplicated = true
    signatures.set(titles, season.season)
  }
  check('no two seasons share an identical title list', duplicated, false)

  // A season must never be reported as two rows just because it aired in two
  // cours ("2nd Season" + "2nd Season Part 2").
  const repeated = new Map()
  let splitSeason = false
  for (const season of details.seasons) {
    const base = season.title
      .toLowerCase()
      .replace(/\b\d+(?:st|nd|rd|th)\s+cour\b/g, '')
      .replace(/\b(?:part|cour|partie)\s+\d+\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const seen = repeated.get(base)
    if (seen !== undefined) {
      splitSeason = true
      console.log(`   note: S${seen} and S${season.season} share the base "${base}"`)
    }
    repeated.set(base, season.season)
  }
  check('no season split into separate rows', splitSeason, false)

  // The parts of a merged season must add up to its episode count.
  let partsMismatch = null
  for (const season of details.seasons) {
    if ((season.parts?.length ?? 1) < 2) continue
    const partsTotal = season.parts
      .map((p) => p.episodes)
      .filter((n) => typeof n === 'number')
      .reduce((sum, n) => sum + n, 0)
    if (typeof season.episodes === 'number' && partsTotal !== season.episodes) {
      partsMismatch = `S${season.season}: parts=${partsTotal} total=${season.episodes}`
    }
  }
  check('merged season totals equal the sum of its parts', partsMismatch, null)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
