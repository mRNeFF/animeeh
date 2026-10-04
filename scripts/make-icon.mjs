/**
 * Generates build/icon.ico (multi-resolution), build/icon.png and
 * build/icon-<size>.png by rasterising scripts/icon/icon.html with Electron.
 *
 * No image libraries required — Electron renders, and the ICO container is
 * packed by hand below.
 */
import { _electron as electron } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const buildDir = join(root, 'build')
const iconMain = join(here, 'icon', 'main.js')

/** Sizes baked into the .ico (Windows picks the best fit). */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
/** Extra high-res raster for store listings / macOS conversion later. */
const EXTRA_SIZES = [512]

mkdirSync(buildDir, { recursive: true })

async function render(size) {
  const app = await electron.launch({
    args: [iconMain],
    cwd: root,
    env: { ...process.env, ICON_SIZE: String(size) }
  })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.setViewportSize({ width: size, height: size }).catch(() => {})
    await win.waitForTimeout(450)
    const buffer = await win.screenshot({ omitBackground: true })
    return buffer
  } finally {
    await app.close()
  }
}

function packIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const directory = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count

  entries.forEach((entry, index) => {
    const at = index * 16
    const dim = entry.size >= 256 ? 0 : entry.size
    directory.writeUInt8(dim, at + 0) // width
    directory.writeUInt8(dim, at + 1) // height
    directory.writeUInt8(0, at + 2) // palette count
    directory.writeUInt8(0, at + 3) // reserved
    directory.writeUInt16LE(1, at + 4) // color planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(entry.buffer.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += entry.buffer.length
  })

  return Buffer.concat([header, directory, ...entries.map((e) => e.buffer)])
}

const entries = []
for (const size of ICO_SIZES) {
  const buffer = await render(size)
  entries.push({ size, buffer })
  writeFileSync(join(buildDir, `icon-${size}.png`), buffer)
  console.log(`rendered ${size}x${size} (${buffer.length} bytes)`)
}

for (const size of EXTRA_SIZES) {
  const buffer = await render(size)
  writeFileSync(join(buildDir, `icon-${size}.png`), buffer)
  console.log(`rendered ${size}x${size} (${buffer.length} bytes)`)
}

const ico = packIco(entries)
writeFileSync(join(buildDir, 'icon.ico'), ico)
writeFileSync(join(buildDir, 'icon.png'), entries[entries.length - 1].buffer)
console.log(`wrote build/icon.ico (${ico.length} bytes, ${entries.length} sizes)`)
console.log('wrote build/icon.png')
