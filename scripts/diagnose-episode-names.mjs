/**
 * Runs the real episode-name lookup against every anime in an ANIMEEH data file
 * and reports what succeeds, what fails, and whether the numbering lines up.
 *
 * This is the diagnostic behind "some anime keep failing" and "the names are
 * still affiliated to the wrong episode". It uses the same bundled module the
 * app uses, so it cannot drift from production behaviour.
 *
 * Usage: node scripts/diagnose-episode-names.mjs [pathToDataFile]
 */
import { build } from 'esbuild'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const dataFile =
  process.argv[2] ??
  join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')

if (!existsSync(dataFile)) {
  console.error(`Data file not found: ${dataFile}`)
  process.exit(2)
}

/* Bundle the real modules so this matches the app exactly. */
const outDir = mkdtempSync(join(tmpdir(), 'animeeh-diag-'))
const episodesOut = join(outDir, 'episodes.mjs')
const bulkOut = join(outDir, 'bulk.mjs')

await build({
  entryPoints: [join(root, 'src/main/episodes.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: episodesOut,
  logLevel: 'error'
})

// Stub the renderer's window bridge so bulkEpisodes can be imported directly.
writeFileSync(
  join(outDir, 'stub.ts'),
  `export const seasonPartsOf = ${JSON.stringify(null)}`
)
await build({
  entryPoints: [join(root, 'src/renderer/src/bulkEpisodes.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: bulkOut,
  logLevel: 'error',
  external: ['electron']
})

const { loadEpisodeNames } = await import(pathToFileURL(episodesOut).href)
const { seasonPartsOf } = await import(pathToFileURL(bulkOut).href)

const data = JSON.parse(readFileSync(dataFile, 'utf-8'))
const anime = data.anime ?? []

console.log(`data file : ${dataFile}`)
console.log(`anime     : ${anime.length}\n`)

const rows = []
let failures = 0

for (const [index, item] of anime.entries()) {
  const parts = seasonPartsOf(item)
  const expectedSeasons = (item.seasons ?? []).length || 1
  const expectedTotal =
    item.seasons?.reduce((sum, s) => sum + (s.episodes ?? 0), 0) || item.totalEpisodes || 0

  process.stdout.write(
    `[${String(index + 1).padStart(2)}/${anime.length}] ${(item.title ?? '?').slice(0, 40).padEnd(42)} `
  )

  if (parts.length === 0) {
    console.log('NO REFERENCE')
    rows.push({ title: item.title, status: 'no-reference' })
    failures += 1
    continue
  }

  try {
    const result = await loadEpisodeNames(parts)
    const numbers = result.episodes.map((e) => e.number)
    const highest = numbers.length > 0 ? Math.max(...numbers) : 0

    // Where each season should start, from the declared episode counts.
    const starts = []
    let cursor = 1
    for (const [i, seasonParts] of parts.entries()) {
      starts.push({ season: i + 1, from: cursor })
      const declared = (item.seasons ?? [])[i]?.episodes ?? 0
      cursor += declared
    }

    const wrongSeason = result.episodes.filter((e) => {
      const span = starts.find((s, i) =>
        i === starts.length - 1 ? e.number >= s.from : e.number >= s.from && e.number < starts[i + 1].from
      )
      return span !== undefined && span.season !== e.season
    }).length

    rows.push({
      title: item.title,
      status: 'ok',
      source: result.source,
      names: result.episodes.length,
      highest,
      expectedTotal,
      seasons: parts.length,
      expectedSeasons,
      missing: result.missingSeasons,
      wrongSeason
    })

    console.log(
      `${String(result.episodes.length).padStart(3)} names, highest #${highest}/${expectedTotal}` +
        (result.missingSeasons.length > 0 ? ` missing S${result.missingSeasons.join(',')}` : '') +
        (wrongSeason > 0 ? `  WRONG-SEASON:${wrongSeason}` : '')
    )
  } catch (err) {
    console.log(`FAILED: ${err.message}`)
    rows.push({ title: item.title, status: 'failed', error: err.message })
    failures += 1
  }

  await new Promise((r) => setTimeout(r, 200))
}

/* ------------------------------------------------------------------ */

console.log(`\n${'='.repeat(78)}`)
const ok = rows.filter((r) => r.status === 'ok')
const failed = rows.filter((r) => r.status === 'failed')
const noRef = rows.filter((r) => r.status === 'no-reference')

console.log(`succeeded      : ${ok.length}`)
console.log(`failed         : ${failed.length}`)
console.log(`no reference   : ${noRef.length}`)
console.log(`total names    : ${ok.reduce((n, r) => n + (r.names ?? 0), 0)}`)

const short = ok.filter((r) => r.expectedTotal > 0 && r.highest < r.expectedTotal)
const misplaced = ok.filter((r) => (r.wrongSeason ?? 0) > 0)

if (failed.length > 0) {
  console.log('\nfailed:')
  for (const r of failed) console.log(`  ${r.title}\n     ${r.error}`)
}

if (short.length > 0) {
  console.log('\nfewer episodes than declared (missing names, not misplacement):')
  for (const r of short) console.log(`  ${String(r.highest).padStart(3)}/${r.expectedTotal}  ${r.title}`)
}

if (misplaced.length > 0) {
  console.log('\nWRONG SEASON LABEL:')
  for (const r of misplaced) console.log(`  ${r.wrongSeason} episodes  ${r.title}`)
}

// Per-season coverage for the biggest gaps.
console.log('\nper-anime coverage (named / expected):')
for (const r of ok.sort((a, b) => (a.names ?? 0) - (b.names ?? 0)).slice(0, 12)) {
  const pct = r.expectedTotal > 0 ? Math.round(((r.names ?? 0) / r.expectedTotal) * 100) : 0
  console.log(`  ${String(pct).padStart(3)}%  ${String(r.names).padStart(3)}/${String(r.expectedTotal).padEnd(3)}  ${r.title}`)
}
