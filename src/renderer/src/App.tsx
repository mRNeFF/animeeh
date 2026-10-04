import { useEffect, useState, type ReactNode } from 'react'
import { AnimeDetail } from './components/AnimeDetail'
import { AnimeForm } from './components/AnimeForm'
import { AnimeLibrary } from './components/AnimeLibrary'
import { CriteriaView } from './components/CriteriaView'
import { Leaderboard } from './components/Leaderboard'
import { SettingsView } from './components/SettingsView'
import {
  IconChart,
  IconLibrary,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconTrophy
} from './components/Icons'
import { useI18n, type MessageKey } from './i18n'
import { useStore } from './store'
import { useUpdate } from './useUpdate'
import { applySeasonSpans, buildEpisodes } from './scoring'
import { createAnime } from './types'

type View = 'library' | 'leaderboard' | 'criteria' | 'settings'

const NAV: { key: View; labelKey: MessageKey; icon: (p: { size?: number }) => ReactNode }[] = [
  { key: 'library', labelKey: 'nav.library', icon: IconLibrary },
  { key: 'leaderboard', labelKey: 'nav.leaderboard', icon: IconTrophy },
  { key: 'criteria', labelKey: 'nav.criteria', icon: IconChart },
  { key: 'settings', labelKey: 'nav.settings', icon: IconSettings }
]

const TITLES: Record<View, { title: MessageKey; sub: MessageKey }> = {
  library: { title: 'title.library', sub: 'subtitle.library' },
  leaderboard: { title: 'title.leaderboard', sub: 'subtitle.leaderboard' },
  criteria: { title: 'title.criteria', sub: 'subtitle.criteria' },
  settings: { title: 'title.settings', sub: 'subtitle.settings' }
}

export default function App(): ReactNode {
  const { data, loaded, saving, addAnime } = useStore()
  const { t } = useI18n()
  const [view, setView] = useState<View>('library')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
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
            <button className="btn primary" onClick={() => setAdding(true)}>
              <IconPlus size={16} /> {t('action.addAnime')}
            </button>
          </div>
        </header>

        <div className="content">
          {view === 'library' &&
            (selectedId ? (
              <AnimeDetail animeId={selectedId} onBack={() => setSelectedId(null)} />
            ) : (
              <AnimeLibrary onOpen={setSelectedId} onAdd={() => setAdding(true)} />
            ))}
          {view === 'leaderboard' && <Leaderboard onOpen={(id) => {
            setView('library')
            setSelectedId(id)
          }} />}
          {view === 'criteria' && <CriteriaView onOpen={(id) => {
            setView('library')
            setSelectedId(id)
          }} />}
          {view === 'settings' && <SettingsView />}
        </div>
      </main>

      {adding && (
        <AnimeForm
          submitLabel={t('action.addAnime')}
          onClose={() => setAdding(false)}
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
            setView('library')
            setSelectedId(anime.id)
          }}
        />
      )}
    </div>
  )
}
