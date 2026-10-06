/**
 * Checks that the two search kinds return disjoint sets.
 *
 * Films and OVAs must come back from the film search, and never from the series
 * search. The split matters because a Re:Zero OVA sitting in the series search
 * would be indistinguishable from a season.
 *
 * Usage: node scripts/check-search-kinds.mjs "re:zero" "chainsaw man"
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(mkdtempSync(join(tmpdir(), 'kinds-')), 'a.mjs')

await build({
  entryPoints: [join(root, 'src/main/anilist.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: out,
  logLevel: 'error'
})
const { searchAnime } = await import(pathToFileURL(out).href)

const FILM_LIKE = new Set(['MOVIE', 'OVA'])
const queries = process.argv.slice(2)
if (queries.length === 0) {
  console.error('Usage: node scripts/check-search-kinds.mjs "<query>" [...]')
  process.exit(2)
}

let failures = 0

for (const query of queries) {
  console.log(`\n${'='.repeat(78)}\n"${query}"\n${'='.repeat(78)}`)

  const films = await searchAnime(query, 'film')
  await new Promise((r) => setTimeout(r, 3000))
  const series = await searchAnime(query, 'series')

  console.log(`FILM SEARCH -> ${films.length}`)
  for (const f of films.slice(0, 10)) {
    console.log(`   ${String(f.format).padEnd(6)} ${f.title.slice(0, 46).padEnd(48)} id=${f.anilistId}`)
  }
  console.log(`SERIES SEARCH -> ${series.length}`)
  for (const s of series.slice(0, 10)) {
    console.log(
      `   ${String(s.format).padEnd(6)} ${s.title.slice(0, 46).padEnd(48)} seasons=${s.seasons.length}`
    )
  }

  const leakedIntoSeries = series.filter((s) => FILM_LIKE.has(s.format ?? ''))
  const leakedIntoFilms = films.filter((f) => !FILM_LIKE.has(f.format ?? ''))
  const seriesGrouped = series.filter((s) => s.seasons.length > 1)

  console.log()
  const check = (label, actual, expected) => {
    const ok = String(actual) === String(expected)
    if (!ok) failures += 1
    console.log(`   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`)
  }
  check('no film or OVA in the series search', leakedIntoSeries.length, 0)
  check('nothing but films and OVAs in the film search', leakedIntoFilms.length, 0)
  if (seriesGrouped.length > 0) {
    console.log(
      `   note: ${seriesGrouped.length} series result(s) have several seasons, e.g. ` +
        `${seriesGrouped[0].title} with ${seriesGrouped[0].seasons.length}`
    )
  }

  await new Promise((r) => setTimeout(r, 3000))
}

console.log(`\n${failures === 0 ? 'SEARCH KINDS OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
