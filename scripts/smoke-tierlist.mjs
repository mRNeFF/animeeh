/**
 * Drives the TierList tab end to end, against a copy of the real library.
 *
 * Covers the whole path the user takes: create a list in one click, search for
 * elements, add anime, characters and themes from the whole catalogue rather than
 * only from the library, drag one into a row, use the keyboard route, rename a
 * row, sort by score, reload to prove it persisted, and delete the list.
 *
 * The real data file is copied into a throwaway profile rather than opened in
 * place, so nothing here can write to the actual library.
 *
 * Usage: node scripts/smoke-tierlist.mjs
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

const real = join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')
if (!existsSync(real)) {
  console.error(`No library at ${real}`)
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'animeeh-tierlist-'))
copyFileSync(real, join(profile, 'animeeh-data.json'))
const copy = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
copy.settings.checkForUpdatesOnStartup = false
copy.settings.language = 'en'
copy.tierLists = []
writeFileSync(join(profile, 'animeeh-data.json'), JSON.stringify(copy), 'utf-8')

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => {
  failures += 1
  console.log(`[pageerror] ${e.message}`)
})

const sleep = (ms) => win.waitForTimeout(ms)
const board = () => win.locator('.tl-capture')
const tilesIn = (selector) => win.locator(`${selector} .tl-tile`)
const searchBox = () => win.locator('.tl-picker .tl-search input')

/**
 * Types a query and waits for results to land.
 *
 * Retried once and given a generous deadline: the search is live, and AniList
 * allows about thirty requests a minute, so a busy run can be throttled. The app
 * already retries a 429 internally; this covers the case where the throttle
 * outlasts those retries.
 */
const search = async (term) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await searchBox().fill('')
    // Wait for the list to empty, so a read cannot pick up the previous query.
    for (let i = 0; i < 20; i += 1) {
      if ((await win.locator('.tl-res').count()) === 0) break
      await sleep(200)
    }
    await searchBox().fill(term)
    const deadline = Date.now() + 40_000
    while (Date.now() < deadline) {
      await sleep(500)
      if ((await win.locator('.tl-res').count()) > 0) return true
    }
    console.log(`   (no results for "${term}", retrying)`)
    await sleep(5000)
  }
  return false
}

const pickFilter = (label) => win.locator('.tl-filter', { hasText: label }).first().click()

try {
  await sleep(1800)

  /* ---- 1. The tab and the empty state ---- */
  console.log('\n1. THE TAB')
  const nav = await win.locator('.nav-label').allInnerTexts()
  check('TierList is in the navigation', nav.map((s) => s.trim()).includes('TierList'))
  check(
    'between Films & OVA and Leaderboard',
    nav.map((s) => s.trim()).slice(0, 4),
    ['Anime', 'Films & OVA', 'TierList', 'Leaderboard']
  )

  await win.getByRole('button', { name: /^TierList/ }).click()
  await sleep(700)
  check('the empty state is shown', await win.locator('.empty h3').count(), 1)

  /* ---- 2. Creating takes one click, with no question asked ---- */
  console.log('\n2. CREATING, IN ONE CLICK')
  await win.getByRole('button', { name: /Create a tierlist/i }).first().click()
  await sleep(900)
  check('the board opened immediately', await board().count(), 1)
  check('no kind dialog was shown', await win.locator('.tl-kinds').count(), 0)
  check('with seven rows', await win.locator('.tl-row').count(), 7)
  const letters = await win.locator('.tl-label').allInnerTexts()
  check('labelled S to F', letters.map((s) => s.trim()[0]).join(''), 'SABCDEF')

  const rows = await win.locator('.tl-row').evaluateAll((els) =>
    els.map((el) => {
      const label = el.querySelector('.tl-label')
      return {
        letter: label?.textContent?.trim() ?? '',
        background: label ? getComputedStyle(label).backgroundImage.slice(0, 24) : ''
      }
    })
  )
  check('each row is coloured', rows.every((r) => r.background.includes('gradient')))
  check('the S row is not plain grey', rows[0].background !== 'linear-gradient(160deg, #2b3d5e')

  /* ---- 3. One search, with filters ---- */
  console.log('\n3. ONE SEARCH WITH FILTERS')
  await win.getByRole('button', { name: /Add elements/i }).click()
  await sleep(600)

  const filters = (await win.locator('.tl-filter').allInnerTexts()).map((s) => s.trim())
  console.log(`   filters: ${filters.join(' | ')}`)
  check('six filters are offered', filters.length, 6)
  check('including characters', filters.some((f) => /character/i.test(f)))
  check('including openings and endings', filters.some((f) => /opening/i.test(f)))
  check('including soundtracks', filters.some((f) => /soundtrack/i.test(f)))

  check('it asks for a query first', (await win.locator('.tl-picker .hint').innerText()).length > 0)

  const found = await search('frieren')
  check('anime results arrive', found)
  const sections = (await win.locator('.tl-section-head .t').allInnerTexts()).map((s) => s.trim())
  console.log(`   sections: ${sections.join(' | ')}`)
  check('both anime and characters came back', sections.length, 2)

  /* ---- 4. The catalogue, not just the library ---- */
  console.log('\n4. THE WHOLE CATALOGUE')
  const tracked = await win.locator('.tl-res .b', { hasText: 'in your list' }).count()
  const untracked = (await win.locator('.tl-res .b').allInnerTexts()).filter(
    (s) => !/in your list/.test(s)
  ).length
  console.log(`   ${tracked} marked as tracked, ${untracked} from the wider catalogue`)
  check('some results are marked as already tracked', tracked > 0)
  check('and results outside the library are found', untracked > 0)
  await win.screenshot({ path: join(root, 'smoke-tierlist-search.png') })

  /* ---- 5. Adding an anime, then a character ---- */
  console.log('\n5. ADDING FROM EACH SOURCE')
  await win.locator('.tl-section', { hasText: 'Anime' }).first().locator('.tl-res-main').first().click()
  await sleep(500)
  await pickFilter('Characters')
  await sleep(400)
  const characterResults = await win.locator('.tl-res').count()
  console.log(`   ${characterResults} character(s) for the same query`)
  check('the character filter narrows to characters', characterResults > 0)
  await win.locator('.tl-res-main').first().click()
  await sleep(500)

  await pickFilter('Seasons')
  await sleep(500)
  const seasonResults = await win.locator('.tl-res').count()
  console.log(`   ${seasonResults} season(s) in the library`)
  check('seasons come from the library', seasonResults > 0)

  await win.locator('.tl-picker .icon-btn').click()
  await sleep(500)
  const mixed = await tilesIn('.tl-pool-tiles').count()
  check('an anime and a character are both in the pool', mixed, 2)

  /* ---- 6. Themes for any anime ---- */
  console.log('\n6. OPENINGS AND ENDINGS')
  await win.getByRole('button', { name: /Add elements/i }).click()
  await sleep(500)
  await pickFilter('Openings')
  await sleep(400)
  await search('bakemonogatari')
  const animeRows = await win.locator('.tl-section .tl-res').count()
  check('an anime outside the library is found', animeRows > 0)
  await win.locator('.tl-open').first().click()
  {
    // Same reasoning as the search helper: a live call, so a generous deadline.
    const deadline = Date.now() + 40_000
    while (Date.now() < deadline) {
      await sleep(600)
      if ((await win.locator('.tl-themes .tl-res').count()) > 0) break
    }
  }
  const themeRows = await win.locator('.tl-themes .tl-res').count()
  console.log(`   ${themeRows} theme(s) loaded`)
  check('its themes load on demand', themeRows > 0)
  const themeLabels = (await win.locator('.tl-themes .tl-res .b').allInnerTexts())
    .map((s) => s.split('·')[0].trim())
    .slice(0, 4)
  console.log(`   labels: ${themeLabels.join(', ')}`)
  check('labelled OP1, OP2, ED1…', themeLabels.every((l) => /^(OP|ED)\d/.test(l)))

  await win.locator('.tl-themes .tl-res-main').first().click()
  await sleep(500)
  await win.locator('.tl-picker .icon-btn').click()
  await sleep(500)
  const withTheme = await tilesIn('.tl-pool-tiles').count()
  check('the theme joined the pool', withTheme, mixed + 1)
  await win.screenshot({ path: join(root, 'smoke-tierlist-mixed.png') })

  /* ---- 7. Drag one into a row ---- */
  console.log('\n7. DRAGGING')
  // Playwright's dragTo, not raw mouse moves: moving the pointer does not raise
  // the HTML5 dragstart and drop events the board listens for.
  const first = tilesIn('.tl-pool-tiles').first()
  const target = win.locator('.tl-row').first().locator('.tl-area')
  check('both ends are on screen', (await first.boundingBox()) !== null && (await target.boundingBox()) !== null)
  await first.dragTo(target)
  await sleep(700)
  check('it is now in the S row', await tilesIn('.tl-row:nth-child(1) .tl-area').count(), 1)
  check('and no longer in the pool', await tilesIn('.tl-pool-tiles').count(), withTheme - 1)

  /* ---- 8. The keyboard route ---- */
  console.log('\n8. THE KEYBOARD')
  await tilesIn('.tl-pool-tiles').first().click()
  await sleep(250)
  check('the selection is shown', (await win.locator('.tl-sel').innerText()).includes('1'))
  await win.keyboard.press('a')
  await sleep(500)
  check('pressing A sends it to the A row', await tilesIn('.tl-row:nth-child(2) .tl-area').count(), 1)

  /* ---- 9. Adding and removing rows ---- */
  console.log('\n9. ADDING AND REMOVING ROWS')

  const rowsBefore = await win.locator('.tl-row').count()
  await win.locator('.tl-add-row').click()
  await sleep(500)
  check('a row was added', await win.locator('.tl-row').count(), rowsBefore + 1)

  // The new row has no letter left to take, so it takes the neutral colour rather
  // than repeating one of the seven.
  const lastBg = await win.locator('.tl-label').last().evaluate((el) => getComputedStyle(el).backgroundImage)
  check('and it is not a repeated palette colour', lastBg.includes('#2b3d5e') || lastBg.includes('43, 61, 94'), true)

  // Deleting it through its own options panel.
  await win.locator('.tl-label').last().click()
  await sleep(450)
  check('its options panel opened', await win.locator('.tl-style').count(), 1)
  await win.locator('.tl-style .btn.danger').click()
  await sleep(500)
  check('the row is gone', await win.locator('.tl-row').count(), rowsBefore)
  check('and the panel closed with it', await win.locator('.tl-style').count(), 0)

  /* ---- 10. The row options panel, and the label must not overflow ---- */
  console.log('\n10. ROW OPTIONS AND THE OVERFLOW FIX')

  // The fault that was reported: a renamed row's text ran across the row beside
  // it. The label must stay inside its 82px box however long the text is.
  await win.locator('.tl-label').first().click()
  await sleep(500)
  check('clicking the label opens the options panel', await win.locator('.tl-style').count(), 1)
  const panelPos = await win.locator('.tl-style').boundingBox()
  const viewport = win.viewportSize() ?? { width: 1152, height: 800 }
  console.log(
    `   panel at x=${panelPos ? Math.round(panelPos.x) : '?'} y=${panelPos ? Math.round(panelPos.y) : '?'}` +
      ` in a ${viewport.width}×${viewport.height} window`
  )
  check(
    'it is anchored bottom right',
    panelPos !== null && panelPos.x + panelPos.width > viewport.width * 0.6 && panelPos.y + panelPos.height > viewport.height * 0.5
  )

  const longLabel = 'Chefs-d oeuvre absolus'
  await win.locator('.tl-style input.input').fill(longLabel)
  await sleep(400)
  const labelBox = await win.locator('.tl-label').first().boundingBox()
  const textBox = await win.locator('.tl-label-text').first().boundingBox()
  const labelMetrics = await win.locator('.tl-label').first().evaluate((el) => ({
    fontSize: getComputedStyle(el).fontSize,
    overflow: getComputedStyle(el).overflow,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth
  }))
  console.log(
    `   label ${labelBox ? Math.round(labelBox.width) : '?'}px wide, text ` +
      `${textBox ? Math.round(textBox.width) : '?'}×${textBox ? Math.round(textBox.height) : '?'}, ` +
      `font ${labelMetrics.fontSize}`
  )
  check('the text stays inside the label', textBox !== null && labelBox !== null && textBox.width <= labelBox.width + 1)
  check('the label clips as a backstop', labelMetrics.overflow, 'hidden')

  // The row beside it must not be pushed or overlapped.
  const rowWidths = await win.locator('.tl-row').evaluateAll((els) =>
    els.map((el) => Math.round(el.querySelector('.tl-label').getBoundingClientRect().width))
  )
  check('every label is the same width', new Set(rowWidths).size, 1)

  /* ---- Changing the colour, the font and the size ---- */
  await win.locator('.tl-swatch').nth(2).click()
  await sleep(350)
  const afterColor = await win.locator('.tl-label').first().evaluate((el) => getComputedStyle(el).backgroundColor)
  check('a swatch changes the background', afterColor, 'rgb(138, 128, 234)')

  await win.locator('.tl-style-chips .tl-filter', { hasText: 'Mono' }).click()
  await sleep(350)
  const afterFont = await win.locator('.tl-label').first().evaluate((el) => getComputedStyle(el).fontFamily)
  check('the font changes', /mono|consolas|cascadia/i.test(afterFont))

  await win.locator('.tl-style .slider').fill('30')
  await sleep(350)
  const afterSize = await win.locator('.tl-label').first().evaluate((el) => getComputedStyle(el).fontSize)
  check('the size changes', afterSize, '30px')

  // An explicit size must still not let the text escape.
  const afterResize = await win.locator('.tl-label-text').first().boundingBox()
  check('and it still clips at a large size', afterResize !== null && afterResize.width <= labelBox.width + 1)

  await win.locator('.tl-style .btn', { hasText: /^Palette/ }).click()
  await sleep(350)
  const afterReset = await win.locator('.tl-label').first().evaluate((el) => getComputedStyle(el).backgroundImage)
  check('the palette can be restored', afterReset.includes('gradient'))

  await win.locator('.tl-style .btn', { hasText: /^Done/ }).click()
  await sleep(400)
  check('the panel closes', await win.locator('.tl-style').count(), 0)
  await win.screenshot({ path: join(root, 'smoke-tierlist-style.png') })

  /* ---- 11. Right-click offers a web search ---- */
  console.log('\n11. RIGHT-CLICK TO LOOK SOMETHING UP')

  const anAnime = win.locator('.tl-area .tl-tile').first()
  await anAnime.click({ button: 'right' })
  await sleep(500)
  check('a menu opens', await win.locator('.tl-menu').count(), 1)
  const menuItems = (await win.locator('.tl-menu-item').allInnerTexts()).map((s) => s.trim())
  console.log(`   entries: ${menuItems.join(' | ')}`)
  check('it offers a web search', menuItems.some((s) => /web/i.test(s)))
  check('and a remove', menuItems.some((s) => /remove/i.test(s)))
  await win.screenshot({ path: join(root, 'smoke-tierlist-menu.png') })

  // Opening a link must not throw, and must not navigate the app itself.
  const url = await win.evaluate(() => window.animeeh.openExternal('https://example.com/'))
  check('opening a link is accepted', url, true)
  const badScheme = await win.evaluate(() => window.animeeh.openExternal('file:///C:/Windows/win.ini'))
  check('a non-web scheme is refused', badScheme, false)
  const notAUrl = await win.evaluate(() => window.animeeh.openExternal('javascript:alert(1)'))
  check('and so is script', notAUrl, false)

  await win.keyboard.press('Escape')
  await sleep(400)
  check('Escape closes the menu', await win.locator('.tl-menu').count(), 0)

  /* ---- 12. Renaming ---- */
  console.log('\n12. RENAMING')

  await win.locator('.tl-name').click()
  await sleep(300)
  await win.locator('.tl-name-input').fill('Mon mix')
  await win.keyboard.press('Enter')
  await sleep(400)
  check('the list was renamed', (await win.locator('.tl-name').innerText()).trim(), 'Mon mix')

  /* ---- 13. It persisted ---- */
  console.log('\n13. PERSISTENCE')
  await sleep(800)
  const onDisk = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
  check('the list is in the data file', onDisk.tierLists.length, 1)
  check('under its new name', onDisk.tierLists[0].name, 'Mon mix')
  check('with a mixed set of elements', onDisk.tierLists[0].items.length, withTheme)
  const kinds = [...new Set(onDisk.tierLists[0].items.map((i) => i.kind))].sort()
  console.log(`   element kinds stored: ${kinds.join(', ')}`)
  check('holding more than one kind', kinds.length > 1)
  check('with their placements', onDisk.tierLists[0].items.filter((i) => i.rowId !== null).length > 0)

  await win.reload()
  await sleep(1900)
  await win.getByRole('button', { name: /^TierList/ }).click()
  await sleep(800)
  check('one card after reloading', await win.locator('.tl-card:not(.new)').count(), 1)
  check('named correctly', (await win.locator('.tl-card .name').first().innerText()).trim(), 'Mon mix')
  check('the card previews the board', await win.locator('.tl-card .prow').count(), 5)

  /* ---- 14. Reopening and deleting ---- */
  console.log('\n14. REOPENING AND DELETING')
  await win.locator('.tl-card .preview').first().click()
  await sleep(800)
  check('the board reopened', await board().count(), 1)
  check('with the placements intact', (await win.locator('.tl-area .tl-tile').count()) > 0)

  await win.locator('.tl-bar .btn').first().click()
  await sleep(700)
  await win.locator('.tl-card .icon-btn').first().click()
  await sleep(700)
  check('deleting returns to the empty state', await win.locator('.empty h3').count(), 1)
  const afterDelete = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
  check('and the data file agrees', afterDelete.tierLists.length, 0)

  /* ---- 15. The one source with no catalogue ---- */
  console.log('\n15. SOUNDTRACKS')
  await win.getByRole('button', { name: /Create a tierlist/i }).first().click()
  await sleep(800)
  await win.getByRole('button', { name: /Add elements/i }).click()
  await sleep(500)
  await pickFilter('Soundtracks')
  await sleep(400)
  const ostNote = await win.locator('.tl-picker .note').innerText()
  check('it explains why it is empty', ostNote.length > 40)
  // Two fields are on screen in this filter: the search box above, and the track
  // field. The track one is the last.
  const trackField = win.locator('.tl-picker input.input').last()
  check('and offers a typed field', await win.locator('.tl-picker input.input').count(), 2)
  await trackField.fill('Mother Sea')
  await win.getByRole('button', { name: /Add the track/i }).click()
  await sleep(500)
  await win.locator('.tl-picker .icon-btn').click()
  await sleep(500)
  check('the typed track is in the pool', await tilesIn('.tl-pool-tiles').count(), 1)
} catch (err) {
  failures += 1
  console.log(`\n[error] ${err.message}`)
  await win.screenshot({ path: join(root, 'smoke-tierlist-failure.png') }).catch(() => {})
} finally {
  await app.close()
}

console.log(`\n${failures === 0 ? 'TIERLIST TEST OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)

