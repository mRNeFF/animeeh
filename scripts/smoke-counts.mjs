/**
 * Verifies that every count describes what its own tab holds.
 *
 * The reported problem: with two series and one film, the sidebar showed "3"
 * beside Anime while the Anime view read "2 of 2". The badge was counting every
 * entry in the library, films included, and the Films & OVA tab had no badge at
 * all. The footer had the same conflation, and the Films tab labelled its own
 * count "anime".
 *
 * Each scenario gets its own app instance and its own data file, because the
 * library has to differ between them and rewriting it mid-run is fiddly.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}` +
      (ok ? '' : ` (expected ${JSON.stringify(expected)})`)
  )
}

const criteria = () => ({
  characters: 80, story: 80, animation: 80, ost: 80, opening: 80, keyFactor: 80, originality: 80
})
const episodes = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `e${i + 1}`,
    number: i + 1,
    title: `Episode ${i + 1}`,
    score: 80
  }))
const entry = (id, title, format, episodeList) => ({
  id,
  title,
  status: 'completed',
  format,
  year: 2020,
  episodes: episodeList,
  criteria: criteria(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
})

/**
 * Two series and one film: the shape the bug was reported with. The series carry
 * episodes so the footer has a total to state, and the film carries none so that
 * total must ignore it.
 */
const WITH_FILM = {
  version: 1,
  settings: {
    weights: {
      characters: 1, story: 1, animation: 1, ost: 1,
      opening: 1, keyFactor: 1, originality: 1, episodeAverage: 1
    },
    checkForUpdatesOnStartup: false,
    language: 'fr'
  },
  anime: [
    entry('s1', 'First Series', 'TV', episodes(12)),
    entry('s2', 'Second Series', 'TV', episodes(5)),
    entry('f1', 'The Film', 'MOVIE', [])
  ]
}

/** The same, minus the film, so a badge must disappear rather than read "0". */
const WITHOUT_FILM = {
  ...WITH_FILM,
  settings: { ...WITH_FILM.settings, language: 'en' },
  anime: [entry('s1', 'First Series', 'TV', episodes(12)), entry('s2', 'Second Series', 'TV', episodes(5))]
}

async function withApp(data, body) {
  const profile = mkdtempSync(join(tmpdir(), 'animeeh-counts-'))
  writeFileSync(join(profile, 'animeeh-data.json'), JSON.stringify(data), 'utf-8')
  const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
  const win = await app.firstWindow()
  win.on('pageerror', (e) => {
    failures += 1
    console.log(`[pageerror] ${e.message}`)
  })
  try {
    await win.waitForTimeout(1700)
    await body(win)
  } finally {
    await app.close()
  }
}

/** The count badge beside a nav item, or '' when the item has none. */
const badge = async (win, label) => {
  const item = win.locator('.nav-item', { hasText: label })
  const count = item.locator('.nav-count')
  return (await count.count()) === 0 ? '' : (await count.innerText()).trim()
}

/** The line saying how many entries the current view is showing. */
const viewCount = async (win) => {
  const hints = await win.locator('.content .hint').allInnerTexts()
  return hints.map((s) => s.trim()).find((s) => /sur |of /.test(s)) ?? ''
}

/** The sidebar footer, which summarises the whole library. */
const footer = async (win) => {
  const lines = await win.locator('.sidebar-foot div').allInnerTexts()
  return lines.map((s) => s.trim()).find((s) => /épisode|episode/.test(s)) ?? ''
}

try {
  /* ---- French, which is what the report was written in ---- */
  await withApp(WITH_FILM, async (win) => {
    console.log('\nFRENCH — two series and one film')
    check('the Anime tab is open', (await win.locator('h1').innerText()).trim(), 'Animé')
    check('the Anime badge counts only the series', await badge(win, 'Animé'), '2')
    check('the Films badge exists, and counts the film', await badge(win, 'Films'), '1')
    check('the Anime view reads 2 of 2', await viewCount(win), '2 sur 2 animés')
    check(
      'the footer names the series and the film',
      await footer(win),
      '2 animés · 17 épisodes · 1 en Films & OVA'
    )
    await win.screenshot({ path: join(root, 'smoke-counts-fr-library.png') })

    await win.getByRole('button', { name: /^Films/ }).click()
    await win.waitForTimeout(700)
    check('the Films view counts in its own words', await viewCount(win), '1 sur 1 en Films & OVA')
    await win.screenshot({ path: join(root, 'smoke-counts-fr-films.png') })

    /* The same library, read in English, where the wording is separate. */
    await win.getByRole('button', { name: /^Réglages/ }).click()
    await win.waitForTimeout(600)
    await win.getByRole('button', { name: 'English' }).click()
    await win.waitForTimeout(700)
    await win.getByRole('button', { name: /^Anime/ }).click()
    await win.waitForTimeout(700)

    console.log('\nENGLISH — the same library')
    check('the Anime badge survives the language change', await badge(win, 'Anime'), '2')
    check('the Films badge survives the language change', await badge(win, 'Films'), '1')
    check('the Anime view reads 2 of 2', await viewCount(win), '2 of 2 anime')
    check(
      'the footer reads naturally in English',
      await footer(win),
      '2 anime · 17 episodes · 1 in Films & OVA'
    )

    await win.getByRole('button', { name: /^Films/ }).click()
    await win.waitForTimeout(700)
    check('the Films view counts in its own words', await viewCount(win), '1 of 1 in Films & OVA')
  })

  /* ---- No films: the badge must vanish, and the footer say nothing about them ---- */
  await withApp(WITHOUT_FILM, async (win) => {
    console.log('\nNO FILMS — a badge must not read "0"')
    check('the Anime badge counts the two series', await badge(win, 'Anime'), '2')
    check('the Films badge is hidden rather than showing 0', await badge(win, 'Films'), '')
    check('the footer omits the film part', await footer(win), '2 anime · 17 episodes')
    await win.screenshot({ path: join(root, 'smoke-counts-no-films.png') })
  })
} catch (err) {
  failures += 1
  console.log(`\n[error] ${err.message}`)
}

console.log(`\n${failures === 0 ? 'COUNTS TEST OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
