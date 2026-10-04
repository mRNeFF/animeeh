import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getAnimeDetails, MIN_QUERY_LENGTH, searchAnime } from './anilist'
import { loadEpisodeNames } from './episodes'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  installUpdate,
  scheduleStartupCheck,
  updateEvents
} from './updater'
import type { AnimeDetails, AnimeSearchResult, AniListOutcome } from '../shared/anilist'
import type { EpisodeNamesOutcome } from '../shared/episodes'
import type { UpdateStatus } from '../shared/update'

/** In dev, electron-vite injects this so we can load the Vite dev server. */
const rendererDevUrl = process.env['ELECTRON_RENDERER_URL']
const isDev = !app.isPackaged && !!rendererDevUrl

function dataFilePath(): string {
  return join(app.getPath('userData'), 'animeeh-data.json')
}

/**
 * Read the persisted settings from the data file, so startup behaviour can
 * honour them before the renderer is ready.
 */
async function readPreferences(): Promise<{ checkForUpdatesOnStartup?: boolean }> {
  try {
    const raw = await fs.readFile(dataFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as {
      settings?: { checkForUpdatesOnStartup?: boolean }
    }
    return parsed.settings ?? {}
  } catch {
    return {}
  }
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: 'ANIMEEH',
    autoHideMenuBar: true,
    backgroundColor: '#0d0a15',
    // Packaged builds inherit the icon from ANIMEEH.exe; dev needs it explicitly.
    icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && rendererDevUrl) {
    await win.loadURL(rendererDevUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/* ------------------------------------------------------------------ */
/* IPC: persistence                                                    */
/* ------------------------------------------------------------------ */

ipcMain.handle('data:load', async () => {
  try {
    const raw = await fs.readFile(dataFilePath(), 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
})

ipcMain.handle('data:save', async (_event, data: unknown) => {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(dataFilePath(), JSON.stringify(data, null, 2), 'utf-8')
  return true
})

ipcMain.handle('data:reveal', async () => {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  shell.showItemInFolder(dataFilePath())
  return dataFilePath()
})

ipcMain.handle('data:export', async (_event, data: unknown) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export ANIMEEH backup',
    defaultPath: 'animeeh-backup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (canceled || !filePath) return null
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
  return filePath
})

ipcMain.handle('data:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import ANIMEEH backup',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (canceled || filePaths.length === 0) return null
  const raw = await fs.readFile(filePaths[0], 'utf-8')
  return { path: filePaths[0], data: JSON.parse(raw) }
})

/* ------------------------------------------------------------------ */
/* IPC: AniList reference lookup                                       */
/* ------------------------------------------------------------------ */

ipcMain.handle(
  'anilist:search',
  async (_event, query: unknown): Promise<AniListOutcome<AnimeSearchResult[]>> => {
    if (typeof query !== 'string' || query.trim().length < MIN_QUERY_LENGTH) {
      return { ok: true, data: [] }
    }
    try {
      return { ok: true, data: await searchAnime(query) }
    } catch (err) {
      // Network problems must never break the app: the user can still type
      // everything in by hand.
      console.error('AniList search failed', err)
      return { ok: false, error: (err as Error).message }
    }
  }
)

ipcMain.handle(
  'anilist:franchise',
  async (_event, anilistId: unknown): Promise<AniListOutcome<AnimeDetails>> => {
    if (typeof anilistId !== 'number' || !Number.isFinite(anilistId)) {
      return { ok: false, error: 'Invalid AniList id' }
    }
    try {
      return { ok: true, data: await getAnimeDetails(anilistId) }
    } catch (err) {
      console.error('AniList franchise lookup failed', err)
      return { ok: false, error: (err as Error).message }
    }
  }
)

/* ------------------------------------------------------------------ */
/* IPC: episode names                                                  */
/* ------------------------------------------------------------------ */

ipcMain.handle(
  'episodes:load',
  async (_event, seasonIds: unknown): Promise<EpisodeNamesOutcome> => {
    if (!Array.isArray(seasonIds) || seasonIds.length === 0) {
      return { ok: false, error: 'This anime has no reference id to look episodes up by.' }
    }
    try {
      const ids = seasonIds.filter((n): n is number => typeof n === 'number')
      return { ok: true, data: await loadEpisodeNames(ids) }
    } catch (err) {
      console.error('Episode lookup failed', err)
      return { ok: false, error: (err as Error).message }
    }
  }
)

/* ------------------------------------------------------------------ */
/* IPC: in-app updates                                                 */
/* ------------------------------------------------------------------ */

ipcMain.handle('update:status', (): UpdateStatus => getUpdateStatus())

ipcMain.handle('update:check', (): Promise<UpdateStatus> => checkForUpdates())

ipcMain.handle('update:download', (): Promise<UpdateStatus> => downloadUpdate())

ipcMain.handle('update:install', () => {
  installUpdate()
  return true
})

/** Push every status change to all open windows. */
updateEvents.on('status', (next: UpdateStatus) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:status-changed', next)
  }
})

/* ------------------------------------------------------------------ */

app.whenReady().then(async () => {
  await createWindow()

  // Honour the user's "check at startup" preference.
  try {
    const prefs = await readPreferences()
    if (prefs.checkForUpdatesOnStartup !== false) scheduleStartupCheck()
  } catch {
    scheduleStartupCheck()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
