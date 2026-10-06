/**
 * Verifies the leaderboard find bar end to end.
 *
 * The ranking is highlighted rather than filtered, so the checks cover:
 *   - the rows that match carrying the match class, and nothing else,
 *   - the matched words being wrapped in <mark>,
 *   - the current match scrolling to the MIDDLE of the scrolling area, which is
 *     the part that cannot be reasoned about from the source and has to be
 *     measured,
 *   - Enter and Shift+Enter moving between matches,
 *   - Escape and the clear button emptying the query,
 *   - accents matching, since "pokemon" has to find "Pokémon".
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

const profile = mkdtempSync(join(tmpdir(), 'animeeh-find-'))

const criteria = (v) => ({
  characters: v,
  story: v,
  animation: v,
  ost: v,
  opening: v,
  keyFactor: v,
  originality: v
})

const anime = (id, title, value, studio) => ({
  id,
  title,
  status: 'completed',
  format: 'TV',
  year: 2020,
  studio,
  episodes: [],
  criteria: criteria(value),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
})

/*
 * Forty rows so the table is far taller than the viewport. The distinctive
 * titles sit mid-table, where the scroll can genuinely centre them, plus one at
 * the very bottom, where the scroll clamps and the row can only be made visible.
 */
const list = []
for (let i = 1; i <= 40; i += 1) {
  const n = String(i).padStart(2, '0')
  list.push(anime(`a${n}`, `Anime ${n}`, 100 - i))
}
list.push(anime('z1', 'Zelda no Densetsu', 79.1, 'Studio X'))
list.push(anime('z2', 'Zelda no Densetsu II', 79, 'Studio Y'))
list.push(anime('p1', 'Pokémon Chronicles', 75.5, 'Studio X'))
// No year and no studio, to exercise the "no details" branch.
const odyssey = anime('o1', 'One Piece Odyssey', 0)
odyssey.year = undefined
list.push(odyssey)

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
    anime: list
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
const input = () => win.locator('.find input')

/**
 * Vertical centre of an element and of the scrolling area, so they can be
 * compared. The scroll animation is smooth, hence the settle time.
 */
const centres = async () => {
  const row = await win.locator('tr.row-current').boundingBox()
  const area = await win.locator('.content').boundingBox()
  if (!row || !area) return { row: null, area: null, delta: null }
  const rowCentre = row.y + row.height / 2
  const areaCentre = area.y + area.height / 2
  return { row: Math.round(rowCentre), area: Math.round(areaCentre), delta: Math.round(Math.abs(rowCentre - areaCentre)) }
}

/**
 * Clears the field and types `text` one character at a time.
 *
 * Typed rather than pasted deliberately. `fill()` sets the value in a single
 * event and this bug does not appear; typing fires one event per character, and
 * it was the browser revealing the focused field on each caret move that dragged
 * the container back to the toolbar and undid the jump. A pasted query hid the
 * whole thing, so the tests paste nothing.
 */
const type = async (text) => {
  await input().fill('')
  await sleep(180)
  await input().click()
  await input().pressSequentially(text, { delay: 40 })
  // The scroll is instant, so this is only a frame or two of settle time.
  await sleep(500)
}

/** Where the current match sits relative to the scrolling area. */
const currentRowState = () =>
  win.evaluate(() => {
    const area = document.querySelector('.content')
    const row = document.querySelector('tr.row-current')
    if (!area || !row) return { delta: null, visible: false, scrollTop: -1 }
    const a = area.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    return {
      delta: Math.round(Math.abs(r.top + r.height / 2 - (a.top + a.height / 2))),
      visible: r.top >= a.top && r.bottom <= a.bottom + 1,
      scrollTop: Math.round(area.scrollTop)
    }
  })

try {
  await sleep(1500)
  await win.getByRole('button', { name: /^Leaderboard/ }).click()
  await sleep(900)

  const rows = await win.locator('tbody tr').count()
  console.log(`\nseeded ${rows} rows (a match at the bottom is off-screen by design)`)

  // Ranked order, used to line the detail lines up with their titles.
  const rowsTitles = (await win.locator('tbody .t-title').allInnerTexts()).map((s) => s.trim())

  /* ---- 1. Nothing highlighted without a query, and the "/" hint is shown ---- */
  check('no match class before searching', await win.locator('tr.row-match').count(), 0)
  check('no mark before searching', await win.locator('tbody mark').count(), 0)
  check('the "/" hint is offered', await win.locator('.find-kbd').count(), 1)
  check('the counter is hidden before searching', await win.locator('.find-count').count(), 0)
  await win.screenshot({ path: join(root, 'smoke-find-empty.png') })

  /* ---- 2. The "/" shortcut focuses the field ---- */
  // The table row click opens a detail view, so the board is re-entered to leave
  // the focus somewhere that is not the find field.
  await win.locator('tbody tr').first().click()
  await sleep(600)
  await win.getByRole('button', { name: /^Leaderboard/ }).click()
  await sleep(700)

  const focusInfo = () =>
    win.evaluate(() => {
      const active = document.activeElement
      return {
        tag: active?.tagName ?? '',
        inFind: active !== null && active.closest('.find') !== null
      }
    })

  const before = await focusInfo()
  await win.keyboard.press('/')
  await sleep(400)
  const after = await focusInfo()
  check('focus starts outside the find field', before.inFind, false)
  check('"/" focuses the find field', after.inFind && after.tag === 'INPUT', true)

  /* ---- 3. One match, far down the table, reached by typing ---- */
  await type('zelda no densetsu')
  const matched = await win.locator('tr.row-match').count()
  check('both Zelda rows match', matched, 2)
  check('exactly one is the current match', await win.locator('tr.row-current').count(), 1)
  check('the counter names the position', (await win.locator('.find-count').innerText()).trim(), '1 / 2')
  check('the matched words are marked', await win.locator('tr.row-current mark').count(), 1)
  check('the "/" hint gives way to the counter', await win.locator('.find-kbd').count(), 0)
  check(
    'the mark holds the searched words',
    (await win.locator('tr.row-current mark').first().innerText()).trim().toLowerCase(),
    'zelda no densetsu'
  )

  const first = await centres()
  console.log(`\n   centres — match ${first.row}px, area ${first.area}px, off by ${first.delta}px`)
  check('the current match is centred', first.delta !== null && first.delta <= 4, true)

  // The detail line was rebuilt to allow a studio highlight, so it is checked:
  // a row with both shows "year · studio", a row with neither says so.
  const subs = await win.locator('tbody .t-sub').allInnerTexts()
  const subOf = (title) => {
    const index = rowsTitles.indexOf(title)
    return index === -1 ? undefined : subs[index]?.trim()
  }
  check('a full detail line reads "year · studio"', subOf('Zelda no Densetsu'), '2020 · Studio X')
  check('a year without a studio still reads', subOf('Anime 01'), '2020')
  check('the last row has no details', subOf('One Piece Odyssey'), 'No details')

  await win.screenshot({ path: join(root, 'smoke-find-single.png') })

  /* ---- 4. Stepping to the next match re-centres it, instantly ---- */
  const firstTitle = (await win.locator('tr.row-current .t-title').innerText()).trim()
  await input().press('Enter')
  // Deliberately far shorter than a smooth scroll would need, so arriving centred
  // this quickly is evidence that the jump is instant.
  await sleep(120)
  const second = await centres()
  const secondTitle = (await win.locator('tr.row-current .t-title').innerText()).trim()
  console.log(`   after Enter — "${secondTitle}" at ${second.row}px, off by ${second.delta}px`)
  check('the counter advanced', (await win.locator('.find-count').innerText()).trim(), '2 / 2')
  check('Enter moved to the other match', secondTitle !== firstTitle, true)
  check('the second match is centred too', second.delta !== null && second.delta <= 4, true)

  /* ---- 5. Shift+Enter goes back ---- */
  await win.locator('.find input').press('Shift+Enter')
  await sleep(450)
  check('Shift+Enter stepped back', (await win.locator('.find-count').innerText()).trim(), '1 / 2')

  /* ---- 6. Many matches, and accents ---- */
  await type('anime')
  const many = await win.locator('tr.row-match').count()
  check('every seeded row matches "anime"', many, 40)
  check('the counter counts them all', (await win.locator('.find-count').innerText()).trim(), '1 / 40')

  await type('pokemon')
  check('an accent-free query finds an accented title', await win.locator('tr.row-match').count(), 1)
  check(
    'the accented title is the match',
    (await win.locator('tr.row-current .t-title').innerText()).trim(),
    'Pokémon Chronicles'
  )
  const accented = await centres()
  console.log(`   accented match centred at ${accented.row}px, off by ${accented.delta}px`)
  check('the accented match is centred', accented.delta !== null && accented.delta <= 4, true)
  const accentedState = await currentRowState()
  check('and it is visible on screen', accentedState.visible, true)
  check('the container really scrolled', accentedState.scrollTop > 100, true)
  await win.screenshot({ path: join(root, 'smoke-find-accent.png') })

  /* ---- 6b. A single match, typed, must still be reached. This is the shape of
     the reported bug: "lycoris" found one row, highlighted it, and left the
     container at the top. ---- */
  await type('pokemon')
  const single = await currentRowState()
  console.log(
    `   single match "Pokémon Chronicles": scrollTop=${single.scrollTop}, off by ${single.delta}px, visible=${single.visible}`
  )
  check('a single typed match is centred', single.delta !== null && single.delta <= 4, true)
  check('a single typed match is visible', single.visible, true)

  /* ---- 6c. Enter with a single match cannot advance, but must re-centre, so the
     control is never inert. ---- */
  await win.evaluate(() => {
    document.querySelector('.content').scrollTop = 0
  })
  await sleep(300)
  const scrolledAway = await currentRowState()
  check('scrolled away for the test', scrolledAway.scrollTop, 0)
  await input().press('Enter')
  await sleep(600)
  const recentred = await currentRowState()
  console.log(`   after Enter: scrollTop=${recentred.scrollTop}, off by ${recentred.delta}px`)
  check('Enter re-centres a lone match', recentred.delta !== null && recentred.delta <= 4, true)
  check('and brings it back into view', recentred.visible, true)

  /* ---- 6d. The step buttons do the same. ---- */
  await win.evaluate(() => {
    document.querySelector('.content').scrollTop = 0
  })
  await sleep(300)
  await win.locator('.find-step').first().click()
  await sleep(600)
  const stepUp = await currentRowState()
  check('the up button re-centres a lone match', stepUp.delta !== null && stepUp.delta <= 4, true)
  await win.evaluate(() => {
    document.querySelector('.content').scrollTop = 0
  })
  await sleep(300)
  await win.locator('.find-step').nth(1).click()
  await sleep(600)
  const stepDown = await currentRowState()
  check('the down button re-centres a lone match', stepDown.delta !== null && stepDown.delta <= 4, true)

  /* ---- 7. A match at the very bottom: the scroll clamps, so all that is
     required is that the row ends up visible. This is the last row, and the
     container cannot scroll past its end to centre it. ---- */
  await type('one piece')
  check('the bottom row matches', await win.locator('tr.row-match').count(), 1)
  const lastRow = await win.locator('tr.row-current').boundingBox()
  const area = await win.locator('.content').boundingBox()
  const visible = lastRow !== null && area !== null && lastRow.y >= area.y && lastRow.y + lastRow.height <= area.y + area.height + 1
  const near = lastRow !== null && area !== null ? Math.round(area.y + area.height - (lastRow.y + lastRow.height)) : null
  console.log(`   last row sits ${near}px above the bottom edge of the scrolling area`)
  check('the bottom match is scrolled into view', visible, true)
  check(
    'and the scroll stopped at the end rather than overshooting',
    near !== null && near >= 0 && near < 120,
    true
  )

  /* ---- 7. No match ---- */
  await type('martian successor nadesico')
  check('no row matches a miss', await win.locator('tr.row-match').count(), 0)
  check('a miss says so', (await win.locator('.find-count').innerText()).trim(), 'No match')

  /* ---- 8. Clearing, and typing a literal slash ---- */
  // A slash typed INTO the field must stay a slash, not re-trigger the shortcut.
  await type('/')
  check('a slash inside the field stays literal', await input().inputValue(), '/')
  check('and finds nothing', (await win.locator('.find-count').innerText()).trim(), 'No match')

  await win.locator('.find-step').last().click()
  await sleep(400)
  check('the clear button empties the field', await input().inputValue(), '')
  check('no match class after clearing', await win.locator('tr.row-match').count(), 0)
  check('no mark after clearing', await win.locator('tbody mark').count(), 0)
  check('the counter is hidden when empty', await win.locator('.find-count').count(), 0)
  check('the "/" hint comes back', await win.locator('.find-kbd').count(), 1)
  check(
    'the clear button keeps the field focused',
    await win.evaluate(() => (document.activeElement?.tagName ?? '') === 'INPUT'),
    true
  )

  /* ---- 9. Escape clears first, then releases the focus ---- */
  await type('anime 07')
  check('one row matches', await win.locator('tr.row-match').count(), 1)
  check('the row is not removed from the table', await win.locator('tbody tr').count(), 44)
  await input().press('Escape')
  await sleep(400)
  check('the first Escape empties the field', await input().inputValue(), '')
  const stillFocused = await win.evaluate(
    () => document.activeElement !== null && document.activeElement.closest('.find') !== null
  )
  check('and keeps the focus, so the search can be retyped', stillFocused, true)
  await win.keyboard.press('Escape')
  await sleep(400)
  const releasedFocus = await win.evaluate(
    () => document.activeElement !== null && document.activeElement.closest('.find') !== null
  )
  check('a second Escape gives the keyboard back to the page', releasedFocus, false)
  check('the table still holds every row', await win.locator('tbody tr').count(), 44)

  const ranked = (await win.locator('tbody .t-title').allInnerTexts()).map((s) => s.trim())
  check('the ranking still starts at rank 1', ranked[0], 'Anime 01')
} catch (err) {
  failures += 1
  console.log(`\n[error] ${err.message}`)
} finally {
  await app.close()
}

console.log(`\n${failures === 0 ? 'FIND BAR TEST OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
