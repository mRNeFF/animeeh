import { useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { applySeasonSpans, grade } from '../scoring'
import type { Anime, Episode } from '../types'
import { GradeBadge, ScoreControl } from './ui'
import { IconTrash } from './Icons'

interface SeasonGroup {
  season: number
  /** Season title from the reference source, when known. */
  title: string | null
  year: number | null
  /** Episode count the source declares for this season. */
  declared: number | null
  episodes: Episode[]
}

/**
 * Group episodes into their seasons.
 *
 * Seasons come from the reference data when present; otherwise they are derived
 * from the episodes themselves, so a hand-entered anime with a single season
 * still gets one group.
 */
function buildGroups(anime: Anime, ordered: Episode[]): SeasonGroup[] {
  const seasons = anime.seasons && anime.seasons.length > 0 ? anime.seasons : undefined
  const withSeasons = applySeasonSpans(ordered, seasons)

  const bySeason = new Map<number, Episode[]>()
  for (const episode of withSeasons) {
    const key = episode.season ?? 1
    const list = bySeason.get(key)
    if (list) list.push(episode)
    else bySeason.set(key, [episode])
  }

  // A season declared by the source but with no episodes yet must still show.
  for (const s of seasons ?? []) {
    if (!bySeason.has(s.season)) bySeason.set(s.season, [])
  }

  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, episodes]) => {
      const meta = seasons?.find((s) => s.season === season)
      return {
        season,
        title: meta?.title ?? null,
        year: meta?.year ?? null,
        declared: meta?.episodes ?? null,
        episodes
      }
    })
}

/** Average of the rated episodes in one group, or null. */
function groupAverage(episodes: Episode[]): number | null {
  const rated = episodes.filter((e) => e.score !== null && Number.isFinite(e.score))
  if (rated.length === 0) return null
  return rated.reduce((sum, e) => sum + (e.score as number), 0) / rated.length
}

export function EpisodeSeasons({
  anime,
  ordered,
  hue,
  onUpdateEpisode,
  onRemoveEpisode
}: {
  anime: Anime
  ordered: Episode[]
  hue: number
  onUpdateEpisode: (id: string, patch: Partial<Episode>) => void
  onRemoveEpisode: (id: string) => void
}): ReactNode {
  const { t } = useI18n()
  const groups = useMemo(() => buildGroups(anime, ordered), [anime, ordered])

  // First season open by default; the rest wait, so a long franchise does not
  // dump hundreds of rows at once.
  const [open, setOpen] = useState<Set<number>>(() => new Set(groups.slice(0, 1).map((g) => g.season)))

  const toggle = (season: number): void =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(season)) next.delete(season)
      else next.add(season)
      return next
    })

  const allOpen = groups.every((g) => open.has(g.season))
  const toggleAll = (): void =>
    setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.season)))

  return (
    <div className="seasons">
      {groups.length > 1 && (
        <div className="seasons-toolbar">
          <span className="hint">
            {t('season.count', { count: groups.length })}
          </span>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={toggleAll}>
            {allOpen ? t('season.collapseAll') : t('season.expandAll')}
          </button>
        </div>
      )}

      {groups.map((group) => {
        const isOpen = open.has(group.season)
        const avg = groupAverage(group.episodes)
        const rated = group.episodes.filter((e) => e.score !== null).length
        const g = grade(avg)

        return (
          <section className="season-block" key={group.season}>
            <button
              type="button"
              className={`season-header${isOpen ? ' open' : ''}`}
              onClick={() => toggle(group.season)}
              aria-expanded={isOpen}
            >
              <span className="season-caret">{isOpen ? '▾' : '▸'}</span>
              <span className="season-badge">S{group.season}</span>
              <span className="season-name">
                {group.title ?? t('season.label', { number: group.season })}
              </span>
              <span className="season-meta">
                {[
                  group.year,
                  group.declared !== null
                    ? t('season.declared', { count: group.declared })
                    : group.episodes.length > 0
                      ? t('season.declared', { count: group.episodes.length })
                      : null
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="spacer" />
              <span className="season-progress">
                {t('season.rated', { rated, total: group.episodes.length })}
              </span>
              {avg !== null && (
                <>
                  <span className="season-avg">{t('season.avg', { value: avg.toFixed(1) })}</span>
                  <GradeBadge
                    letter={g.letter}
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
                </>
              )}
            </button>

            {isOpen &&
              (group.episodes.length === 0 ? (
                <div className="season-empty">{t('season.noEpisodes')}</div>
              ) : (
                <div className="season-body">
                  <div className="ep-row ep-head">
                    <div className="hint">{t('diff.epHeader')}</div>
                    <div className="hint">{t('diff.titleHeader')}</div>
                    <div className="hint">{t('diff.scoreHeader')}</div>
                    <div className="hint" style={{ textAlign: 'center' }}>
                      0–100
                    </div>
                    <div />
                  </div>

                  {group.episodes.map((ep) => (
                    <div className="ep-row" key={ep.id}>
                      <div className="ep-num">{ep.number}</div>
                      <input
                        className="ep-title"
                        placeholder={t('form.episodePlaceholder', { number: ep.number })}
                        value={ep.title ?? ''}
                        onChange={(e) =>
                          onUpdateEpisode(ep.id, { title: e.target.value || undefined })
                        }
                      />
                      <ScoreControl
                        hue={hue}
                        value={ep.score}
                        onChange={(v) => onUpdateEpisode(ep.id, { score: v })}
                      />
                      <div style={{ textAlign: 'center' }}>
                        <GradeBadge
                          letter={grade(ep.score).letter}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            fontSize: 13,
                            margin: '0 auto'
                          }}
                        />
                      </div>
                      <button
                        className="btn ghost sm"
                        title={t('action.remove')}
                        onClick={() => onRemoveEpisode(ep.id)}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
          </section>
        )
      })}
    </div>
  )
}
