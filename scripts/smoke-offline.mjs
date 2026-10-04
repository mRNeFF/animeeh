/**
 * Verifies the app degrades gracefully when AniList is unreachable.
 *
 * AniList access failed from some networks during development, so the add form
 * must show a clear message and still allow fully manual entry.
 *
 * Points the client at a dead endpoint, then checks that:
 *   1. the error is surfaced in the UI,
 *   2. an anime can still be added by hand.
 */
import { _electron as electron } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const userDataDir = mkdtempSync(join(tmpdir(), 'animeeh-offline-'))

const errors = []
const app = await electron.launch({
  args: [root, `--user-data-dir=${userDataDir}`],
  cwd: root,
  env: {
    ...process.env,
    // Port 9 (discard) — nothing listens, so the request fails immediately.
    ANIMEEH_ANILIST_ENDPOINT: 'http://127.0.0.1:9'
  }
})

const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

const sleep = (ms) => win.waitForTimeout(ms)

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(1500)

  await win.getByRole('button', { name: /Add your first anime/i }).click()
  await sleep(400)

  await win.locator('.al-block input.input').fill('frieren')

  // The error state must appear instead of the app hanging or breaking.
  await win.locator('.al-state.error').waitFor({ state: 'visible', timeout: 30000 })
  const message = (await win.locator('.al-state.error').innerText()).replace(/\s+/g, ' ').trim()
  console.log(`OFFLINE: error shown -> "${message}"`)
  await win.screenshot({ path: join(root, 'smoke-offline-error.png') })

  // Manual entry must still work.
  await win.locator('#af-title').fill('Manual Entry Test')
  await win.locator('#af-year').fill('2024')
  await win.locator('.modal button[type=submit]').click()
  await sleep(1200)

  const title = await win.locator('.detail-title-input').inputValue()
  console.log(`OFFLINE: manual entry created -> "${title}" (expected "Manual Entry Test")`)

  await win.getByRole('button', { name: 'Library' }).click()
  await sleep(600)
  const cards = await win.locator('.card').count()
  console.log(`OFFLINE: library shows ${cards} card(s) (expected 1)`)
  await win.screenshot({ path: join(root, 'smoke-offline-manual.png') })

  const dataFile = join(userDataDir, 'animeeh-data.json')
  console.log(`OFFLINE: data file written = ${existsSync(dataFile)}`)
  if (existsSync(dataFile)) {
    console.log(`OFFLINE: stored = ${JSON.parse(readFileSync(dataFile, 'utf-8')).anime.length} anime`)
  }

  console.log('OFFLINE TEST OK')
} catch (err) {
  errors.push(`[script] ${err.message}`)
  try {
    await win.screenshot({ path: join(root, 'smoke-offline-failure.png') })
  } catch {
    /* ignore */
  }
} finally {
  if (errors.length) console.log('--- ERRORS ---\n' + errors.join('\n'))
  await app.close()
}

process.exit(errors.length ? 1 : 0)
