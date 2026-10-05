import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import { criterionKey, statusKey, useI18n } from '../i18n'
import {
  CRITERIA,
  STATUSES,
  type Anime,
  type CriterionKey,
  type Episode,
  type Status
} from '../types'
import { AnimeForm } from './AnimeForm'
import { EpisodeSeasons } from './EpisodeSeasons'
import { isFilm } from './AnimeLibrary'
import { mergeEpisodeNames, seasonPartsOf } from '../bulkEpisodes'
import { Bar, Cover, ScoreControl } from './ui'
import { IconArrowLeft, IconDownload, IconEpisode, IconPlus, IconTrash } from './Icons'

export function AnimeDetail({
  animeId,
  onBack
}: {
  animeId: string
  onBack: () => void
}): ReactNode {
  const { data, updateAnime, removeAnime } = useStore()
  const { t } = useI18n()
  const anime = data.anime.find((a) => a.id === animeId)

  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bulk, setBulk] = useState('5')
  const [loadingNames, setLoadingNames] = useState(false)
  const [namesMessage, setNamesMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null
  )

  /**
   * Backfill the cover and genres from the reference source.
   *
   * Entries added before the form saved them can have a source id but no
   * artwork. Runs once per anime when it opens, uses the cached franchise call,
   * and only writes fields that are still empty.
   *
   * Declared before the early return so hook order never changes.
   */
  const backfilled = useRef<string | null>(null)
  const needsBackfill = !!anime && (!anime.coverImage || (anime.genres?.length ?? 0) === 0)
  const backfillSourceId = anime?.source?.anilistId ?? anime?.seasons?.[0]?.anilistId ?? null

  useEffect(() => {
    if (!needsBackfill || backfillSourceId === null) return
    if (backfilled.current === anime?.id) return
    backfilled.current = anime?.id ?? null

    let cancelled = false
    void window.animeeh
      .animeFranchise(backfillSourceId)
      .then((outcome) => {
        if (cancelled || !outcome.ok || !anime) return
        const details = outcome.data
        const next: Partial<Anime> = {}
        if (!anime.coverImage && details.coverImage) next.coverImage = details.coverImage
        if ((anime.genres?.length ?? 0) === 0 && details.genres.length > 0) {
          next.genres = details.genres
        }
        if (Object.keys(next).length > 0) updateAnime(anime.id, next)
      })
      .catch(() => {
        // Artwork is cosmetic; a failure here stays silent.
      })

    return () => {
      cancelled = true
    }
  }, [needsBackfill, backfillSourceId, anime, updateAnime])

  const weights = data.settings.weights

  if (!anime) {
    return (
      <div className="empty">
        <h3>{t('empty.notFound')}</h3>
        <button className="btn" onClick={onBack}>
          <IconArrowLeft size={16} /> {t('action.backToLibrary')}
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

  /**
   * Fetch episode names and merge them in.
   *
   * Season ids come from the assembled franchise when available, otherwise from
   * the single AniList entry. Titles are only written where the episode has
   * none, so anything you typed yourself survives, and missing episodes are
   * created to match the source count.
   */
  const loadEpisodeNames = async (): Promise<void> => {
    const seasons = seasonPartsOf(anime)

    if (seasons.length === 0) {
      setNamesMessage({ kind: 'error', text: t('diff.noReference') })
      return
    }

    setLoadingNames(true)
    setNamesMessage(null)
    try {
      const outcome = await window.animeeh.loadEpisodeNames(seasons)
      if (!outcome.ok) {
        setNamesMessage({ kind: 'error', text: t('diff.namesFailed', { error: outcome.error }) })
        return
      }

      const { episodes: names, missingSeasons } = outcome.data
      const merged = mergeEpisodeNames(anime, names)

      patch({
        episodes: merged,
        totalEpisodes: anime.totalEpisodes ?? (merged.length > 0 ? merged.length : undefined)
      })

      setNamesMessage({
        kind: 'ok',
        text:
          missingSeasons.length > 0
            ? t('diff.namesPartial', {
                count: names.length,
                seasons: missingSeasons.join(', ')
              })
            : t('diff.namesLoaded', { count: names.length })
      })
    } catch (err) {
      setNamesMessage({
        kind: 'error',
        text: t('diff.namesFailed', { error: (err as Error).message })
      })
    } finally {
      setLoadingNames(false)
    }
  }

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
          <IconArrowLeft size={16} /> {t('action.backToLibrary')}
        </button>
        <div className="spacer" />
        <button className="btn" onClick={() => setEditing(true)}>
          {t('action.editDetails')}
        </button>
        <button className="btn danger" onClick={() => setConfirmDelete(true)}>
          <IconTrash size={15} /> {t('action.delete')}
        </button>
      </div>

      <div className="detail-head">
        <Cover
          title={anime.title}
          hue={hue}
          src={anime.coverImage}
          className="detail-cover"
        />
        <div className="detail-headline">
          <input
            className="detail-title-input"
            value={anime.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
          <div className="detail-fields">
            <div className="field">
              <label>{t('field.year')}</label>
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
              <label>{t('field.studio')}</label>
              <input
                className="input"
                value={anime.studio ?? ''}
                placeholder="—"
                onChange={(e) => patch({ studio: e.target.value || undefined })}
              />
            </div>
            <div className="field">
              <label>{t('field.status')}</label>
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
              <label>{t('field.episodes')}</label>
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
              {t('diff.favourite')}
            </label>
            {anime.source && (
              <a
                className="al-link"
                href={anime.source.siteUrl}
                target="_blank"
                rel="noreferrer"
                title={t('detail.openOnAniList')}
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
                title={t('detail.openOnMal')}
              >
                MyAnimeList ↗
              </a>
            )}
          </div>
          {(anime.genres?.length ?? 0) > 0 && (
            <div className="genre-strip">
              {anime.genres?.map((g) => (
                <span className="genre-pill" key={g}>
                  {g}
                </span>
              ))}
            </div>
          )}

          {multiSeason && (
            <div className="season-strip">
              {anime.seasons?.map((s) => {
                const partCount = s.parts?.length ?? 1
                return (
                  <span
                    className="season-chip"
                    key={s.anilistId}
                    title={
                      partCount > 1
                        ? `${s.title} — ${s.parts?.map((p) => p.title).join(' + ')}`
                        : s.title
                    }
                  >
                    <strong>S{s.season}</strong>
                    <span>{s.year ?? '—'}</span>
                    <span>{s.episodes ? `${s.episodes} eps` : '—'}</span>
                    {partCount > 1 && <span className="season-parts">{partCount} parts</span>}
                  </span>
                )
              })}
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
                {t(criterionKey(c.key))}
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
                {t('criteria.episodeAverage')}
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
        <h3>{t('detail.section.weights')}</h3>
        <div className="panel-sub">
          {t('detail.section.weightsSub')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {parts.map((part) => (
            <div className="criterion" key={part.key}>
              <div className="criterion-name">
                <span className="dot" style={{ background: `hsl(${part.hue} 70% 55%)` }} />
                {t(criterionKey(part.key))}
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
      {/* A film is one work: it is rated as a whole on its criteria, so an
          episode list would be meaningless. */}
      {!isFilm(anime) && (
      <>
      <div className="section-title">
        <IconEpisode size={17} />
        <h2>{t('detail.section.episodes')}</h2>
        <span className="hint">
          {anime.episodes.length === 0
            ? t('diff.noEpisodesYet')
            : t('score.ratedOf', { rated: scoredCount, listed: anime.episodes.length }) +
              (anime.totalEpisodes ? t('score.ofTotal', { total: anime.totalEpisodes }) : '') +
              (avg === null ? t('score.noRatingYet') : t('score.avg', { value: avg.toFixed(1) }))}
        </span>
        <div className="spacer" />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn sm"
            onClick={() => void loadEpisodeNames()}
            disabled={loadingNames}
            title={t('diff.loadNamesHint')}
          >
            {loadingNames ? (
              <>
                <span className="spinner" /> {t('diff.loadingNames')}
              </>
            ) : (
              <>
                <IconDownload size={14} /> {t('diff.loadNames')}
              </>
            )}
          </button>
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
              {t('diff.addBatch')}
            </button>
            <button className="btn primary sm" onClick={() => addEpisodes(1)}>
              <IconPlus size={14} /> {t('diff.addEpisode')}
            </button>
        </div>
      </div>

      {namesMessage && (
        <div className={`names-message${namesMessage.kind === 'error' ? ' error' : ''}`}>
          {namesMessage.text}
        </div>
      )}

      {ordered.length === 0 && (anime.seasons?.length ?? 0) === 0 ? (
        <div className="empty" style={{ padding: '40px 20px' }}>
          <h3>{t('empty.noEpisodes.title')}</h3>
          <p style={{ margin: 0, maxWidth: 420 }}>{t('empty.noEpisodes.body')}</p>
        </div>
      ) : (
        <EpisodeSeasons
          anime={anime}
          ordered={ordered}
          hue={hue}
          onUpdateEpisode={updateEpisode}
          onRemoveEpisode={removeEpisode}
        />
      )}
      </>
      )}

      {/* ---------------- Notes ---------------- */}
      <div className="section-title">
        <h2>{t('detail.section.notes')}</h2>
      </div>
      <textarea
        className="textarea"
        style={{ minHeight: 110 }}
        placeholder={t('detail.notesPlaceholder')}
        value={anime.notes ?? ''}
        onChange={(e) => patch({ notes: e.target.value || undefined })}
      />

      <div className="hint" style={{ marginTop: 22 }}>
        Status: {t(statusKey(anime.status))} · Last updated{' '}
        {new Date(anime.updatedAt).toLocaleString()}
      </div>

      {editing && (
        <AnimeForm
          initial={anime}
          submitLabel={t('action.saveChanges')}
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
  const { t } = useI18n()
  const [text, setText] = useState('')
  const word = t('detail.deleteWord')
  const ok = text.trim().toLowerCase() === word.toLowerCase()
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <h3>{t('delete.confirm', { title })}</h3>
        <div className="modal-sub">{t('delete.body', { word })}</div>
        <div className="modal-form">
          <input
            className="input"
            autoFocus
            value={text}
            placeholder={t('detail.deleteWord')}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn ghost" onClick={onCancel}>
              {t('action.cancel')}
            </button>
            <button className="btn danger" disabled={!ok} onClick={onConfirm}>
              <IconTrash size={15} /> {t('action.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
