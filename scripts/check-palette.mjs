/**
 * Measures the grade palette, so a later tweak cannot quietly ruin it.
 *
 * Three properties matter, and the palette that was replaced failed the third:
 *
 *   1. contiguity    — each tier's slice must end where the next begins, since
 *                      that is what makes the palette one gradient rather than
 *                      seven unrelated colours
 *   2. distinction   — two consecutive tiers must not be confusable. Measured in
 *                      Lab (CIE76), where 20 is the point two colours separate
 *                      at a glance and below 10 they blend
 *   3. readability   — the dark letter on a badge must clear 4.5:1 contrast. The
 *                      previous palette reached only 3.3:1
 *
 * The hex values are derived from the palette itself, so the checks follow the
 * source rather than a copy of it.
 *
 * Usage: node scripts/check-palette.mjs
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(mkdtempSync(join(tmpdir(), 'palette-')), 'a.mjs')

await build({
  entryPoints: [join(root, 'src/renderer/src/palette.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: out,
  logLevel: 'error'
})

const { TIERS, tierOf, tierHue, tierGradient, tierTextColor, tierRgb, hslToRgbChannels } =
  await import(pathToFileURL(out).href)

/* ---------------- Colour maths, independent of the palette module ---------------- */

const APP_BG = '#070c16'

const hexToRgb = (hex) => {
  const v = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16))
}

const toLinear = (c) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (rgbA, rgbB) => {
  const a = luminance(rgbA)
  const b = luminance(rgbB)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const toLab = (rgb) => {
  const [r, g, b] = rgb.map(toLinear)
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(X), f(Y), f(Z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

const deltaE = (rgbA, rgbB) => {
  const [l1, a1, b1] = toLab(rgbA)
  const [l2, a2, b2] = toLab(rgbB)
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2)
}

/** The colour at one end of a tier's slice, taken from the gradient it paints. */
const endRgb = (tier, end) => {
  const gradient = tierGradient(tier)
  // The gradient is `linear-gradient(135deg, hsl(...), hsl(...))`; reading the
  // colours back out of it means the checks follow whatever the app renders.
  const matches = [...gradient.matchAll(/hsl\(([-\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)/g)]
  const pick = end === 'from' ? matches[0] : matches[1]
  return hslToRgbChannels(Number(pick[1]), Number(pick[2]), Number(pick[3]))
}

const tierStartRgb = (tier) => endRgb(tier, 'from')
const tierEndRgb = (tier) => endRgb(tier, 'to')

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('')
const hexOf = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
const parseHex = (h) => hexToRgb(h)

let failures = 0
const check = (label, ok, detail) => {
  if (!ok) failures += 1
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
}

/* ---------------- 1. The tiers themselves ---------------- */

console.log('the seven tiers, worst first:\n')
check('there are exactly seven', TIERS.length === 7, `${TIERS.length}`)
check(
  'the letters are F E D C B A S',
  TIERS.map((t) => t.letter).join('') === 'FEDCBAS',
  TIERS.map((t) => t.letter).join(' ')
)

console.log('\ncontiguity, each slice starting where the previous ends:\n')
for (let i = 1; i < TIERS.length; i += 1) {
  const prev = TIERS[i - 1]
  const here = TIERS[i]
  check(
    `${prev.letter} ends where ${here.letter} begins`,
    prev.to === here.from,
    `${prev.letter} to=${prev.to} · ${here.letter} from=${here.from}`
  )
}

/* ---------------- 2. Distinctness ---------------- */

console.log('\nperceived distance between consecutive tiers (CIE76):\n')
const distances = []
for (let i = 1; i < TIERS.length; i += 1) {
  const d = deltaE(tierStartRgb(TIERS[i]), tierStartRgb(TIERS[i - 1]))
  distances.push(d)
  console.log(
    `     ${TIERS[i - 1].letter} -> ${TIERS[i].letter}   ` +
      `${hexOf(tierStartRgb(TIERS[i - 1]))} -> ${hexOf(tierStartRgb(TIERS[i]))}   ΔE ${d.toFixed(1)}`
  )
}
const minD = Math.min(...distances)
const maxD = Math.max(...distances)
const ratio = maxD / minD
console.log()
check('every neighbour pair separates at a glance', minD >= 20, `worst ${minD.toFixed(1)}`)
check('no pair is confusable', minD >= 10, `worst ${minD.toFixed(1)}`)
check('the spread stays even', ratio <= 2.6, `${ratio.toFixed(2)}x (was 4.73x before)`)

/* ---------------- 3. Readability ---------------- */

console.log('\nthe letter on each badge, against the required 4.5:1:\n')
const contrasts = []
for (const tier of TIERS) {
  // The letter colour is chosen by the palette, and both ends of the gradient
  // are painted, so both have to clear the threshold — not just the middle.
  const text = parseHex(tierTextColor(tier))
  const atStart = contrast(tierStartRgb(tier), text)
  const atEnd = contrast(tierEndRgb(tier), text)
  const worst = Math.min(atStart, atEnd)
  contrasts.push(worst)
  const name = tierTextColor(tier) === '#ffffff' ? 'light' : 'dark'
  console.log(
    `     ${tier.letter}  ${hexOf(tierStartRgb(tier))} -> ${hexOf(tierEndRgb(tier))}  ` +
      `${name.padStart(5)} letter   ${atStart.toFixed(1)}:1 / ${atEnd.toFixed(1)}:1`
  )
}
const minC = Math.min(...contrasts)
console.log()
check('every badge letter is readable, at both ends', minC >= 4.5, `worst ${minC.toFixed(1)}:1 (was 3.3:1 before)`)

/* ---------------- 4. The helpers behave ---------------- */

console.log('\nhelpers:\n')
check('tierOf finds a tier by letter', tierOf('S')?.letter === 'S', JSON.stringify(tierOf('S')))
check('tierOf returns null for an em dash', tierOf('—') === null, String(tierOf('—')))
check('tierOf returns null for nonsense', tierOf('Z') === null, String(tierOf('Z')))

const s = tierOf('S')
check('tierHue sits in the middle of the slice', tierHue(s) === (s.from + s.to) / 2, `${tierHue(s)}`)
const gradient = tierGradient(s)
check('the gradient is a two-stop linear gradient', /^linear-gradient\(135deg, hsl\(.+, hsl\(.+\)$/.test(gradient), gradient)
check('the gradient uses both ends of the slice', gradient.includes(`hsl(${s.from} `) && gradient.includes(`hsl(${s.to} `), gradient)
check(
  'a negative hue is handled, since F starts at -18',
  hslToRgbChannels(-18, 78, 63).every((v) => v >= 0 && v <= 255),
  hslToRgbChannels(-18, 78, 63).join(', ')
)

console.log(`\n${failures === 0 ? 'PALETTE OK' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
