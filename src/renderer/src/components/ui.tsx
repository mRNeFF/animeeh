import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { tierGradient, tierOf, tierTextColor } from '../palette'

/* ------------------------------------------------------------------ */
/* Deterministic hue + cover gradient                                  */
/* ------------------------------------------------------------------ */

export function hueFromString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 100000
  }
  return hash % 360
}

export function coverGradient(hue: number): string {
  const a = `hsl(${hue} 68% 46%)`
  const b = `hsl(${(hue + 48) % 360} 72% 32%)`
  return `linear-gradient(140deg, ${a}, ${b})`
}

export function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export function Cover({
  title,
  hue,
  src,
  className,
  style
}: {
  title: string
  hue: number
  /** Cover art URL from the reference source; falls back to initials. */
  src?: string
  className?: string
  style?: CSSProperties
}): ReactNode {
  if (src) {
    return (
      <div className={`${className ?? ''} cover-img`} style={style}>
        <img src={src} alt="" loading="lazy" draggable={false} />
      </div>
    )
  }
  return (
    <div className={className} style={{ background: coverGradient(hue), ...style }}>
      {initials(title)}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  title,
  subtitle,
  onClose,
  children
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h3>{title}</h3>
        {subtitle && <div className="modal-sub">{subtitle}</div>}
        {children}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Score control (slider + numeric box)                                */
/* ------------------------------------------------------------------ */

export function ScoreControl({
  value,
  onChange,
  hue,
  showClear = false
}: {
  value: number | null
  onChange: (next: number | null) => void
  hue: number
  showClear?: boolean
}): ReactNode {
  const { t } = useI18n()
  const display = value ?? 0
  const pct = Math.max(0, Math.min(100, display))

  return (
    <div className="ep-bar-wrap">
      <input
        className="slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={display}
        style={{
          background: `linear-gradient(90deg, hsl(${hue} 70% 52%) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`
        }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <input
        className={`score-input${value === null ? ' unrated' : ''}`}
        type="number"
        min={0}
        max={100}
        value={value === null ? '' : value}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') return onChange(null)
          const num = Number(raw)
          if (!Number.isFinite(num)) return
          onChange(Math.max(0, Math.min(100, Math.round(num))))
        }}
      />
      {showClear && value !== null && (
        <button className="btn ghost sm" title={t('action.clearRating')} onClick={() => onChange(null)}>
          ×
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Bar                                                                 */
/* ------------------------------------------------------------------ */

export function Bar({
  value,
  hue,
  height = 6
}: {
  value: number | null
  hue: number
  height?: number
}): ReactNode {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div className="bar" style={{ height }}>
      <span style={{ width: `${pct}%`, background: `hsl(${hue} 70% 52%)` }} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Grade badge                                                         */
/* ------------------------------------------------------------------ */

export function GradeBadge({
  letter,
  className,
  style
}: {
  letter: string
  className?: string
  style?: CSSProperties
}): ReactNode {
  const tier = tierOf(letter)
  // A badge carries its own tier's slice of the palette gradient, so it leads
  // into the badge of the neighbouring tier rather than standing alone.
  const background = tier === null ? 'rgba(255,255,255,0.08)' : tierGradient(tier)
  // Which letter colour to use is decided by contrast, not fixed. The blue and
  // violet tiers are intrinsically dark, so a dark letter on them reached only
  // 2.9:1; those tiers take a light letter instead.
  const color = tier === null ? 'var(--muted-2)' : tierTextColor(tier)
  return (
    <div className={className} style={{ background, color, ...style }}>
      {letter}
    </div>
  )
}
