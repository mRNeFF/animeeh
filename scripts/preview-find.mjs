/**
 * Screenshots the find bar over a copy of the real library.
 *
 * The user's data file is copied into a throwaway profile rather than opened in
 * place, so nothing here can write to the real library.
 *
 * Usage: node scripts/preview-find.mjs "dragon"
 */
import { _electron as electron } from 'playwright-core'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const query = process.argv[2] ?? 'dragon'

const real = join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')
if (!existsSync(real)) {
  console.error(`No library at ${real}`)
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'animeeh-preview-'))
copyFileSync(real, join(profile, 'animeeh-data.json'))

// Keep the update banner out of the screenshot; the library itself is untouched.
const copy = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
copy.settings.checkForUpdatesOnStartup = false
writeFileSync(join(profile, 'animeeh-data.json'), JSON.stringify(copy), 'utf-8')

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))

try {
  await win.waitForTimeout(1800)
  // The interface follows the stored language, which may be French.
  await win.getByRole('button', { name: /^(Leaderboard|Classement)/ }).click()
  await win.waitForTimeout(900)

  const rows = await win.locator('tbody tr').count()
  console.log(`library holds ${rows} ranked rows`)

  await win.locator('.find input').fill(query)
  await win.waitForTimeout(1500)

  const matches = await win.locator('tr.row-match').count()
  const counter = await win.locator('.find-count').innerText().catch(() => '(none)')
  const area = await win.locator('.content').boundingBox()
  const current = await win.locator('tr.row-current').boundingBox()
  const offset =
    area && current
      ? Math.round(Math.abs(current.y + current.height / 2 - (area.y + area.height / 2)))
      : null
  console.log(`"${query}" -> ${matches} match(es), counter "${counter.trim()}", centred to within ${offset}px`)

  const titles = await win.locator('tr.row-match .t-title').allInnerTexts()
  for (const title of titles.slice(0, 8)) console.log(`   ${title.replace(/\s+/g, ' ').trim()}`)

  await win.screenshot({ path: join(root, `preview-find-${query.replace(/\W+/g, '-')}.png`) })
} finally {
  await app.close()
}
