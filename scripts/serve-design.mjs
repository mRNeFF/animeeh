/**
 * Minimal static file server, used only to preview the pages in design/ in the
 * browser. The browser tool refuses file:// URLs, so a page needs to be served
 * over HTTP for a visual check.
 *
 * Usage:
 *   node scripts/serve-design.mjs                      # art-directions.html
 *   node scripts/serve-design.mjs 4180                 # another port
 *   node scripts/serve-design.mjs 4180 leaderboard-gradients.html
 *
 * Any other file in design/ is reachable by its name, so the default page is
 * only a convenience.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, normalize } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'design')
const port = Number(process.argv[2] ?? 4173)
const defaultPage = process.argv[3] ?? 'art-directions.html'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0])
  const rel = url === '/' ? defaultPage : url.replace(/^\/+/, '')
  const file = join(root, normalize(rel))

  // Keep the server inside the design folder.
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden')
    return
  }
  if (!existsSync(file)) {
    res.writeHead(404).end('not found')
    return
  }

  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store'
    })
    res.end(body)
  } catch (err) {
    res.writeHead(500).end(String(err))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`design preview on http://127.0.0.1:${port}/`)
})
