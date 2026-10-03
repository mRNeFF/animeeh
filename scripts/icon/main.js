// Minimal Electron entry used only by scripts/make-icon.mjs to rasterise the
// icon artwork at a specific square size. Size comes in via ICON_SIZE.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const size = Math.max(8, Number(process.env.ICON_SIZE || 256))

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: size,
    height: size,
    useContentSize: true,
    frame: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    minWidth: 1,
    minHeight: 1,
    maximizable: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: { backgroundThrottling: false }
  })

  await win.loadFile(path.join(__dirname, 'icon.html'))
  win.setContentSize(size, size)
  win.showInactive()
})
