/**
 * Screenshots the library and films views with the sidebar, to inspect the
 * counts there.
 *
 * The user's data file is copied into a throwaway profile rather than opened in
 * place, so nothing here can write to the real library.
 *
 * Usage: node scripts/preview-library.mjs
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

const profile = mkdtempSync(join(tmpdir(), 'animeeh-preview-'))
copyFileSync(real, join(profile, 'animeeh-data.json'))
// Keep the update banner out of the screenshot; the library itself is untouched.
const copy = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
copy.settings.checkForUpdatesOnStartup = false
writeFileSync(join(profile, 'animeeh-data.json'), JSON.stringify(copy), 'utf-8')

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))

const describe = async (label) => {
  const badges = await win.locator('.nav-item').evaluateAll((items) =>
    items.map((item) => {
      const name = item.querySelector('.nav-label')?.textContent?.trim() ?? '?'
      const count = item.querySelector('.nav-count')?.textContent?.trim()
      return count === undefined ? name : `${name} ${count}`
    })
  )
  const foot = (await win.locator('.sidebar-foot div').allInnerTexts())
    .map((s) => s.trim())
    .find((s) => /épisode|episode/.test(s))
  console.log(`\n${label}`)
  console.log(`  sidebar: ${badges.join(' | ')}`)
  console.log(`  footer : ${foot}`)
}

try {
  await win.waitForTimeout(1800)
  await describe('Anime tab')
  await win.screenshot({ path: join(root, 'preview-library.png') })

  await win.getByRole('button', { name: /^(Films & OVA|Films)/ }).first().click()
  await win.waitForTimeout(800)
  await describe('Films & OVA tab')
  await win.screenshot({ path: join(root, 'preview-library-films.png') })
} finally {
  await app.close()
}
