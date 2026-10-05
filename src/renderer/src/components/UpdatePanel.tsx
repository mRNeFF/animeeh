import type { ReactNode } from 'react'
import type { UpdateStage } from '../../../shared/update'
import { useI18n, type MessageKey } from '../i18n'
import { useUpdate } from '../useUpdate'
import { IconDownload, IconRefresh } from './Icons'

const STAGE_KEYS: Record<UpdateStage, MessageKey> = {
  idle: 'update.stage.idle',
  checking: 'update.stage.checking',
  available: 'update.stage.available',
  'not-available': 'update.stage.not-available',
  downloading: 'update.stage.downloading',
  downloaded: 'update.stage.downloaded',
  error: 'update.stage.error'
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatSpeed(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond)) return ''
  return `${formatBytes(bytesPerSecond)}/s`
}

export function UpdatePanel(): ReactNode {
  const { status, checking, downloading, check, download, install } = useUpdate()
  const { t } = useI18n()

  if (!status) {
    return (
      <div className="panel">
        <h3>{t('update.title')}</h3>
        <div className="panel-sub">{t('update.reading')}</div>
      </div>
    )
  }

  const busy = checking || downloading || status.stage === 'checking' || status.stage === 'downloading'
  const percent = status.percent === null ? null : Math.max(0, Math.min(100, status.percent))

  return (
    <div className="panel">
      <h3>{t('update.title')}</h3>
      <div className="panel-sub">
        {t('update.version')} <strong>{status.currentVersion}</strong>
        {status.feed ? (
          <>
            {' '}
            · feed <span className="mono">{status.feed}</span>
          </>
        ) : (
          ` · ${t('update.noFeed')}`
        )}
      </div>

      <div className="upd-row">
        <span className={`upd-badge stage-${status.stage}`}>{t(STAGE_KEYS[status.stage])}</span>

        {status.stage === 'available' && status.availableVersion && (
          <span className="hint">
            {t('update.available', { version: status.availableVersion })}
          </span>
        )}

        {status.stage === 'downloading' && percent !== null && (
          <span className="hint">
            {percent.toFixed(0)}%
            {status.transferred !== null && status.total !== null && (
              <>
                {' '}
                · {formatBytes(status.transferred)} / {formatBytes(status.total)}
              </>
            )}
            {status.bytesPerSecond !== null && <> · {formatSpeed(status.bytesPerSecond)}</>}
          </span>
        )}

        {status.stage === 'downloaded' && (
          <span className="hint">
            {t('update.downloaded', { version: status.availableVersion ?? '' })}
          </span>
        )}

        {status.stage === 'error' && (
          <span className="hint error-text">
            {status.messageCode === 'noFeed'
              ? t('error.noFeed')
              : status.messageCode === 'noUpdateToDownload'
                ? t('error.noUpdateToDownload')
                : status.message}
          </span>
        )}
      </div>

      {percent !== null && (status.stage === 'downloading' || status.stage === 'downloaded') && (
        <div className="upd-progress">
          <span style={{ width: `${percent}%` }} />
        </div>
      )}

      <div className="panel-actions" style={{ marginTop: 14 }}>
        <button className="btn" onClick={() => void check()} disabled={busy || !status.canUpdate}>
          <IconRefresh size={15} /> {checking ? t('update.checking') : t('update.check')}
        </button>

        {status.stage === 'available' && (
          <button className="btn primary" onClick={() => void download()} disabled={busy}>
            <IconDownload size={15} /> {downloading ? t('update.starting') : t('update.download')}
          </button>
        )}

        {status.stage === 'downloaded' && (
          <button className="btn primary" onClick={() => void install()}>
            <IconRefresh size={15} /> {t('update.install')}
          </button>
        )}
      </div>

      {!status.canUpdate && (
        <div className="hint" style={{ marginTop: 12 }}>
          {t('update.notAvailable')}
        </div>
      )}
    </div>
  )
}
