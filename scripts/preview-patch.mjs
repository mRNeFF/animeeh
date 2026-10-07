/**
 * Screenshots the statistics and settings screens, to check what the patch
 * changed: the films tile in one, and the missing N.xlsx import in the other.
 *
 * The user's data file is copied into a throwaway profile rather than opened in
 * place, so nothing here can write to the real library.
 *
 * Usage: node scripts/preview-patch.mjs
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

const profile = mkdtempSync(join(tmpdir(), 'animeeh-patch-'))
copyFileSync(real, join(profile, 'animeeh-data.json'))
const copy = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
copy.settings.checkForUpdatesOnStartup = false
writeFileSync(join(profile, 'animeeh-data.json'), JSON.stringify(copy), 'utf-8')

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))

try {
  await win.waitForTimeout(1900)

  /* ---- Statistics: the tiles ---- */
  await win.getByRole('button', { name: /^(Statistics|Statistiques)/ }).click()
  await win.waitForTimeout(1200)

  const tiles = await win.locator('.stat-tile').evaluateAll((els) =>
    els.map((el) => ({
      label: el.querySelector('.stat-label')?.textContent?.trim(),
      value: el.querySelector('.stat-value')?.textContent?.trim()
    }))
  )
  console.log('\nstatistics tiles:')
  for (const tile of tiles) console.log(`   ${String(tile.label).padEnd(26)} ${tile.value}`)

  const ovaTile = tiles.find((t) => /ova/i.test(t.label ?? '') && !/films/i.test(t.label ?? ''))
  console.log(`\n   a bare "OVAs" tile is present: ${ovaTile !== undefined ? 'YES' : 'no'}`)

  await win.locator('.stat-tile').first().scrollIntoViewIfNeeded().catch(() => {})
  await win.screenshot({ path: join(root, 'patch-stats.png') })

  /* ---- Settings: the backups panel ---- */
  await win.getByRole('button', { name: /^(Settings|Réglages)/ }).click()
  await win.waitForTimeout(1000)

  const buttons = await win.locator('.panel-actions .btn').allInnerTexts()
  console.log('\nbackup panel buttons:')
  for (const b of buttons.map((s) => s.trim())) console.log(`   ${b}`)

  const body = await win.locator('.content').innerText()
  console.log(`\n   the page still mentions "N.xlsx": ${/N\.xlsx/i.test(body) ? 'YES' : 'no'}`)

  await win.screenshot({ path: join(root, 'patch-settings.png') })
} catch (err) {
  console.log(`[error] ${err.message}`)
} finally {
  await app.close()
}
