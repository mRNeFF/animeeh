/**
 * Screenshots the TierList tab on a copy of the real library, so the result can
 * be looked at rather than only asserted on.
 *
 * Creates a list, adds every entry, sorts by the scores already given, and takes
 * a picture of the board and of the grid.
 *
 * The real data file is copied into a throwaway profile, so nothing here can
 * write to the actual library.
 *
 * Usage: node scripts/preview-tierlist.mjs
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

const profile = mkdtempSync(join(tmpdir(), 'animeeh-tlpreview-'))
copyFileSync(real, join(profile, 'animeeh-data.json'))
const copy = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
copy.settings.checkForUpdatesOnStartup = false
copy.settings.language = 'fr'
copy.tierLists = []
writeFileSync(join(profile, 'animeeh-data.json'), JSON.stringify(copy), 'utf-8')

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))

try {
  await win.waitForTimeout(1900)
  await win.getByRole('button', { name: /^TierList/ }).click()
  await win.waitForTimeout(700)

  await win.getByRole('button', { name: /Créer une tierlist/i }).first().click()
  await win.waitForTimeout(500)
  await win.locator('.tl-kinds .btn', { hasText: /^Animés/ }).click()
  await win.waitForTimeout(800)

  await win.getByRole('button', { name: /Ajouter des éléments/i }).click()
  await win.waitForTimeout(700)
  await win.locator('.tl-picker-actions .btn').click()
  await win.waitForTimeout(900)
  await win.locator('.tl-picker .icon-btn').click()
  await win.waitForTimeout(500)

  await win.getByRole('button', { name: /Trier par score/i }).click()
  await win.waitForTimeout(1200)

  const perRow = await win.locator('.tl-row').evaluateAll((els) =>
    els.map((el) => el.querySelectorAll('.tl-area .tl-tile').length)
  )
  console.log(`per row S to F: ${perRow.join(' ')}`)
  await win.screenshot({ path: join(root, 'preview-tierlist-board.png') })

  await win.locator('.tl-bar .btn').first().click()
  await win.waitForTimeout(800)
  await win.locator('.tl-name').first().click().catch(() => {})
  await win.keyboard.press('Enter')
  await win.waitForTimeout(600)
  await win.screenshot({ path: join(root, 'preview-tierlist-cards.png') })
  console.log('screenshots written')
} catch (err) {
  console.log(`[error] ${err.message}`)
} finally {
  await app.close()
}
