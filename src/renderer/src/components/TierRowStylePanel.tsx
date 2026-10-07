/**
 * The options panel for a tier row, anchored at the bottom right.
 *
 * Opening it is what clicking a row's label does, so the label itself is no longer
 * an inline text field: everything about a row is changed in one place, and the
 * board never shifts under the pointer while it is being edited.
 *
 * Every control writes straight through to the stored row, so there is no apply
 * step to forget. A colour that has not been overridden is shown as the palette
 * one, and the reset button clears the override rather than trying to reproduce
 * the palette by hand.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { LABEL_FONTS, labelFontSize, rowBackground, rowLabelColor } from '../tierlist'
import type { TierRow } from '../types'
import { IconClose, IconTrash } from './Icons'

/** Colours offered as swatches, a spread of hues rather than a full wheel. */
const SWATCHES = [
  '#EA8CEE',
  '#C77DFF',
  '#8A80EA',
  '#5B7CFA',
  '#6BCFEB',
  '#3FB6C9',
  '#5CDB86',
  '#34C77B',
  '#A7DD64',
  '#E8E94E',
  '#ECB165',
  '#E8845C',
  '#ED6E94',
  '#E05A5A',
  '#8B93A7',
  '#3B4A66'
]

interface Props {
  row: TierRow
  /** True for the first row, so its "move up" is disabled. */
  isFirst: boolean
  /** True for the last row, so its "move down" is disabled. */
  isLast: boolean
  /** False when it is the only row, since a list needs at least one. */
  canDelete: boolean
  onChange: (patch: Partial<TierRow>) => void
  onMove: (delta: number) => void
  onDelete: () => void
  onClose: () => void
}

export function TierRowStylePanel({
  row,
  isFirst,
  isLast,
  canDelete,
  onChange,
  onMove,
  onDelete,
  onClose
}: Props): ReactNode {
  const { t } = useI18n()
  const textRef = useRef<HTMLInputElement>(null)

  // Focusing the text field on open saves a click, and Escape closes from
  // anywhere in the panel.
  useEffect(() => {
    textRef.current?.select()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const background = rowBackground(row)
  const labelColor = rowLabelColor(row)

  return (
    <aside className="tl-style">
      <div className="tl-style-head">
        <span className="t">{t('tierlist.style.title')}</span>
        <span className="grow" />
        <button className="icon-btn" title={t('tierlist.picker.close')} onClick={onClose}>
          <IconClose size={15} />
        </button>
      </div>

      {/* A live preview, so a change is visible without looking away from the panel. */}
      <div className="tl-style-preview" style={{ background, color: labelColor }}>
        <span style={{ fontFamily: row.font ? undefined : undefined, fontSize: labelFontSize(row) }}>
          {row.label || '?'}
        </span>
      </div>

      <label className="tl-style-label" htmlFor="tl-row-text">
        {t('tierlist.style.text')}
      </label>
      <input
        id="tl-row-text"
        ref={textRef}
        className="input"
        value={row.label}
        maxLength={24}
        placeholder={t('tierlist.rename')}
        onChange={(event) => onChange({ label: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onClose()
        }}
      />

      <span className="tl-style-label">{t('tierlist.style.font')}</span>
      <div className="tl-style-chips">
        {LABEL_FONTS.map((font) => (
          <button
            key={font.key}
            className={`tl-filter${(row.font ?? 'ui') === font.key ? ' on' : ''}`}
            style={{ fontFamily: font.stack }}
            onClick={() => onChange({ font: font.key })}
          >
            {font.label}
          </button>
        ))}
      </div>

      <span className="tl-style-label">{t('tierlist.style.background')}</span>
      <div className="tl-style-swatches">
        {SWATCHES.map((color) => (
          <button
            key={color}
            className={`tl-swatch${row.color === color ? ' on' : ''}`}
            style={{ background: color }}
            title={color}
            onClick={() => onChange({ color })}
          />
        ))}
        <label className="tl-swatch custom" title={t('tierlist.style.custom')}>
          <input
            type="color"
            value={row.color ?? '#8A80EA'}
            onChange={(event) => onChange({ color: event.target.value })}
          />
        </label>
      </div>

      <span className="tl-style-label">{t('tierlist.style.textColor')}</span>
      <div className="tl-style-swatches">
        <button
          className={`tl-swatch light${row.textColor === '#ffffff' ? ' on' : ''}`}
          style={{ background: '#ffffff' }}
          aria-label={t('tierlist.style.onLight')}
          onClick={() => onChange({ textColor: '#ffffff' })}
        />
        <button
          className={`tl-swatch dark${row.textColor === '#070c16' ? ' on' : ''}`}
          style={{ background: '#070c16' }}
          aria-label={t('tierlist.style.onDark')}
          onClick={() => onChange({ textColor: '#070c16' })}
        />
        <label className="tl-swatch custom" title={t('tierlist.style.custom')}>
          <input
            type="color"
            value={row.textColor ?? '#070c16'}
            onChange={(event) => onChange({ textColor: event.target.value })}
          />
        </label>
      </div>

      <span className="tl-style-label">{t('tierlist.style.size')}</span>
      <div className="tl-style-size">
        <input
          className="slider"
          type="range"
          min={8}
          max={40}
          step={1}
          value={labelFontSize(row)}
          onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
        />
        <span className="mono">{labelFontSize(row)}</span>
      </div>

      <div className="tl-style-actions">
        <button
          className="btn sm"
          onClick={() => onChange({ color: undefined, textColor: undefined, font: undefined, fontSize: undefined })}
        >
          {t('tierlist.style.reset')}
        </button>
        <span className="grow" />
        <button className="btn sm primary" onClick={onClose}>
          {t('tierlist.style.done')}
        </button>
      </div>

      <div className="tl-style-label">{t('tierlist.style.row')}</div>
      <div className="tl-style-actions">
        <button
          className="btn sm"
          onClick={() => onMove(-1)}
          title={t('tierlist.style.moveUp')}
          disabled={isFirst}
        >
          ↑
        </button>
        <button
          className="btn sm"
          onClick={() => onMove(1)}
          title={t('tierlist.style.moveDown')}
          disabled={isLast}
        >
          ↓
        </button>
        <span className="grow" />
        <button className="btn sm danger" onClick={onDelete} disabled={!canDelete}>
          <IconTrash size={13} /> {t('tierlist.style.deleteRow')}
        </button>
      </div>
      {!canDelete && <div className="hint">{t('tierlist.style.lastRow')}</div>}
    </aside>
  )
}
