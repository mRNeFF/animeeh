/**
 * Reports, in plain ASCII, whether the non-ASCII characters in i18n.tsx survived.
 *
 * The Windows console renders UTF-8 as mojibake, so reading the values off the
 * terminal cannot distinguish a real corruption from a display artefact. This
 * prints code points instead, which are unambiguous.
 *
 * Usage: node scripts/check-i18n-bytes.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'src/renderer/src/i18n.tsx')
const text = readFileSync(file, 'utf-8')

const EXPECTED = {
  'French e-acute (Réglages)': 'Réglages',
  'French e-acute (notés)': 'notés',
  'French e-acute (Épisodes)': 'Épisodes',
  'curly apostrophe': '\u2019',
  'horizontal ellipsis': '\u2026',
  'em dash': '\u2014',
  'middle dot separator': '\u00b7'
}

let failures = 0
console.log('Characters expected in i18n.tsx, reported by code point:\n')

for (const [label, needle] of Object.entries(EXPECTED)) {
  const count = text.split(needle).length - 1
  const ok = count > 0
  if (!ok) failures += 1
  const codes = [...needle].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(30)} ${codes.padEnd(28)} x${count}`)
}

// A replacement character would mean bytes were decoded wrongly at some point.
const damaged = text.split('\uFFFD').length - 1
const okDamaged = damaged === 0
if (!okDamaged) failures += 1
console.log(`\n  ${okDamaged ? 'OK  ' : 'FAIL'} U+FFFD replacement characters: ${damaged}`)

console.log(`\n${failures === 0 ? 'NON-ASCII TEXT INTACT' : `${failures} PROBLEM(S)`}`)
process.exit(failures === 0 ? 0 : 1)
