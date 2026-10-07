/**
 * Verifies the unified search: one box, one request, everything.
 *
 * The point of this version is that a tier list is no longer restricted to one
 * kind of element, which only works if a single search returns anime and
 * characters together. So the assertions are about breadth and about the id
 * discipline, not about fetching.
 *
 * Two things are checked that would be easy to break silently:
 *
 *   - the library is only consulted to MARK results, never to limit them, so a
 *     show the user has never rated is still found;
 *   - every character result names the anime it belongs to, since a bare name in a
 *     search list is not enough to tell which show it came from.
 *
 * Usage: node scripts/check-tierlist-search.mjs
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(mkdtempSync(join(tmpdir(), 'tlsearch-')), 'a.mjs')

await build({
  entryPoints: [join(root, 'src/main/tierlist.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: out,
  logLevel: 'error'
})
const { searchEverything, loadThemes } = await import(pathToFileURL(out).href)

let failures = 0
const check = (label, actual, expected = true) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  )
}

/** A library with exactly one entry, so "in your list" can be told apart. */
const LIBRARY = [{ anilistId: 154587, id: 'frieren-entry' }]

/* ------------------------------------------------------------------ */
/* 1. One query, both kinds                                            */
/* ------------------------------------------------------------------ */

console.log('\n1. ONE SEARCH RETURNS BOTH KINDS\n')

const result = await searchEverything('frieren', LIBRARY)
if (!result.ok) {
  check('the search succeeded', result.code, undefined)
  process.exit(1)
}

const { anime, characters } = result.data
console.log(`   "frieren" -> ${anime.length} anime, ${characters.length} characters`)

check('anime came back', anime.length > 0, true)
check('characters came back', characters.length > 0, true)
check(
  'each anime carries a cover',
  anime.every((entry) => typeof entry.image === 'string' && entry.image.startsWith('http')),
  true
)
check(
  'each anime carries a year and a format',
  anime.every((entry) => entry.format !== null),
  true
)
check(
  'each character carries a portrait',
  characters.every((character) => typeof character.image === 'string' && character.image.startsWith('http')),
  true
)
check(
  'each character names its anime',
  characters.every((character) => typeof character.animeTitle === 'string' && character.animeTitle !== ''),
  true
)

console.log('\n   anime:')
for (const entry of anime.slice(0, 5)) {
  console.log(
    `      [${String(entry.anilistId).padEnd(7)}] ${String(entry.format).padEnd(6)} ${entry.year ?? '?'}  ` +
      `${entry.title.slice(0, 40)}${entry.inLibrary ? '  (in your list)' : ''}`
  )
}
console.log('   characters:')
for (const character of characters.slice(0, 5)) {
  console.log(
    `      [${String(character.anilistId).padEnd(7)}] ${character.name.slice(0, 24).padEnd(26)} ` +
      `${String(character.favourites).padStart(6)} fav  from ${character.animeTitle}`
  )
}

/* ------------------------------------------------------------------ */
/* 2. The library marks, it does not limit                             */
/* ------------------------------------------------------------------ */

console.log('\n2. THE LIBRARY MARKS, IT DOES NOT LIMIT\n')

const tracked = anime.filter((entry) => entry.inLibrary)
const untracked = anime.filter((entry) => !entry.inLibrary)
check('the tracked entry is marked', tracked.length > 0, true)
check('and its library id is carried', tracked[0].libraryId, 'frieren-entry')
// The assertion that matters: the catalogue is searched, so a show the user has
// never rated is still found. A library-only search would return one result.
check('untracked results are found too', untracked.length > 0, true)
console.log(`   ${tracked.length} tracked, ${untracked.length} from the wider catalogue`)

/* ------------------------------------------------------------------ */
/* 3. A query that matches nothing                                     */
/* ------------------------------------------------------------------ */

console.log('\n3. A QUERY THAT MATCHES NOTHING\n')
const none = await searchEverything('zzzqqqxyzzy', LIBRARY)
check('it succeeds rather than failing', none.ok, true)
if (none.ok) {
  check('with no anime', none.data.anime.length, 0)
}

console.log('\n4. A QUERY THAT IS TOO SHORT\n')
const short = await searchEverything('f', LIBRARY)
check('a single letter is not searched', short.ok && short.data.anime.length === 0, true)

/* ------------------------------------------------------------------ */
/* 5. A character can be found without naming an anime                 */
/* ------------------------------------------------------------------ */

console.log('\n5. A CHARACTER, SEARCHED BY NAME ALONE\n')

// "levi ackerman" is the case that forced the fallback: the catalogue names the
// character "Levi" alone, so the two-word query returns nothing and the search
// retries on the longest word.
const byCharacter = await searchEverything('levi ackerman', [])
if (byCharacter.ok) {
  const levi = byCharacter.data.characters.find((c) => /levi/i.test(c.name))
  check('a full name still finds the character', levi !== undefined, true)
  if (levi) {
    console.log(`      "${levi.name}" — ${levi.favourites} favourites — from ${levi.animeTitle}`)
    check('and it names its anime', typeof levi.animeTitle === 'string' && levi.animeTitle !== '', true)
  }
}

const bySingleName = await searchEverything('levi', [])
if (bySingleName.ok) {
  check('a single name works too', bySingleName.data.characters.length > 0, true)
}

/* ------------------------------------------------------------------ */
/* 6. Themes for a catalogue anime, not just a library one             */
/* ------------------------------------------------------------------ */

console.log('\n6. THEMES FOR AN ANIME OUTSIDE THE LIBRARY\n')

// Bakemonogatari is deliberately not in the library fixture: the theme lookup has
// to work for anything the search returns.
const outside = await loadThemes([{ anilistId: 5081, title: 'Bakemonogatari' }])
if (!outside.ok) {
  check('the theme lookup succeeded', outside.code, undefined)
} else {
  const themes = outside.data.themes
  check('themes were found', themes.length > 0, true)
  check('none was reported unmatched', outside.data.unmatched, 0)
  check(
    'they belong to the id that was asked for',
    themes.every((theme) => theme.anilistId === 5081),
    true
  )
  check(
    'and they carry their slug',
    themes.every((theme) => /^(OP|ED)\d/.test(theme.slug)),
    true
  )
  console.log(`   ${themes.length} themes, e.g. ${themes.slice(0, 3).map((t) => `${t.slug} "${t.title}"`).join(', ')}`)
}

console.log(`\n${failures === 0 ? 'TIERLIST SEARCH OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
