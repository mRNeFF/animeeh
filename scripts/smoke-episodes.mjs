/**
 * Verifies the two additions:
 *   1. "Load episode names" on an anime that has none,
 *   2. clearing the whole ranking.
 *
 * Vinland Saga is the interesting case: AniList has no episode titles for it at
 * all, while Kitsu lists all 24, so it exercises the new primary source.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const userDataDir = mkdtempSync(join(tmpdir(), 'animeeh-episodes-'))

const errors = []
const app = await electron.launch({ args: [root, `--user-data-dir=${userDataDir}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

const sleep = (ms) => win.waitForTimeout(ms)
const shot = (name) => win.screenshot({ path: join(root, `smoke-${name}.png`) })

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(1600)

  /* ---- Import the bundled list ---- */
  await win.getByRole('button', { name: 'Settings' }).click()
  await sleep(600)
  await win.getByRole('button', { name: /Import the N\.xlsx list/i }).click()
  await sleep(2500)
  console.log(`SETUP: ${(await win.locator('.mono').first().innerText()).trim()}`)

  /* ---- Open Vinland Saga ---- */
  await win.getByRole('button', { name: 'My Anime' }).click()
  await sleep(900)
  await win.locator('.search input').fill('vinland')
  await sleep(700)
  const cards = await win.locator('.card').count()
  console.log(`EPISODES: search "vinland" -> ${cards} card(s)`)
  await win.locator('.card').first().click()
  await sleep(900)

  const title = await win.locator('.detail-title-input').inputValue()
  const before = (await win.locator('.ep-row').count()) - 1
  console.log(`EPISODES: opened "${title}", ${before} episode rows before loading`)

  const hint = (await win.locator('.section-title .hint').last().innerText()).replace(/\s+/g, ' ')
  console.log(`EPISODES: section hint = ${hint.trim()}`)

  /* ---- Load the names ---- */
  const loadBtn = win.getByRole('button', { name: /Load episode names/i })
  console.log(`EPISODES: button present = ${(await loadBtn.count()) === 1}`)
  await loadBtn.click()

  await win.locator('.names-message').waitFor({ state: 'visible', timeout: 60000 })
  const message = (await win.locator('.names-message').innerText()).replace(/\s+/g, ' ').trim()
  const kind = (await win.locator('.names-message').getAttribute('class')) ?? ''
  console.log(`EPISODES: result = "${message}"${kind.includes('error') ? ' [ERROR]' : ''}`)

  const after = (await win.locator('.ep-row').count()) - 1
  const titled = await win.locator('.ep-row .ep-title').evaluateAll((els) =>
    els.map((el) => el.value).filter((v) => v && v.trim() !== '')
  )
  const scores = await win.locator('.ep-row .score-input').evaluateAll((els) =>
    els.map((el) => el.value)
  )
  const firstTitle = titled[0] ?? ''
  const lastTitle = titled[titled.length - 1] ?? ''
  const unrated = scores.filter((s) => s === '').length

  console.log(`EPISODES: ${after} rows after loading, ${titled.length} carry a name`)
  console.log(`EPISODES: first = "${firstTitle}"`)
  console.log(`EPISODES: last  = "${lastTitle}"`)
  console.log(`EPISODES: unrated episodes = ${unrated} (all should be unrated)`)
  await shot('episode-names')

  /* ---- Reload to prove it persisted ---- */
  await win.reload()
  await sleep(1600)
  await win.locator('.card').first().waitFor({ state: 'visible', timeout: 20000 })
  await win.locator('.search input').fill('vinland')
  await sleep(700)
  await win.locator('.card').first().click()
  await sleep(900)
  const persisted = await win.locator('.ep-row .ep-title').evaluateAll((els) =>
    els.map((el) => el.value).filter((v) => v && v.trim() !== '')
  )
  console.log(`EPISODES: after reload, ${persisted.length} names kept`)

  /* ---- Clear the whole ranking ---- */
  await win.getByRole('button', { name: 'Settings' }).click()
  await sleep(600)

  const dangerVisible = await win.locator('.danger-panel').count()
  console.log(`CLEAR: danger zone present = ${dangerVisible === 1}`)
  await shot('settings-danger')

  await win.getByRole('button', { name: /Clear the entire ranking/i }).click()
  await sleep(500)

  const confirmBody = (await win.locator('.modal-sub').innerText()).replace(/\s+/g, ' ').trim()
  console.log(`CLEAR: confirmation = ${confirmBody}`)

  // The confirm button must stay disabled until the exact word is typed.
  const confirmBtn = win.locator('.modal button.btn.danger')
  const disabledBefore = await confirmBtn.isDisabled()
  await win.locator('.modal input.input').fill('wrong word')
  await sleep(250)
  const disabledWrong = await confirmBtn.isDisabled()
  console.log(`CLEAR: confirm disabled — empty: ${disabledBefore}, wrong word: ${disabledWrong}`)

  await win.locator('.modal input.input').fill('clear all')
  await sleep(250)
  const enabled = await confirmBtn.isEnabled()
  console.log(`CLEAR: confirm enabled with the right word = ${enabled}`)

  await confirmBtn.click()
  await sleep(1200)

  const resultMessage = (await win.locator('.mono').first().innerText()).trim()
  console.log(`CLEAR: result = "${resultMessage}"`)

  await win.getByRole('button', { name: 'My Anime' }).click()
  await sleep(900)
  const remaining = await win.locator('.card').count()
  const emptyState = await win.locator('.empty h3').count()
  console.log(`CLEAR: ${remaining} cards left, empty state shown = ${emptyState === 1}`)
  await shot('ranking-cleared')

  console.log('EPISODE/CLEAR TEST OK')
} catch (err) {
  errors.push(`[script] ${err.message}`)
  try {
    await shot('episode-clear-failure')
  } catch {
    /* ignore */
  }
} finally {
  if (errors.length) console.log('--- ERRORS ---\n' + errors.join('\n'))
  await app.close().catch(() => {})
}

process.exit(errors.length ? 1 : 0)
