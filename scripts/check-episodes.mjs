/**
 * Measures episode-title coverage for the imported library.
 *
 * AniList has no episode list of its own; `streamingEpisodes` mirrors the
 * streaming service and only covered 73% of this library. Kitsu keeps a real
 * episode list per anime and exposes an AniList id mapping, so it is the better
 * source. This checks what Kitsu can actually deliver, with a disk cache so
 * re-runs are instant.
 *
 * Usage: node scripts/check-episodes.mjs [--limit N]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const seed = JSON.parse(readFileSync(join(root, 'src/renderer/src/data/seed-anime.json'), 'utf-8'))

const limitArg = process.argv.indexOf('--limit')
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : seed.anime.length

const CACHE_PATH = join(root, '.kitsu-cache.json')
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) : {}
const saveCache = () => writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf-8')

const KITSU = 'https://kitsu.io/api/edge'
let lastRequest = 0

async function kitsu(path) {
  if (cache[path]) return cache[path]

  const wait = 900 - (Date.now() - lastRequest)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequest = Date.now()

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${KITSU}${path}`, {
      headers: { Accept: 'application/vnd.api+json' },
      signal: AbortSignal.timeout(20000)
    })
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 5000 * attempt))
      continue
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const json = await response.json()
    cache[path] = json
    saveCache()
    return json
  }
  throw new Error('rate limited')
}

/** AniList id -> Kitsu anime id, via Kitsu's own mapping table. */
async function kitsuId(anilistId) {
  const json = await kitsu(
    `/mappings?filter[externalSite]=anilist/anime&filter[externalId]=${anilistId}&include=item`
  )
  const item = json.data?.[0]?.relationships?.item?.data
  return item?.type === 'anime' ? item.id : null
}

/** All episodes of one Kitsu anime, following pagination. */
async function episodes(kitsuAnimeId) {
  const first = await kitsu(`/anime/${kitsuAnimeId}/episodes?page[limit]=20&page[offset]=0`)
  const total = first.meta?.count ?? first.data?.length ?? 0
  const items = [...(first.data ?? [])]

  for (let offset = 20; offset < total && offset < 400; offset += 20) {
    const page = await kitsu(`/anime/${kitsuAnimeId}/episodes?page[limit]=20&page[offset]=${offset}`)
    items.push(...(page.data ?? []))
  }
  return items
}

/* ------------------------------------------------------------------ */

const stats = []
const subset = seed.anime.slice(0, limit)

for (const [i, anime] of subset.entries()) {
  process.stdout.write(`[${i + 1}/${subset.length}] ${anime.sheetLabel.padEnd(30)} `)
  try {
    const id = await kitsuId(anime.anilistId)
    if (!id) {
      stats.push({ label: anime.sheetLabel, ok: false, reason: 'no kitsu mapping', titles: 0, total: 0 })
      console.log('NO MAPPING')
      continue
    }
    const eps = await episodes(id)
    const named = eps.filter((e) => e.attributes?.canonicalTitle)
    stats.push({
      label: anime.sheetLabel,
      ok: true,
      kitsuId: id,
      titles: named.length,
      total: eps.length,
      sample: named[0]?.attributes?.canonicalTitle ?? null,
      list: named.map((e) => ({
        number: e.attributes?.number,
        season: e.attributes?.seasonNumber,
        title: e.attributes?.canonicalTitle
      }))
    })
    console.log(`${named.length}/${eps.length} titles${named[0] ? ` — "${named[0].attributes.canonicalTitle}"` : ''}`)
  } catch (err) {
    stats.push({ label: anime.sheetLabel, ok: false, reason: err.message, titles: 0, total: 0 })
    console.log(`FAILED (${err.message})`)
  }
}

/* ------------------------------------------------------------------ */

const mapped = stats.filter((s) => s.ok)
const withTitles = mapped.filter((s) => s.titles > 0)

console.log(`\n${'='.repeat(72)}`)
console.log(`checked            : ${stats.length}`)
console.log(`kitsu mapping found: ${mapped.length} (${Math.round((mapped.length / stats.length) * 100)}%)`)
console.log(`with episode names : ${withTitles.length} (${Math.round((withTitles.length / stats.length) * 100)}%)`)
console.log(`total named episodes: ${withTitles.reduce((n, s) => n + s.titles, 0)}`)

const missing = stats.filter((s) => !s.ok || s.titles === 0)
if (missing.length > 0) {
  console.log('\nno episode names:')
  for (const s of missing) console.log(`  ${s.label.padEnd(32)} ${s.reason ?? 'zero titles'}`)
}

console.log('\nsample:')
for (const s of withTitles.slice(0, 6)) {
  console.log(`  ${s.label.padEnd(24)} ${s.titles} eps — "${s.sample}"`)
}

writeFileSync(
  join(root, 'kitsu-report.json'),
  JSON.stringify({ stats, generatedAt: new Date().toISOString() }, null, 2),
  'utf-8'
)
console.log('\nwrote kitsu-report.json')
