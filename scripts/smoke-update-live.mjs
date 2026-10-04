/**
 * Live test of the updater against the REAL GitHub release feed.
 *
 * Unlike smoke-update.mjs (which serves a fake local feed), this drives an
 * actually installed build with no feed override, so it verifies end to end:
 *
 *   installed app -> github.com/mRNeFF/animeeh -> newer release found
 *   -> installer downloaded -> "Ready to install"
 *
 * ANIMEEH_NO_AUTO_INSTALL keeps the app from running the installer on exit, so
 * the test can inspect the final state without upgrading the machine.
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const installedExe =
  process.env.ANIMEEH_INSTALLED_EXE ??
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'ANIMEEH', 'ANIMEEH.exe')

/** What the installed app should find. Defaults to the current package version. */
const expectVersion =
  process.env.ANIMEEH_EXPECT_VERSION ??
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version

if (!existsSync(installedExe)) {
  console.error(`Installed app not found: ${installedExe}`)
  process.exit(2)
}
console.log(`LIVE: driving ${installedExe}`)
console.log(`LIVE: expecting version ${expectVersion} to be offered`)

const errors = []
const app = await electron.launch({
  executablePath: installedExe,
  args: [],
  env: {
    ...process.env,
    // Keep the downloaded installer from running when the test closes the app.
    ANIMEEH_NO_AUTO_INSTALL: '1'
  }
})

const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
app.process().stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`))
app.process().stderr?.on('data', (d) => process.stdout.write(`[main!] ${d}`))

const sleep = (ms) => win.waitForTimeout(ms)

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(2000)

  await win.getByRole('button', { name: 'Settings' }).click()
  await sleep(800)

  const feed = (await win.locator('.panel .panel-sub').first().innerText()).replace(/\s+/g, ' ')
  console.log(`LIVE: panel = ${feed}`)

  await win.getByRole('button', { name: /Check for updates/i }).click()

  await win.locator('.upd-badge.stage-available').waitFor({ state: 'visible', timeout: 45000 })
  const detail = (await win.locator('.upd-row').innerText()).replace(/\s+/g, ' ').trim()
  console.log(`LIVE: ${detail}`)

  if (!detail.includes(expectVersion)) {
    throw new Error(`expected version ${expectVersion} in "${detail}"`)
  }
  const topbar = (await win.locator('.topbar-actions .btn').first().innerText()).replace(/\s+/g, ' ')
  console.log(`LIVE: topbar badge = "${topbar.trim()}"`)
  await win.screenshot({ path: join(root, 'live-update-available.png') })

  // Download the real installer from GitHub.
  console.log('LIVE: downloading the real installer from GitHub...')
  await win.getByRole('button', { name: /Download update/i }).click()

  for (let i = 0; i < 90; i += 1) {
    await sleep(1000)
    const badge = (await win.locator('.upd-badge').innerText().catch(() => '')).trim()
    if (i % 10 === 0) {
      const row = (await win.locator('.upd-row').innerText().catch(() => '')).replace(/\s+/g, ' ')
      console.log(`LIVE: t+${i + 1}s ${badge} | ${row.trim()}`)
    }
    if (badge.toLowerCase().includes('ready to install')) break
    if (badge.toLowerCase().includes('error')) {
      const row = (await win.locator('.upd-row').innerText()).replace(/\s+/g, ' ')
      throw new Error(`download failed: ${row.trim()}`)
    }
  }

  await win.locator('.upd-badge.stage-downloaded').waitFor({ state: 'visible', timeout: 30000 })
  const done = (await win.locator('.upd-row').innerText()).replace(/\s+/g, ' ').trim()
  console.log(`LIVE: ${done}`)

  const canInstall = await win.getByRole('button', { name: /Restart and install/i }).count()
  console.log(`LIVE: "Restart and install" available = ${canInstall === 1}`)
  await win.screenshot({ path: join(root, 'live-update-downloaded.png') })

  console.log('LIVE UPDATE TEST OK')
} catch (err) {
  errors.push(`[script] ${err.message}`)
  try {
    await win.screenshot({ path: join(root, 'live-update-failure.png') })
  } catch {
    /* ignore */
  }
} finally {
  if (errors.length) console.log('--- ERRORS ---\n' + errors.join('\n'))
  await app.close().catch(() => {})
}

process.exit(errors.length ? 1 : 0)
