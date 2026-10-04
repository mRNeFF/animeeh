import { useState, type ReactNode } from 'react'
import {
  appendEpisodes,
  episodeAverage,
  globalScore,
  grade,
  missingEpisodeNumbers,
  scoredEpisodeCount,
  scoreParts,
  sortEpisodes
} from '../scoring'
import { useStore } from '../store'
import {
  CRITERIA,
  STATUSES,
  STATUS_LABELS,
  type Anime,
  type CriterionKey,
  type Episode,
  type Status
} from '../types'
import { AnimeForm } from './AnimeForm'
import { Bar, Cover, GradeBadge, ScoreControl } from './ui'
import { IconArrowLeft, IconEpisode, IconPlus, IconTrash } from './Icons'

export function AnimeDetail({
  animeId,
  onBack
}: {
  animeId: string
  onBack: () => void
}): ReactNode {
  const { data, updateAnime, removeAnime } = useStore()
  const anime = data.anime.find((a) => a.id === animeId)

  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bulk, setBulk] = useState('5')

  const weights = data.settings.weights

  if (!anime) {
    return (
      <div className="empty">
        <h3>Anime not found</h3>
        <button className="btn" onClick={onBack}>
          <IconArrowLeft size={16} /> Back to library
        </button>
      </div>
    )
  }

  const score = globalScore(anime, weights)
  const g = grade(score)
  const parts = scoreParts(anime, weights)
  const avg = episodeAverage(anime)
  const scoredCount = scoredEpisodeCount(anime)
  const ordered = sortEpisodes(anime.episodes)
  const missing = missingEpisodeNumbers(anime.episodes, anime.totalEpisodes)
  const multiSeason = (anime.seasons?.length ?? 0) > 1
  const hue = (anime.title.charCodeAt(0) * 37 + anime.title.length * 11) % 360

  const patch = (p: Partial<Anime>): void => updateAnime(anime.id, p)

  const setCriterion = (key: CriterionKey, value: number | null): void =>
    patch({ criteria: { ...anime.criteria, [key]: value } })

  const setEpisodes = (episodes: Episode[]): void => patch({ episodes })

  const addEpisodes = (count: number): void => {
    // Unrated by default — an unrated episode must not count as a zero.
    setEpisodes(appendEpisodes(anime.episodes, count))
  }

  /** Top up to the episode total announced by the source. */
  const completeEpisodes = (): void => {
    if (missing.length === 0) return

    const added: Episode[] = missing.map((number) => ({
      id: crypto.randomUUID(),
      number,
      score: null
    }))
    setEpisodes(sortEpisodes([...anime.episodes, ...added]))
  }

  const updateEpisode = (id: string, p: Partial<Episode>): void =>
    setEpisodes(anime.episodes.map((e) => (e.id === id ? { ...e, ...p } : e)))

  const removeEpisode = (id: string): void =>
    setEpisodes(anime.episodes.filter((e) => e.id !== id))

  const gaugeDeg = (score ?? 0) * 3.6

  return (
    <>
      <div className="toolbar">
        <button className="btn ghost" onClick={onBack}>
          <IconArrowLeft size={16} /> Library
        </button>
        <div className="spacer" />
        <button className="btn" onClick={() => setEditing(true)}>
          Edit details
        </button>
        <button className="btn danger" onClick={() => setConfirmDelete(true)}>
          <IconTrash size={15} /> Delete
        </button>
      </div>

      <div className="detail-head">
        <Cover title={anime.title} hue={hue} className="detail-cover" />
        <div className="detail-headline">
          <input
            className="detail-title-input"
            value={anime.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
          <div className="detail-fields">
            <div className="field">
              <label>Year</label>
              <input
                className="input"
                type="number"
                value={anime.year ?? ''}
                placeholder="—"
                onChange={(e) =>
                  patch({ year: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Studio</label>
              <input
                className="input"
                value={anime.studio ?? ''}
                placeholder="—"
                onChange={(e) => patch({ studio: e.target.value || undefined })}
              />
            </div>
            <div className="field">
              <label>Status</label>
              <select
                className="select"
                value={anime.status}
                onChange={(e) => patch({ status: e.target.value as Status })}
              >
                {STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Episodes</label>
              <input
                className="input"
                value={
                  anime.totalEpisodes
                    ? `${anime.episodes.length} / ${anime.totalEpisodes}`
                    : String(anime.episodes.length)
                }
                readOnly
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!anime.favorite}
                onChange={(e) => patch({ favorite: e.target.checked })}
              />
              Personal favourite
            </label>
            {anime.source && (
              <a
                className="al-link"
                href={anime.source.siteUrl}
                target="_blank"
                rel="noreferrer"
                title="Ouvrir sur AniList"
              >
                AniList #{anime.source.anilistId}
                {anime.source.malId ? ` · MAL ${anime.source.malId}` : ''}
              </a>
            )}
            {anime.source?.malId && (
              <a
                className="al-link"
                href={`https://myanimelist.net/anime/${anime.source.malId}`}
                target="_blank"
                rel="noreferrer"
                title="Ouvrir sur MyAnimeList"
              >
                MyAnimeList ↗
              </a>
            )}
          </div>
          {multiSeason && (
            <div className="season-strip">
              {anime.seasons?.map((s) => (
                <span className="season-chip" key={s.anilistId} title={s.title}>
                  <strong>S{s.season}</strong>
                  <span>{s.year ?? '—'}</span>
                  <span>{s.episodes ? `${s.episodes} eps` : '—'}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---------------- Scoreboard ---------------- */}
      <div className="scoreboard">
        <div
          className="gauge"
          style={{
            background: `conic-gradient(hsl(${g.hue} 72% 55%) ${gaugeDeg}deg, rgba(255,255,255,0.07) ${gaugeDeg}deg)`
          }}
        >
          <div className="gauge-inner">
            <div>
              <div className="gauge-score">{score === null ? '—' : score.toFixed(1)}</div>
              <div className="gauge-label">Global ({g.letter})</div>
            </div>
          </div>
        </div>

        <div className="criteria-list">
          <div className="hint" style={{ marginBottom: 2 }}>
            Rate each criterion from 0–100. The episode average is added as its own component.
          </div>
          {CRITERIA.map((c) => (
            <div className="criterion" key={c.key}>
              <div className="criterion-name">
                <span className="dot" style={{ background: `hsl(${c.hue} 70% 55%)` }} />
                {c.label}
              </div>
              <ScoreControl
                hue={c.hue}
                value={anime.criteria[c.key]}
                onChange={(v) => setCriterion(c.key, v)}
                showClear
              />
            </div>
          ))}
          <div className="criterion">
            <div className="criterion-name">
              <span className="dot" style={{ background: 'hsl(292 70% 60%)' }} />
              Episode average
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Bar value={avg} hue={292} />
              </div>
              <span className="hint" style={{ width: 62, textAlign: 'right' }}>
                {avg === null ? 'no episodes' : `${avg.toFixed(1)} auto`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- Contribution breakdown ---------------- */}
      <div className="panel">
        <h3>How the global score is built</h3>
        <div className="panel-sub">
          Weighted average of every rated component. Change weights in Settings.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {parts.map((part) => (
            <div className="criterion" key={part.key}>
              <div className="criterion-name">
                <span className="dot" style={{ background: `hsl(${part.hue} 70% 55%)` }} />
                {part.label}
              </div>
              <Bar value={part.value} hue={part.hue} />
              <span className="hint" style={{ textAlign: 'right' }}>
                {part.value === null ? '—' : part.value.toFixed(1)}
                {part.weight !== 1 ? ` ×${part.weight}` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ---------------- Episodes ---------------- */}
      <div className="section-title">
        <IconEpisode size={17} />
        <h2>Episodes</h2>
        <span className="hint">
          {anime.episodes.length === 0
            ? 'no episodes yet'
            : `${scoredCount} rated / ${anime.episodes.length} listed` +
              (anime.totalEpisodes ? ` / ${anime.totalEpisodes} total` : '') +
              (avg === null ? ' · no rating yet' : ` · avg ${avg.toFixed(1)}`)}
        </span>
        <div className="spacer" />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {missing.length > 0 && (
            <button
              className="btn sm"
              onClick={completeEpisodes}
              title={`Add the ${missing.length} episodes missing from the source count`}
            >
              <IconPlus size={14} /> Fill {missing.length} missing
            </button>
          )}
          <input
            className="input"
            style={{ width: 62, textAlign: 'center' }}
            type="number"
            min={1}
            max={500}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
          />
          <button
            className="btn sm"
            onClick={() => addEpisodes(Math.max(1, Math.min(500, Number(bulk) || 1)))}
          >
            Add batch
          </button>
          <button className="btn primary sm" onClick={() => addEpisodes(1)}>
            <IconPlus size={14} /> Episode
          </button>
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="empty" style={{ padding: '40px 20px' }}>
          <h3>No episodes yet</h3>
          <p style={{ margin: 0, maxWidth: 400 }}>
            Add episodes and score each one from 0 to 100. Unrated episodes are ignored by the
            average, so you can add a whole season first and rate as you watch.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="ep-row" style={{ background: 'var(--panel-2)' }}>
            <div className="hint" style={{ fontWeight: 700 }}>
              EP
            </div>
            <div className="hint" style={{ fontWeight: 700 }}>
              TITLE (optional)
            </div>
            <div className="hint" style={{ fontWeight: 700 }}>
              SCORE
            </div>
            <div className="hint" style={{ fontWeight: 700, textAlign: 'center' }}>
              0–100
            </div>
            <div />
          </div>
          {ordered.map((ep) => (
            <div className="ep-row" key={ep.id}>
              <div className="ep-num">
                {ep.number}
                {multiSeason && ep.season !== undefined && (
                  <span className="ep-season" title={`Season ${ep.season}`}>
                    S{ep.season}
                  </span>
                )}
              </div>
              <input
                className="ep-title"
                placeholder={`Episode ${ep.number}`}
                value={ep.title ?? ''}
                onChange={(e) => updateEpisode(ep.id, { title: e.target.value || undefined })}
              />
              <ScoreControl
                hue={hue}
                value={ep.score}
                onChange={(v) => updateEpisode(ep.id, { score: v })}
              />
              <div style={{ textAlign: 'center' }}>
                <GradeBadge
                  letter={grade(ep.score).letter}
                  hue={grade(ep.score).hue}
                  style={{ width: 28, height: 28, borderRadius: 8, fontSize: 13, margin: '0 auto' }}
                />
              </div>
              <button
                className="btn ghost sm"
                title="Remove episode"
                onClick={() => removeEpisode(ep.id)}
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- Notes ---------------- */}
      <div className="section-title">
        <h2>Notes</h2>
      </div>
      <textarea
        className="textarea"
        style={{ minHeight: 110 }}
        placeholder="Anything you want to remember about this show…"
        value={anime.notes ?? ''}
        onChange={(e) => patch({ notes: e.target.value || undefined })}
      />

      <div className="hint" style={{ marginTop: 22 }}>
        Status: {STATUS_LABELS[anime.status]} · Last updated{' '}
        {new Date(anime.updatedAt).toLocaleString()}
      </div>

      {editing && (
        <AnimeForm
          initial={anime}
          submitLabel="Save changes"
          onClose={() => setEditing(false)}
          onSubmit={(v) => {
            patch({
              title: v.title,
              englishTitle: v.englishTitle || undefined,
              year: v.year ? Number(v.year) : undefined,
              studio: v.studio || undefined,
              status: v.status,
              notes: v.notes || undefined,
              favorite: v.favorite
            })
            setEditing(false)
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDelete
          title={anime.title}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            removeAnime(anime.id)
            onBack()
          }}
        />
      )}
    </>
  )
}

function ConfirmDelete({
  title,
  onCancel,
  onConfirm
}: {
  title: string
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  const [text, setText] = useState('')
  const ok = text.trim().toLowerCase() === 'delete'
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <h3>Delete “{title}”?</h3>
        <div className="modal-sub">
          This permanently removes the anime, all its episode scores and criteria. Type{' '}
          <strong>delete</strong> to confirm.
        </div>
        <div className="modal-form">
          <input
            className="input"
            autoFocus
            value={text}
            placeholder="delete"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn ghost" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn danger" disabled={!ok} onClick={onConfirm}>
              <IconTrash size={15} /> Delete forever
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
