import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { describeFailure, useI18n } from '../i18n'
import { useStore } from '../store'
import type { AiringEpisode, ScheduleResult, UpcomingSeason } from '../../../shared/schedule'
import { IconRefresh } from './Icons'

/** Weekday and date labels, in the current language. */
function useDateFormatters(): {
  dayLabel: (unix: number) => string
  timeLabel: (unix: number) => string
} {
  const { language } = useI18n()
  const locale = language === 'fr' ? 'fr-FR' : 'en-GB'

  return {
    dayLabel: (unix) =>
      new Date(unix * 1000).toLocaleDateString(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }),
    timeLabel: (unix) =>
      new Date(unix * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }
}

/** Local day key, so episodes group by the user's own calendar day. */
function dayKey(unix: number): string {
  const d = new Date(unix * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ScheduleView(): ReactNode {
  const { data } = useStore()
  const { t } = useI18n()
  const fmt = useDateFormatters()

  const [schedule, setSchedule] = useState<ScheduleResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDiscovery, setShowDiscovery] = useState(false)

  const load = useCallback(
    async (force: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const outcome = await window.animeeh.schedule(force)
        if (outcome.ok) setSchedule(outcome.data)
        else setError(describeFailure(t, outcome))
      } catch (err) {
        setError(describeFailure(t, { detail: (err as Error).message }))
      } finally {
        setLoading(false)
      }
    },
    [t]
  )

  // Served from the six-hour cache on first paint, refreshed otherwise.
  useEffect(() => {
    void load(false)
  }, [load])

  const byDay = useMemo(() => {
    const groups = new Map<string, AiringEpisode[]>()
    for (const episode of schedule?.episodes ?? []) {
      const key = dayKey(episode.airingAt)
      const found = groups.get(key)
      if (found) found.push(episode)
      else groups.set(key, [episode])
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [schedule])

  const hasAnything =
    (schedule?.episodes.length ?? 0) > 0 ||
    (schedule?.seasons.length ?? 0) > 0 ||
    (schedule?.discovery.length ?? 0) > 0

  const noAnime = data.anime.length === 0

  return (
    <>
      <div className="toolbar">
        <span className="hint">
          {schedule
            ? t('schedule.fetched', {
                when: new Date(schedule.fetchedAt).toLocaleString(
                  undefined,
                  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
                ),
                days: schedule.windowDays
              })
            : t('schedule.loading')}
        </span>
        <div className="spacer" />
        <button className="btn" onClick={() => void load(true)} disabled={loading}>
          <IconRefresh size={15} /> {loading ? t('schedule.refreshing') : t('schedule.refresh')}
        </button>
      </div>

      {error && (
        <div className="panel">
          <div className="hint error-text">{error}</div>
        </div>
      )}

      {noAnime ? (
        <div className="empty">
          <h3>{t('schedule.empty.title')}</h3>
          <p style={{ margin: 0 }}>{t('schedule.empty.body')}</p>
        </div>
      ) : !schedule ? (
        <div className="panel">
          <div className="panel-sub">{t('schedule.loading')}</div>
        </div>
      ) : (
        <>
          {/* ---------------- Tracked episodes ---------------- */}
          <div className="panel sched-episodes">
            <h3>{t('schedule.episodes')}</h3>
            <div className="panel-sub">
              {t('schedule.episodesSub', { count: schedule.counts.airingEntries })}
            </div>

            {byDay.length === 0 ? (
              <div className="hint">{t('schedule.noEpisodes')}</div>
            ) : (
              byDay.map(([key, episodes]) => (
                <div className="sched-day" key={key}>
                  <div className="sched-day-head">
                    <span className="sched-day-name">{fmt.dayLabel(episodes[0].airingAt)}</span>
                  </div>
                  {episodes.map((e) => (
                    <div className="sched-row" key={`${e.anilistId}-${e.episode}-${e.airingAt}`}>
                      <span className="sched-time">{fmt.timeLabel(e.airingAt)}</span>
                      {e.coverImage ? (
                        <img className="sched-cover" src={e.coverImage} alt="" loading="lazy" />
                      ) : (
                        <div className="sched-cover placeholder" />
                      )}
                      <span className="sched-title">{e.title}</span>
                      <span className="pill">{t('schedule.episode', { number: e.episode })}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* ---------------- Announced continuations ---------------- */}
          <div className="panel sched-seasons">
            <h3>{t('schedule.seasons')}</h3>
            <div className="panel-sub">{t('schedule.seasonsSub')}</div>

            {schedule.seasons.length === 0 ? (
              <div className="hint">{t('schedule.noSeasons')}</div>
            ) : (
              schedule.seasons.map((s) => <SeasonRow key={s.seasonId} season={s} />)
            )}
          </div>

          {/* ---------------- Discovery ---------------- */}
          <div className="panel sched-discovery">
            <h3>{t('schedule.discovery')}</h3>
            <div className="panel-sub">{t('schedule.discoverySub')}</div>
            <div className="toolbar" style={{ marginBottom: 12 }}>
              <button className="btn sm" onClick={() => setShowDiscovery((v) => !v)}>
                {showDiscovery ? t('schedule.hideDiscovery') : t('schedule.showDiscovery')}
              </button>
              <span className="hint">{t('schedule.discoveryCount', { count: schedule.discovery.length })}</span>
            </div>
            {showDiscovery &&
              (schedule.discovery.length === 0 ? (
                <div className="hint">{t('schedule.noDiscovery')}</div>
              ) : (
                schedule.discovery.slice(0, 30).map((d) => (
                  <div className="sched-row" key={`${d.anilistId}-${d.episode}`}>
                    <span className="sched-time">{fmt.timeLabel(d.airingAt)}</span>
                    {d.coverImage ? (
                      <img className="sched-cover" src={d.coverImage} alt="" loading="lazy" />
                    ) : (
                      <div className="sched-cover placeholder" />
                    )}
                    <span className="sched-title">{d.title}</span>
                    <span className="pill">{t('schedule.episode', { number: d.episode })}</span>
                    <span className="sched-date">{fmt.dayLabel(d.airingAt)}</span>
                  </div>
                ))
              ))}
          </div>

          {!hasAnything && <div className="hint">{t('schedule.nothingAtAll')}</div>}
        </>
      )}
    </>
  )
}

/**
 * One announced continuation.
 *
 * The date is shown at the precision AniList actually provides, and says so when
 * it only knows the broadcast season. Implying a day that is not known would be
 * worse than admitting the gap.
 */
function SeasonRow({ season }: { season: UpcomingSeason }): ReactNode {
  const { t } = useI18n()

  const dateLabel = ((): string => {
    if (season.precision === 'day' && season.startDate) {
      return new Date(`${season.startDate}T00:00:00`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })
    }
    if (season.precision === 'month' && season.startDate) {
      const [year, month] = season.startDate.split('-')
      return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric'
      })
    }
    if (season.precision === 'year' && season.startDate) return season.startDate
    return t('schedule.dateUnknown')
  })()

  return (
    <div className="sched-row">
      <span className={`sched-date${season.precision === 'none' ? ' vague' : ''}`}>
        {dateLabel}
      </span>
      <span className="sched-title">
        {season.title}
        <span className="sched-after">
          {' '}
          {t('schedule.after', { title: season.fromTitle })}
        </span>
      </span>
      {season.precision !== 'day' && (
        <span className="pill" title={t('schedule.imprecise')}>
          {t('schedule.approximate')}
        </span>
      )}
      {season.status === 'RELEASING' && <span className="pill good">{t('schedule.airing')}</span>}
    </div>
  )
}
