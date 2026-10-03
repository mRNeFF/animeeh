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
  IconSettings,
  IconTrophy
} from './components/Icons'
import { useStore } from './store'
import { buildEpisodes } from './scoring'
import { createAnime } from './types'

type View = 'library' | 'leaderboard' | 'criteria' | 'settings'

const NAV: { key: View; label: string; icon: (p: { size?: number }) => ReactNode }[] = [
  { key: 'library', label: 'My Anime', icon: IconLibrary },
  { key: 'leaderboard', label: 'Leaderboard', icon: IconTrophy },
  { key: 'criteria', label: 'By Criteria', icon: IconChart },
  { key: 'settings', label: 'Settings', icon: IconSettings }
]

const TITLES: Record<View, { title: string; sub: string }> = {
  library: { title: 'My Anime', sub: 'Everything you have watched and scored' },
  leaderboard: { title: 'Global Leaderboard', sub: 'Your anime ranked by weighted score' },
  criteria: { title: 'Rankings by Criteria', sub: 'Compare shows on a single aspect' },
  settings: { title: 'Settings', sub: 'Weights, backups and data' }
}

export default function App(): ReactNode {
  const { data, loaded, saving, addAnime } = useStore()
  const [view, setView] = useState<View>('library')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const inDetail = view === 'library' && selectedId !== null

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
          Loading your list…
        </div>
      </div>
    )
  }

  const header = inDetail
    ? { title: 'Anime detail', sub: 'Score episodes and rate every criterion' }
    : TITLES[view]

  const episodes = data.anime.reduce((sum, a) => sum + a.episodes.length, 0)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">ア</div>
          <div className="brand-text">
            <div className="brand-title">ANIMEEH</div>
            <div className="brand-sub">rate · rank · repeat</div>
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
              <span className="nav-label">{item.label}</span>
              {item.key === 'library' && data.anime.length > 0 && (
                <span className="nav-count">{data.anime.length}</span>
              )}
            </button>
          )
        })}

        <div className="sidebar-foot">
          <div className={`save-dot${saving ? ' saving' : ''}`}>
            <i />
            {saving ? 'Saving…' : 'Saved locally'}
          </div>
          <div>
            {data.anime.length} anime · {episodes} episodes
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{header.title}</h1>
            <div className="sub">{header.sub}</div>
          </div>
          <div className="topbar-actions">
            <button className="btn primary" onClick={() => setAdding(true)}>
              <IconPlus size={16} /> Add anime
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
          submitLabel="Add anime"
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
              episodes: planned > 0 ? buildEpisodes(planned, v.episodeBlueprint) : []
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
