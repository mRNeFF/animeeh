import type { ReactNode } from 'react'
import { episodeCount, globalScore, grade } from '../scoring'
import { STATUS_LABELS, type Anime, type Weights } from '../types'
import { Bar, Cover, GradeBadge } from './ui'

export function AnimeCard({
  anime,
  weights,
  rank,
  onOpen
}: {
  anime: Anime
  weights: Weights
  rank: number | null
  onOpen: () => void
}): ReactNode {
  const score = globalScore(anime, weights)
  const g = grade(score)
  const hue = (anime.title.charCodeAt(0) * 37 + anime.title.length * 11) % 360
  const eps = episodeCount(anime)

  return (
    <article className="card" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}>
      <Cover title={anime.title} hue={hue} className="card-cover" />
      {rank !== null && rank > 0 && <div className="card-rank">#{rank}</div>}
      <GradeBadge letter={g.letter} hue={g.hue} className="card-grade" />
      <div className="card-body">
        <div className="card-title">{anime.title}</div>
        <div className="card-meta">
          <span className="pill">{STATUS_LABELS[anime.status]}</span>
          {anime.year ? <span>{anime.year}</span> : null}
          <span>
            {eps} {eps === 1 ? 'ep' : 'eps'}
          </span>
          {anime.favorite ? <span title="Favourite">★</span> : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Bar value={score} hue={g.hue} />
          </div>
          <span className="num" style={{ fontSize: 13 }}>
            {score === null ? '—' : score.toFixed(1)}
          </span>
        </div>
      </div>
    </article>
  )
}
