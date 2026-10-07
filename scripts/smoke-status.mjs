/**
 * Verifies the status tag in the leaderboard.
 *
 * The rule is that a ranking marks what is unfinished. "Completed" is what most
 * entries are, so a tag on every row would be noise, and the point of the tag is
 * the information the numbers beside it cannot give: this one is still being
 * watched, this one was dropped.
 *
 * A fixture of five entries, one per status, so the absence on the completed row
 * is tested as deliberately as the presence on the others.
 *
 * Usage: node scripts/smoke-status.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
const check = (label, actual, expected = true) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}` +
      (ok ? '' : ` (expected ${JSON.stringify(expected)})`)
  )
}

const profile = mkdtempSync(join(tmpdir(), 'animeeh-status-'))

const criteria = (v) => ({
  characters: v, story: v, animation: v, ost: v, opening: v, keyFactor: v, originality: v
})

/** One entry per status, with scores far enough apart to keep the order fixed. */
const STATUSES = [
  ['completed', 'Finished Show', 95],
  ['watching', 'Ongoing Show', 85],
  ['planned', 'Future Show', 75],
  ['on_hold', 'Paused Show', 65],
  ['dropped', 'Dropped Show', 55]
]

const anime = STATUSES.map(([status, title, value], index) => ({
  id: `a${index}`,
  title,
  status,
  format: 'TV',
  year: 2020,
  episodes: [],
  criteria: criteria(value),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}))

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
    anime
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

try {
  await sleep(1800)
  await win.getByRole('button', { name: /^Leaderboard/ }).click()
  await sleep(900)

  const rows = await win.locator('tbody tr').evaluateAll((trs) =>
    trs.map((tr) => {
      const cells = [...tr.querySelectorAll('td')]
      const titleCell = cells[1]
      const tag = titleCell?.querySelector('.status-tag')
      // The title without the tags, so the row can be identified.
      const copy = titleCell?.cloneNode(true)
      copy?.querySelectorAll('.status-tag, .film-tag').forEach((el) => el.remove())
      return {
        title: copy?.querySelector('.t-title')?.textContent?.trim() ?? '',
        tag: tag?.textContent?.trim() ?? null
      }
    })
  )

  console.log('\n   rows and their tags:')
  for (const row of rows) console.log(`      ${row.title.padEnd(16)} ${row.tag ?? '—'}`)

  check('every entry is listed', rows.length, STATUSES.length)

  const tagOf = (title) => rows.find((row) => row.title === title)?.tag ?? null

  // The rule, stated as the check: nothing at all for a completed entry.
  check('a completed entry carries no tag', tagOf('Finished Show'), null)
  check('a watched entry says so', tagOf('Ongoing Show'), 'Watching')
  check('a planned entry says so', tagOf('Future Show'), 'Plan to watch')
  check('an on-hold entry says so', tagOf('Paused Show'), 'On hold')
  check('a dropped entry says so', tagOf('Dropped Show'), 'Dropped')

  const tagCount = rows.filter((row) => row.tag !== null).length
  check('exactly four of the five are tagged', tagCount, 4)

  // Each status gets its own colour, so a glance down the column is readable.
  const hues = await win.locator('.status-tag').evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).color)
  )
  check('the tags are not all one colour', new Set(hues).size, 4)
  console.log(`   colours: ${[...new Set(hues)].join(' ')}`)

  await win.screenshot({ path: join(root, 'smoke-status-board.png') })

  /* ---- The sticky toolbar must be opaque ---- */
  console.log('\n6. THE STICKY TOOLBAR OPACITY\n')

  // The fault: the toolbar was 90% opaque, so the rows scrolling underneath showed
  // through as a ghost row of figures. A translucent background is the whole cause,
  // so the computed colour is checked for transparency rather than the intent.
  const toolbarBg = await win
    .locator('.toolbar-sticky')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  console.log(`   toolbar background: ${toolbarBg}`)
  const alpha = /rgba?\([^)]*,\s*([\d.]+)\s*\)/.exec(toolbarBg)
  const opacity = alpha ? Number(alpha[1]) : 1
  check('the toolbar is fully opaque', opacity >= 1)

  const backdrop = await win
    .locator('.toolbar-sticky')
    .evaluate((el) => getComputedStyle(el).backdropFilter)
  check('and has no blur left over', backdrop === 'none' || backdrop === '')

  // The column headers must clear the toolbar rather than hide behind it, so their
  // sticky offset has to be at least the toolbar's height.
  const offsets = await win.evaluate(() => {
    const toolbar = document.querySelector('.toolbar-sticky')
    const header = document.querySelector('thead th')
    if (!toolbar || !header) return null
    return {
      toolbarHeight: Math.round(toolbar.offsetHeight),
      headerTop: parseFloat(getComputedStyle(header).top) || 0
    }
  })
  console.log(`   toolbar ${offsets?.toolbarHeight}px tall, headers stick at ${offsets?.headerTop}px`)
  check('the headers stick below the toolbar', offsets !== null && offsets.headerTop >= offsets.toolbarHeight)

  // And with the board actually scrolled, nothing from a row may show through.
  await win.locator('.content').evaluate((el) => {
    el.scrollTop = 400
  })
  await sleep(700)
  const stillOpaque = await win
    .locator('.toolbar-sticky')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  check('it stays opaque while scrolling', stillOpaque, toolbarBg)
  await win.screenshot({ path: join(root, 'smoke-status-scrolled.png') })
  await win.locator('.content').evaluate((el) => {
    el.scrollTop = 0
  })
  await sleep(400)

  /* ---- And in French, where the wording differs ---- */
  await win.getByRole('button', { name: /^Settings/ }).click()
  await sleep(600)
  await win.getByRole('button', { name: 'Français' }).click()
  await sleep(500)
  await win.getByRole('button', { name: /^Classement/ }).click()
  await sleep(800)

  const frTags = (await win.locator('.status-tag').allInnerTexts()).map((s) => s.trim().toLowerCase())
  console.log(`\n   French tags: ${frTags.join(' | ')}`)
  // Compared without case: the tag is drawn in small caps by the stylesheet, so
  // the rendered text is uppercase whatever the dictionary says.
  check(
    'the tags are translated',
    frTags.sort(),
    ['abandonné', 'à voir', 'en cours', 'en pause'].sort()
  )
  check('and the completed one is still untagged', await win.locator('.status-tag').count(), 4)
} catch (err) {
  failures += 1
  console.log(`\n[error] ${err.message}`)
  await win.screenshot({ path: join(root, 'smoke-status-failure.png') }).catch(() => {})
} finally {
  await app.close()
}

/* ------------------------------------------------------------------ */
/* (the sticky toolbar checks live inside the try, with the board open) */
/* ------------------------------------------------------------------ */

console.log(`\n${failures === 0 ? 'STATUS TEST OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
