/**
 * Tests the tier list logic, away from the interface.
 *
 * The interesting cases are the ones an interface is bad at exposing: an element
 * whose row has been deleted, a library entry removed after being placed, a list
 * read back from a file written before the tab existed, and the score pass, which
 * is what makes a sixty-element list practical.
 *
 * Usage: node scripts/check-tierlist.mjs
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(mkdtempSync(join(tmpdir(), 'tierlist-')), 'a.mjs')

await build({
  entryPoints: [join(root, 'src/renderer/src/tierlist.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: out,
  logLevel: 'error'
})
const T = await import(pathToFileURL(out).href)

const { build: buildStore } = await import('esbuild')
const storeOut = join(mkdtempSync(join(tmpdir(), 'store-')), 's.mjs')
await buildStore({
  entryPoints: [join(root, 'src/renderer/src/scoring.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: storeOut,
  logLevel: 'error'
})
const { normaliseStore } = await import(pathToFileURL(storeOut).href)

let failures = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}` +
      (ok ? '' : ` (expected ${JSON.stringify(expected)})`)
  )
}

const anime = (id, title, value) => ({
  id,
  title,
  status: 'completed',
  format: 'TV',
  year: 2020,
  episodes: [],
  criteria: {
    characters: value, story: value, animation: value, ost: value,
    opening: value, keyFactor: value, originality: value
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

const weights = {
  characters: 1, story: 1, animation: 1, ost: 1,
  opening: 1, keyFactor: 1, originality: 1, episodeAverage: 1
}

/* ---------------- 1. A fresh list ---------------- */

console.log('\n1. A new tier list\n')
const fresh = T.createTierList('Mes animés', 'anime')
check('seven rows', fresh.rows.length, 7)
check('best first', fresh.rows.map((r) => r.label).join(''), 'SABCDEF')
check('no elements yet', fresh.items.length, 0)
check('the rows are distinct', new Set(fresh.rows.map((r) => r.id)).size, 7)

/* ---------------- 2. Elements from the library ---------------- */

console.log('\n2. Building elements\n')
const library = [anime('a1', 'Frieren', 96), anime('a2', 'Naruto', 70), anime('a3', 'Bleach', 40)]
const items = T.itemsFromAnime(library, weights)
check('one per entry', items.length, 3)
check('all start in the pool', items.every((i) => i.rowId === null), true)
check('the score is carried', items[0].sublabel.includes('96.0'), true)
check('the link is kept', items[0].animeId, 'a1')

const seasonal = T.itemsFromSeasons([
  { id: 's1', title: 'Frieren', seasons: [
    { season: 1, anilistId: 1, malId: null, title: 'Frieren', year: 2023, episodes: 28 },
    { season: 2, anilistId: 2, malId: null, title: 'Frieren 2nd', year: 2026, episodes: 10 }
  ] },
  // A single-season entry contributes nothing: it would duplicate the entry.
  { id: 's2', title: 'Solo', seasons: [
    { season: 1, anilistId: 3, malId: null, title: 'Solo', year: 2019, episodes: 12 }
  ] }
])
check('only multi-season entries contribute', seasonal.length, 2)
check('each season is its own element', seasonal.map((i) => i.label), ['Frieren', 'Frieren 2nd'])

/* ---------------- 3. Placing ---------------- */

console.log('\n3. Placing, moving, clearing\n')
let list = T.addItems(fresh, items)
check('three elements added', list.items.length, 3)

const sRow = list.rows[0].id
const fRow = list.rows[6].id
list = T.moveItem(list, list.items[0].id, sRow)
check('one is placed', T.statsOf(list).placed, 1)
check('and the pool shrank', T.statsOf(list).pool, 2)

list = T.moveItem(list, list.items[0].id, fRow)
check('moving overwrites the row', T.boardView(list).rows[0].items.length, 0)
check('and the new row has it', T.boardView(list).rows[6].items.length, 1)

list = T.moveItem(list, list.items[0].id, null)
check('it can go back to the pool', T.statsOf(list).pool, 3)

list = T.moveItem(list, 'not-an-id', sRow)
check('moving an unknown id changes nothing', list.items.every((i) => i.rowId === null), true)

list = T.addItems(list, [items[0]])
check('the same element is not added twice', list.items.length, 3)

const counts = T.countsByRow(T.moveItem(list, list.items[1].id, sRow))
check('the count follows the row', counts.get(sRow), 1)

/* ---------------- 4. Sorting by score ---------------- */

console.log('\n4. Sorting by the scores already given\n')
const sorted = T.sortByScore(T.addItems(fresh, items), library, weights)
const rowOf = (title) => {
  const item = sorted.items.find((i) => i.label === title)
  return sorted.rows.find((r) => r.id === item.rowId)?.letter
}
check('96 goes to S', rowOf('Frieren'), 'S')
check('70 goes to B', rowOf('Naruto'), 'B')
check('40 goes to D', rowOf('Bleach'), 'D')
check('and nothing is left in the pool', T.statsOf(sorted).pool, 0)

// An element with no score must stay put rather than being guessed at.
const unrated = T.addItems(fresh, [
  ...items,
  { id: 'x', label: 'No score', sublabel: '', rowId: null, animeId: 'missing' }
])
const afterUnrated = T.sortByScore(unrated, library, weights)
check(
  'an unlinked element stays in the pool',
  afterUnrated.items.find((i) => i.id === 'x')?.rowId,
  null
)

const alreadySorted = T.sortByScore(sorted, library, weights)
check('sorting twice changes nothing the second time', alreadySorted, sorted)

/* ---------------- 5. Robustness ---------------- */

console.log('\n5. Damage tolerance\n')

// An element pointing at a row that no longer exists must come back to the pool
// rather than becoming unreachable.
const broken = {
  ...fresh,
  rows: fresh.rows.slice(0, 3),
  items: [{ id: 'i', label: 'Orphan row', sublabel: '', rowId: fresh.rows[6].id }]
}
check('the element is not lost', T.boardView(broken).pool.length, 1)
check('rows and pool account for everything', T.boardView(broken).rows.reduce((n, r) => n + r.items.length, 0) + T.boardView(broken).pool.length, broken.items.length)

const deletedEntry = T.orphanAnimeIds(T.addItems(fresh, items), [library[0]])
check('a deleted library entry is reported', [...deletedEntry].sort(), ['a2', 'a3'])
check('the element itself survives', T.addItems(fresh, items).items.length, 3)

check('renaming trims', T.renameList(fresh, '  Named  ').name, 'Named')
check('an empty name is refused', T.renameList(fresh, '   ').name, fresh.name)
check('a row can be renamed', T.renameRow(fresh, fresh.rows[0].id, 'Chefs-d’œuvre').rows[0].label, 'Chefs-d’œuvre')
check('an empty row name is refused', T.renameRow(fresh, fresh.rows[0].id, '  ').rows[0].label, 'S')

/* ---------------- 6. Reading a file written before the tab existed -------- */

console.log('\n6. Older data files\n')
const legacy = normaliseStore({ version: 1, anime: [], settings: {} })
check('a file with no tierLists key loads', Array.isArray(legacy.tierLists), true)
check('and it is empty', legacy.tierLists.length, 0)

const withLists = normaliseStore({
  version: 1,
  anime: [],
  settings: {},
  tierLists: [
    { id: 't1', name: 'Mine', kind: 'anime', rows: [{ id: 'r1', label: 'S', letter: 'S' }], items: [] },
    // Garbage must be dropped rather than taking the whole list down.
    { name: 'No id', kind: 'nonsense', rows: 'not an array', items: [{ label: 'x', rowId: 'gone' }] },
    null
  ]
})
check('two valid lists survive the third being null', withLists.tierLists.length, 2)
check('the first keeps its name', withLists.tierLists[0].name, 'Mine')
check('an unknown kind falls back', withLists.tierLists[1].kind, 'anime')
check('a non-array rows becomes empty', withLists.tierLists[1].rows, [])
check('an item pointing at a missing row goes to the pool', withLists.tierLists[1].items[0].rowId, null)
check('a missing id is generated', withLists.tierLists[1].id.length > 0, true)

console.log(`\n${failures === 0 ? 'TIER LIST LOGIC OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
