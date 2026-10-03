import { useMemo, useState, type ReactNode } from 'react'
import { rankAnime } from '../scoring'
import { useStore } from '../store'
import { STATUSES, type Status } from '../types'
import { AnimeCard } from './AnimeCard'
import { IconPlus, IconSearch } from './Icons'

type SortKey = 'score' | 'title' | 'year' | 'episodes' | 'recent'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'score', label: 'Global score' },
  { key: 'title', label: 'Title (A–Z)' },
  { key: 'year', label: 'Newest first' },
  { key: 'episodes', label: 'Most episodes' },
  { key: 'recent', label: 'Recently updated' }
]

export function AnimeLibrary({
  onOpen,
  onAdd
}: {
  onOpen: (id: string) => void
  onAdd: () => void
}): ReactNode {
  const { data } = useStore()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status | 'all'>('all')
  const [sort, setSort] = useState<SortKey>('score')

  const weights = data.settings.weights

  const rankMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of rankAnime(data.anime, weights)) {
      if (entry.rank > 0) map.set(entry.anime.id, entry.rank)
    }
    return map
  }, [data.anime, weights])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = data.anime.filter((a) => {
      if (status !== 'all' && a.status !== status) return false
      if (!q) return true
      return (
        a.title.toLowerCase().includes(q) ||
        (a.englishTitle ?? '').toLowerCase().includes(q) ||
        (a.studio ?? '').toLowerCase().includes(q)
      )
    })

    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'title':
          return a.title.localeCompare(b.title)
        case 'year':
          return (b.year ?? 0) - (a.year ?? 0)
        case 'episodes':
          return b.episodes.length - a.episodes.length
        case 'recent':
          return b.updatedAt.localeCompare(a.updatedAt)
        case 'score':
        default: {
          const ra = rankMap.get(a.id) ?? Number.MAX_SAFE_INTEGER
          const rb = rankMap.get(b.id) ?? Number.MAX_SAFE_INTEGER
          return ra - rb
        }
      }
    })
    return list
  }, [data.anime, query, status, sort, rankMap])

  if (data.anime.length === 0) {
    return (
      <div className="empty">
        <div className="big">アニメ</div>
        <h3>No anime yet</h3>
        <p style={{ maxWidth: 420, margin: 0 }}>
          Add the first show you&apos;ve watched, then score its episodes from 0–100 and rate it on
          every criterion. ANIMEEH builds your global ranking automatically.
        </p>
        <button className="btn primary" onClick={onAdd}>
          <IconPlus size={16} /> Add your first anime
        </button>
      </div>
    )
  }

  const plural = data.anime.length === 1 ? '' : 's'

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <IconSearch size={15} />
          <input
            className="input"
            placeholder="Search title, studio…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chips">
          <button
            className={`chip${status === 'all' ? ' active' : ''}`}
            onClick={() => setStatus('all')}
          >
            All
          </button>
          {STATUSES.map((s) => (
            <button
              key={s.key}
              className={`chip${status === s.key ? ' active' : ''}`}
              onClick={() => setStatus(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <select
          className="select"
          style={{ width: 180 }}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <h3>Nothing matches</h3>
          <p style={{ margin: 0 }}>No anime match the current search or filters.</p>
        </div>
      ) : (
        <>
          <div className="hint" style={{ marginBottom: 12 }}>
            {visible.length} of {data.anime.length} anime{plural}
          </div>
          <div className="grid">
            {visible.map((a) => (
              <AnimeCard
                key={a.id}
                anime={a}
                weights={weights}
                rank={rankMap.get(a.id) ?? null}
                onOpen={() => onOpen(a.id)}
              />
            ))}
          </div>
        </>
      )}
    </>
  )
}
