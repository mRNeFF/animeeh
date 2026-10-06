/**
 * Scans the text a French user actually sees, for English words.
 *
 * Static analysis cannot tell a displayed string from an enum value:
 * "{eps === 1 ? 'ep' : 'eps'}" shipped English into the French interface, and
 * every pass over the source missed it, because 'eps' looks exactly like a key
 * or a constant. The rendered DOM has no such ambiguity.
 *
 * So this drives the real app, walks the visible text of every view, and reports
 * any word from a list of English-only cues. Words that exist in both languages
 * (film, total, note) are deliberately absent from the list.
 *
 * Usage: node scripts/audit-visible-text.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const profile = mkdtempSync(join(tmpdir(), 'animeeh-visible-'))

/**
 * Words that exist only in English, so finding one in a French interface is
 * always a fault.
 *
 * Kept short and deliberate. Several candidates were removed after the first
 * run, because they are ordinary French here: "score" (score pondéré), "total"
 * (poids total), "approx." (used on purpose for an imprecise date), and "no",
 * which appears in romanised Japanese titles such as Sousou no Frieren.
 */
const ENGLISH_CUES = [
  'ep', 'eps', 'episode', 'episodes', 'unknown', 'none', 'search', 'filter',
  'clear', 'close', 'save', 'cancel', 'delete', 'add', 'edit', 'remove',
  'loading', 'settings', 'airing', 'days', 'day', 'week', 'weeks', 'month',
  'today', 'tomorrow', 'refresh', 'updated', 'available', 'ready',
  'error', 'empty', 'yes', 'and', 'or', 'the', 'with', 'from', 'your',
  'show', 'hide', 'open', 'back', 'next', 'previous'
]

/** A few cues are legitimate: 'no' in "No Game No Life", 'or' inside a word. */
const IGNORE_LINES = [/No Game No Life/i, /One Piece/i, /Call of the Night/i]

const weights = {
  characters: 1, story: 1, animation: 1, ost: 1,
  opening: 1, keyFactor: 1, originality: 1, episodeAverage: 1
}
const criteria = (v) => ({
  characters: v, story: v, animation: v, ost: v,
  opening: v, keyFactor: v, originality: v
})

// A library with a bit of everything, so each view has something to render.
writeFileSync(
  join(profile, 'animeeh-data.json'),
  JSON.stringify({
    version: 1,
    settings: { weights, checkForUpdatesOnStartup: false, language: 'fr' },
    anime: [
      {
        id: 'v1',
        title: 'Sousou no Frieren',
        status: 'completed',
        format: 'TV',
        year: 2023,
        studio: 'Madhouse',
        favorite: true,
        genres: ['Aventure', 'Drame'],
        episodes: [
          { id: 'e1', number: 1, title: 'La fin du voyage', score: 95 },
          { id: 'e2', number: 2, title: 'Le mage', score: 88 }
        ],
        criteria: criteria(92),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'v2',
        title: 'Chainsaw Man: Reze-hen',
        status: 'planned',
        format: 'MOVIE',
        year: 2025,
        episodes: [],
        criteria: criteria(80),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]
  }),
  'utf-8'
)

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()

const sleep = (ms) => win.waitForTimeout(ms)
const findings = []

/** Collect the visible text of the page, one entry per element. */
async function visibleText() {
  return win.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('body *')) {
      // Only elements that directly hold text.
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .filter(Boolean)
      if (own.length === 0) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      out.push(own.join(' '))
    }
    return out
  })
}

async function scan(view) {
  const lines = await visibleText()
  for (const line of lines) {
    if (IGNORE_LINES.some((re) => re.test(line))) continue
    // Compare on whole words, so 'ep' does not match inside 'episode'.
    const words = line.toLowerCase().match(/[a-z']+/g) ?? []
    for (const cue of ENGLISH_CUES) {
      if (words.includes(cue)) {
        findings.push({ view, cue, line: line.replace(/\s+/g, ' ').slice(0, 110) })
      }
    }
  }
}

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(2200)

  const nav = await win.locator('.sidebar .nav-item').count()
  const views = [
    { label: 'Animé', index: 0 },
    { label: 'Films', index: 1 },
    { label: 'Classement', index: 2 },
    { label: 'Par critère', index: 3 },
    { label: 'Calendrier', index: 4 },
    { label: 'Statistiques', index: 5 },
    { label: 'Réglages', index: 6 }
  ]

  for (const view of views) {
    if (view.index >= nav) continue
    await win.locator('.sidebar .nav-item').nth(view.index).click()
    await sleep(1400)
    await scan(view.label)
    process.stdout.write(`  ${view.label} …\n`)
  }

  // The detail view and the add form, which the sidebar does not reach.
  await win.locator('.sidebar .nav-item').nth(0).click()
  await sleep(900)
  if ((await win.locator('.card').count()) > 0) {
    await win.locator('.card').first().click()
    await sleep(1200)
    await scan('Détail')
    process.stdout.write('  Détail …\n')
  }

  await win.locator('.sidebar .nav-item').nth(0).click()
  await sleep(700)
  await win.locator('.topbar-actions .btn.primary').click()
  await sleep(900)
  await scan('Formulaire')
  process.stdout.write('  Formulaire …\n')

  await win.screenshot({ path: join(root, 'smoke-visible-text.png') })
} finally {
  await app.close().catch(() => {})
}

console.log(`\n${'='.repeat(80)}`)
if (findings.length === 0) {
  console.log('No English word found in the French interface.')
  process.exit(0)
}

// Group by cue so the report stays readable.
const byCue = new Map()
for (const f of findings) {
  const list = byCue.get(f.cue) ?? []
  list.push(f)
  byCue.set(f.cue, list)
}

console.log(`${findings.length} occurrence(s) of English words:\n`)
for (const [cue, list] of [...byCue.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  "${cue}"  x${list.length}   (${[...new Set(list.map((f) => f.view))].join(', ')})`)
  for (const f of list.slice(0, 2)) console.log(`      ${f.line}`)
}

console.log('\nEach is either a real miss or an entry that needs allowing.')
process.exit(1)
