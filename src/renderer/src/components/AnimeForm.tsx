import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AnimeDetails, AnimeSearchResult } from '../../../shared/anilist'
import { STATUSES, type Anime, type AnimeSeason, type AnimeSource, type Status } from '../types'
import { IconClose, IconSearch } from './Icons'
import { Modal } from './ui'

export interface EpisodeBlueprint {
  number: number
  title?: string
  season?: number
}

export interface AnimeFormValues {
  title: string
  englishTitle: string
  year: string
  studio: string
  status: Status
  notes: string
  favorite: boolean
  /** Reference entry picked from AniList, if any. */
  source?: AnimeSource
  /** Episode count announced by the source, across every season. */
  totalEpisodes?: number
  /** Per-episode titles from the source, already numbered across seasons. */
  episodeBlueprint: EpisodeBlueprint[]
  /** Seasons merged into this franchise. */
  seasons: AnimeSeason[]
  /** Whether the caller should pre-create the episode rows. */
  createEpisodes: boolean
}

const MIN_QUERY = 2
const DEBOUNCE_MS = 450

function sourceFrom(result: AnimeSearchResult): AnimeSource {
  return {
    provider: 'anilist',
    anilistId: result.anilistId,
    malId: result.malId,
    siteUrl: result.siteUrl
  }
}

function seasonsFrom(result: AnimeDetails | AnimeSearchResult): AnimeSeason[] {
  return result.seasons.map((s) => ({
    season: s.season,
    anilistId: s.anilistId,
    malId: s.malId,
    title: s.title,
    year: s.year ?? undefined,
    episodes: s.episodes ?? undefined,
    parts: s.parts.map((p) => ({
      anilistId: p.anilistId,
      title: p.title,
      year: p.year ?? undefined,
      episodes: p.episodes ?? undefined
    }))
  }))
}

/** Small "3 seasons" style summary for a search hit. */
function seasonSummary(result: AnimeSearchResult): string | null {
  if (result.seasons.length < 2) return null
  const years = result.seasons
    .map((s) => s.year)
    .filter((y): y is number => typeof y === 'number')
  const span =
    years.length > 0 ? `${Math.min(...years)}–${Math.max(...years)}` : null
  return `${result.seasons.length} seasons${span ? ` · ${span}` : ''}`
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
  const isNew = !initial

  const [values, setValues] = useState<AnimeFormValues>({
    title: initial?.title ?? '',
    englishTitle: initial?.englishTitle ?? '',
    year: initial?.year ? String(initial.year) : '',
    studio: initial?.studio ?? '',
    status: initial?.status ?? 'completed',
    notes: initial?.notes ?? '',
    favorite: initial?.favorite ?? false,
    source: initial?.source,
    totalEpisodes: initial?.totalEpisodes,
    episodeBlueprint: [],
    seasons: initial?.seasons ?? [],
    createEpisodes: true
  })

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AnimeSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [picked, setPicked] = useState<AnimeSearchResult | AnimeDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [showSeasons, setShowSeasons] = useState(false)

  // Guards against out-of-order responses landing after a newer keystroke.
  const requestId = useRef(0)

  const set = <K extends keyof AnimeFormValues>(key: K, value: AnimeFormValues[K]): void =>
    setValues((prev) => ({ ...prev, [key]: value }))

  /* ---------------- debounced AniList search ---------------- */
  useEffect(() => {
    if (!isNew) return

    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY) {
      setResults([])
      setSearching(false)
      setSearchError(null)
      return
    }

    setSearching(true)
    const timer = setTimeout(async () => {
      const id = ++requestId.current
      try {
        const outcome = await window.animeeh.searchAnime(trimmed)
        if (id !== requestId.current) return // a newer search won
        if (outcome.ok) {
          setResults(outcome.data)
          setSearchError(null)
        } else {
          setResults([])
          setSearchError(outcome.error)
        }
      } catch (err) {
        if (id === requestId.current) {
          setResults([])
          setSearchError((err as Error).message)
        }
      } finally {
        if (id === requestId.current) setSearching(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, isNew])

  /* ---------------- pick a search result ---------------- */
  const pick = async (result: AnimeSearchResult): Promise<void> => {
    setPicked(result)
    setShowSeasons(false)
    setValues((prev) => ({
      ...prev,
      title: result.title,
      englishTitle: result.englishTitle ?? '',
      year: result.year ? String(result.year) : '',
      studio: result.studio ?? '',
      source: sourceFrom(result),
      totalEpisodes: result.episodes ?? undefined,
      episodeBlueprint: [],
      seasons: seasonsFrom(result),
      createEpisodes: true
    }))

    // The search row already carries the grouped seasons; this call walks the
    // relations to make sure the chain is complete and correctly ordered, and
    // brings back the per-episode titles.
    setLoadingDetails(true)
    try {
      const outcome = await window.animeeh.animeFranchise(result.anilistId)
      if (outcome.ok) {
        const details = outcome.data
        setPicked(details)
        setValues((prev) => ({
          ...prev,
          title: details.title,
          englishTitle: details.englishTitle ?? '',
          year: details.year ? String(details.year) : '',
          studio: details.studio ?? '',
          source: sourceFrom(details),
          totalEpisodes: details.episodes ?? undefined,
          seasons: seasonsFrom(details),
          episodeBlueprint: details.episodeTitles.map((e) => ({
            number: e.number,
            title: e.title,
            season: e.season
          }))
        }))
      }
      // If it fails we keep the search-level data, which is already usable.
    } finally {
      setLoadingDetails(false)
    }
  }

  const clearPicked = (): void => {
    setPicked(null)
    setShowSeasons(false)
    setValues((prev) => ({
      ...prev,
      source: undefined,
      totalEpisodes: undefined,
      episodeBlueprint: [],
      seasons: []
    }))
  }

  const canSubmit = values.title.trim().length > 0
  const plannedEpisodes = values.createEpisodes
    ? (values.totalEpisodes ?? values.episodeBlueprint.length)
    : 0
  const multiSeason = values.seasons.length > 1

  return (
    <Modal
      title={initial ? 'Edit anime' : 'Add anime'}
      subtitle={
        initial
          ? 'Update the details for this entry.'
          : 'Search AniList to pre-fill, or type everything manually. Seasons of the same series are merged into one entry.'
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
        {/* ---------------- AniList lookup (new entries only) ---------------- */}
        {isNew && (
          <div className="al-block">
            <div className="search">
              <IconSearch size={15} />
              <input
                className="input"
                autoFocus
                placeholder="Search AniList (e.g. frieren)…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {searching && (
              <div className="al-state">
                <span className="spinner" /> Searching AniList…
              </div>
            )}

            {!searching && searchError && (
              <div className="al-state error">
                AniList unreachable: {searchError}
                <div className="hint" style={{ marginTop: 4 }}>
                  You can still fill in the details manually below.
                </div>
              </div>
            )}

            {!searching && !searchError && results.length > 0 && (
              <div className="al-results">
                {results.map((r) => {
                  const summary = seasonSummary(r)
                  return (
                    <button
                      type="button"
                      key={r.anilistId}
                      className={`al-result${picked?.anilistId === r.anilistId ? ' active' : ''}`}
                      onClick={() => void pick(r)}
                    >
                      {r.coverImage ? (
                        <img className="al-cover" src={r.coverImage} alt="" loading="lazy" />
                      ) : (
                        <div className="al-cover placeholder">?</div>
                      )}
                      <div className="al-info">
                        <div className="al-title">{r.title}</div>
                        {r.englishTitle && r.englishTitle !== r.title && (
                          <div className="al-sub">{r.englishTitle}</div>
                        )}
                        {summary && <div className="al-seasons">{summary}</div>}
                        <div className="al-tags">
                          {r.year && <span>{r.year}</span>}
                          {r.format && <span>{r.format}</span>}
                          <span>{r.episodes ? `${r.episodes} eps` : 'eps unknown'}</span>
                          {r.studio && <span className="al-studio">{r.studio}</span>}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {!searching &&
              !searchError &&
              query.trim().length >= MIN_QUERY &&
              results.length === 0 && (
                <div className="al-state">No results for “{query.trim()}”.</div>
              )}

            {picked && (
              <>
                <div className="al-selected">
                  <div>
                    {multiSeason ? (
                      <button
                        type="button"
                        className="pill pill-button"
                        onClick={() => setShowSeasons((v) => !v)}
                      >
                        {values.seasons.length} seasons {showSeasons ? '▴' : '▾'}
                      </button>
                    ) : (
                      <span className="pill">1 season</span>
                    )}{' '}
                    {picked.malId ? (
                      <span className="pill">MAL {picked.malId}</span>
                    ) : (
                      <span className="pill">no MAL id</span>
                    )}
                    {loadingDetails && <span className="hint"> · assembling seasons…</span>}
                  </div>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={clearPicked}
                    title="Remove"
                  >
                    <IconClose size={13} />
                  </button>
                </div>

                {showSeasons && (
                  <ol className="al-season-list">
                    {values.seasons.map((s) => {
                      const partCount = s.parts?.length ?? 1
                      return (
                        <li key={s.anilistId}>
                          <span className="al-season-num">S{s.season}</span>
                          <span className="al-season-title">
                            {s.title}
                            {partCount > 1 && (
                              <span className="al-season-parts">
                                {partCount} parts merged
                              </span>
                            )}
                          </span>
                          <span className="al-season-meta">
                            {[s.year, s.episodes ? `${s.episodes} eps` : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </>
            )}

            {picked && (values.totalEpisodes ?? 0) > 0 && (
              <label className="al-check">
                <input
                  type="checkbox"
                  checked={values.createEpisodes}
                  onChange={(e) => set('createEpisodes', e.target.checked)}
                />
                Create all <strong>{values.totalEpisodes}</strong> episodes automatically
                {values.episodeBlueprint.length > 0 &&
                  ` (${values.episodeBlueprint.length} with titles)`}
                {multiSeason && ', numbered continuously across seasons'}
              </label>
            )}
          </div>
        )}

        {/* ---------------- Manual fields ---------------- */}
        <div className="field">
          <label htmlFor="af-title">Title *</label>
          <input
            id="af-title"
            className="input"
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
          {plannedEpisodes > 0 && (
            <span className="hint" style={{ marginRight: 'auto', alignSelf: 'center' }}>
              {plannedEpisodes} episode{plannedEpisodes > 1 ? 's' : ''} will be created
            </span>
          )}
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
