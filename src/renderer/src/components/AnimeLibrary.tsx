import { useMemo, useState, type ReactNode } from 'react'
import { statusKey, useI18n, type MessageKey } from '../i18n'
import { rankAnime } from '../scoring'
import { useStore } from '../store'
import { STATUSES, type Status } from '../types'
import { AnimeCard } from './AnimeCard'
import { IconPlus, IconSearch } from './Icons'

type SortKey = 'score' | 'title' | 'year' | 'episodes' | 'recent'

const SORTS: { key: SortKey; labelKey: MessageKey }[] = [
  { key: 'score', labelKey: 'sort.score' },
  { key: 'title', labelKey: 'sort.title' },
  { key: 'year', labelKey: 'sort.year' },
  { key: 'episodes', labelKey: 'sort.episodes' },
  { key: 'recent', labelKey: 'sort.recent' }
]

export function AnimeLibrary({
  onOpen,
  onAdd
}: {
  onOpen: (id: string) => void
  onAdd: () => void
}): ReactNode {
  const { data } = useStore()
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status | 'all'>('all')
  const [genre, setGenre] = useState<string>('all')
  const [sort, setSort] = useState<SortKey>('score')

  const weights = data.settings.weights

  /** Genres present in the library, most common first. */
  const genres = useMemo(() => {
    const counts = new Map<string, number>()
    for (const anime of data.anime) {
      for (const g of anime.genres ?? []) counts.set(g, (counts.get(g) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [data.anime])

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
      if (genre !== 'all' && !(a.genres ?? []).includes(genre)) return false
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
  }, [data.anime, query, status, genre, sort, rankMap])

  if (data.anime.length === 0) {
    return (
      <div className="empty">
        <div className="big">アニメ</div>
        <h3>{t('empty.noAnime.title')}</h3>
        <p style={{ maxWidth: 460, margin: 0 }}>{t('empty.noAnime.body')}</p>
        <button className="btn primary" onClick={onAdd}>
          <IconPlus size={16} /> {t('empty.noAnime.cta')}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <IconSearch size={15} />
          <input
            className="input"
            placeholder={t('library.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chips">
          <button
            className={`chip${status === 'all' ? ' active' : ''}`}
            onClick={() => setStatus('all')}
          >
            {t('library.all')}
          </button>
          {STATUSES.map((s) => (
            <button
              key={s.key}
              className={`chip${status === s.key ? ' active' : ''}`}
              onClick={() => setStatus(s.key)}
            >
              {t(statusKey(s.key))}
            </button>
          ))}
        </div>
        <div className="spacer" />
        {genres.length > 0 && (
          <select
            className="select"
            style={{ width: 190 }}
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            title={t('library.genre')}
          >
            <option value="all">
              {t('library.allGenres')} ({data.anime.length})
            </option>
            {genres.map(([g, count]) => (
              <option key={g} value={g}>
                {g} ({count})
              </option>
            ))}
          </select>
        )}
        <select
          className="select"
          style={{ width: 180 }}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {t('library.sort', { label: t(s.labelKey) })}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <h3>{t('empty.nothingMatches')}</h3>
          <p style={{ margin: 0 }}>{t('empty.nothingMatchesBody')}</p>
        </div>
      ) : (
        <>
          <div className="hint" style={{ marginBottom: 12 }}>
            {t('library.count', { shown: visible.length, total: data.anime.length })}
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
