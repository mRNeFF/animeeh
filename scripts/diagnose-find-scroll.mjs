/**
 * Diagnoses why the find bar fails to scroll to a match.
 *
 * Reports the layout the scroll has to work with: which ancestor is treated as
 * the scrolling area, whether it really overflows, where the matched row sits and
 * where it ends up. Printed rather than asserted, so the numbers can be read.
 *
 * Usage: node scripts/diagnose-find-scroll.mjs "lycoris"
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const query = process.argv[2] ?? 'lycoris'

const real = join(process.env.APPDATA ?? '', 'ANIMEEH', 'animeeh-data.json')
if (!existsSync(real)) {
  console.error(`No library at ${real}`)
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'animeeh-scroll-'))
copyFileSync(real, join(profile, 'animeeh-data.json'))
const copy = JSON.parse(readFileSync(join(profile, 'animeeh-data.json'), 'utf-8'))
copy.settings.checkForUpdatesOnStartup = false
writeFileSync(join(profile, 'animeeh-data.json'), JSON.stringify(copy), 'utf-8')

const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))

try {
  await win.waitForTimeout(1800)
  await win.getByRole('button', { name: /^(Leaderboard|Classement)/ }).click()
  await win.waitForTimeout(900)

  /** Every ancestor of a row, with the properties that decide the scrolling. */
  const describe = () =>
    win.evaluate(() => {
      const row = document.querySelector('tbody tr')
      if (!row) return { error: 'no row' }
      const chain = []
      let node = row.parentElement
      while (node && chain.length < 8) {
        const style = getComputedStyle(node)
        chain.push({
          tag: node.tagName.toLowerCase(),
          cls: node.className || '(none)',
          overflowY: style.overflowY,
          overflowX: style.overflowX,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          overflows: node.scrollHeight > node.clientHeight + 1,
          scrollTop: Math.round(node.scrollTop),
          scrollBehavior: style.scrollBehavior
        })
        node = node.parentElement
      }
      return { chain, innerHeight: window.innerHeight }
    })

  const before = await describe()
  console.log('\nAncestors of a table row, nearest first:')
  for (const entry of before.chain) {
    console.log(
      `  ${entry.tag}.${String(entry.cls).slice(0, 24).padEnd(24)} ` +
        `overflow-y=${String(entry.overflowY).padEnd(7)} ` +
        `scrollH=${String(entry.scrollHeight).padStart(5)} clientH=${String(entry.clientHeight).padStart(5)} ` +
        `overflows=${entry.overflows ? 'YES' : 'no '} ` +
        `scrollTop=${String(entry.scrollTop).padStart(4)} behavior=${entry.scrollBehavior}`
    )
  }

  const rows = await win.locator('tbody tr').count()
  console.log(`\n${rows} rows in the table, viewport height ${before.innerHeight}px`)

  /* ---- Type one character at a time, the way a person does ---- */
  const contentScroll = () =>
    win.evaluate(() => Math.round(document.querySelector('.content')?.scrollTop ?? -1))

  const input = win.locator('.find input')

  // Record every scroll the app performs on the scrolling area, so a call that
  // never arrives can be told apart from one that arrives and is undone.
  await win.evaluate(() => {
    const area = document.querySelector('.content')
    window.__calls = []
    const original = area.scrollTo.bind(area)
    area.scrollTo = (...args) => {
      const before = area.scrollTop
      const result = original(...args)
      window.__calls.push({
        args: JSON.stringify(args),
        before: Math.round(before),
        after: Math.round(area.scrollTop),
        maxTop: Math.round(area.scrollHeight - area.clientHeight)
      })
      return result
    }
  })

  await input.click()
  const typed = process.argv[3] ?? query
  console.log(`\ntyping "${typed}" one character at a time:`)
  for (let i = 0; i < typed.length; i += 1) {
    await input.pressSequentially(typed[i], { delay: 60 })
    await win.waitForTimeout(320)
    const info = await win.evaluate(() => {
      const row = document.querySelector('tr.row-current')
      const area = document.querySelector('.content')
      if (!row || !area) return { scrollTop: -1, delta: null, title: null }
      const r = row.getBoundingClientRect()
      const a = area.getBoundingClientRect()
      return {
        scrollTop: Math.round(area.scrollTop),
        delta: Math.round(Math.abs(r.top + r.height / 2 - (a.top + a.height / 2))),
        title: row.querySelector('.t-title')?.textContent?.trim() ?? null,
        visible: r.top >= a.top && r.bottom <= a.bottom + 1
      }
    })
    console.log(
      `  "${typed.slice(0, i + 1).padEnd(9)}" scrollTop=${String(info.scrollTop).padStart(5)} ` +
        `off by ${String(info.delta).padStart(4)}px  visible=${info.visible ? 'yes' : 'NO '}  ${info.title ?? ''}`
    )
    const calls = await win.evaluate(() => window.__calls.splice(0, window.__calls.length))
    for (const call of calls) {
      console.log(
        `        scrollTo(${call.args}) -> ${call.before}..${call.after} (max ${call.maxTop})`
      )
    }
  }
  await win.waitForTimeout(400)

  /* ---- Type the query again, in one go ---- */
  await win.locator('.find-step').last().click()
  await win.waitForTimeout(400)
  await win.locator('.find input').fill(query)
  await win.waitForTimeout(600)

  const state = await win.evaluate(() => {
    const current = document.querySelector('tr.row-current')
    const box = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }
    }
    return {
      matches: document.querySelectorAll('tr.row-match').length,
      current: document.querySelectorAll('tr.row-current').length,
      counter: document.querySelector('.find-count')?.textContent?.trim() ?? '(none)',
      rowBox: box(current),
      rowTitle: current?.querySelector('.t-title')?.textContent?.trim() ?? null
    }
  })

  console.log(`\n"${query}" -> ${state.matches} match(es), ${state.current} current, counter "${state.counter}"`)
  console.log(`  current row: ${JSON.stringify(state.rowTitle)} at ${JSON.stringify(state.rowBox)}`)

  const after = await describe()
  console.log('\nScroll positions after typing:')
  for (const entry of after.chain) {
    const old = before.chain.find((c) => c.tag === entry.tag && c.cls === entry.cls)
    const moved = old && old.scrollTop !== entry.scrollTop ? ` (was ${old.scrollTop})` : ''
    if (entry.overflowY !== 'visible' || entry.overflows) {
      console.log(`  ${entry.tag}.${String(entry.cls).slice(0, 24).padEnd(24)} scrollTop=${entry.scrollTop}${moved}`)
    }
  }

  const area = await win.locator('.content').boundingBox()
  const row = await win.locator('tr.row-current').boundingBox()
  if (area && row) {
    const delta = Math.round(Math.abs(row.y + row.height / 2 - (area.y + area.height / 2)))
    console.log(`\n  .content spans ${Math.round(area.y)}..${Math.round(area.y + area.height)}`)
    console.log(`  current row spans ${Math.round(row.y)}..${Math.round(row.y + row.height)}`)
    console.log(`  off centre by ${delta}px`)
    console.log(
      `  visible: ${row.y >= area.y && row.y + row.height <= area.y + area.height + 1 ? 'YES' : 'NO'}`
    )
  }

  await win.screenshot({ path: join(root, `diagnose-scroll-${query.replace(/\W+/g, '-')}.png`) })
} catch (err) {
  console.log(`\n[error] ${err.message}`)
} finally {
  await app.close()
}
