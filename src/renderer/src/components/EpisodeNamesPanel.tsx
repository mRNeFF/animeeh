import { useRef, useState, type ReactNode } from 'react'
import { loadAllEpisodeNames, seasonIdsOf, type BulkProgress } from '../bulkEpisodes'
import { useI18n } from '../i18n'
import { useStore } from '../store'
import { IconDownload } from './Icons'

export function EpisodeNamesPanel(): ReactNode {
  const { data, updateAnime } = useStore()
  const { t } = useI18n()

  const [progress, setProgress] = useState<BulkProgress | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const cancelled = useRef(false)

  // Only anime with a reference id can be filled, and only those still missing
  // names are worth counting.
  const eligible = data.anime.filter((a) => seasonIdsOf(a).length > 0)
  const withoutNames = eligible.filter(
    (a) => !a.episodes.some((e) => (e.title ?? '').trim() !== '')
  ).length

  const running = progress?.running ?? false

  const start = async (): Promise<void> => {
    cancelled.current = false
    setResult(null)

    const outcome = await loadAllEpisodeNames(data.anime, updateAnime, {
      onProgress: setProgress,
      shouldCancel: () => cancelled.current
    })

    setProgress((prev) => (prev ? { ...prev, running: false, current: null } : prev))

    if (outcome.loaded === 0 && outcome.empty === 0 && outcome.failed === 0) {
      setResult(t('settings.episodesNothing'))
      return
    }

    const parts = [t('settings.episodesDone', { count: outcome.loaded })]
    if (outcome.empty > 0) parts.push(t('settings.episodesEmpty', { count: outcome.empty }))
    if (outcome.failed > 0) parts.push(t('settings.episodesFailed', { count: outcome.failed }))
    if (outcome.alreadyDone > 0) {
      parts.push(t('settings.episodesSkipped', { count: outcome.alreadyDone }))
    }
    setResult(parts.join(' · '))
  }

  return (
    <div className="panel">
      <h3>{t('settings.episodes')}</h3>
      <div className="panel-sub">{t('settings.episodesSub')}</div>

      {progress && progress.total > 0 && (
        <>
          <div className="upd-row" style={{ marginBottom: 10 }}>
            <span className="hint">
              {running
                ? t('settings.episodesRunning', {
                    done: progress.done,
                    total: progress.total
                  })
                : t('settings.episodesStopped', {
                    done: progress.done,
                    total: progress.total
                  })}
            </span>
            {progress.current && <span className="mono bulk-current">{progress.current}</span>}
          </div>
          <div className="upd-progress">
            <span
              style={{
                width: `${progress.total === 0 ? 0 : (progress.done / progress.total) * 100}%`
              }}
            />
          </div>
        </>
      )}

      <div className="panel-actions" style={{ marginTop: 14 }}>
        <button className="btn primary" onClick={() => void start()} disabled={running}>
          {running ? (
            <>
              <span className="spinner" /> {t('settings.episodesRunningShort')}
            </>
          ) : (
            <>
              <IconDownload size={15} /> {t('settings.episodesLoad')}
            </>
          )}
        </button>
        {running && (
          <button className="btn danger" onClick={() => (cancelled.current = true)}>
            {t('settings.episodesStop')}
          </button>
        )}
      </div>

      <div className="hint" style={{ marginTop: 10 }}>
        {t('settings.episodesCount', { count: withoutNames })}
      </div>

      {result && (
        <div className="mono bulk-result" style={{ marginTop: 10 }}>
          {result}
        </div>
      )}
    </div>
  )
}
