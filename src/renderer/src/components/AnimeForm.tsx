import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AnimeDetails, AnimeSearchResult } from '../../../shared/anilist'
import { describeFailure, statusKey, useI18n } from '../i18n'
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
  /** Cover art from the reference source. */
  coverImage?: string
  /** Genres from the reference source. */
  genres: string[]
  /** AniList format, so films can be told apart from series. */
  format?: string
  /** AniList duration in minutes, for the watch-time estimate. */
  duration?: number
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
    runtimeMinutes: s.duration ?? undefined,
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
  kind = 'series',
  onClose,
  onSubmit,
  submitLabel
}: {
  initial?: Anime
  /** Whether this form searches series or films. */
  kind?: 'series' | 'film'
  onClose: () => void
  onSubmit: (values: AnimeFormValues) => void
  submitLabel: string
}): ReactNode {
  const { t } = useI18n()
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
    coverImage: initial?.coverImage,
    genres: initial?.genres ?? [],
    format: initial?.format,
    duration: initial?.runtimeMinutes,
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
        const outcome = await window.animeeh.searchAnime(trimmed, kind)
        if (id !== requestId.current) return // a newer search won
        if (outcome.ok) {
          setResults(outcome.data)
          setSearchError(null)
        } else {
          setResults([])
          setSearchError(describeFailure(t, outcome))
        }
      } catch (err) {
        if (id === requestId.current) {
          setResults([])
          setSearchError(describeFailure(t, { detail: (err as Error).message }))
        }
      } finally {
        if (id === requestId.current) setSearching(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, isNew, kind])

  /* ---------------- pick a search result ---------------- */
  const pick = async (result: AnimeSearchResult): Promise<void> => {
    setPicked(result)
    setShowSeasons(false)

    const isFilm = (result.format ?? '') === 'MOVIE'

    setValues((prev) => ({
      ...prev,
      title: result.title,
      englishTitle: result.englishTitle ?? '',
      year: result.year ? String(result.year) : '',
      studio: result.studio ?? '',
      source: sourceFrom(result),
      totalEpisodes: isFilm ? undefined : (result.episodes ?? undefined),
      episodeBlueprint: [],
      seasons: isFilm ? [] : seasonsFrom(result),
      coverImage: result.coverImage ?? undefined,
      genres: result.genres ?? [],
      format: result.format ?? undefined,
      duration: result.duration ?? undefined,
      // A film is rated as a whole: there are no episodes to create.
      createEpisodes: !isFilm
    }))

    // A film is a single work. Walking its relations would drag in the TV
    // series it belongs to — picking "Chainsaw Man: Reze-hen" used to return
    // the whole Chainsaw Man franchise — so films stop here and use the search
    // data, which already carries everything the app stores.
    if (isFilm || kind === 'film') {
      setLoadingDetails(false)
      return
    }

    // For a series, the search row carries the grouped seasons; this call walks
    // the relations to make sure the chain is complete and correctly ordered,
    // and brings back the per-episode titles.
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
          coverImage: details.coverImage ?? prev.coverImage,
          genres: details.genres.length > 0 ? details.genres : prev.genres,
          format: details.format ?? prev.format,
          duration: details.duration ?? prev.duration,
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
      seasons: [],
      coverImage: undefined,
      genres: [],
      format: undefined,
      duration: undefined
    }))
  }

  const canSubmit = values.title.trim().length > 0
  const isFilmPicked = (picked?.format ?? '') === 'MOVIE' || kind === 'film'
  const plannedEpisodes = values.createEpisodes
    ? (values.totalEpisodes ?? values.episodeBlueprint.length)
    : 0
  const multiSeason = values.seasons.length > 1

  return (
    <Modal
      title={initial ? t('form.editTitle') : kind === 'film' ? t('form.addFilm') : t('form.addTitle')}
      subtitle={initial ? t('form.editSubtitle') : t('form.addSubtitle')}
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
                placeholder={t(kind === 'film' ? 'form.searchFilm' : 'form.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {searching && (
              <div className="al-state">
                <span className="spinner" /> {t('form.searching')}
              </div>
            )}

            {!searching && searchError && (
              <div className="al-state error">
                {t('form.unreachable', { error: searchError })}
                <div className="hint" style={{ marginTop: 4 }}>
                  {t('form.manualFallback')}
                </div>
              </div>
            )}

            {!searching && !searchError && results.length > 0 && (
              <div className="al-results">
                {results.map((r) => {
                  const isFilmResult = (r.format ?? '') === 'MOVIE'
                  const summary = isFilmResult ? null : seasonSummary(r)
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
                          {/* A film's format and episode count are noise: it is
                              one work, so only the year and studio are useful. */}
                          {isFilmResult && <span className="al-film">{t('form.film')}</span>}
                          {r.year && <span>{r.year}</span>}
                          {!isFilmResult && r.format && <span>{r.format}</span>}
                          {!isFilmResult && (
                            <span>
                              {r.episodes
                                ? t('form.episodeCount', { count: r.episodes })
                                : t('form.episodesUnknown')}
                            </span>
                          )}
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
                <div className="al-state">
                  {t('form.noResults', { query: query.trim() })}
                </div>
              )}

            {picked && (
              <>
                <div className="al-selected">
                  <div>
                    {/* A film has no seasons, so the season pill is noise. */}
                    {isFilmPicked ? (
                      <span className="pill">{t('form.film')}</span>
                    ) : multiSeason ? (
                      <button
                        type="button"
                        className="pill pill-button"
                        onClick={() => setShowSeasons((v) => !v)}
                      >
                        {t('form.seasons', { count: values.seasons.length })}{' '}
                        {showSeasons ? '▴' : '▾'}
                      </button>
                    ) : (
                      <span className="pill">{t('form.oneSeason')}</span>
                    )}{' '}
                    {picked.malId ? (
                      <span className="pill">MAL {picked.malId}</span>
                    ) : (
                      <span className="pill">{t('form.noMalId')}</span>
                    )}
                    {loadingDetails && <span className="hint">{t('form.assembling')}</span>}
                  </div>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={clearPicked}
                    title={t('action.remove')}
                  >
                    <IconClose size={13} />
                  </button>
                </div>

                {showSeasons && !isFilmPicked && (
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
                                {t('form.partsMerged', { count: partCount })}
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

            {picked && !isFilmPicked && (values.totalEpisodes ?? 0) > 0 && (
              <label className="al-check">
                <input
                  type="checkbox"
                  checked={values.createEpisodes}
                  onChange={(e) => set('createEpisodes', e.target.checked)}
                />
                {t('form.createAll', { count: values.totalEpisodes ?? 0 })}
                {values.episodeBlueprint.length > 0 &&
                  t('form.withTitles', { count: values.episodeBlueprint.length })}
                {multiSeason && t('form.acrossSeasons')}
              </label>
            )}
          </div>
        )}

        {/* ---------------- Manual fields ---------------- */}
        <div className="field">
          <label htmlFor="af-title">{t('form.title')}</label>
          <input
            id="af-title"
            className="input"
            placeholder={
              kind === 'film' ? t('form.filmTitlePlaceholder') : t('form.titlePlaceholder')
            }
            value={values.title}
            onChange={(e) => set('title', e.target.value)}
          />
        </div>

        <div className="row-2">
          <div className="field">
            <label htmlFor="af-english">{t('field.englishTitle')}</label>
            <input
              id="af-english"
              className="input"
              placeholder={t('field.optional')}
              value={values.englishTitle}
              onChange={(e) => set('englishTitle', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="af-year">{t('field.year')}</label>
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
            <label htmlFor="af-studio">{t('field.studio')}</label>
            <input
              id="af-studio"
              className="input"
                placeholder={t('form.studioPlaceholder')}
              value={values.studio}
              onChange={(e) => set('studio', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="af-status">{t('field.status')}</label>
            <select
              id="af-status"
              className="select"
              value={values.status}
              onChange={(e) => set('status', e.target.value as Status)}
            >
              {STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {t(statusKey(s.key))}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="af-notes">{t('field.notes')}</label>
          <textarea
            id="af-notes"
            className="textarea"
            placeholder={t('form.notesPlaceholder')}
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
            {t('form.favourite')}
          </label>

        <div className="modal-actions">
          {plannedEpisodes > 0 && (
            <span className="hint" style={{ marginRight: 'auto', alignSelf: 'center' }}>
              {plannedEpisodes} episode{plannedEpisodes > 1 ? 's' : ''} will be created
            </span>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('action.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
