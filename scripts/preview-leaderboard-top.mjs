/**
 * Screenshots the leaderboard's top, at rest and scrolled, to see what is broken.
 *
 * The report is that the top of the page looks broken and that a gap is visible
 * between the page heading and the search bar. Both are layout, so they are looked
 * at rather than reasoned about.
 *
 * The real data file is copied into a throwaway profile, so nothing here can write
 * to the actual library.
 *
 * Usage: node scripts/preview-leaderboard-top.mjs
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

const profile = mkdtempSync(join(tmpdir(), 'animeeh-top-'))
copyFileSync(real, join(profile, 'animeeh-data.json'))
const copy = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
copy.settings.checkForUpdatesOnStartup = false
copy.settings.language = 'fr'
writeFileSync(join(profile, 'animeeh-data.json'), JSON.stringify(copy), 'utf-8')

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))

try {
  await win.waitForTimeout(2000)
  await win.getByRole('button', { name: /^(Classement|Leaderboard)/ }).click()
  await win.waitForTimeout(1200)

  /** The layout of everything between the page heading and the first row. */
  const layout = await win.evaluate(() => {
    const pick = (selector) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        marginTop: cs.marginTop,
        marginBottom: cs.marginBottom,
        background: cs.backgroundColor,
        position: cs.position
      }
    }
    const content = document.querySelector('.content')
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      topbar: pick('.topbar'),
      content: content
        ? { ...pick('.content'), scrollTop: Math.round(content.scrollTop) }
        : null,
      toolbar: pick('.toolbar-sticky'),
      firstHint: pick('.content > .hint'),
      tableWrap: pick('.table-wrap'),
      firstHeader: pick('thead th'),
      firstRow: pick('tbody tr'),
      // The bands that should read as one strip.
      topbarBorder: getComputedStyle(document.querySelector('.topbar')).borderBottomWidth,
      toolbarBorder: getComputedStyle(document.querySelector('.toolbar-sticky')).borderBottomWidth
    }
  })

  console.log(JSON.stringify(layout, null, 2))

  // Also written to a file, so the numbers can be read without going through a
  // shell that mangles quotes.
  writeFileSync(join(root, 'preview-top-layout.json'), JSON.stringify(layout, null, 2), 'utf-8')

  await win.screenshot({ path: join(root, 'preview-top-rest.png') })
  console.log('\nwrote preview-top-rest.png')

  // A cropped view of the band that must read as one strip, since the question is
  // whether a gap is visible between the heading and the search.
  await win.screenshot({
    path: join(root, 'preview-top-band.png'),
    clip: { x: 160, y: 0, width: 900, height: 220 }
  })
  console.log('wrote preview-top-band.png')

  // And scrolled, since the sticky chrome is what looked wrong.
  await win.locator('.content').evaluate((el) => {
    el.scrollTop = 300
  })
  await win.waitForTimeout(700)
  await win.screenshot({ path: join(root, 'preview-top-scrolled.png') })
  console.log('wrote preview-top-scrolled.png')
} catch (err) {
  console.log(`[error] ${err.message}`)
} finally {
  await app.close()
}
