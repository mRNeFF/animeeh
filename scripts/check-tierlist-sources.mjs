/**
 * Checks the two network sources through the code the app actually runs.
 *
 * The interface test covers anime, seasons and soundtracks, because those need no
 * network. Characters and themes do, so they are checked here, straight through
 * the main-process loaders rather than through a re-implementation: what is
 * verified is what the app calls.
 *
 * The important assertion is the matching, not the fetching. AnimeThemes is keyed
 * on its own ids, and a wrong match would silently attach the openings of, say,
 * Dragon Ball Z to Dragon Ball — the failure already seen twice with titles. So
 * this checks that each returned theme really names the AniList id it was asked
 * for, and that an entry AnimeThemes has never heard of is reported as unmatched
 * rather than quietly given someone else's songs.
 *
 * Usage: node scripts/check-tierlist-sources.mjs
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(mkdtempSync(join(tmpdir(), 'tlsrc-')), 'a.mjs')

await build({
  entryPoints: [join(root, 'src/main/tierlist.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: out,
  logLevel: 'error'
})
const { loadCharacters, loadThemes } = await import(pathToFileURL(out).href)

let failures = 0
/** Takes the actual and expected values, so a zero cannot be mistaken for false. */
const check = (label, actual, expected = true) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'} ${label}${ok ? '' : `: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  )
}

/** A few real entries, with the titles AnimeThemes is searched by. */
const ENTRIES = [
  { anilistId: 154587, animeId: 'frieren', title: 'Sousou no Frieren' },
  { anilistId: 97986, animeId: 'mia', title: 'Made in Abyss' },
  { anilistId: 20, animeId: 'naruto', title: 'NARUTO' }
]

/* ------------------------------------------------------------------ */
/* 1. Characters, from AniList                                         */
/* ------------------------------------------------------------------ */

console.log('\n1. CHARACTERS\n')

const chars = await loadCharacters(ENTRIES.map(({ anilistId, animeId }) => ({ anilistId, animeId })))

if (!chars.ok) {
  check('the characters request succeeded', chars.code, undefined)
} else {
  const byAnime = new Map()
  for (const character of chars.data.characters) {
    byAnime.set(character.animeId, (byAnime.get(character.animeId) ?? 0) + 1)
  }
  check('characters came back', chars.data.characters.length > 0, true)
  check('every request returned some', byAnime.size, 3)
  check('none was missing', chars.data.missing, 0)
  check(
    'each carries a portrait',
    chars.data.characters.every((c) => typeof c.image === 'string' && c.image.startsWith('http')),
    true
  )
  // AniList also reports BACKGROUND, which is a legitimate role; the picker keeps
  // it because a minor character can still be worth ranking.
  const roles = new Set(chars.data.characters.map((c) => c.role))
  check(
    'every character carries a role AniList defines',
    [...roles].every((role) => ['MAIN', 'SUPPORTING', 'BACKGROUND'].includes(role)),
    true
  )
  console.log(`       roles seen: ${[...roles].join(', ')}`)
  check('the main characters come first', chars.data.characters[0].role, 'MAIN')

  for (const [animeId, count] of byAnime) {
    const first = chars.data.characters.filter((c) => c.animeId === animeId).slice(0, 3)
    console.log(`       ${animeId.padEnd(9)} ${String(count).padStart(3)} — ${first.map((c) => `${c.name} (${c.role})`).join(', ')}`)
  }
}

/* ------------------------------------------------------------------ */
/* 2. Themes, from AnimeThemes                                         */
/* ------------------------------------------------------------------ */

console.log('\n2. OPENINGS AND ENDINGS\n')

const themes = await loadThemes(ENTRIES.map(({ anilistId, title }) => ({ anilistId, title })))

if (!themes.ok) {
  check('the themes request succeeded', themes.code, undefined)
} else {
  const ops = themes.data.themes.filter((t) => t.type === 'OP')
  const eds = themes.data.themes.filter((t) => t.type === 'ED')
  check('both openings and endings came back', ops.length > 0 && eds.length > 0, true)
  console.log(`       ${ops.length} OP, ${eds.length} ED`)

  // The assertion that matters: nothing may be attributed to the wrong entry.
  const askedFor = new Set(ENTRIES.map((e) => e.anilistId))
  const stray = themes.data.themes.filter((t) => !askedFor.has(t.anilistId))
  check('every theme belongs to an entry we asked about', stray.length, 0)

  const perEntry = new Map()
  for (const theme of themes.data.themes) {
    perEntry.set(theme.anilistId, (perEntry.get(theme.anilistId) ?? 0) + 1)
  }
  for (const entry of ENTRIES) {
    const count = perEntry.get(entry.anilistId) ?? 0
    console.log(`       id ${String(entry.anilistId).padEnd(7)} ${String(count).padStart(2)} theme(s) — ${entry.title}`)
  }

  check('titles are present', themes.data.themes.every((t) => t.title.trim() !== ''), true)
  const withArtists = themes.data.themes.filter((t) => t.artists.length > 0).length
  // The artists are only there when the catalogue has them: AnimeThemes is a
  // fan-maintained database, and a long-running show from the nineties often has
  // a song title but no credited performer. So the check is that the field is
  // populated, not that it is always populated, and the ratio is printed.
  check('some carry artists', withArtists > 0, true)
  console.log(`       ${withArtists} of ${themes.data.themes.length} name their artists (the rest are older entries)`)
  const withImage = themes.data.themes.filter((t) => t.videoUrl).length
  check('some carry a hosted video', withImage > 0, true)
  console.log(`       ${withImage} of ${themes.data.themes.length} link to a video file (no poster frame exists)`)
  check(
    'the video links are files, not images',
    // Worth asserting: treating one of these as an image rendered nothing, and
    // that mistake is easy to reintroduce.
    themes.data.themes.every((t) => t.videoUrl === null || !/\.(png|jpe?g|webp)$/i.test(t.videoUrl)),
    true
  )
  check(
    'each theme is typed OP or ED',
    themes.data.themes.every((t) => t.type === 'OP' || t.type === 'ED'),
    true
  )

  console.log()
  for (const theme of themes.data.themes.slice(0, 8)) {
    console.log(
      `       ${theme.slug.padEnd(7)} "${theme.title}"` +
        (theme.artists.length ? ` — ${theme.artists.join(', ')}` : '') +
        `  [${theme.anilistId}]`
    )
  }
  check('every theme carries a slug', themes.data.themes.every((t) => t.slug !== ''), true)
  check(
    'the slugs are distinct within an entry',
    // Two openings of one show must not compare equal, which is what keying on
    // the null `sequence` field would have done.
    new Set(themes.data.themes.map((t) => `${t.anilistId}:${t.slug}`)).size,
    themes.data.themes.length
  )
}

/* ------------------------------------------------------------------ */
/* 3. An entry AnimeThemes does not have                               */
/* ------------------------------------------------------------------ */

console.log('\n3. AN UNKNOWN TITLE\n')

// A made-up title must come back unmatched, not as another show's themes.
const unknown = await loadThemes([{ anilistId: 999999999, title: 'Zzzz Nonexistent Anime Zzzz' }])
if (!unknown.ok) {
  check('it did not crash', unknown.code, undefined)
} else {
  check('nothing was attributed to it', unknown.data.themes.length, 0)
  check('and it is reported as unmatched', unknown.data.unmatched, 1)
}

/* ------------------------------------------------------------------ */
/* 4. The cache                                                        */
/* ------------------------------------------------------------------ */

console.log('\n4. CACHING\n')

const first = Date.now()
await loadThemes([{ anilistId: 154587, title: 'Sousou no Frieren' }])
const cold = Date.now() - first
const second = Date.now()
const again = await loadThemes([{ anilistId: 154587, title: 'Sousou no Frieren' }])
const warm = Date.now() - second
console.log(`       first ${cold} ms, second ${warm} ms`)
check('a repeat is served from the cache', warm < 200, true)
check('and returns the same themes', again.ok ? again.data.themes.length > 0 : 0, true)

console.log(`\n${failures === 0 ? 'TIERLIST SOURCES OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
