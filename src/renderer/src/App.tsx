import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimeDetail } from './components/AnimeDetail'
import { AnimeForm } from './components/AnimeForm'
import { AnimeLibrary } from './components/AnimeLibrary'
import { CriteriaView } from './components/CriteriaView'
import { Leaderboard } from './components/Leaderboard'
import { SettingsView } from './components/SettingsView'
import { ScheduleView } from './components/ScheduleView'
import { StatsView } from './components/StatsView'
import {
  IconChart,
  IconFilm,
  IconLibrary,
  IconPlus,
  IconRefresh,
  IconCalendar,
  IconSettings,
  IconStats,
  IconTrophy
} from './components/Icons'
import { useI18n, type MessageKey } from './i18n'
import { useStore } from './store'
import { useUpdate } from './useUpdate'
import { applySeasonSpans, buildEpisodes } from './scoring'
import { createAnime, type Anime } from './types'

type View = 'library' | 'films' | 'leaderboard' | 'criteria' | 'schedule' | 'stats' | 'settings'

/**
 * Silently fill in missing metadata for entries that have a reference id.
 *
 * Covers cover art, genres, format and the per-episode duration. The duration
 * matters most: without it the statistics cannot state a watch time, only guess
 * one. Entries added by an older build have none of these.
 *
 * Paced to stay under AniList's ~30 requests/minute, and capped per launch so a
 * large library does not turn into a burst. Failures are swallowed: this is
 * cosmetic metadata, not user data.
 */
const MAX_BACKFILL = 40
const BACKFILL_PACING_MS = 2200

function needsMetadata(anime: {
  coverImage?: string
  format?: string
  genres?: string[]
  runtimeMinutes?: number
  seasons?: { runtimeMinutes?: number }[]
}): boolean {
  if (!anime.coverImage || !anime.format || (anime.genres?.length ?? 0) === 0) return true
  if (anime.runtimeMinutes === undefined) return true
  // A season without its own duration falls back to the entry's, so fetch it.
  return (anime.seasons ?? []).some((s) => s.runtimeMinutes === undefined)
}

function useMetadataBackfill(): void {
  const { data, updateAnime } = useStore()
  const started = useRef(false)

  useEffect(() => {
    if (started.current || data.anime.length === 0) return

    const targets = data.anime
      .filter((a) => needsMetadata(a))
      .filter((a) => !!(a.source?.anilistId ?? a.seasons?.[0]?.anilistId))
      .slice(0, MAX_BACKFILL)

    started.current = true
    if (targets.length === 0) return

    void (async () => {
      for (const anime of targets) {
        const sourceId = anime.source?.anilistId ?? anime.seasons?.[0]?.anilistId
        if (!sourceId) continue
        try {
          const outcome = await window.animeeh.animeFranchise(sourceId)
          if (outcome.ok) {
            const next: Partial<Anime> = {}
            if (!anime.coverImage && outcome.data.coverImage) {
              next.coverImage = outcome.data.coverImage
            }
            if ((anime.genres?.length ?? 0) === 0 && outcome.data.genres.length > 0) {
              next.genres = outcome.data.genres
            }
            if (!anime.format && outcome.data.format) {
              next.format = outcome.data.format
            }
            if (anime.runtimeMinutes === undefined && outcome.data.duration) {
              next.runtimeMinutes = outcome.data.duration
            }

            // Refresh the stored seasons so each carries its own duration and
            // episode count, which the statistics use for accuracy.
            if (outcome.data.seasons.length > 0) {
              next.seasons = outcome.data.seasons.map((s) => ({
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

            if (Object.keys(next).length > 0) updateAnime(anime.id, next)
          }
        } catch {
          // cosmetic only
        }
        await new Promise((r) => setTimeout(r, BACKFILL_PACING_MS))
      }
    })()
  }, [data.anime, updateAnime])
}

const NAV: { key: View; labelKey: MessageKey; icon: (p: { size?: number }) => ReactNode }[] = [
  { key: 'library', labelKey: 'nav.library', icon: IconLibrary },
  { key: 'films', labelKey: 'nav.films', icon: IconFilm },
  { key: 'leaderboard', labelKey: 'nav.leaderboard', icon: IconTrophy },
  { key: 'criteria', labelKey: 'nav.criteria', icon: IconChart },
  { key: 'schedule', labelKey: 'nav.schedule', icon: IconCalendar },
  { key: 'stats', labelKey: 'nav.stats', icon: IconStats },
  { key: 'settings', labelKey: 'nav.settings', icon: IconSettings }
]

const TITLES: Record<View, { title: MessageKey; sub: MessageKey }> = {
  library: { title: 'title.library', sub: 'subtitle.library' },
  films: { title: 'title.films', sub: 'subtitle.films' },
  leaderboard: { title: 'title.leaderboard', sub: 'subtitle.leaderboard' },
  criteria: { title: 'title.criteria', sub: 'subtitle.criteria' },
  schedule: { title: 'title.schedule', sub: 'subtitle.schedule' },
  stats: { title: 'title.stats', sub: 'subtitle.stats' },
  settings: { title: 'title.settings', sub: 'subtitle.settings' }
}

export default function App(): ReactNode {
  const { data, loaded, saving, addAnime } = useStore()
  const { t } = useI18n()
  useMetadataBackfill()
  const [view, setView] = useState<View>('library')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addingFilm, setAddingFilm] = useState(false)
  const { status: updateStatus } = useUpdate()

  const inDetail = view === 'library' && selectedId !== null
  const updateReady =
    updateStatus?.stage === 'available' || updateStatus?.stage === 'downloaded'

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setAdding(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!loaded) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center', color: 'var(--muted-2)' }}>
          <div className="brand-mark" style={{ margin: '0 auto 14px' }}>
            ア
          </div>
          {t('shell.loading')}
        </div>
      </div>
    )
  }

  const header = inDetail
    ? { title: t('title.detail'), sub: t('subtitle.detail') }
    : { title: t(TITLES[view].title), sub: t(TITLES[view].sub) }

  const episodes = data.anime.reduce((sum, a) => sum + a.episodes.length, 0)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">ア</div>
          <div className="brand-text">
            <div className="brand-title">ANIMEEH</div>
            <div className="brand-sub">{t('brand.tagline')}</div>
          </div>
        </div>

        {NAV.map((item) => {
          const Icon = item.icon
          const active = view === item.key && !inDetail
          return (
            <button
              key={item.key}
              className={`nav-item${active ? ' active' : ''}`}
              onClick={() => {
                setView(item.key)
                setSelectedId(null)
              }}
            >
              <Icon size={17} />
              <span className="nav-label">{t(item.labelKey)}</span>
              {item.key === 'library' && data.anime.length > 0 && (
                <span className="nav-count">{data.anime.length}</span>
              )}
            </button>
          )
        })}

        <div className="sidebar-foot">
          <div className={`save-dot${saving ? ' saving' : ''}`}>
            <i />
            {saving ? t('shell.saving') : t('shell.saved')}
          </div>
          <div>{t('shell.summary', { anime: data.anime.length, episodes })}</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{header.title}</h1>
            <div className="sub">{header.sub}</div>
          </div>
          <div className="topbar-actions">
            {updateReady && (
              <button
                className="btn"
                onClick={() => {
                  setView('settings')
                  setSelectedId(null)
                }}
                title={
                  updateStatus?.stage === 'downloaded'
                    ? t('update.badgeTitleReady')
                    : t('update.badgeTitle', { version: updateStatus?.availableVersion ?? '' })
                }
              >
                <IconRefresh size={15} />
                {updateStatus?.stage === 'downloaded'
                  ? t('update.badgeReady')
                  : t('update.badge', { version: updateStatus?.availableVersion ?? '' }).trim()}
              </button>
            )}
            <button
              className="btn primary"
              onClick={() => (view === 'films' ? setAddingFilm(true) : setAdding(true))}
            >
                <IconPlus size={16} /> {t(view === 'films' ? 'form.addFilm' : 'action.addAnime')}
              </button>
          </div>
        </header>

        <div className="content">
          {view === 'library' &&
            (selectedId ? (
              <AnimeDetail animeId={selectedId} onBack={() => setSelectedId(null)} />
            ) : (
              <AnimeLibrary
                mode="series"
                onOpen={setSelectedId}
                onAdd={() => setAdding(true)}
              />
            ))}
          {view === 'films' &&
            (selectedId ? (
              <AnimeDetail animeId={selectedId} onBack={() => setSelectedId(null)} />
            ) : (
              <AnimeLibrary
                mode="film"
                onOpen={setSelectedId}
                onAdd={() => {
                  setAddingFilm(true)
                }}
              />
            ))}
          {view === 'leaderboard' && <Leaderboard onOpen={(id) => {
            setView('library')
            setSelectedId(id)
          }} />}
          {view === 'criteria' && <CriteriaView onOpen={(id) => {
            setView('library')
            setSelectedId(id)
          }} />}
          {view === 'schedule' && <ScheduleView />}
          {view === 'stats' && <StatsView />}
          {view === 'settings' && <SettingsView />}
        </div>
      </main>

      {(adding || addingFilm) && (
        <AnimeForm
          kind={addingFilm ? 'film' : 'series'}
          submitLabel={t(addingFilm ? 'form.addFilm' : 'action.addAnime')}
          onClose={() => {
            setAdding(false)
            setAddingFilm(false)
          }}
          onSubmit={(v) => {
            const planned = v.createEpisodes
              ? (v.totalEpisodes ?? v.episodeBlueprint.length)
              : 0

            const anime = createAnime({
              title: v.title,
              englishTitle: v.englishTitle || undefined,
              year: v.year ? Number(v.year) : undefined,
              studio: v.studio || undefined,
              status: v.status,
              notes: v.notes || undefined,
              favorite: v.favorite,
              totalEpisodes: v.totalEpisodes,
              source: v.source,
              seasons: v.seasons.length > 0 ? v.seasons : undefined,
              coverImage: v.coverImage,
              genres: v.genres.length > 0 ? v.genres : undefined,
              format: v.format,
              runtimeMinutes: v.duration,
              episodes:
                planned > 0
                  ? applySeasonSpans(
                      buildEpisodes(planned, v.episodeBlueprint),
                      v.seasons.length > 1 ? v.seasons : undefined
                    )
                  : []
            })
            addAnime(anime)
            setAdding(false)
            setAddingFilm(false)
            setView('library')
            setSelectedId(anime.id)
          }}
        />
      )}
    </div>
  )
}
