/**
 * Turns the spreadsheet at N.xlsx into ANIMEEH seed data.
 *
 * The sheet is a matrix: rows are anime, columns are the seven criteria, scored
 * out of 20. The app scores out of 100, so every value is multiplied by 5.
 *
 * Titles in the sheet are abbreviations ("SNK", "COTE", "MHA"), so each row is
 * resolved against AniList to get a real title, year, studio, cover image and
 * genres in one request per anime. AniList rate-limits to ~30 requests/minute,
 * so requests are paced and 429s are retried with backoff.
 *
 * Writes src/renderer/src/data/seed-anime.json plus a report of what could not
 * be resolved.
 *
 * Usage: node scripts/build-seed.mjs "C:/Users/AXEL/Desktop/N.xlsx"
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readSheet } from './xlsx.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const xlsxPath = process.argv[2] ?? 'C:/Users/AXEL/Desktop/N.xlsx'

if (!existsSync(xlsxPath)) {
  console.error(`Spreadsheet not found: ${xlsxPath}`)
  process.exit(2)
}

/* ------------------------------------------------------------------ */
/* Spreadsheet layout                                                  */
/* ------------------------------------------------------------------ */

/** 0-based column indices, read from the header row of the sheet. */
const COLUMNS = {
  title: 4,
  characters: 5,
  story: 6,
  animation: 7,
  ost: 8,
  opening: 9,
  originality: 10,
  keyFactor: 11,
  total: 12,
  favouriteCharacter: 14,
  favouriteOst: 15,
  favouriteOpening: 16,
  favouriteEpisode: 17
}

/** The sheet scores out of 20; the app scores out of 100. */
const SHEET_MAX = 20
const APP_MAX = 100
const SCALE = APP_MAX / SHEET_MAX

/**
 * Sheet label -> AniList search term, for the abbreviations and French titles
 * that a plain search would not resolve.
 */
const ALIASES = {
  'RE:ZERO': 'Re:Zero kara Hajimeru Isekai Seikatsu',
  SNK: 'Shingeki no Kyojin',
  'STEINS:GATE': 'Steins;Gate',
  'MUSHOKU TENSEI': 'Mushoku Tensei',
  'MADE IN ABYSS': 'Made in Abyss',
  'VINLAND SAGA': 'Vinland Saga',
  'TENGOKU DAIMAIKYO': 'Tengoku Daimakyou',
  JJK: 'Jujutsu Kaisen',
  DITF: 'Darling in the FranXX',
  FRIEREN: 'Sousou no Frieren',
  CYBERPUNK: 'Cyberpunk Edgerunners',
  MHA: 'Boku no Hero Academia',
  'OSHI NO KO': 'Oshi no Ko',
  KAKEGURUI: 'Kakegurui',
  'PROMISED NEVERLAND': 'Yakusoku no Neverland',
  'DAN DA DAN': 'Dandadan',
  'FATE:UNLIMITED BLADE WORK': 'Fate/stay night Unlimited Blade Works',
  'TAKT:OP DESTINY': 'Takt Op. Destiny',
  HXH: 'Hunter x Hunter (2011)',
  "HELL'S PARADISE": 'Jigokuraku',
  'DEATH NOTE': 'Death Note',
  'CALL OF THE NIGHT': 'Yofukashi no Uta',
  'DRAGON BALL Z': 'Dragon Ball Z',
  'CHAINSAW MAN': 'Chainsaw Man',
  'MOUVEMENT DE LA TERRE': 'Chi.: Chikyuu no Undou ni Tsuite',
  COTE: 'Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e',
  'YOUR LIE IN APRIL': 'Shigatsu wa Kimi no Uso',
  'VIOLET EVERGARDEN': 'Violet Evergarden',
  'TERROR IN RESONNANCE': 'Zankyou no Terror',
  'BUNNY GIRL SENPAI': 'Seishun Buta Yarou wa Bunny Girl Senpai no Yume wo Minai',
  'SOLO LEVELING': 'Solo Leveling',
  LAIN: 'Serial Experiments Lain',
  'LOVE IS WAR': 'Kaguya-sama wa Kokurasetai: Tensai-tachi no Renai Zunousen',
  MONSTER: 'Monster',
  'YOUJO SENKI': 'Youjo Senki',
  'TOKYO REVENGER': 'Tokyo Revengers',
  PARASYTE: 'Kiseijuu Sei no Kakuritsu',
  'SONO BISQUE DOLL': 'Sono Bisque Doll wa Koi wo Suru',
  MAKEINE: 'Makeine: Too Many Losing Heroines',
  'LYCORIS RECOIL': 'Lycoris Recoil',
  KONOSUBA: 'Kono Subarashii Sekai ni Shukufuku wo',
  BAKI: 'Baki',
  'SHANGRI LA FRONTIER': 'Shangri-La Frontier',
  'SUMMERTIME RENDER': 'Summertime Render',
  SAO: 'Sword Art Online',
  GACHIAKUTA: 'Gachiakuta',
  'EMINENCE IN SHADOW': 'The Eminence in Shadow',
  'YU-NO': 'YU-NO: A Girl Who Chants Love at the Bound of this World',
  'BLUE LOCK': 'Blue Lock',
  'BOCCHI THE ROCK': 'Bocchi the Rock',
  'DEMON SLAYER': 'Kimetsu no Yaiba',
  'DRAGON BALL SUPER': 'Dragon Ball Super',
  'KAIJU NO 8': 'Kaijuu 8-gou',
  'SPY X FAMILY': 'Spy x Family',
  'TOMODACHI GAME': 'Tomodachi Game',
  'MIRAI NIKKI': 'Mirai Nikki',
  NISEKOI: 'Nisekoi',
  'WATA-NARE': 'Watashi no Osananajimi',
  'QUINTESSENTIAL QUINTUPLETS': '5-toubun no Hanayome',
  GLEIPNIR: 'Gleipnir',
  "CARNET DE L'APOTHICAIRE": 'Kusuriya no Hitorigoto',
  'DOMESTIC GIRLFRIEND': 'Domestic na Kanojo',
  'NO GAME NO LIFE': 'No Game No Life',
  CHARLOTTE: 'Charlotte',
  'KOBAYASHI DRAGON MAID': 'Kobayashi-san Chi no Maid Dragon',
  'WIND BREAKER': 'Wind Breaker',
  'SAKAMOTO DAYS': 'Sakamoto Days',
  'ALYA SOMETIMES HIDE HER FEELINGS': 'Tokidoki Bosotto Russia-go de Dereru Tonari no Alya-san',
  'WE NEVER LEARN: BOKUBEN': 'Bokutachi wa Benkyou ga Dekinai',
  'MORE THAN A MARRIED COUPLE': 'Fuufu Ijou, Koibito Miman',
  'LOVE IS INDIVISIBLE BY TWINS': 'Koi wa Futago de Warikirenai',
  'LITTLE WITCH ACADEMIA': 'Little Witch Academia',
  NAGATORO: 'Ijiranaide, Nagatoro-san',
  'GOLDEN TIME': 'Golden Time',
  'RENT A GIRLFRIEND': 'Kanojo, Okarishimasu',
  'LIAR LIAR': 'Liar Liar',
  'MASAMUNE KUN REVENGE': 'Masamune-kun no Revenge',
  'MY GIRLFRIEND IS A GAL': 'Hajimete no Gal',
  'GIRLFRIEND GIRLFRIEND': 'Kanojo mo Kanojo',
  KAORU: 'Kaoru Hana wa Rin to Saku',
  'ALYA SOMETIMES HIDE HER FEELINGS': 'Alya-san',
  'WATA-NARE': 'Watashi ga Koibito ni Nareru',
  'CHITOSE IS IN THE RAMUNE BOTTLE': 'Chitose-kun wa Ramune Bin no Naka'
}

/* ------------------------------------------------------------------ */
/* AniList lookup                                                      */
/* ------------------------------------------------------------------ */

const SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 5) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      idMal
      title { romaji english }
      format
      episodes
      seasonYear
      genres
      coverImage { large }
      siteUrl
      studios(isMain: true) { nodes { name } }
    }
  }
}`

let lastRequestAt = 0

/**
 * Disk cache of AniList responses, keyed by search term. Calibrating the alias
 * map means re-running the script repeatedly; without this every run would
 * spend three minutes re-fetching identical results and risk rate limiting.
 */
const CACHE_PATH = join(root, '.seed-cache.json')
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) : {}

function saveCache() {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8')
}

async function searchAnime(term) {
  if (cache[term]) return cache[term]

  // Pace to stay under AniList's ~30 requests/minute.
  const wait = 2200 - (Date.now() - lastRequestAt)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    lastRequestAt = Date.now()
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { search: term } }),
      signal: AbortSignal.timeout(20000)
    })

    if (response.status === 429) {
      const backoff = 8000 * attempt
      console.log(`      rate limited, waiting ${backoff / 1000}s…`)
      await new Promise((r) => setTimeout(r, backoff))
      continue
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const payload = await response.json()
    if (payload.errors) throw new Error(payload.errors[0]?.message ?? 'AniList error')

    const media = payload.data?.Page?.media ?? []
    cache[term] = media
    saveCache()
    return media
  }
  throw new Error('rate limited after retries')
}

/** Prefer a TV/ONA entry: the sheet lists series, not films or specials. */
const SERIES_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA'])

function pickBest(media) {
  if (media.length === 0) return null
  const series = media.find((m) => SERIES_FORMATS.has(m.format ?? ''))
  return series ?? media[0]
}

/* ------------------------------------------------------------------ */
/* Parse the sheet                                                     */
/* ------------------------------------------------------------------ */

const { grid } = readSheet(xlsxPath)

function numeric(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Sheet value (0-20) to the app's 0-100 scale. */
function scale(value) {
  const n = numeric(value)
  return n === null ? null : Math.round(n * SCALE)
}

const rows = []
for (let r = 1; r < grid.length; r += 1) {
  const row = grid[r] ?? []
  const label = (row[COLUMNS.title] ?? '').trim()
  if (!label) continue

  const criteria = {
    characters: scale(row[COLUMNS.characters]),
    story: scale(row[COLUMNS.story]),
    animation: scale(row[COLUMNS.animation]),
    ost: scale(row[COLUMNS.ost]),
    opening: scale(row[COLUMNS.opening]),
    keyFactor: scale(row[COLUMNS.keyFactor]),
    originality: scale(row[COLUMNS.originality])
  }

  // A row with no ratings at all carries no ranking information.
  if (Object.values(criteria).every((v) => v === null)) continue

  rows.push({
    label,
    sheetTotal: numeric(row[COLUMNS.total]),
    criteria,
    favouriteCharacter: (row[COLUMNS.favouriteCharacter] ?? '').trim() || null,
    favouriteOst: (row[COLUMNS.favouriteOst] ?? '').trim() || null,
    favouriteOpening: (row[COLUMNS.favouriteOpening] ?? '').trim() || null,
    favouriteEpisode: (row[COLUMNS.favouriteEpisode] ?? '').trim() || null
  })
}

console.log(`sheet: ${rows.length} rated anime`)

/* ------------------------------------------------------------------ */
/* Resolve each row against AniList                                    */
/* ------------------------------------------------------------------ */

const resolved = []
const unresolved = []

for (const [index, row] of rows.entries()) {
  const term = ALIASES[row.label] ?? row.label
  process.stdout.write(`[${index + 1}/${rows.length}] ${row.label} → ${term} … `)

  try {
    const media = await searchAnime(term)
    const best = pickBest(media)

    if (!best) {
      unresolved.push({ label: row.label, term, reason: 'no AniList match' })
      console.log('NOT FOUND')
      continue
    }

    const studio = (best.studios?.nodes ?? []).map((n) => n.name).join(', ') || null

    resolved.push({
      sheetLabel: row.label,
      title: best.title.romaji || best.title.english || row.label,
      englishTitle: best.title.english || null,
      year: best.seasonYear ?? null,
      studio,
      format: best.format ?? null,
      totalEpisodes: best.episodes ?? null,
      coverImage: best.coverImage?.large ?? null,
      genres: best.genres ?? [],
      anilistId: best.id,
      malId: best.idMal ?? null,
      siteUrl: best.siteUrl ?? null,
      criteria: row.criteria,
      sheetTotal: row.sheetTotal,
      favouriteCharacter: row.favouriteCharacter,
      favouriteOst: row.favouriteOst,
      favouriteOpening: row.favouriteOpening,
      favouriteEpisode: row.favouriteEpisode
    })

    console.log(`${best.title.romaji} [${best.format} ${best.seasonYear ?? '?'}]`)
  } catch (err) {
    unresolved.push({ label: row.label, term, reason: err.message })
    console.log(`FAILED (${err.message})`)
  }
}

/* ------------------------------------------------------------------ */
/* Write the seed                                                      */
/* ------------------------------------------------------------------ */

const outDir = join(root, 'src', 'renderer', 'src', 'data')
mkdirSync(outDir, { recursive: true })

const seed = {
  version: 1,
  source: 'N.xlsx',
  generatedAt: new Date().toISOString(),
  scaleNote: `Sheet scores are out of ${SHEET_MAX}; multiplied by ${SCALE} to the app's ${APP_MAX}.`,
  count: resolved.length,
  anime: resolved
}

writeFileSync(join(outDir, 'seed-anime.json'), JSON.stringify(seed, null, 2), 'utf-8')

/* Summary ------------------------------------------------------------ */

const allGenres = new Map()
for (const a of resolved) {
  for (const g of a.genres) allGenres.set(g, (allGenres.get(g) ?? 0) + 1)
}

console.log(`\n${'='.repeat(64)}`)
console.log(`resolved : ${resolved.length}`)
console.log(`unresolved: ${unresolved.length}`)
console.log(`with cover: ${resolved.filter((a) => a.coverImage).length}`)

console.log('\ngenres found:')
for (const [genre, count] of [...allGenres.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${genre}`)
}

if (unresolved.length > 0) {
  console.log('\nNOT RESOLVED (fix the alias map and re-run):')
  for (const u of unresolved) console.log(`  ${u.label.padEnd(34)} "${u.term}" — ${u.reason}`)
}

// Sanity check: the app's score must reproduce the sheet's own Total column,
// which is already on a 0-100 scale.
console.log('\nscore check (app score vs the sheet Total column):')
const scored = resolved
  .map((a) => {
    const values = Object.values(a.criteria).filter((v) => v !== null)
    const avg = values.reduce((s, v) => s + v, 0) / values.length
    return { label: a.sheetLabel, app: avg, sheet: a.sheetTotal }
  })
  .sort((a, b) => b.app - a.app)

let worst = 0
for (const s of scored) {
  if (s.sheet === null) continue
  worst = Math.max(worst, Math.abs(s.app - s.sheet))
}

for (const s of scored.slice(0, 5)) {
  const delta = s.sheet === null ? null : Math.abs(s.app - s.sheet)
  console.log(
    `  ${s.label.padEnd(22)} app=${s.app.toFixed(2).padStart(6)}  sheet=${s.sheet?.toFixed(2) ?? '?'}  delta=${delta?.toFixed(3) ?? '?'}`
  )
}
console.log(`  worst delta across all rows: ${worst.toFixed(3)}`)

console.log(`\nwrote ${join(outDir, 'seed-anime.json')}`)
writeFileSync(
  join(root, 'seed-report.json'),
  JSON.stringify({ resolved: resolved.length, unresolved, genres: [...allGenres.entries()] }, null, 2),
  'utf-8'
)
