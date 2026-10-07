import { useMemo, useState, type ReactNode } from 'react'
import { useI18n, LANGUAGES, criterionKey } from '../i18n'
import { useStore } from '../store'
import { COMPONENTS, DEFAULT_WEIGHTS, type ComponentKey, type Language, type StoreData } from '../types'
import { IconDownload, IconFolder, IconTrash, IconUpload } from './Icons'
import { EpisodeNamesPanel } from './EpisodeNamesPanel'
import { Modal } from './ui'
import { UpdatePanel } from './UpdatePanel'

export function SettingsView(): ReactNode {
  const { data, updateSettings, replaceAll, clearAnime } = useStore()
  const { t, language } = useI18n()
  const [message, setMessage] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  const weights = data.settings.weights

  const setWeight = (key: ComponentKey, value: number): void =>
    updateSettings({ weights: { ...weights, [key]: value } })

  /** Every genre present in the library, most common first. */
  const genres = useMemo(() => {
    const counts = new Map<string, number>()
    for (const anime of data.anime) {
      for (const genre of anime.genres ?? []) {
        counts.set(genre, (counts.get(genre) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [data.anime])

  const onExport = async (): Promise<void> => {
    const path = await window.animeeh.exportData(data)
    setMessage(path ? `${t('settings.export')} → ${path}` : t('action.cancel'))
  }

  const onImport = async (): Promise<void> => {
    try {
      const result = await window.animeeh.importData()
      if (!result) return
      replaceAll(result.data as StoreData)
      setMessage(result.path)
    } catch (err) {
      setMessage(`${(err as Error).message}`)
    }
  }

  const onReveal = async (): Promise<void> => {
    const path = await window.animeeh.reveal()
    setMessage(path)
  }

  return (
    <>
      <UpdatePanel />

      <EpisodeNamesPanel />

      {message && (
        <div className="panel" style={{ padding: '12px 18px' }}>
          <div className="mono">{message}</div>
        </div>
      )}

      <div className="panel">
        <h3>{t('settings.language')}</h3>
        <div className="panel-sub">{t('settings.languageSub')}</div>
        <div className="chips">
          {LANGUAGES.map((option) => (
            <button
              key={option.key}
              className={`chip${language === option.key ? ' active' : ''}`}
              onClick={() => updateSettings({ language: option.key as Language })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>{t('settings.startup')}</h3>
        <div className="panel-sub">{t('settings.startupSub')}</div>
        <div className="toggle-row">
          <label htmlFor="set-check-startup">
            <span className="toggle-title">{t('settings.checkOnStartup')}</span>
            <span className="toggle-sub">{t('settings.checkOnStartupSub')}</span>
          </label>
          <input
            id="set-check-startup"
            type="checkbox"
            checked={data.settings.checkForUpdatesOnStartup}
            onChange={(e) => updateSettings({ checkForUpdatesOnStartup: e.target.checked })}
          />
        </div>
      </div>

      <div className="panel">
        <h3>{t('settings.weights')}</h3>
        <div className="panel-sub">{t('settings.weightsSub')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {COMPONENTS.map((c) => (
            <div className="weights-grid" key={c.key}>
              <div className="criterion-name">
                <span className="dot" style={{ background: `hsl(${c.hue} 70% 55%)` }} />
                {t(criterionKey(c.key))}
              </div>
              <input
                className="slider"
                type="range"
                min={0}
                max={3}
                step={0.25}
                value={weights[c.key]}
                style={{
                  background: `linear-gradient(90deg, hsl(${c.hue} 70% 52%) ${
                    (weights[c.key] / 3) * 100
                  }%, rgba(255,255,255,0.08) ${(weights[c.key] / 3) * 100}%)`
                }}
                onChange={(e) => setWeight(c.key, Number(e.target.value))}
              />
              <input
                className="score-input"
                type="number"
                min={0}
                max={3}
                step={0.25}
                value={weights[c.key]}
                onChange={(e) => setWeight(c.key, Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
          ))}
        </div>
        <div className="panel-actions" style={{ marginTop: 16 }}>
          <button
            className="btn sm"
            onClick={() => updateSettings({ weights: { ...DEFAULT_WEIGHTS } })}
          >
            {t('settings.resetWeights')}
          </button>
          <span className="hint" style={{ alignSelf: 'center' }}>
            {t('settings.totalWeight', {
              value: Object.values(weights)
                .reduce((a, b) => a + b, 0)
                .toFixed(2)
            })}
          </span>
        </div>
      </div>

      <div className="panel">
        <h3>{t('settings.backups')}</h3>
        <div className="panel-sub">{t('settings.backupsSub')}</div>
        <div className="panel-actions">
          <button className="btn" onClick={onExport}>
            <IconDownload size={15} /> {t('settings.export')}
          </button>
          <button className="btn" onClick={onImport}>
            <IconUpload size={15} /> {t('settings.import')}
          </button>
          <button className="btn" onClick={onReveal}>
            <IconFolder size={15} /> {t('settings.reveal')}
          </button>
        </div>
      </div>

      {genres.length > 0 && (
        <div className="panel">
          <h3>{t('settings.genres')}</h3>
          <div className="panel-sub">{t('settings.genresSub')}</div>
          <div className="chips">
            {genres.map(([genre, count]) => (
              <span className="chip" key={genre}>
                {genre} <span className="hint">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="panel danger-panel">
        <h3>{t('settings.danger')}</h3>
        <div className="panel-sub">{t('settings.dangerSub')}</div>
        <div className="panel-actions">
          <button
            className="btn danger"
            disabled={data.anime.length === 0}
            onClick={() => setClearing(true)}
          >
            <IconTrash size={15} /> {t('settings.clear')}
          </button>
          <span className="hint" style={{ alignSelf: 'center', maxWidth: 420 }}>
            {t('settings.clearHint')}
          </span>
        </div>
      </div>

      {clearing && (
        <ClearConfirm
          count={data.anime.length}
          onCancel={() => setClearing(false)}
          onConfirm={() => {
            clearAnime()
            setClearing(false)
            setMessage(t('settings.clearDone'))
          }}
        />
      )}
    </>
  )
}

/**
 * Typed confirmation for the destructive reset. The word is localised, so a
 * French user types "tout effacer" rather than an English word.
 */
function ClearConfirm({
  count,
  onCancel,
  onConfirm
}: {
  count: number
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const word = t('settings.clearWord')
  const ok = text.trim().toLowerCase() === word.toLowerCase()

  return (
    <Modal title={t('settings.clearConfirmTitle')} onClose={onCancel}>
      <div className="modal-sub">{t('settings.clearConfirmBody', { count, word })}</div>
      <div className="modal-form">
        <input
          className="input"
          autoFocus
          value={text}
          placeholder={word}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>
            {t('action.cancel')}
          </button>
          <button className="btn danger" disabled={!ok} onClick={onConfirm}>
            <IconTrash size={15} /> {t('settings.clear')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

