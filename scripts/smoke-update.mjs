/**
 * End-to-end test of the in-app updater.
 *
 * Serves a fake release feed over local HTTP, then runs the packaged app with
 * ANIMEEH_UPDATE_URL pointing at it and drives the real UI:
 *
 *   Check for updates  ->  "Update available 0.1.1"
 *   Download update    ->  "Ready to install"
 *
 * This exercises the whole chain: IPC, electron-updater, the feed parsing
 * (latest.yml + sha512 verification) and every UI state.
 *
 * The dummy payload is never executed: ANIMEEH_NO_AUTO_INSTALL stops
 * electron-updater from running it when the app exits.
 */
import { _electron as electron } from 'playwright-core'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packagedExe = join(root, 'release', 'win-unpacked', 'ANIMEEH.exe')
const resourcesDir = join(root, 'release', 'win-unpacked', 'resources')

/** Version the fake feed advertises, deliberately newer than the app. */
const FEED_VERSION = '0.1.1'
const PAYLOAD_NAME = `ANIMEEH-${FEED_VERSION}-setup.exe`

if (!existsSync(packagedExe)) {
  console.error(`Packaged app missing: ${packagedExe}\nRun: npm run dist:dir`)
  process.exit(2)
}

/* ------------------------------------------------------------------ */
/* app-update.yml                                                      */
/* ------------------------------------------------------------------ */

/**
 * electron-updater reads resources/app-update.yml during download to resolve
 * its cache directory, and electron-builder only writes that file when a
 * `publish` block is configured. Reproduce the file here so the whole flow can
 * be exercised before the GitHub feed exists, then remove it again.
 */
const appUpdateYml = join(resourcesDir, 'app-update.yml')
let createdYml = false
if (!existsSync(appUpdateYml)) {
  writeFileSync(
    appUpdateYml,
    [
      'provider: github',
      'owner: placeholder',
      'repo: animeeh',
      'updaterCacheDirName: animeeh-updater',
      ''
    ].join('\n'),
    'utf-8'
  )
  createdYml = true
  console.log('FEED: created resources/app-update.yml (what the publish block generates)')
}

/* ------------------------------------------------------------------ */
/* Fake release feed                                                   */
/* ------------------------------------------------------------------ */

const feedDir = join(tmpdir(), `animeeh-feed-${Date.now()}`)
mkdirSync(feedDir, { recursive: true })

// electron-updater caches a downloaded update and skips re-downloading it.
// Clear that cache so the test always exercises a real download.
const updaterCacheDir = join(process.env.LOCALAPPDATA ?? tmpdir(), 'animeeh-updater')
rmSync(updaterCacheDir, { recursive: true, force: true })
console.log(`FEED: cleared updater cache at ${updaterCacheDir}`)

// ~2 MB so the download takes long enough to observe progress.
const payload = Buffer.alloc(2 * 1024 * 1024, 0x41)
writeFileSync(join(feedDir, PAYLOAD_NAME), payload)

const sha512 = createHash('sha512').update(payload).digest('base64')
writeFileSync(
  join(feedDir, 'latest.yml'),
  [
    `version: ${FEED_VERSION}`,
    'files:',
    `  - url: ${PAYLOAD_NAME}`,
    `    sha512: ${sha512}`,
    `    size: ${payload.length}`,
    `path: ${PAYLOAD_NAME}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  ].join('\n'),
  'utf-8'
)

const server = createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\/+/, ''))
  const file = join(feedDir, name)
  if (!name || !existsSync(file)) {
    console.log(`FEED: 404 ${name}`)
    res.writeHead(404).end('not found')
    return
  }
  const body = readFileSync(file)
  console.log(`FEED: 200 ${name} (${body.length} bytes)`)
  res.writeHead(200, { 'Content-Length': body.length }).end(body)
})

const port = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port))
})
const feedUrl = `http://127.0.0.1:${port}/`
console.log(`FEED: serving ${feedDir} at ${feedUrl} (advertising v${FEED_VERSION})`)

/* ------------------------------------------------------------------ */
/* Drive the real app                                                  */
/* ------------------------------------------------------------------ */

const errors = []
const app = await electron.launch({
  executablePath: packagedExe,
  args: [],
  env: {
    ...process.env,
    ANIMEEH_UPDATE_URL: feedUrl,
    ANIMEEH_NO_AUTO_INSTALL: '1'
  }
})

const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

// electron-updater logs through the main process console; surface it.
app.process().stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`))
app.process().stderr?.on('data', (d) => process.stdout.write(`[main!] ${d}`))

const sleep = (ms) => win.waitForTimeout(ms)

try {
  await win.waitForLoadState('domcontentloaded')
  await sleep(1800)

  // The app auto-checks on startup; give that time to land too.
  await win.getByRole('button', { name: 'Settings' }).click()
  await sleep(1200)

  const currentVersion = await win.locator('.panel .panel-sub strong').first().innerText()
  console.log(`UPDATER: current version = ${currentVersion} (expected 0.1.0)`)

  await win.getByRole('button', { name: /Check for updates/i }).click()

  await win.locator('.upd-badge.stage-available').waitFor({ state: 'visible', timeout: 30000 })
  const badge = await win.locator('.upd-badge').innerText()
  const detail = (await win.locator('.upd-row').innerText()).replace(/\s+/g, ' ').trim()
  console.log(`UPDATER: badge = "${badge}" (expected "Update available")`)
  console.log(`UPDATER: detail = ${detail}`)
  await win.screenshot({ path: join(root, 'smoke-update-available.png') })

  // The topbar badge must appear too.
  const topbarBadge = await win.locator('.topbar-actions .btn').first().innerText()
  console.log(`UPDATER: topbar badge = "${topbarBadge.replace(/\s+/g, ' ')}"`)

  await win.getByRole('button', { name: /Download update/i }).click()

  // Poll the panel so we can see the outcome (progress, or the error message).
  let sawProgress = false
  let finalBadge = ''
  let finalDetail = ''
  for (let i = 0; i < 25; i += 1) {
    await sleep(1000)
    const badgeText = await win.locator('.upd-badge').innerText().catch(() => '')
    const rowText = (await win.locator('.upd-row').innerText().catch(() => ''))
      .replace(/\s+/g, ' ')
      .trim()
    if (await win.locator('.upd-progress').isVisible().catch(() => false)) sawProgress = true
    finalBadge = badgeText.trim()
    finalDetail = rowText
    console.log(`UPDATER: t+${i + 1}s badge="${finalBadge}" | ${rowText}`)
    if (finalBadge.toLowerCase().includes('ready to install')) break
    if (finalBadge.toLowerCase().includes('error')) break
  }

  console.log(`UPDATER: progress bar observed at some point = ${sawProgress}`)

  if (!finalBadge.toLowerCase().includes('ready to install')) {
    throw new Error(`download did not finish: badge="${finalBadge}" detail="${finalDetail}"`)
  }

  const installButton = await win.getByRole('button', { name: /Restart and install/i }).count()
  console.log(`UPDATER: "Restart and install" button present = ${installButton === 1}`)
  await win.screenshot({ path: join(root, 'smoke-update-downloaded.png') })

  console.log('UPDATE TEST OK')
} catch (err) {
  errors.push(`[script] ${err.message}`)
  try {
    await win.screenshot({ path: join(root, 'smoke-update-failure.png') })
  } catch {
    /* ignore */
  }
} finally {
  if (errors.length) console.log('--- ERRORS ---\n' + errors.join('\n'))
  await app.close().catch(() => {})
  server.close()
  if (createdYml) {
    rmSync(appUpdateYml, { force: true })
    console.log('FEED: removed the generated app-update.yml')
  }
}

process.exit(errors.length ? 1 : 0)
