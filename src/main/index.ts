import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/** In dev, electron-vite injects this so we can load the Vite dev server. */
const rendererDevUrl = process.env['ELECTRON_RENDERER_URL']
const isDev = !app.isPackaged && !!rendererDevUrl

function dataFilePath(): string {
  return join(app.getPath('userData'), 'animeeh-data.json')
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

app.whenReady().then(async () => {
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
