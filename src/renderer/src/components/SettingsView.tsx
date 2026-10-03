import { useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { COMPONENTS, DEFAULT_WEIGHTS, type ComponentKey, type StoreData } from '../types'
import { IconDownload, IconFolder, IconUpload } from './Icons'

export function SettingsView(): ReactNode {
  const { data, updateSettings, replaceAll } = useStore()
  const [message, setMessage] = useState<string | null>(null)
  const weights = data.settings.weights

  const setWeight = (key: ComponentKey, value: number): void =>
    updateSettings({ weights: { ...weights, [key]: value } })

  const onExport = async (): Promise<void> => {
    const path = await window.animeeh.exportData(data)
    setMessage(path ? `Backup written to ${path}` : 'Export cancelled.')
  }

  const onImport = async (): Promise<void> => {
    try {
      const result = await window.animeeh.importData()
      if (!result) {
        setMessage('Import cancelled.')
        return
      }
      replaceAll(result.data as StoreData)
      setMessage(`Imported ${result.path}`)
    } catch (err) {
      setMessage(`Import failed: ${(err as Error).message}`)
    }
  }

  const onReveal = async (): Promise<void> => {
    const path = await window.animeeh.reveal()
    setMessage(`Data file: ${path}`)
  }

  return (
    <>
      <div className="panel">
        <h3>Criteria weights</h3>
        <div className="panel-sub">
          Each component is scored 0–100. The global score is the weighted mean of the components
          you have rated. Weight 0 removes a component from the calculation.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {COMPONENTS.map((c) => (
            <div className="weights-grid" key={c.key}>
              <div className="criterion-name">
                <span className="dot" style={{ background: `hsl(${c.hue} 70% 55%)` }} />
                {c.label}
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
            Reset to equal weights
          </button>
          <span className="hint" style={{ alignSelf: 'center' }}>
            Total weight: {Object.values(weights).reduce((a, b) => a + b, 0).toFixed(2)}
          </span>
        </div>
      </div>

      <div className="panel">
        <h3>Backups &amp; data</h3>
        <div className="panel-sub">
          Your list is stored locally as JSON in the app&apos;s data folder. Export a copy to move it
          between machines.
        </div>
        <div className="panel-actions">
          <button className="btn" onClick={onExport}>
            <IconDownload size={15} /> Export backup
          </button>
          <button className="btn" onClick={onImport}>
            <IconUpload size={15} /> Import backup
          </button>
          <button className="btn" onClick={onReveal}>
            <IconFolder size={15} /> Show data file
          </button>
        </div>
        {message && (
          <div className="mono" style={{ marginTop: 14 }}>
            {message}
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Summary</h3>
        <div className="panel-sub">A quick look at what you have logged so far.</div>
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
          <Stat label="Anime" value={String(data.anime.length)} />
          <Stat
            label="Episodes scored"
            value={String(data.anime.reduce((sum, a) => sum + a.episodes.length, 0))}
          />
          <Stat
            label="Criteria ratings"
            value={String(
              data.anime.reduce(
                (sum, a) => sum + Object.values(a.criteria).filter((v) => v !== null).length,
                0
              )
            )}
          />
          <Stat label="Favourites" value={String(data.anime.filter((a) => a.favorite).length)} />
        </div>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 800 }}>{value}</div>
      <div className="hint">{label}</div>
    </div>
  )
}
