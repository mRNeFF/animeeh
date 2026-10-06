/**
 * Assembles each Dragon Ball series on its own, to see whether any of them still
 * swallows another.
 *
 * The earlier check only covered Dragon Ball (223). Dragon Ball Z, Super, GT and
 * DAIMA each have their own sequel links, so each one has to be assembled and
 * inspected separately — a link that is harmless from 223 can still merge two
 * series when starting from 813.
 *
 * Usage: node scripts/diagnose-dragonball-each.mjs
 */
import { build } from 'esbuild'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(mkdtempSync(join(tmpdir(), 'dbe-')), 'a.mjs')

await build({
  entryPoints: [join(root, 'src/main/anilist.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: out,
  logLevel: 'error'
})
const { getAnimeDetails } = await import(pathToFileURL(out).href)

/** The five Dragon Ball series, and the recut. */
const SERIES = [
  { id: 223, label: 'Dragon Ball' },
  { id: 813, label: 'Dragon Ball Z' },
  { id: 225, label: 'Dragon Ball GT' },
  { id: 21175, label: 'Dragon Ball Super' },
  { id: 170083, label: 'Dragon Ball DAIMA' },
  { id: 6033, label: 'Dragon Ball Kai' }
]

/** What the series should stand alone with, if the split works. */
const EXPECTED_ONE = new Set(['Dragon Ball', 'Dragon Ball Z', 'Dragon Ball GT', 'Dragon Ball Super', 'Dragon Ball DAIMA'])

let problems = 0

for (const series of SERIES) {
  console.log(`\n${'='.repeat(88)}`)
  console.log(`${series.label}  —  assembling [${series.id}]`)
  console.log('='.repeat(88))

  let details
  try {
    details = await getAnimeDetails(series.id)
  } catch (err) {
    console.log(`  FAILED: ${err.message}`)
    problems += 1
    continue
  }

  console.log(`  identity : [${details.anilistId}] ${details.title}`)
  console.log(`  seasons  : ${details.seasons.length}, total ${details.episodes} episodes`)
  for (const s of details.seasons) {
    console.log(`     S${String(s.season).padStart(2)} [${String(s.anilistId).padEnd(7)}] ${s.title.slice(0, 44).padEnd(46)} ${s.format} ${s.year}`)
  }

  for (const s of details.seasons) {
    const other = EXPECTED_ONE.has(s.title) && s.title !== series.label
    if (other) {
      console.log(`     ^^ MERGED: "${s.title}" is a separate series`)
      problems += 1
    }
  }

  await new Promise((r) => setTimeout(r, 6000))
}

/* Also check the library, in case a merged Dragon Ball entry is already stored. */
const dataFile = join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')
console.log(`\n${'='.repeat(88)}`)
console.log('YOUR LIBRARY')
console.log('='.repeat(88))

if (!existsSync(dataFile)) {
  console.log('  no data file')
} else {
  const data = JSON.parse(readFileSync(dataFile, 'utf-8'))
  const balls = (data.anime ?? []).filter((a) => /dragon\s*ball/i.test(a.title ?? ''))
  if (balls.length === 0) {
    console.log('  no Dragon Ball entry stored')
  }
  for (const a of balls) {
    console.log(`  [${a.source?.anilistId}] ${a.title}  format=${a.format}`)
    console.log(`     seasons=${(a.seasons ?? []).length}  episodes=${(a.episodes ?? []).length}`)
    for (const s of a.seasons ?? []) {
      console.log(`        S${s.season} (${s.title}) -> ${s.anilistId}`)
    }
  }
}

console.log(`\n${problems === 0 ? 'EACH SERIES STANDS ALONE' : `${problems} MERGE PROBLEM(S)`}`)
