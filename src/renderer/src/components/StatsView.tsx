import { useMemo, type ReactNode } from 'react'
import { criterionKey, useI18n } from '../i18n'
import { episodeAverage, globalScore, grade, scoredEpisodeCount } from '../scoring'
import { useStore } from '../store'
import { CRITERIA, isFilm, type Anime, type CriterionKey } from '../types'
import { GradeBadge } from './ui'

/**
 * Minutes to assume when the reference source reports no duration.
 *
 * A TV episode is almost always 24 minutes, but a TV_SHORT runs 3 to 12, so
 * using 24 for those would inflate the total. These are guesses and the panel
 * says so, listing how many entries relied on one.
 */
const FALLBACK_MINUTES: Record<string, number> = {
  TV_SHORT: 12,
  MOVIE: 105
}
const FALLBACK_EPISODE_MINUTES = 24

function minutesPerEpisode(
  entry: { format?: string; runtimeMinutes?: number },
  season: { runtimeMinutes?: number } | undefined
): { minutes: number; fromSource: boolean } {
  // A season's own duration wins: seasons of one franchise can differ.
  if (season?.runtimeMinutes && season.runtimeMinutes > 0) {
    return { minutes: season.runtimeMinutes, fromSource: true }
  }
  if (entry.runtimeMinutes && entry.runtimeMinutes > 0) {
    return { minutes: entry.runtimeMinutes, fromSource: true }
  }
  const format = entry.format ?? ''
  return {
    minutes: FALLBACK_MINUTES[format] ?? FALLBACK_EPISODE_MINUTES,
    fromSource: false
  }
}

interface Totals {
  seriesCount: number
  filmCount: number
  episodesRated: number
  episodesListed: number
  /** Minutes for episodes that carry a rating. */
  minutesRated: number
  /** Minutes if every listed episode were counted — an upper bound. */
  minutesListed: number
  entriesWithoutDuration: number
  averageScore: number | null
  best: { anime: Anime; score: number } | null
  worst: { anime: Anime; score: number } | null
  grades: { letter: string; hue: number; count: number }[]
  criteriaAverages: { key: CriterionKey; label: string; hue: number; value: number | null }[]
  topGenres: [string, number][]
  topStudios: [string, number][]
  longest: Anime | null
  favourites: number
  withNames: number
  oldestYear: number | null
  newestYear: number | null
}

function computeTotals(anime: Anime[], weights: Parameters<typeof globalScore>[1]): Totals {
  let seriesCount = 0
  let filmCount = 0
  let episodesRated = 0
  let episodesListed = 0
  let minutesRated = 0
  let minutesListed = 0
  let entriesWithoutDuration = 0
  let favourites = 0
  let withNames = 0
  let oldestYear: number | null = null
  let newestYear: number | null = null

  const scores: number[] = []
  const gradeCounts = new Map<string, { hue: number; count: number }>()
  const criterionSums = new Map<CriterionKey, { total: number; count: number }>()
  const genreCounts = new Map<string, number>()
  const studioCounts = new Map<string, number>()
  let best: { anime: Anime; score: number } | null = null
  let worst: { anime: Anime; score: number } | null = null
  let longest: Anime | null = null

  for (const item of anime) {
    const film = isFilm(item)
    if (film) filmCount += 1
    else seriesCount += 1

    if (item.favorite) favourites += 1

    if (item.year) {
      oldestYear = oldestYear === null ? item.year : Math.min(oldestYear, item.year)
      newestYear = newestYear === null ? item.year : Math.max(newestYear, item.year)
    }

    for (const genre of item.genres ?? []) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
    }
    if (item.studio) {
      for (const studio of item.studio
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        studioCounts.set(studio, (studioCounts.get(studio) ?? 0) + 1)
      }
    }

    if (film) {
      // A film is one sitting, counted only once it has been rated.
      const rated = CRITERIA.some((c) => item.criteria[c.key] !== null)
      if (rated) {
        const per = minutesPerEpisode(item, undefined)
        if (!per.fromSource) entriesWithoutDuration += 1
        minutesRated += per.minutes
        minutesListed += per.minutes
      }
    } else {
      const listed = item.episodes.length
      const rated = scoredEpisodeCount(item)
      episodesRated += rated
      episodesListed += listed

      // Group by season so each season can use its own duration.
      const bySeason = new Map<number, number>()
      for (const episode of item.episodes) {
        const key = episode.season ?? 1
        bySeason.set(key, (bySeason.get(key) ?? 0) + 1)
      }

      let coveredBySource = true
      for (const [seasonNumber, count] of bySeason) {
        const season = (item.seasons ?? []).find((s) => s.season === seasonNumber)
        const per = minutesPerEpisode(item, season)
        if (!per.fromSource) coveredBySource = false

        const ratedInSeason = item.episodes.filter(
          (e) => (e.season ?? 1) === seasonNumber && e.score !== null && Number.isFinite(e.score)
        ).length
        minutesRated += ratedInSeason * per.minutes
        minutesListed += count * per.minutes
      }

      // An entry with no episodes yet still has no duration to speak of.
      if (bySeason.size === 0 && !item.runtimeMinutes) coveredBySource = false
      if (!coveredBySource) entriesWithoutDuration += 1

      if (item.episodes.length > (longest?.episodes.length ?? 0)) longest = item

      const named = item.episodes.filter((e) => (e.title ?? '').trim() !== '').length
      if (named > 0) withNames += 1
    }

    const score = globalScore(item, weights)
    if (score !== null) {
      scores.push(score)
      const g = grade(score)
      const found = gradeCounts.get(g.letter)
      if (found) found.count += 1
      else gradeCounts.set(g.letter, { hue: g.hue, count: 1 })

      if (!best || score > best.score) best = { anime: item, score }
      if (!worst || score < worst.score) worst = { anime: item, score }
    }

    for (const c of CRITERIA) {
      const value = item.criteria[c.key]
      if (typeof value !== 'number') continue
      const found = criterionSums.get(c.key)
      if (found) {
        found.total += value
        found.count += 1
      } else {
        criterionSums.set(c.key, { total: value, count: 1 })
      }
    }
  }

  const order = ['S', 'A', 'B', 'C', 'D', 'E', 'F']

  return {
    seriesCount,
    filmCount,
    episodesRated,
    episodesListed,
    minutesRated,
    minutesListed,
    entriesWithoutDuration,
    averageScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    best,
    worst,
    grades: order
      .filter((letter) => gradeCounts.has(letter))
      .map((letter) => ({ letter, ...(gradeCounts.get(letter) as { hue: number; count: number }) })),
    criteriaAverages: CRITERIA.map((c) => {
      const found = criterionSums.get(c.key)
      return {
        key: c.key,
        label: c.label,
        hue: c.hue,
        value: found && found.count > 0 ? found.total / found.count : null
      }
    }),
    topGenres: [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    topStudios: [...studioCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    longest,
    favourites,
    withNames,
    oldestYear,
    newestYear
  }
}

/** Kept as a no-op hook point so the shape stays readable above. */
function formatHours(minutes: number): string {
  const hours = minutes / 60
  if (hours < 1) return `${Math.round(minutes)} min`
  if (hours < 100) return `${hours.toFixed(1)} h`
  return `${Math.round(hours).toLocaleString()} h`
}

function formatDays(minutes: number): string {
  const days = minutes / 60 / 24
  if (days < 1) return ''
  return `${days.toFixed(1)} d`
}

export function StatsView(): ReactNode {
  const { data } = useStore()
  const { t } = useI18n()

  const totals = useMemo(
    () => computeTotals(data.anime, data.settings.weights),
    [data.anime, data.settings.weights]
  )

  if (data.anime.length === 0) {
    return (
      <div className="empty">
        <h3>{t('stats.empty.title')}</h3>
        <p style={{ margin: 0 }}>{t('stats.empty.body')}</p>
      </div>
    )
  }

  const coverage =
    totals.episodesListed > 0
      ? Math.round((totals.episodesRated / totals.episodesListed) * 100)
      : 0

  const tiles: { label: string; value: string; sub?: string }[] = [
    {
      label: t('stats.series'),
      value: String(totals.seriesCount),
      sub: t('stats.episodesRatedSub', {
        rated: totals.episodesRated,
        listed: totals.episodesListed
      })
    },
    { label: t('stats.films'), value: String(totals.filmCount) },
    {
      label: t('stats.watchTime'),
      value: formatHours(totals.minutesRated),
      sub: formatDays(totals.minutesRated) || undefined
    },
    {
      label: t('stats.averageScore'),
      value: totals.averageScore === null ? '—' : totals.averageScore.toFixed(1)
    }
  ]

  const total = totals.grades.reduce((sum, g) => sum + g.count, 0)

  return (
    <>
      <div className="stat-grid">
        {tiles.map((tile) => (
          <div className="stat-tile" key={tile.label}>
            <div className="stat-value">{tile.value}</div>
            <div className="stat-label">{tile.label}</div>
            {tile.sub && <div className="stat-sub">{tile.sub}</div>}
          </div>
        ))}
      </div>

      <div className="panel stats-watchtime">
        <h3>{t('stats.watchTimeDetail')}</h3>
        <div className="panel-sub">{t('stats.watchTimeSub')}</div>
        <div className="stat-list">
          <PlainRow
            label={t('stats.ratedOnly')}
            value={`${formatHours(totals.minutesRated)} · ${t('stats.minutes', {
              count: Math.round(totals.minutesRated)
            })}`}
          />
          <PlainRow
            label={t('stats.listedUpper')}
            value={`${formatHours(totals.minutesListed)} · ${t('stats.minutes', {
              count: Math.round(totals.minutesListed)
            })}`}
          />
          <PlainRow
            label={t('stats.ratedEpisodesShort')}
            value={String(totals.episodesRated)}
          />
          <PlainRow
            label={t('stats.listedEpisodesShort')}
            value={String(totals.episodesListed)}
          />
        </div>
        <div className="hint" style={{ marginTop: 12 }}>
          {totals.entriesWithoutDuration > 0
            ? t('stats.partialDuration', {
                count: totals.entriesWithoutDuration,
                episode: FALLBACK_EPISODE_MINUTES
              })
            : t('stats.fullDuration')}
        </div>
      </div>

      <div className="panel stats-episodes">
        <h3>{t('stats.episodes')}</h3>
        <div className="panel-sub">
          {t('stats.episodesSub', { rated: totals.episodesRated, listed: totals.episodesListed })}
        </div>
        <div className="bar" style={{ height: 10 }}>
          <span style={{ width: `${coverage}%`, background: 'hsl(268 70% 55%)' }} />
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          {t('stats.coverage', { percent: coverage })} ·{' '}
          {t('stats.named', { count: totals.withNames, total: totals.seriesCount })}
        </div>
      </div>

      {totals.grades.length > 0 && (
        <div className="panel">
          <h3>{t('stats.grades')}</h3>
          <div className="panel-sub">{t('stats.gradesSub')}</div>
          <div className="grade-bar">
            {totals.grades.map((g) => (
              <div
                className="grade-seg"
                key={g.letter}
                style={{
                  width: `${total === 0 ? 0 : (g.count / total) * 100}%`,
                  background: `hsl(${g.hue} 70% 52%)`
                }}
                title={`${g.letter}: ${g.count}`}
              >
                {g.count / total > 0.07 ? g.letter : ''}
              </div>
            ))}
          </div>
          <div className="grade-legend">
            {totals.grades.map((g) => (
              <span className="grade-legend-item" key={g.letter}>
                <GradeBadge
                  letter={g.letter}
                  hue={g.hue}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    fontSize: 11,
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800
                  }}
                />
                {g.count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <h3>{t('stats.criteria')}</h3>
        <div className="panel-sub">{t('stats.criteriaSub')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {totals.criteriaAverages.map((c) => (
            <div className="criterion" key={c.key}>
              <div className="criterion-name">
                <span className="dot" style={{ background: `hsl(${c.hue} 70% 55%)` }} />
                {t(criterionKey(c.key))}
              </div>
              <div className="bar">
                <span
                  style={{
                    width: `${c.value ?? 0}%`,
                    background: `hsl(${c.hue} 70% 52%)`
                  }}
                />
              </div>
              <span className="hint" style={{ textAlign: 'right' }}>
                {c.value === null ? '—' : c.value.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="stat-columns">
        {totals.topGenres.length > 0 && (
          <div className="panel">
            <h3>{t('stats.topGenres')}</h3>
            <div className="chips">
              {totals.topGenres.map(([genre, count]) => (
                <span className="chip" key={genre}>
                  {genre} <span className="hint">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {totals.topStudios.length > 0 && (
          <div className="panel">
            <h3>{t('stats.topStudios')}</h3>
            <div className="chips">
              {totals.topStudios.map(([studio, count]) => (
                <span className="chip" key={studio}>
                  {studio} <span className="hint">{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>{t('stats.highlights')}</h3>
        <div className="stat-list">
          {totals.best && (
            <Row
              label={t('stats.best')}
              title={totals.best.anime.title}
              value={totals.best.score.toFixed(1)}
              hue={grade(totals.best.score).hue}
              grade={grade(totals.best.score).letter}
            />
          )}
          {totals.worst && totals.worst.anime.id !== totals.best?.anime.id && (
            <Row
              label={t('stats.worst')}
              title={totals.worst.anime.title}
              value={totals.worst.score.toFixed(1)}
              hue={grade(totals.worst.score).hue}
              grade={grade(totals.worst.score).letter}
            />
          )}
          {totals.longest && (
            <Row
              label={t('stats.longest')}
              title={totals.longest.title}
              value={t('stats.episodeUnit', { count: totals.longest.episodes.length })}
            />
          )}
          <PlainRow label={t('stats.favourites')} value={String(totals.favourites)} />
          {totals.oldestYear !== null && totals.newestYear !== null && (
            <PlainRow
              label={t('stats.yearSpan')}
              value={
                totals.oldestYear === totals.newestYear
                  ? String(totals.oldestYear)
                  : `${totals.oldestYear} – ${totals.newestYear}`
              }
            />
          )}
          <PlainRow label={t('stats.averages')} value={(() => {
              const avg = data.anime
                .map((a) => episodeAverage(a))
                .filter((v): v is number => v !== null)
              return avg.length === 0
                ? '—'
                : (avg.reduce((x, y) => x + y, 0) / avg.length).toFixed(1)
            })()}
          />
        </div>
      </div>
    </>
  )
}

function Row({
  label,
  title,
  value,
  hue,
  grade: letter
}: {
  label: string
  title: string
  value: string
  hue?: number
  grade?: string
}): ReactNode {
  return (
    <div className="stat-row">
      <span className="stat-row-label">{label}</span>
      <span className="stat-row-title">{title}</span>
      {letter && hue !== undefined && (
        <GradeBadge
          letter={letter}
          hue={hue}
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            fontSize: 12,
            display: 'grid',
            placeItems: 'center',
            fontWeight: 800,
            flex: 'none'
          }}
        />
      )}
      <span className="stat-row-value">{value}</span>
    </div>
  )
}

function PlainRow({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="stat-row">
      <span className="stat-row-label">{label}</span>
      <span className="stat-row-title" />
      <span className="stat-row-value">{value}</span>
    </div>
  )
}
