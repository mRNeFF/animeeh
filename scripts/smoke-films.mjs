/**
 * Verifies the films split and the new letter grades:
 *   - a Films tab that holds only films,
 *   - the series library refusing to list films,
 *   - the leaderboard's Global / Series only / Films only scopes ranked
 *     independently,
 *   - the grade thresholds S 90 · A 75 · B 65 · C 50 · D 30 · E 10 · F 0.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ------------------------------------------------------------------ */
/* 0. Grade thresholds, straight from the module                       */
/* ------------------------------------------------------------------ */

const gradeOut = join(mkdtempSync(join(tmpdir(), 'grades-')), 'g.mjs')
await build({
  entryPoints: [join(root, 'src/renderer/src/scoring.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: gradeOut,
  logLevel: 'error'
})
const { grade } = await import(pathToFileURL(gradeOut).href)

const gradeCases = [
  [100, 'S'], [90, 'S'], [89.9, 'A'], [75, 'A'], [74.9, 'B'], [65, 'B'],
  [64.9, 'C'], [50, 'C'], [49.9, 'D'], [30, 'D'], [29.9, 'E'], [10, 'E'],
  [9.9, 'F'], [0, 'F']
]

let failures = 0
console.log('GRADES:')
for (const [score, expected] of gradeCases) {
  const actual = grade(score).letter
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${String(score).padStart(5)} -> ${actual}${ok ? '' : ` (expected ${expected})`}`)
}

/* ------------------------------------------------------------------ */
/* 1. Films tab and scoped leaderboard                                 */
/* ------------------------------------------------------------------ */

const profile = mkdtempSync(join(tmpdir(), 'animeeh-films-'))

const criteria = (v) => ({
  characters: v, story: v, animation: v, ost: v, opening: v, keyFactor: v, originality: v
})

const anime = (id, title, format, value, year) => ({
  id,
  title,
  status: 'completed',
  format,
  year,
  episodes: [],
  criteria: criteria(value),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
})

// Two series, two films and one OVA, interleaved by score so a shared ranking
// would give a different (and wrong) order.
writeFileSync(
  join(profile, 'animeeh-data.json'),
  JSON.stringify({
    version: 1,
    settings: {
      weights: {
        characters: 1, story: 1, animation: 1, ost: 1,
        opening: 1, keyFactor: 1, originality: 1, episodeAverage: 1
      },
      checkForUpdatesOnStartup: false,
      language: 'en'
    },
    anime: [
      anime('s1', 'Top Series', 'TV', 95, 2020),
      anime('f1', 'Top Film', 'MOVIE', 85, 2021),
      anime('o1', 'Mid OVA', 'OVA', 70, 2022),
      anime('s2', 'Low Series', 'TV', 60, 2023),
      anime('f2', 'Low Film', 'MOVIE', 40, 2024)
    ]
  }),
  'utf-8'
)

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => {
  failures += 1
  console.log(`[pageerror] ${e.message}`)
})

const sleep = (ms) => win.waitForTimeout(ms)
const shot = (name) => win.screenshot({ path: join(root, `smoke-${name}.png`) })

async function titlesInCards() {
  return (await win.locator('.card .card-title').allInnerTexts()).map((s) => s.trim())
}

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(1800)

  const nav = (await win.locator('.nav-label').allInnerTexts()).join(' | ')
  console.log(`\nNAV: ${nav}`)

  /* ---- Series library excludes films ---- */
  const seriesCards = await titlesInCards()
  const seriesHeading = await win.locator('h1').innerText()
  console.log(`LIBRARY heading "${seriesHeading}": ${seriesCards.join(', ')}`)

  /* ---- Films tab ---- */
  await win.getByRole('button', { name: /^Films/ }).click()
  await sleep(900)
  const filmCards = await titlesInCards()
  const filmHeading = await win.locator('h1').innerText()
  const filmEmpty = await win.locator('.empty h3').count()
  const filmEmptyText = filmEmpty > 0 ? await win.locator('.empty h3').innerText() : ''
  console.log(`FILMS TAB      : heading "${filmHeading}", ${filmCards.length} card(s): ${filmCards.join(', ')}`)
  if (filmEmpty > 0) console.log(`   empty state: "${filmEmptyText}"`)
  await shot('films-tab')

  /* ---- Leaderboard scopes ---- */
  await win.getByRole('button', { name: /^Leaderboard/ }).click()
  await sleep(900)

  const tabs = (await win.locator('.toolbar .chip').allInnerTexts()).map((s) =>
    s.replace(/\s+/g, ' ').trim()
  )
  console.log(`\nBOARD TABS: ${tabs.join(' | ')}`)

  const readBoard = async (label) => {
    await win.locator('.toolbar .chip', { hasText: label }).click()
    await sleep(700)
    const rows = await win.locator('tbody tr').evaluateAll((trs) =>
      trs.map((tr) => {
        const cells = [...tr.querySelectorAll('td')]
        return {
          rank: cells[0]?.textContent?.trim(),
          title: (() => {
            const cell = cells[1]?.querySelector('.t-title')
            if (!cell) return undefined
            // The film/OVA badge sits inside the title cell, so remove it from a
            // copy rather than pattern-matching its label, which is translated.
            const copy = cell.cloneNode(true)
            copy.querySelector('.film-tag')?.remove()
            return copy.textContent?.trim()
          })(),
          tag: cells[1]?.querySelector('.film-tag')?.textContent?.trim(),
          isFilm: !!cells[1]?.querySelector('.film-tag'),
          score: cells[cells.length - 2]?.textContent?.trim(),
          grade: cells[cells.length - 1]?.textContent?.trim()
        }
      })
    )
    console.log(`\n${label}:`)
    for (const r of rows) {
      console.log(`  #${r.rank} ${r.title}${r.tag ? ` [${r.tag}]` : ''} score=${r.score} grade=${r.grade}`)
    }
    return rows
  }

  const globals = await readBoard('Global')
  const series = await readBoard('Series only')
  const films = await readBoard('Films only')
  await shot('board-scopes')

  /* ---- Assertions ---- */
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    if (!ok) failures += 1
    console.log(`   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
  }

  console.log('\nCHECKS:')
  check('series library excludes films and OVAs', seriesCards.sort(), ['Low Series', 'Top Series'])
  check('films tab holds films and OVAs', filmCards.sort(), ['Low Film', 'Mid OVA', 'Top Film'])
  check('global scope ranks all five', globals.length, 5)
  check('series scope ranks series only', series.map((r) => r.title), ['Top Series', 'Low Series'])
  check('film scope ranks films and OVAs', films.map((r) => r.title), ['Top Film', 'Mid OVA', 'Low Film'])
  // Ranks must be computed inside the scope: the film scope's #1 is a film.
  check('film scope rank 1', films[0]?.rank, '1')
  check('film scope rank 2', films[1]?.rank, '2')
  check('series scope has no film', series.some((r) => r.isFilm), false)

  // The badge must name the format rather than saying FILM for everything.
  check('movie badge reads Film', films.find((r) => r.title === 'Top Film')?.tag, 'Film')
  check('OVA badge reads OVA', films.find((r) => r.title === 'Mid OVA')?.tag, 'OVA')
  check('series rows carry no badge', series.every((r) => r.tag === undefined), true)

  // Grades follow the new thresholds.
  check('score 95 grades S', globals.find((r) => r.title === 'Top Series')?.grade, 'S')
  check('score 85 grades A', globals.find((r) => r.title === 'Top Film')?.grade, 'A')
  check('score 70 grades B', globals.find((r) => r.title === 'Mid OVA')?.grade, 'B')
  check('score 60 grades C', globals.find((r) => r.title === 'Low Series')?.grade, 'C')
  check('score 40 grades D', globals.find((r) => r.title === 'Low Film')?.grade, 'D')

  /* ---- French pass, to confirm the new labels are translated ---- */
  await win.getByRole('button', { name: /^Settings/ }).click()
  await sleep(600)
  await win.getByRole('button', { name: 'Français' }).click()
  await sleep(600)
  const frNav = (await win.locator('.nav-label').allInnerTexts()).join(' | ')
  console.log(`\nFR NAV: ${frNav}`)
  await win.getByRole('button', { name: /^Classement/ }).click()
  await sleep(700)
  const frTabs = (await win.locator('.toolbar .chip').allInnerTexts()).map((s) =>
    s.replace(/\s+/g, ' ').trim()
  )
  console.log(`FR TABS: ${frTabs.join(' | ')}`)
  await shot('films-fr')

  check('films nav is translated', frNav.includes('Films'), true)
  check('board tabs are translated', frTabs.some((t) => t.includes('Séries uniquement')), true)

  console.log(`\n${failures === 0 ? 'FILMS/GRADES TEST OK' : `${failures} FAILURE(S)`}`)
} catch (err) {
  failures += 1
  console.log(`\n[script] ${err.message}`)
  try {
    await shot('films-failure')
  } catch {
    /* ignore */
  }
} finally {
  await app.close().catch(() => {})
}

process.exit(failures === 0 ? 0 : 1)
