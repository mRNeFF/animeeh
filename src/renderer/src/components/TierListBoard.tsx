/**
 * The board: rows S to F, a pool of everything not yet placed, and the gestures
 * that move an element between them.
 *
 * Two ways in, deliberately. Dragging is what everyone expects from a tier list,
 * and it is the clearest way to place one element. But a list has sixty elements,
 * and dragging sixty times is tiring, so elements can also be selected and sent to
 * a row with a single keypress. The keyboard route is the one that makes a large
 * list practical, and it is why selection exists at all.
 *
 * The row letters come from the grade palette, so a row and a badge read the same.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { useStore } from '../store'
import {
  boardView,
  clearPlacements,
  countsByRow,
  orphanAnimeIds,
  removeItem,
  renameList,
  renameRow,
  rowGradient,
  rowTextColor,
  sortByScore,
  statsOf
} from '../tierlist'
import type { TierItem, TierList } from '../types'
import { IconArrowLeft, IconClose, IconDownload, IconPlus, IconRefresh, IconTrash } from './Icons'

interface Props {
  list: TierList
  onClose: () => void
  onAddItems: () => void
  onChange: (next: (list: TierList) => TierList) => void
}

/** Which element is being dragged, kept in a ref so the drop handler can read it. */
interface DragState {
  itemId: string
  /** Every selected element, so dragging one of a selection moves the selection. */
  ids: string[]
}

export function TierListBoard({ list, onClose, onAddItems, onChange }: Props): ReactNode {
  const { t } = useI18n()
  const { data } = useStore()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingName, setEditingName] = useState(false)
  const [editingRow, setEditingRow] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const dragging = useRef<DragState | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)

  const view = useMemo(() => boardView(list), [list])
  const counts = useMemo(() => countsByRow(list), [list])
  const stats = useMemo(() => statsOf(list), [list])
  const orphans = useMemo(() => orphanAnimeIds(list, data.anime), [list, data.anime])

  /* ---- Placing elements ---- */

  const place = useCallback(
    (ids: string[], rowId: string | null) => {
      onChange((current) => {
        let next = current
        for (const id of ids) {
          next = { ...next, items: next.items.map((item) => (item.id === id ? { ...item, rowId } : item)) }
        }
        return { ...next, updatedAt: new Date().toISOString() }
      })
      setSelected(new Set())
    },
    [onChange]
  )

  /**
   * The keyboard route: with elements selected, the row's own letter sends them
   * there. Rows can be renamed, so the match is on the letter rather than the
   * label, which keeps the shortcut working after a rename.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      if (selected.size === 0) return

      if (event.key === 'Escape') {
        setSelected(new Set())
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        onChange((current) => {
          let next = current
          for (const id of selected) next = removeItem(next, id)
          return next
        })
        setSelected(new Set())
        return
      }

      const key = event.key.toUpperCase()
      const row = list.rows.find((candidate) => candidate.letter.toUpperCase() === key)
      if (row) {
        event.preventDefault()
        place([...selected], row.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, list.rows, onChange, place])

  const toggleSelected = (itemId: string, additive: boolean): void => {
    setSelected((current) => {
      const next = new Set(additive ? current : [])
      if (additive && current.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  /* ---- Drag and drop ---- */

  const onDragStart = (event: React.DragEvent, itemId: string, rowId: string | null): void => {
    void rowId
    const ids = selected.has(itemId) ? [...selected] : [itemId]
    dragging.current = { itemId, ids }
    event.dataTransfer.effectAllowed = 'move'
    // The data transfer needs something in it for Firefox and for Electron's
    // own drag handling; the real state is in the ref.
    event.dataTransfer.setData('text/plain', itemId)
  }

  const onDrop = (event: React.DragEvent, rowId: string | null): void => {
    event.preventDefault()
    setDragOver(null)
    const state = dragging.current
    dragging.current = null
    if (state) place(state.ids, rowId)
  }

  /* ---- Actions ---- */

  const onSortByScore = (): void => {
    const next = sortByScore(list, data.anime, data.settings.weights)
    if (next === list) {
      setMessage(t('tierlist.picker.noScores'))
      return
    }
    onChange(() => next)
    setMessage('')
  }

  const onExport = async (): Promise<void> => {
    const element = boardRef.current
    if (!element) return
    setMessage('')
    const rect = element.getBoundingClientRect()
    const safe = list.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'tier-list'
    const path = await window.animeeh.exportImage(
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      safe
    )
    if (path) setMessage(t('tierlist.exportDone', { path }))
  }

  const onRemoveItem = (itemId: string): void => {
    onChange((current) => removeItem(current, itemId))
  }

  /* ---- Rendering ---- */

  const tile = (item: TierItem, rowId: string | null): ReactNode => {
    const orphan = item.animeId !== undefined && orphans.has(item.animeId)
    return (
      <div
        key={item.id}
        className={`tl-tile${selected.has(item.id) ? ' on' : ''}${orphan ? ' orphan' : ''}`}
        draggable
        onDragStart={(event) => onDragStart(event, item.id, rowId)}
        onClick={(event) => toggleSelected(item.id, event.ctrlKey || event.metaKey || event.shiftKey)}
        title={orphan ? `${item.label} — ${t('tierlist.orphan')}` : item.label}
      >
        {item.image ? (
          <img src={item.image} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="ph">{item.label.slice(0, 2).toUpperCase()}</span>
        )}
        <span className="cap">{item.label}</span>
        <button
          className="rm"
          title={t('action.delete')}
          onClick={(event) => {
            event.stopPropagation()
            onRemoveItem(item.id)
          }}
        >
          <IconClose size={11} />
        </button>
      </div>
    )
  }

  return (
    <div className="tl-board-wrap">
      <div className="tl-bar">
        <button className="btn sm" onClick={onClose}>
          <IconArrowLeft size={14} /> {t('tierlist.back')}
        </button>

        {editingName ? (
          <input
            className="input tl-name-input"
            autoFocus
            defaultValue={list.name}
            onBlur={(event) => {
              onChange((current) => renameList(current, event.target.value))
              setEditingName(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              if (event.key === 'Escape') setEditingName(false)
            }}
          />
        ) : (
          <button className="tl-name" onClick={() => setEditingName(true)} title={t('tierlist.rename')}>
            {list.name}
          </button>
        )}

        <span className="pill">{t(`tierlist.kind.${list.kind}`)}</span>
        <span className="grow" />

        {selected.size > 0 && (
          <span className="hint tl-sel">{t('tierlist.selected', { count: selected.size })}</span>
        )}
        <button className="btn sm" onClick={onSortByScore} title={t('tierlist.sortByScoreHint')}>
          <IconRefresh size={13} /> {t('tierlist.sortByScore')}
        </button>
        <button
          className="btn sm"
          onClick={() => onChange(clearPlacements)}
          disabled={stats.placed === 0}
          title={t('tierlist.clearPlacements')}
        >
          <IconTrash size={13} /> {t('tierlist.clearPlacements')}
        </button>
        <button className="btn sm" onClick={onAddItems}>
          <IconPlus size={13} /> {t('tierlist.addItems')}
        </button>
        <button className="btn sm primary" onClick={onExport}>
          <IconDownload size={13} /> {t('tierlist.export')}
        </button>
      </div>

      {message !== '' && <div className="hint tl-message">{message}</div>}

      <div className="tl-scroll">
        {/* Everything below this line is what the export captures. */}
        <div className="tl-capture" ref={boardRef}>
          <div className="tl-capture-head">
            <span className="n">{list.name}</span>
            <span className="s">ANIMEEH</span>
          </div>

          {/* B1: the pool sits above the rows, so both are on screen for a drag. */}
          <div
            className={`tl-pool${dragOver === 'pool' ? ' over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver('pool')
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(event) => onDrop(event, null)}
          >
            <div className="tl-pool-head">
              <span className="t">
                {t('tierlist.pool')} · {stats.pool}
              </span>
              <span className="grow" />
              {stats.pool > 0 && <span className="hint">{t('tierlist.helpDrag')}</span>}
            </div>
            <div className="tl-pool-tiles">
              {stats.pool === 0 ? (
                <span className="hint">{t('tierlist.poolEmpty')}</span>
              ) : (
                view.pool.map((item) => tile(item, null))
              )}
            </div>
          </div>

          <div className="tl-rows">
            {view.rows.map(({ row, items }) => (
              <div className="tl-row" key={row.id}>
                {editingRow === row.id ? (
                  <input
                    className="tl-label-input"
                    autoFocus
                    defaultValue={row.label}
                    style={{ background: rowGradient(row), color: rowTextColor(row) }}
                    onBlur={(event) => {
                      onChange((current) => renameRow(current, row.id, event.target.value))
                      setEditingRow(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                      if (event.key === 'Escape') setEditingRow(null)
                    }}
                  />
                ) : (
                  <button
                    className="tl-label"
                    style={{ background: rowGradient(row), color: rowTextColor(row) }}
                    onClick={() => setEditingRow(row.id)}
                    title={t('tierlist.rename')}
                  >
                    {row.label}
                    <span className="count">{counts.get(row.id) ?? 0}</span>
                  </button>
                )}

                <div
                  className={`tl-area${dragOver === row.id ? ' over' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragOver(row.id)
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(event) => onDrop(event, row.id)}
                  onClick={() => {
                    // Clicking the empty space of a row sends the selection there.
                    if (selected.size > 0) place([...selected], row.id)
                  }}
                >
                  {items.length === 0 ? (
                    <span className="tl-hintline">{row.letter}</span>
                  ) : (
                    items.map((item) => tile(item, row.id))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
