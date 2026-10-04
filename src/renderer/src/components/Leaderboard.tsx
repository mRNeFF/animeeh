import { useMemo, useState, type ReactNode } from 'react'
import { grade, rankAnime, scoreParts } from '../scoring'
import { useStore } from '../store'
import { criterionKey, useI18n } from '../i18n'
import { CRITERIA, type ComponentKey } from '../types'
import { GradeBadge } from './ui'

type SortKey = 'rank' | ComponentKey
type Dir = 'asc' | 'desc'

export function Leaderboard({ onOpen }: { onOpen: (id: string) => void }): ReactNode {
  const { data } = useStore()
  const { t } = useI18n()
  const weights = data.settings.weights

  const [sortKey, setSortKey] = useState<SortKey>('rank')
  const [dir, setDir] = useState<Dir>('desc')

  const ranked = useMemo(() => rankAnime(data.anime, weights), [data.anime, weights])

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
    if (key === sortKey) {
      setDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setDir('desc')
    }
  }

  const arrow = (key: SortKey): string => (key === sortKey ? (dir === 'desc' ? ' ▾' : ' ▴') : '')

  if (data.anime.length === 0) {
    return (
      <div className="empty">
        <h3>{t('empty.leaderboard')}</h3>
        <p style={{ margin: 0 }}>{t('empty.leaderboardBody')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="hint" style={{ marginBottom: 12 }}>
        Ranked by weighted global score. Click any column header to re-sort; click a row to open it.
        Unrated components are excluded from the average.
      </div>
      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th onClick={() => toggle('rank')} style={{ width: 54 }}>
                #{arrow('rank')}
              </th>
              <th className="no-sort">Title</th>
              <th className="no-sort" style={{ width: 54 }}>
                {t('board.eps')}
              </th>
              <th onClick={() => toggle('episodeAverage')} style={{ width: 62 }}>
                Avg{arrow('episodeAverage')}
              </th>
              {CRITERIA.map((c) => (
                <th key={c.key} onClick={() => toggle(c.key)} style={{ width: 58 }} title={t(criterionKey(c.key))}>
                  {c.short}
                  {arrow(c.key)}
                </th>
              ))}
              <th onClick={() => toggle('rank')} style={{ width: 66 }}>
                Global{arrow('rank')}
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
                    <div className="t-title">{entry.anime.title}</div>
                    <div className="t-sub">
                      {[entry.anime.year, entry.anime.studio].filter(Boolean).join(' · ') ||
                        'No details'}
                    </div>
                  </td>
                  <td className="num">{entry.anime.episodes.length}</td>
                  <td className="num">{epAvg === null ? '—' : epAvg.toFixed(1)}</td>
                  {CRITERIA.map((c) => {
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
        {data.anime.length} anime · global score = weighted mean of rated criteria + episode average.
        {' '}
        {globalScoreSummary(rows.map((r) => r.entry.score))}
      </div>
    </>
  )
}

function globalScoreSummary(scores: (number | null)[]): string {
  const rated = scores.filter((s): s is number => s !== null)
  if (rated.length === 0) return ''
  const mean = rated.reduce((a, b) => a + b, 0) / rated.length
  return `Average of your rated shows: ${mean.toFixed(1)}.`
}
