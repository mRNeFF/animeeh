import type { ReactNode } from 'react'
import type { UpdateStage } from '../../../shared/update'
import { useUpdate } from '../useUpdate'
import { IconDownload, IconRefresh } from './Icons'

const STAGE_LABELS: Record<UpdateStage, string> = {
  idle: 'Ready',
  checking: 'Checking…',
  available: 'Update available',
  'not-available': 'Up to date',
  downloading: 'Downloading…',
  downloaded: 'Ready to install',
  error: 'Error'
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

  if (!status) {
    return (
      <div className="panel">
        <h3>Updates</h3>
        <div className="panel-sub">Reading update status…</div>
      </div>
    )
  }

  const busy = checking || downloading || status.stage === 'checking' || status.stage === 'downloading'
  const percent = status.percent === null ? null : Math.max(0, Math.min(100, status.percent))

  return (
    <div className="panel">
      <h3>Updates</h3>
      <div className="panel-sub">
        Version <strong>{status.currentVersion}</strong>
        {status.feed ? (
          <>
            {' '}
            · feed <span className="mono">{status.feed}</span>
          </>
        ) : (
          ' · no feed configured'
        )}
      </div>

      <div className="upd-row">
        <span className={`upd-badge stage-${status.stage}`}>{STAGE_LABELS[status.stage]}</span>

        {status.stage === 'available' && status.availableVersion && (
          <span className="hint">
            Version <strong>{status.availableVersion}</strong> is available.
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
            Version <strong>{status.availableVersion}</strong> downloaded. Restart to apply it.
          </span>
        )}

        {status.stage === 'error' && <span className="hint error-text">{status.message}</span>}
      </div>

      {percent !== null && (status.stage === 'downloading' || status.stage === 'downloaded') && (
        <div className="upd-progress">
          <span style={{ width: `${percent}%` }} />
        </div>
      )}

      <div className="panel-actions" style={{ marginTop: 14 }}>
        <button className="btn" onClick={() => void check()} disabled={busy || !status.canUpdate}>
          <IconRefresh size={15} /> {checking ? 'Checking…' : 'Check for updates'}
        </button>

        {status.stage === 'available' && (
          <button className="btn primary" onClick={() => void download()} disabled={busy}>
            <IconDownload size={15} /> {downloading ? 'Starting…' : 'Download update'}
          </button>
        )}

        {status.stage === 'downloaded' && (
          <button className="btn primary" onClick={() => void install()}>
            <IconRefresh size={15} /> Restart and install
          </button>
        )}
      </div>

      {!status.canUpdate && (
        <div className="hint" style={{ marginTop: 12 }}>
          Updates are only available in the installed build, once a release feed is configured.
        </div>
      )}
    </div>
  )
}
