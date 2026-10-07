/**
 * The grade palette.
 *
 * Seven tiers, each one a **slice of a single continuous gradient** rather than a
 * colour chosen on its own. The slices are contiguous: a tier ends exactly where
 * the next begins, so the palette reads as one gradient cut into steps, and the
 * continuity cannot break because there is only ever one gradient.
 *
 * Each tier carries its own colour — a hue slice, a saturation and a lightness —
 * and the badge paints that whole slice. Two progressions run together:
 *
 *   - **within a tier**, the hue sweeps its slice at the **luminance the tier's
 *     own colour has**. The lightness at each end is therefore derived, not
 *     fixed, which is what lets a single letter colour stay readable across the
 *     whole badge;
 *   - **between tiers**, both the hue and the lightness step, the lightness
 *     rising from deep at F to bright at S.
 *
 * Deriving the end lightness from a luminance is not optional, and getting it
 * wrong is what the first attempt did. Contrast is a function of luminance, and
 * the same HSL lightness gives very different luminance at different hues: B's
 * slice ends at 246 degrees, where blue is intrinsically dark, and a fixed
 * lightness there produced 2.9:1 for the letter, worse than the palette this
 * replaced. Holding the luminance flat across a slice fixes it at the cause.
 *
 * It also fixes a second thing that is easy to miss: the letter colour is chosen
 * by contrast rather than assumed. A dark letter on every badge failed on the
 * blue and violet tiers; those now take a light letter instead.
 *
 * Chosen over three alternatives, and the reasons are worth keeping:
 *
 *   - even 54 degree steps are regular on a circle but not to the eye: their
 *     perceived gaps measured 34.4 to 83.6;
 *   - an arc of constant chroma placed in Lab gives near-perfectly even gaps
 *     (measured 29.0 to 29.4, a ratio of 1.02) but is the dullest of the four,
 *     since a constant chroma leaves no room for a deep red or a vivid pink;
 *   - keeping today's anchors (green at C, blue at B) and only respacing the
 *     cramped bottom leaves the widest gap in the palette at C.
 *
 * `npm run check:palette` measures the contiguity, the perceived gaps and the
 * letter contrast at both ends of every badge.
 */

/** The seven tiers, best first, as they are displayed. */
export type TierLetter = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export interface Tier {
  letter: TierLetter
  /** Start of this tier's slice, in HSL hue degrees. May be negative. */
  from: number
  /** End of the slice, where the next tier starts. */
  to: number
  saturation: number
  /** The lightness of the tier's own colour, which sets the luminance its whole
   *  slice is rendered at. */
  lightness: number
}

/**
 * The slices, ordered worst first so that each entry's `to` is the next entry's
 * `from`. Written this way round to make that contiguity checkable at a glance.
 */
export const TIERS: readonly Tier[] = [
  { letter: 'F', from: -18, to: 34, saturation: 78, lightness: 63 },
  { letter: 'E', from: 34, to: 87, saturation: 78, lightness: 61 },
  { letter: 'D', from: 87, to: 140, saturation: 64, lightness: 58 },
  { letter: 'C', from: 140, to: 193, saturation: 64, lightness: 56 },
  { letter: 'B', from: 193, to: 246, saturation: 76, lightness: 62 },
  { letter: 'A', from: 246, to: 298, saturation: 72, lightness: 66 },
  { letter: 'S', from: 298, to: 351, saturation: 74, lightness: 69 }
]

const BY_LETTER = new Map<string, Tier>(TIERS.map((tier) => [tier.letter, tier]))

/** The two colours a badge letter may take. Both belong to the app already. */
export const TIER_TEXT_DARK = '#070c16'
export const TIER_TEXT_LIGHT = '#ffffff'

/**
 * The grade letters, best first, for anything that needs to name all seven.
 *
 * Kept here rather than in the tier list module so the order matches the palette
 * it is derived from.
 */
export const GRADE_LETTERS: readonly string[] = [...TIERS]
  .reverse()
  .map((tier) => tier.letter)

/** The tier for a grade letter, or null for anything else such as an em dash. */
export function tierOf(letter: string): Tier | null {
  return BY_LETTER.get(letter) ?? null
}

/* ------------------------------------------------------------------ */
/* HSL to RGB, and the luminance that decides everything               */
/* ------------------------------------------------------------------ */

function hueToRgb(p: number, q: number, t: number): number {
  let value = t
  if (value < 0) value += 1
  if (value > 1) value -= 1
  if (value < 1 / 6) return p + (q - p) * 6 * value
  if (value < 1 / 2) return q
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
  return p
}

/** HSL in degrees and percentages to an `r, g, b` triple. */
export function hslToRgbChannels(hue: number, saturation: number, lightness: number): [number, number, number] {
  // HSL accepts any hue, including the negative end of the first slice.
  const h = (((hue % 360) + 360) % 360) / 360
  const s = saturation / 100
  const l = lightness / 100
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, h) * 255),
    Math.round(hueToRgb(p, q, h - 1 / 3) * 255)
  ]
}

/** Relative luminance, the quantity WCAG contrast is computed from. */
export function relativeLuminance(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map((channel) => {
    const v = channel / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours. */
export function contrastRatio(rgbA: readonly number[], rgbB: readonly number[]): number {
  const a = relativeLuminance(rgbA)
  const b = relativeLuminance(rgbB)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * The lightness at this hue and saturation that reaches a target luminance.
 *
 * Luminance rises monotonically with lightness at a fixed hue, so a bisection is
 * enough and cannot land on the wrong branch.
 */
export function lightnessForLuminance(hue: number, saturation: number, target: number): number {
  let low = 0
  let high = 100
  for (let i = 0; i < 44; i += 1) {
    const mid = (low + high) / 2
    if (relativeLuminance(hslToRgbChannels(hue, saturation, mid)) < target) low = mid
    else high = mid
  }
  return Math.round(((low + high) / 2) * 10) / 10
}

/* ------------------------------------------------------------------ */
/* The colours a tier renders                                          */
/* ------------------------------------------------------------------ */

/**
 * The luminance below which a dark letter stops being readable, and above which
 * a light letter does. Both carry a margin over the 4.5:1 threshold, since the
 * letter sits over a gradient and its exact position shifts with the glyph.
 */
const DARK_TEXT_FLOOR = 0.22
const LIGHT_TEXT_CEILING = 0.13

/** The tier's own colour, which is the identity every other colour derives from. */
function tierIdentity(tier: Tier): { rgb: [number, number, number]; luminance: number } {
  const rgb = hslToRgbChannels(tierHue(tier), tier.saturation, tier.lightness)
  return { rgb, luminance: relativeLuminance(rgb) }
}

/**
 * The lightness of one end of a tier's slice.
 *
 * The natural value is the tier's own lightness, lifted at the leading end and
 * lowered at the trailing one so the badge has some depth. That value is then
 * pushed to the readable floor when it would otherwise fall under it.
 *
 * Clamping rather than holding the luminance flat is deliberate. Holding it flat
 * is tidier on paper but ruins a slice that contains yellow: E's identity colour
 * is bright, and forcing its orange end to the same luminance turned it cream.
 * Clamping only intervenes where readability actually requires it, so E keeps its
 * colour and B's dark blue end gets lifted.
 */
function endLightness(tier: Tier, hue: number, end: 'start' | 'end'): number {
  const natural = end === 'start' ? tier.lightness + 5 : tier.lightness - 5
  const luminance = relativeLuminance(hslToRgbChannels(hue, tier.saturation, natural))
  if (tierTextColor(tier) === TIER_TEXT_DARK) {
    return luminance >= DARK_TEXT_FLOOR
      ? natural
      : lightnessForLuminance(hue, tier.saturation, DARK_TEXT_FLOOR)
  }
  return luminance <= LIGHT_TEXT_CEILING
    ? natural
    : lightnessForLuminance(hue, tier.saturation, LIGHT_TEXT_CEILING)
}

/** A tier's colour at a given hue inside its slice, as HSL. */
function hslAt(tier: Tier, hue: number, end: 'start' | 'end'): string {
  return `hsl(${hue} ${tier.saturation}% ${endLightness(tier, hue, end)}%)`
}

/**
 * The middle hue of a tier, used wherever a single flat colour is needed: a bar,
 * a dot, a gauge. The badges use the full slice instead.
 */
export function tierHue(tier: Tier): number {
  return (tier.from + tier.to) / 2
}

/**
 * The badge background: this tier's own slice of the gradient, so a badge leads
 * into the next one.
 */
export function tierGradient(tier: Tier): string {
  return `linear-gradient(135deg, ${hslAt(tier, tier.from, 'start')}, ${hslAt(
    tier,
    tier.to,
    'end'
  )})`
}

/** A flat colour at this tier's middle, for fills that are not gradients. */
export function tierSolid(tier: Tier): string {
  return `hsl(${tierHue(tier)} ${tier.saturation}% ${tier.lightness}%)`
}

/** A tier's own colour as channels, for anything needing to compute with it. */
export function tierRgb(tier: Tier): [number, number, number] {
  return tierIdentity(tier).rgb
}

/**
 * The letter colour for a tier, picked from the tier's own colour rather than
 * assumed. A dark letter on every badge failed on the blue and violet tiers;
 * those take a light letter instead.
 */
export function tierTextColor(tier: Tier): string {
  return tierIdentity(tier).luminance >= (DARK_TEXT_FLOOR + LIGHT_TEXT_CEILING) / 2
    ? TIER_TEXT_DARK
    : TIER_TEXT_LIGHT
}

/**
 * The wash behind a row of the ranking: the tier's slice, strongest at the left
 * edge and fading out, so the colour reads as belonging to the row without ever
 * competing with the figures printed on it.
 */
export function tierRowWash(tier: Tier, alpha = 0.2): string {
  const [r, g, b] = tierRgb(tier)
  return `linear-gradient(90deg, rgba(${r},${g},${b},${alpha}) 0%, rgba(${r},${g},${b},${
    alpha * 0.35
  }) 40%, transparent 72%)`
}
