/**
 * Screenshots the tier list with a long row label, to show the overflow fixed.
 *
 * The fault reported was a renamed row's text running across the row beside it.
 * This builds a list whose top rows carry long labels and long element titles, so
 * both places text could escape are visible in one picture.
 *
 * The real data file is copied into a throwaway profile, so nothing here can write
 * to the actual library.
 *
 * Usage: node scripts/preview-tierlist-labels.mjs
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

const profile = mkdtempSync(join(tmpdir(), 'animeeh-labels-'))
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
  await win.waitForTimeout(800)

  // Two rows renamed to long strings, which is what used to overflow.
  const RENAMES = ['Chefs-d oeuvre absolus', 'Je les ai abandonnés']
  for (let i = 0; i < RENAMES.length; i += 1) {
    await win.locator('.tl-label').nth(i).click()
    await win.waitForTimeout(350)
    await win.locator('.tl-style input.input').fill(RENAMES[i])
    await win.waitForTimeout(300)
    await win.locator('.tl-style .btn', { hasText: /^Terminé/ }).click()
    await win.waitForTimeout(300)
  }

  // Then fill the board, so long element titles are on screen too.
  await win.getByRole('button', { name: /Ajouter des éléments/i }).click()
  await win.waitForTimeout(500)
  await win.locator('.tl-picker .tl-search input').fill('tengoku')
  for (let i = 0; i < 40; i += 1) {
    await win.waitForTimeout(400)
    if ((await win.locator('.tl-res').count()) > 0) break
  }
  await win.locator('.tl-picker-actions .btn, .tl-section-head .btn').first().click()
  await win.waitForTimeout(800)
  await win.locator('.tl-picker .icon-btn').click()
  await win.waitForTimeout(500)
  await win.getByRole('button', { name: /Trier par score/i }).click()
  await win.waitForTimeout(1200)

  // And one styled row, to show the colours and the font changing.
  await win.locator('.tl-label').nth(2).click()
  await win.waitForTimeout(400)
  await win.locator('.tl-style-chips .tl-filter', { hasText: 'Mono' }).click()
  await win.waitForTimeout(300)
  await win.locator('.tl-swatch').nth(9).click()
  await win.waitForTimeout(500)

  await win.screenshot({ path: join(root, 'preview-labels.png') })
  console.log('screenshot written')
} catch (err) {
  console.log(`[error] ${err.message}`)
} finally {
  await app.close()
}
