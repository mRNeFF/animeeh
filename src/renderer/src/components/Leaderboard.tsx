import { useMemo, useState, type ReactNode } from 'react'
import { criterionKey, useI18n } from '../i18n'
import { grade, rankAnime, scoreParts } from '../scoring'
import { useStore } from '../store'
import { CRITERIA, type Anime, type ComponentKey } from '../types'
import { GradeBadge } from './ui'
import { isFilm } from './AnimeLibrary'

type SortKey = 'rank' | ComponentKey
type Dir = 'asc' | 'desc'

/** Which pool the ranking is computed over. */
type Scope = 'global' | 'series' | 'film'

function scopeFilter(scope: Scope): (anime: Anime) => boolean {
  if (scope === 'global') return () => true
  if (scope === 'film') return isFilm
  return (anime) => !isFilm(anime)
}

export function Leaderboard({ onOpen }: { onOpen: (id: string) => void }): ReactNode {
  const { data } = useStore()
  const { t } = useI18n()
  const weights = data.settings.weights

  /**
   * Ranks are recomputed per scope rather than filtered from the global order:
   * a film must be ranked against other films, not against series.
   */
  const [scope, setScope] = useState<Scope>('global')
  const [sortKey, setSortKey] = useState<SortKey>('rank')
  const [dir, setDir] = useState<Dir>('desc')

  const pool = useMemo(
    () => data.anime.filter(scopeFilter(scope)),
    [data.anime, scope]
  )

  const ranked = useMemo(() => rankAnime(pool, weights), [pool, weights])

  // A film has no opening, so that column is hidden when ranking films.
  const columns = scope === 'film' ? CRITERIA.filter((c) => c.key !== 'opening') : CRITERIA

  const rows = useMemo(() => {
    const withValues = ranked.map((entry) => {
      const parts = new Map(scoreParts(entry.anime, weights).map((p) => [p.key, p]))
      return { entry, parts }
    })

    if (sortKey === 'rank') return withValues

    return [...withValues].sort((a, b) => {
      const av = a.parts.get(sortKey)?.value ?? null
      const bv = b.parts.get(sortKey)?.value ?? null
      if (av === null && bv === null) return a.entry.anime.title.localeCompare(b.entry.anime.title)
      if (av === null) return 1
      if (bv === null) return -1
      return dir === 'desc' ? bv - av : av - bv
    })
  }, [ranked, weights, sortKey, dir])

  const toggle = (key: SortKey): void => {
    if (key === sortKey) setDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else {
      setSortKey(key)
      setDir('desc')
    }
  }

  const arrow = (key: SortKey): string => (key === sortKey ? (dir === 'desc' ? ' ▾' : ' ▴') : '')

  const counts = useMemo(() => {
    const films = data.anime.filter(isFilm).length
    return { all: data.anime.length, films, series: data.anime.length - films }
  }, [data.anime])

  const tabs: { key: Scope; label: string; count: number }[] = [
    { key: 'global', label: t('board.tab.global'), count: counts.all },
    { key: 'series', label: t('board.tab.series'), count: counts.series },
    { key: 'film', label: t('board.tab.films'), count: counts.films }
  ]

  return (
    <>
      <div className="toolbar">
        <div className="chips">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`chip${scope === tab.key ? ' active' : ''}`}
              onClick={() => setScope(tab.key)}
              disabled={tab.count === 0}
            >
              {tab.label} <span className="hint">{tab.count}</span>
            </button>
          ))}
        </div>
      </div>

      {pool.length === 0 ? (
        <div className="empty">
          <h3>{scope === 'film' ? t('empty.noFilms.title') : t('empty.leaderboard')}</h3>
          <p style={{ margin: 0 }}>
            {scope === 'film' ? t('empty.noFilms.body') : t('empty.leaderboardBody')}
          </p>
        </div>
      ) : (
        <>
          <div className="hint" style={{ marginBottom: 12 }}>
            {t('board.hint')} {t('board.tabHint')}
          </div>
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th onClick={() => toggle('rank')} style={{ width: 54 }}>
                    #{arrow('rank')}
                  </th>
                  <th className="no-sort">{t('board.title')}</th>
                  <th className="no-sort" style={{ width: 54 }}>
                    {t('board.eps')}
                  </th>
                  <th onClick={() => toggle('episodeAverage')} style={{ width: 62 }}>
                    {t('board.avg')}
                    {arrow('episodeAverage')}
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => toggle(c.key)}
                      style={{ width: 58 }}
                      title={t(criterionKey(c.key))}
                    >
                      {c.short}
                      {arrow(c.key)}
                    </th>
                  ))}
                  <th onClick={() => toggle('rank')} style={{ width: 66 }}>
                    {t('board.global')}
                    {arrow('rank')}
                  </th>
                  <th className="no-sort" style={{ width: 56 }}>
                    {t('board.grade')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ entry, parts }) => {
                  const g = grade(entry.score)
                  const epAvg = parts.get('episodeAverage')?.value ?? null
                  return (
                    <tr
                      key={entry.anime.id}
                      className="clickable"
                      onClick={() => onOpen(entry.anime.id)}
                    >
                      <td className={`rank-cell${entry.rank > 0 && entry.rank <= 3 ? ' top' : ''}`}>
                        {entry.rank > 0 ? entry.rank : '—'}
                      </td>
                      <td>
                        <div className="t-title">
                          {entry.anime.title}
                          {isFilm(entry.anime) && <span className="film-tag">FILM</span>}
                        </div>
                        <div className="t-sub">
                          {[entry.anime.year, entry.anime.studio].filter(Boolean).join(' · ') ||
                            t('board.noDetails')}
                        </div>
                      </td>
                      <td className="num">{entry.anime.episodes.length}</td>
                      <td className="num">{epAvg === null ? '—' : epAvg.toFixed(1)}</td>
                      {columns.map((c) => {
                        const value = parts.get(c.key)?.value ?? null
                        return (
                          <td key={c.key} className="num" style={{ color: `hsl(${c.hue} 65% 68%)` }}>
                            {value === null ? '—' : Math.round(value)}
                          </td>
                        )
                      })}
                      <td className="num" style={{ fontSize: 14 }}>
                        {entry.score === null ? '—' : entry.score.toFixed(1)}
                      </td>
                      <td>
                        <GradeBadge
                          letter={g.letter}
                          hue={g.hue}
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 9,
                            fontSize: 14,
                            display: 'grid',
                            placeItems: 'center',
                            fontWeight: 800
                          }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="hint" style={{ marginTop: 14 }}>
            {t('board.summary', { count: pool.length })} {globalScoreSummary(rows.map((r) => r.entry.score), t)}
          </div>
        </>
      )}
    </>
  )
}

function globalScoreSummary(
  scores: (number | null)[],
  t: (key: 'board.average', vars: Record<string, string | number>) => string
): string {
  const rated = scores.filter((s): s is number => s !== null)
  if (rated.length === 0) return ''
  const mean = rated.reduce((a, b) => a + b, 0) / rated.length
  return t('board.average', { value: mean.toFixed(1) })
}
