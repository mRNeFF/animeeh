/**
 * Diagnostic for missing thumbnails in the library, run against the INSTALLED
 * app so it reproduces exactly what the user sees.
 *
 * Reports, per card: whether the <img> exists, its src, and the resolved size
 * the browser actually laid out. A zero-size or absent image points at CSS; a
 * correct size with a broken src points at the URL or the network.
 */
import { _electron as electron } from 'playwright-core'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const installedExe =
  process.env.ANIMEEH_INSTALLED_EXE ??
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'ANIMEEH', 'ANIMEEH.exe')

if (!existsSync(installedExe)) {
  console.error(`Installed app not found: ${installedExe}`)
  process.exit(2)
}

const NAV_LIBRARY = /^(My Anime|Mes animés)$/

const app = await electron.launch({ executablePath: installedExe, args: [] })
const win = await app.firstWindow()

const failedRequests = []
win.on('requestfailed', (r) => failedRequests.push(`${r.failure()?.errorText} ${r.url()}`))
const consoleErrors = []
win.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})

const sleep = (ms) => win.waitForTimeout(ms)

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(3500)

  // The app opens on the library, so no navigation is needed.
  const navLabels = await win.locator('.nav-label').allInnerTexts().catch(() => [])
  console.log(`DIAG: nav = ${navLabels.join(' | ')}`)

  const cards = await win.locator('.card').count()
  console.log(`DIAG: ${cards} cards in the library`)
  if (cards === 0) {
    const body = (await win.locator('.content').innerText().catch(() => '')).slice(0, 400)
    console.log(`DIAG: content = ${body.replace(/\s+/g, ' ')}`)
  }

  const report = await win.evaluate(() => {
    const cardEls = [...document.querySelectorAll('.card')].slice(0, 6)
    return cardEls.map((card) => {
      const title = card.querySelector('.card-title')?.textContent?.trim() ?? '?'
      const coverDiv = card.querySelector('.card-cover')
      const img = card.querySelector('.card-cover img')
      const cs = coverDiv ? getComputedStyle(coverDiv) : null
      const imgCs = img ? getComputedStyle(img) : null
      const rect = img?.getBoundingClientRect()
      return {
        title,
        hasCoverDiv: !!coverDiv,
        coverClasses: coverDiv?.className ?? null,
        coverSize: coverDiv
          ? `${Math.round(coverDiv.getBoundingClientRect().width)}x${Math.round(coverDiv.getBoundingClientRect().height)}`
          : null,
        coverPosition: cs?.position ?? null,
        coverDisplay: cs?.display ?? null,
        hasImg: !!img,
        imgSrc: img?.getAttribute('src') ?? null,
        imgComplete: img?.complete ?? null,
        naturalSize: img ? `${img.naturalWidth}x${img.naturalHeight}` : null,
        renderedSize: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : null,
        imgObjectFit: imgCs?.objectFit ?? null,
        imgDisplay: imgCs?.display ?? null,
        overlayAfter: coverDiv
          ? getComputedStyle(coverDiv, '::after').backgroundImage.slice(0, 60)
          : null
      }
    })
  })

  console.log('\nDIAG: first cards')
  for (const r of report) {
    console.log(`  "${r.title}"`)
    console.log(`     cover div: ${r.hasCoverDiv} classes="${r.coverClasses}" size=${r.coverSize} position=${r.coverPosition} display=${r.coverDisplay}`)
    console.log(`     img: ${r.hasImg} rendered=${r.renderedSize} natural=${r.naturalSize} complete=${r.imgComplete} display=${r.imgDisplay} fit=${r.imgObjectFit}`)
    console.log(`     src: ${(r.imgSrc ?? '').slice(0, 70)}`)
    console.log(`     ::after overlay: ${r.overlayAfter}`)
  }

  // Count how many images actually decoded.
  const total = await win.locator('.card-cover img').count()
  const loaded = await win.locator('.card-cover img').evaluateAll((els) =>
    els.filter((el) => el.complete && el.naturalWidth > 0).length
  )
  console.log(`\nDIAG: ${loaded}/${total} cover images decoded successfully`)

  if (failedRequests.length > 0) {
    console.log(`\nDIAG: ${failedRequests.length} failed requests`)
    for (const f of failedRequests.slice(0, 8)) console.log(`  ${f.slice(0, 120)}`)
  }
  if (consoleErrors.length > 0) {
    console.log(`\nDIAG: ${consoleErrors.length} console errors`)
    for (const e of consoleErrors.slice(0, 8)) console.log(`  ${e.slice(0, 160)}`)
  }

  await win.screenshot({ path: join(root, 'diagnostic-library.png') })
  console.log('\nDIAG: wrote diagnostic-library.png')
} finally {
  await app.close().catch(() => {})
}
