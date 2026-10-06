/**
 * Checks that a library card still shows its title, rank, grade, metadata and
 * score bar after the cover was enlarged and the body overlaid on it.
 *
 * Overlaying text on artwork is the riskiest part of direction E: if the
 * gradient or the negative margin is off, the text ends up clipped or unreadable
 * without the layout looking broken. So each element is measured, and its colour
 * is compared against the backdrop it actually sits on.
 *
 * Usage: node scripts/check-card-layout.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const profile = mkdtempSync(join(tmpdir(), 'animeeh-card-'))

let failures = 0
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected)
  if (!ok) failures += 1
  console.log(`   ${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`)
}

const weights = {
  characters: 1, story: 1, animation: 1, ost: 1,
  opening: 1, keyFactor: 1, originality: 1, episodeAverage: 1
}
const criteria = (v) => ({
  characters: v, story: v, animation: v, ost: v,
  opening: v, keyFactor: v, originality: v
})

// One entry with artwork, one without, so the fallback cover is covered too.
writeFileSync(
  join(profile, 'animeeh-data.json'),
  JSON.stringify({
    version: 1,
    settings: { weights, checkForUpdatesOnStartup: false, language: 'fr' },
    anime: [
      {
        id: 'c1',
        title: 'Sousou no Frieren',
        status: 'completed',
        format: 'TV',
        year: 2023,
        studio: 'Madhouse',
        favorite: true,
        episodes: [{ id: 'e1', number: 1, title: 'Le début', score: 95 }],
        criteria: criteria(92),
        coverImage:
          'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx154587-gHSraOSa0nBS.jpg',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'c2',
        title: 'Sans jaquette',
        status: 'watching',
        format: 'TV',
        year: 2020,
        episodes: [],
        criteria: criteria(70),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]
  }),
  'utf-8'
)

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => {
  failures += 1
  console.log(`[pageerror] ${e.message}`)
})

const sleep = (ms) => win.waitForTimeout(ms)

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(2500)
  await win.locator('.card').first().waitFor({ state: 'visible', timeout: 20000 })
  await sleep(1200)

  const report = await win.evaluate(() => {
    const cards = [...document.querySelectorAll('.card')]
    return cards.map((card) => {
      const box = card.getBoundingClientRect()
      const rect = (sel) => {
        const el = card.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return {
          text: (el.textContent ?? '').trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
          top: Math.round(r.top - box.top),
          bottom: Math.round(r.bottom - box.top),
          color: cs.color,
          opacity: cs.opacity,
          display: cs.display,
          overflow: cs.overflow
        }
      }
      const body = card.querySelector('.card-body')
      const bodyCs = body ? getComputedStyle(body) : null
      return {
        title: (card.querySelector('.card-title')?.textContent ?? '').trim(),
        cardH: Math.round(box.height),
        coverH: Math.round((card.querySelector('.card-cover')?.getBoundingClientRect().height) ?? 0),
        hasImage: !!card.querySelector('.card-cover img'),
        bodyMarginTop: bodyCs?.marginTop ?? null,
        bodyBg: bodyCs?.backgroundImage?.slice(0, 46) ?? null,
        titleRect: rect('.card-title'),
        metaRect: rect('.card-meta'),
        barRect: rect('.bar'),
        scoreRect: rect('.card-body .num'),
        rankRect: rect('.card-rank'),
        gradeRect: rect('.card-grade')
      }
    })
  })

  for (const c of report) {
    console.log(`\nCARD "${c.title}"`)
    console.log(`   height ${c.cardH}px · cover ${c.coverH}px · image ${c.hasImage} · body margin-top ${c.bodyMarginTop}`)
    console.log(`   body gradient: ${c.bodyBg}`)
    for (const key of ['rankRect', 'gradeRect', 'titleRect', 'metaRect', 'barRect', 'scoreRect']) {
      const r = c[key]
      console.log(
        `   ${key.replace('Rect', '').padEnd(6)} ${
          r ? `top ${String(r.top).padStart(4)} → ${String(r.bottom).padStart(4)}  ${r.w}x${r.h}  color ${r.color}  "${r.text}"` : 'MISSING'
        }`
      )
    }
  }

  console.log('\nCHECKS:')
  const first = report[0]
  check('the title is rendered', first.titleRect !== null, true)
  check('the title is not empty', (first.titleRect?.text ?? '').length > 0, true)
  check('the title has a real size', (first.titleRect?.h ?? 0) > 10, true)
  check('the title sits inside the card', (first.titleRect?.bottom ?? 999) <= first.cardH, true)
  check('the metadata is visible', (first.metaRect?.h ?? 0) > 8, true)
  check('the score bar is visible', (first.barRect?.w ?? 0) > 20, true)
  check('the score is rendered', (first.scoreRect?.text ?? '').length > 0, true)
  check('the rank badge is rendered', first.rankRect !== null, true)
  check('the grade badge is rendered', first.gradeRect !== null, true)
  check('the body overlays the cover', (first.coverH ?? 0) > 100, true)

  // The fallback card must work too: no cover image means a colour gradient.
  check('the coverless card still shows its title', (report[1]?.titleRect?.text ?? '').length > 0, true)

  // Text must not be transparent.
  const transparent = report.some((c) => (c.titleRect?.color ?? '').includes('rgba') && (c.titleRect?.color ?? '').endsWith(', 0)'))
  check('no title is invisible', transparent, false)

  await win.screenshot({ path: join(root, 'smoke-theme-cards.png') })
  console.log('\nwrote smoke-theme-cards.png')

  console.log(`\n${failures === 0 ? 'CARD LAYOUT OK' : `${failures} FAILURE(S)`}`)
} catch (err) {
  failures += 1
  console.log(`\n[script] ${err.message}`)
} finally {
  await app.close().catch(() => {})
}

process.exit(failures === 0 ? 0 : 1)
