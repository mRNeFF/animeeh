/**
 * In-app updates, driven by electron-updater.
 *
 * A packaged app reads its release feed from the `app-update.yml` that
 * electron-builder generates from the `publish` block in electron-builder.yml
 * (a GitHub Releases feed by default).
 *
 * `ANIMEEH_UPDATE_URL` overrides that feed with a plain HTTP directory, which
 * is how the whole update flow is tested locally without publishing anything.
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateStatus } from '../shared/update'

/** Overrides the baked-in feed. Used by the local update test. */
const feedUrlOverride = process.env['ANIMEEH_UPDATE_URL']

export const updateEvents = new EventEmitter()

/* ------------------------------------------------------------------ */
/* Feed discovery                                                      */
/* ------------------------------------------------------------------ */

function appUpdateYmlPath(): string {
  return join(process.resourcesPath, 'app-update.yml')
}

/** electron-builder writes app-update.yml only when publish is configured. */
function hasBakedFeed(): boolean {
  try {
    return app.isPackaged && existsSync(appUpdateYmlPath())
  } catch {
    return false
  }
}

function describeFeed(): string | null {
  if (feedUrlOverride) return feedUrlOverride
  if (!hasBakedFeed()) return null

  try {
    const raw = readFileSync(appUpdateYmlPath(), 'utf-8')
    const read = (key: string): string | undefined =>
      new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(raw)?.[1]?.trim()

    const provider = read('provider')
    const owner = read('owner')
    const repo = read('repo')
    if (provider === 'github' && owner && repo) return `${owner}/${repo} (GitHub)`

    return read('url') ?? provider ?? null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Status                                                             */
/* ------------------------------------------------------------------ */

let status: UpdateStatus = {
  stage: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: null,
  bytesPerSecond: null,
  transferred: null,
  total: null,
  message: null,
  canUpdate: hasBakedFeed() || Boolean(feedUrlOverride),
  feed: describeFeed()
}

function emitStatus(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  updateEvents.emit('status', status)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

/* ------------------------------------------------------------------ */
/* Wiring                                                             */
/* ------------------------------------------------------------------ */

/**
 * Stages that a background check must never overwrite. Without this, the
 * startup check can fire mid-download and reset the panel from
 * "Ready to install" back to "Update available", prompting a second download.
 */
function isDownloadInFlight(): boolean {
  return status.stage === 'downloading' || status.stage === 'downloaded'
}

let wired = false

function wire(): void {
  if (wired) return
  wired = true

  // We drive the download from the UI, and install on quit as a safety net.
  autoUpdater.autoDownload = false
  // Test hook: the update smoke test downloads a dummy file, which must not be
  // executed when the test closes the app.
  autoUpdater.autoInstallOnAppQuit = !process.env['ANIMEEH_NO_AUTO_INSTALL']

  autoUpdater.on('checking-for-update', () => {
    if (isDownloadInFlight()) return
    emitStatus({ stage: 'checking', message: null })
  })

  autoUpdater.on('update-available', (info) => {
    if (isDownloadInFlight()) return
    emitStatus({
      stage: 'available',
      availableVersion: info.version,
      message: null,
      percent: null,
      transferred: null,
      total: null
    })
  })

  autoUpdater.on('update-not-available', () => {
    if (isDownloadInFlight()) return
    emitStatus({
      stage: 'not-available',
      availableVersion: null,
      message: null,
      percent: null,
      transferred: null,
      total: null
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    emitStatus({
      stage: 'downloading',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    emitStatus({
      stage: 'downloaded',
      availableVersion: info.version,
      percent: 100,
      message: null
    })
  })

  autoUpdater.on('error', (err) => {
    emitStatus({ stage: 'error', message: cleanError(err) })
  })
}

function cleanError(err: unknown): string {
  const message = (err as Error)?.message ?? String(err)
  return message.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/* ------------------------------------------------------------------ */
/* Public actions                                                     */
/* ------------------------------------------------------------------ */

export async function checkForUpdates(): Promise<UpdateStatus> {
  wire()

  // Never interrupt a download that is running or already finished.
  if (isDownloadInFlight()) return status

  if (!status.canUpdate) {
    emitStatus({
      stage: 'error',
      message: app.isPackaged
        ? 'No update feed is configured for this build.'
        : 'Updates only work in the installed app, not in development.'
    })
    return status
  }

  if (feedUrlOverride) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrlOverride })
  }

  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    emitStatus({ stage: 'error', message: cleanError(err) })
  }
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  wire()

  if (status.stage !== 'available' && status.stage !== 'error') {
    emitStatus({ stage: 'error', message: 'No update available to download.' })
    return status
  }

  // Claim the 'downloading' stage immediately so a concurrent background check
  // cannot slip in before the first progress event arrives.
  emitStatus({ stage: 'downloading', percent: 0, message: null })

  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    emitStatus({ stage: 'error', message: cleanError(err) })
  }
  return status
}

export function installUpdate(): void {
  if (status.stage !== 'downloaded') return
  // Closes the app, runs the installer, relaunches it.
  autoUpdater.quitAndInstall()
}

/** Start a check shortly after launch without blocking the window. */
export function scheduleStartupCheck(delayMs = 4000): void {
  if (!status.canUpdate) return
  setTimeout(() => {
    // Skip if the user already started a download in the meantime.
    if (status.stage !== 'idle') return
    void checkForUpdates()
  }, delayMs)
}
