/**
 * Screenshots the grade palette in place, across every tier.
 *
 * The ranking is sorted by score, so the top of the table shows the high tiers
 * and the bottom the low ones. Both ends are captured, plus the library view
 * where the badges sit on cards, which is where the palette is seen most.
 *
 * The user's data file is copied into a throwaway profile rather than opened in
 * place, so nothing here can write to the real library.
 *
 * Usage: node scripts/preview-palette.mjs
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const real = join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')
if (!existsSync(real)) {
  console.error(`No library at ${real}`)
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'animeeh-palette-'))
copyFileSync(real, join(profile, 'animeeh-data.json'))
const copy = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
copy.settings.checkForUpdatesOnStartup = false
writeFileSync(join(profile, 'animeeh-data.json'), JSON.stringify(copy), 'utf-8')

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))

/** Which tier each row's badge is showing, in table order. */
const badgeLetters = () =>
  win.locator('tbody tr .grade-badge, tbody tr [class*="grade"]').allInnerTexts().catch(() => [])

try {
  await win.waitForTimeout(1900)

  /* ---- The library cards ---- */
  await win.screenshot({ path: join(root, 'palette-library.png') })
  console.log('library screenshot taken')

  /* ---- The ranking, top and bottom ---- */
  await win.getByRole('button', { name: /^(Leaderboard|Classement)/ }).click()
  await win.waitForTimeout(1000)

  const rows = await win.locator('tbody tr').count()
  const letters = await win.locator('tbody tr td:last-child').allInnerTexts()
  const tiers = [...new Set(letters.map((s) => s.trim()))].filter(Boolean)
  console.log(`${rows} ranked rows, tiers present: ${tiers.join(' ')}`)

  await win.screenshot({ path: join(root, 'palette-board-top.png') })

  await win.locator('.content').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await win.waitForTimeout(700)
  await win.screenshot({ path: join(root, 'palette-board-bottom.png') })
  console.log('ranking screenshots taken')
} catch (err) {
  console.log(`[error] ${err.message}`)
} finally {
  await app.close()
}
