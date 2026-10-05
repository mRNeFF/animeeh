/**
 * Runs the schedule builder against a real ANIMEEH data file, so the calendar
 * can be checked before any UI exists.
 *
 * Usage: node scripts/check-schedule.mjs [pathToDataFile]
 */
import { build } from 'esbuild'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataFile = process.argv[2] ?? join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')

if (!existsSync(dataFile)) {
  console.error(`Data file not found: ${dataFile}`)
  process.exit(2)
}

const out = join(mkdtempSync(join(tmpdir(), 'sched-')), 's.mjs')
await build({
  entryPoints: [join(root, 'src/main/schedule.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: out,
  logLevel: 'error'
})

const { buildSchedule } = await import(pathToFileURL(out).href)

const data = JSON.parse(readFileSync(dataFile, 'utf-8'))
const entries = []
const seen = new Set()
for (const a of data.anime ?? []) {
  const id = a.source?.anilistId ?? a.seasons?.[0]?.anilistId
  if (typeof id !== 'number' || seen.has(id)) continue
  seen.add(id)
  const seasonIds = []
  for (const s of a.seasons ?? []) {
    if (typeof s.anilistId === 'number') seasonIds.push(s.anilistId)
    for (const p of s.parts ?? []) if (typeof p.anilistId === 'number') seasonIds.push(p.anilistId)
  }
  entries.push({ anilistId: id, title: a.title ?? '', status: a.status ?? 'completed', seasonIds })
}

console.log(`library entries sent : ${entries.length}`)
console.log(`now                  : ${new Date().toISOString()}\n`)

const started = Date.now()
const result = await buildSchedule(entries)
console.log(`fetched in ${((Date.now() - started) / 1000).toFixed(1)}s\n`)

const stamp = (s) =>
  new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ')

console.log(`=== EPISODES (${result.episodes.length}) ===`)
for (const e of result.episodes.slice(0, 20)) {
  console.log(
    `  ${stamp(e.airingAt)}  ep ${String(e.episode).padStart(4)}  ${e.title.slice(0, 46)}`
  )
}

console.log(`\n=== UPCOMING SEASONS (${result.seasons.length}) ===`)
for (const s of result.seasons.slice(0, 20)) {
  console.log(
    `  ${String(s.startDate ?? 'unknown').padEnd(11)} ${s.precision.padEnd(5)} ` +
      `${s.title.slice(0, 40).padEnd(42)} <- sequel of ${s.fromTitle.slice(0, 30)}`
  )
}

console.log(`\n=== DISCOVERY (${result.discovery.length}) ===`)
for (const d of result.discovery.slice(0, 10)) {
  console.log(`  ${stamp(d.airingAt)}  ep ${String(d.episode).padStart(3)}  ${d.title.slice(0, 46)}`)
}

console.log(`\ncounts: ${JSON.stringify(result.counts)}`)

/* Sanity checks ---------------------------------------------------------- */

let failures = 0
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures += 1
  console.log(`   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`)
}

console.log('\nCHECKS:')
const now = Math.floor(Date.now() / 1000)
const horizon = now + result.windowDays * 86400
check(
  'every episode is in the future',
  result.episodes.every((e) => e.airingAt >= now),
  true
)
check(
  'every episode is inside the window',
  result.episodes.every((e) => e.airingAt <= horizon),
  true
)
check(
  'episodes are sorted by date',
  result.episodes.every((e, i) => i === 0 || e.airingAt >= result.episodes[i - 1].airingAt),
  true
)
check(
  'no duplicate episode (show + number)',
  new Set(result.episodes.map((e) => `${e.anilistId}:${e.episode}`)).size,
  result.episodes.length
)
check(
  'seasons are continuations, never something in the library',
  result.seasons.every((s) => !entries.some((e) => e.anilistId === s.seasonId)),
  true
)
check(
  'no duplicate upcoming season',
  new Set(result.seasons.map((s) => s.seasonId)).size,
  result.seasons.length
)
check('discovery excludes the library', result.discovery.every((d) => !d.inLibrary), true)

console.log(`\n${failures === 0 ? 'SCHEDULE OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
