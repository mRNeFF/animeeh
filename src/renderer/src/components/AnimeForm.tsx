import { useState, type ReactNode } from 'react'
import { STATUSES, type Anime, type Status } from '../types'
import { Modal } from './ui'

export interface AnimeFormValues {
  title: string
  englishTitle: string
  year: string
  studio: string
  status: Status
  notes: string
  favorite: boolean
}

export function AnimeForm({
  initial,
  onClose,
  onSubmit,
  submitLabel
}: {
  initial?: Anime
  onClose: () => void
  onSubmit: (values: AnimeFormValues) => void
  submitLabel: string
}): ReactNode {
  const [values, setValues] = useState<AnimeFormValues>({
    title: initial?.title ?? '',
    englishTitle: initial?.englishTitle ?? '',
    year: initial?.year ? String(initial.year) : '',
    studio: initial?.studio ?? '',
    status: initial?.status ?? 'completed',
    notes: initial?.notes ?? '',
    favorite: initial?.favorite ?? false
  })

  const set = <K extends keyof AnimeFormValues>(key: K, value: AnimeFormValues[K]): void =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const canSubmit = values.title.trim().length > 0

  return (
    <Modal
      title={initial ? 'Edit anime' : 'Add anime'}
      subtitle={
        initial
          ? 'Update the details for this entry.'
          : 'Create the entry first — you can add episode scores and criteria right after.'
      }
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) onSubmit({ ...values, title: values.title.trim() })
        }}
      >
        <div className="field">
          <label htmlFor="af-title">Title *</label>
          <input
            id="af-title"
            className="input"
            autoFocus
            placeholder="e.g. Frieren: Beyond Journey's End"
            value={values.title}
            onChange={(e) => set('title', e.target.value)}
          />
        </div>

        <div className="row-2">
          <div className="field">
            <label htmlFor="af-english">English title</label>
            <input
              id="af-english"
              className="input"
              placeholder="optional"
              value={values.englishTitle}
              onChange={(e) => set('englishTitle', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="af-year">Year</label>
            <input
              id="af-year"
              className="input"
              type="number"
              min={1900}
              max={2200}
              placeholder="2023"
              value={values.year}
              onChange={(e) => set('year', e.target.value)}
            />
          </div>
        </div>

        <div className="row-2">
          <div className="field">
            <label htmlFor="af-studio">Studio</label>
            <input
              id="af-studio"
              className="input"
              placeholder="e.g. Madhouse"
              value={values.studio}
              onChange={(e) => set('studio', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="af-status">Status</label>
            <select
              id="af-status"
              className="select"
              value={values.status}
              onChange={(e) => set('status', e.target.value as Status)}
            >
              {STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="af-notes">Notes</label>
          <textarea
            id="af-notes"
            className="textarea"
            placeholder="Thoughts, favourite arc, where you watched it…"
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={values.favorite}
            onChange={(e) => set('favorite', e.target.checked)}
          />
          Mark as a personal favourite
        </label>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
