/**
 * Two checks before changing anything.
 *
 * 1. Does a "dragon ball" search, and the franchise assembly behind a selection,
 *    collapse Dragon Ball, Z, GT, Super and Daima into one entry? They are
 *    linked by SEQUEL on AniList, so the chain walk is expected to merge them,
 *    even though they are distinct series rather than seasons of one.
 *
 * 2. Which of the library's shows have OVA or SPECIAL entries on AniList, and
 *    what are they called? OVAs are neither series nor films, so where they
 *    belong is a decision rather than an obvious answer.
 *
 * Usage: node scripts/diagnose-dragonball-ova.mjs
 */
import { build } from 'esbuild'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ANILIST = 'https://graphql.anilist.co'
const dataFile = join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')

const out = join(mkdtempSync(join(tmpdir(), 'db-')), 'a.mjs')
await build({
  entryPoints: [join(root, 'src/main/anilist.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: out,
  logLevel: 'error'
})
const { searchAnime, getAnimeDetails } = await import(pathToFileURL(out).href)

async function gql(query) {
  const response = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })
  const json = await response.json()
  if (json.errors) throw new Error(json.errors[0].message)
  return json.data
}

/* ---------------------------------------------------------------- */
/* 1. Dragon Ball                                                   */
/* ---------------------------------------------------------------- */

console.log('='.repeat(90))
console.log('1. SEARCH "dragon ball" — does it group the five series?')
console.log('='.repeat(90))

const results = await searchAnime('dragon ball', 'series')
console.log(`${results.length} grouped result(s):\n`)
for (const r of results.slice(0, 12)) {
  console.log(
    `  [${r.anilistId}] ${r.title.slice(0, 40).padEnd(42)} ${String(r.format).padEnd(6)} ` +
      `${r.year ?? '?'}  seasons=${r.seasons.length}  eps=${r.episodes ?? '?'}`
  )
  if (r.seasons.length > 1) {
    for (const s of r.seasons) {
      console.log(`        S${s.season} [${s.anilistId}] ${s.title.slice(0, 50)} (${s.format}, ${s.year})`)
    }
  }
}

console.log('\n--- the franchise behind Dragon Ball (id 223) ---')
const timeStart = Date.now()
const details = await getAnimeDetails(223)
console.log(`assembled in ${Date.now() - timeStart} ms`)
console.log(`identity : [${details.anilistId}] ${details.title}`)
console.log(`seasons  : ${details.seasons.length}, total ${details.episodes} episodes`)
for (const s of details.seasons) {
  console.log(`   S${String(s.season).padStart(2)} [${s.anilistId}] ${s.title.slice(0, 46).padEnd(48)} ${s.format} ${s.year}`)
}

/* ---------------------------------------------------------------- */
/* 2. OVAs for the library                                          */
/* ---------------------------------------------------------------- */

console.log(`\n${'='.repeat(90)}`)
console.log('2. OVA and SPECIAL entries for the shows in the library')
console.log('='.repeat(90))

if (!existsSync(dataFile)) {
  console.log('no data file')
  process.exit(0)
}

const data = JSON.parse(readFileSync(dataFile, 'utf-8'))
const entries = []
for (const a of data.anime ?? []) {
  const id = a.source?.anilistId ?? a.seasons?.[0]?.anilistId
  if (typeof id !== 'number') continue
  entries.push({ id, title: a.title })
}

/** Everything that is not TV, ONA or a film, reachable from one id. */
const FIELDS = `
  id title { romaji } format status episodes startDate { year }
`

const found = []
for (let i = 0; i < entries.length; i += 8) {
  const batch = entries.slice(i, i + 8)
  const aliases = batch
    .map(
      (e, j) =>
        `a${j}: Media(id: ${e.id}) { ${FIELDS} relations { edges { relationType node { ${FIELDS} } } } }`
    )
    .join('\n')

  let data2
  try {
    data2 = await gql(`query {\n${aliases}\n}`)
  } catch (err) {
    console.log(`  batch failed: ${err.message}`)
    continue
  }

  batch.forEach((entry, j) => {
    const media = data2[`a${j}`]
    if (!media) return
    const extras = []
    for (const edge of media.relations?.edges ?? []) {
      const n = edge.node
      if (!n) continue
      if (n.format !== 'OVA' && n.format !== 'SPECIAL' && n.format !== 'ONA') continue
      // Keep only entries tied to this show, not unrelated spin-offs.
      if (!['SIDE_STORY', 'PARENT', 'SEQUEL', 'PREQUEL', 'SPIN_OFF', 'ALTERNATIVE', 'SUMMARY'].includes(edge.relationType)) continue
      extras.push({ relation: edge.relationType, ...n })
    }
    if (extras.length > 0) found.push({ show: entry.title, extras })
  })

  await new Promise((r) => setTimeout(r, 2200))
}

let total = 0
for (const f of found) {
  console.log(`\n  ${f.show}`)
  for (const e of f.extras) {
    total += 1
    console.log(
      `     ${String(e.format).padEnd(8)} [${String(e.id).padEnd(7)}] ${e.title.romaji.slice(0, 46).padEnd(48)}` +
        ` ${e.episodes ?? '?'} eps  ${e.startDate?.year ?? '?'}  ${e.relation}`
    )
  }
}
console.log(`\n  ${total} OVA/SPECIAL/ONA entries across ${found.length} shows`)
