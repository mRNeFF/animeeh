/** Which keys exist in one dictionary but not the other. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'src/renderer/src/i18n.tsx'), 'utf-8')

function read(name) {
  const start = src.indexOf(`const ${name}`)
  const end = src.indexOf('\n}', start)
  const block = src.slice(start, end)
  const map = new Map()
  const pattern = /'([a-zA-Z0-9.]+)':\s*\n?\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
  for (const m of block.matchAll(pattern)) {
    map.set(m[1], m[2] ?? m[3] ?? '')
  }
  return map
}

const en = read('en')
const fr = read('fr')

console.log(`en=${en.size}  fr=${fr.size}\n`)

const missingFr = [...en.keys()].filter((k) => !fr.has(k))
const extraFr = [...fr.keys()].filter((k) => !en.has(k))

console.log(`keys in en but not fr (${missingFr.length}):`)
for (const k of missingFr) console.log(`   ${k}  =  "${en.get(k)}"`)

console.log(`\nkeys in fr but not en (${extraFr.length}):`)
for (const k of extraFr) console.log(`   ${k}`)
