/**
 * Screenshots the season filter, to check it reads the whole catalogue.
 *
 * The fault reported was that it only listed the seasons already tracked. This
 * searches a show deliberately kept out of the profile, so a library-only list
 * would come back empty.
 *
 * The real data file is copied into a throwaway profile, so nothing here can write
 * to the actual library.
 *
 * Usage: node scripts/preview-seasons.mjs
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

const profile = mkdtempSync(join(tmpdir(), 'animeeh-seasons-'))
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
  await win.getByRole('button', { name: /Ajouter des éléments/i }).click()
  await win.waitForTimeout(600)

  const search = win.locator('.tl-picker .tl-search input')

  /** Types a query and waits for the results to reflect it, not the previous one. */
  const look = async (term) => {
    await search.fill('')
    // Wait for the list to actually empty, so the next read cannot be the previous
    // query's results.
    for (let i = 0; i < 20; i += 1) {
      if ((await win.locator('.tl-res').count()) === 0) break
      await win.waitForTimeout(200)
    }
    await search.fill(term)
    let last = ''
    for (let i = 0; i < 40; i += 1) {
      await win.waitForTimeout(400)
      const titles = await win.locator('.tl-res .a').allInnerTexts()
      if (titles.length > 0 && titles.join('|') === last) break
      last = titles.join('|')
    }
    return win.locator('.tl-res .a').allInnerTexts()
  }

  // A show the library does not hold, to prove the seasons are not read from it.
  await win.locator('.tl-filter', { hasText: 'Saisons' }).first().click()
  await win.waitForTimeout(400)
  const mono = await look('bakemonogatari')
  console.log(`seasons offered for "bakemonogatari":`)
  for (const title of mono) console.log(`   ${title}`)

  // And a tracked franchise, to show the seasons of something already owned.
  const frieren = await look('frieren')
  console.log(`\nseasons offered for "frieren":`)
  for (const title of frieren) console.log(`   ${title}`)

  await win.screenshot({ path: join(root, 'preview-seasons.png') })
  console.log('screenshot written')
} catch (err) {
  console.log(`[error] ${err.message}`)
} finally {
  await app.close()
}
