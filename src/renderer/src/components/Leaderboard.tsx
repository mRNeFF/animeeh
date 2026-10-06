import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { criterionKey, useI18n } from '../i18n'
import { grade, rankAnime, scoreParts } from '../scoring'
import { highlightSegments, includesQuery } from '../search'
import { useStore } from '../store'
import { GradeBadge } from './ui'
import { IconChevronDown, IconChevronUp, IconClose, IconSearch } from './Icons'
import { CRITERIA, isFilmLike, isMovie, type Anime, type ComponentKey } from '../types'

type SortKey = 'rank' | ComponentKey
type Dir = 'asc' | 'desc'

/** Which pool the ranking is computed over. */
type Scope = 'global' | 'series' | 'film'

function scopeFilter(scope: Scope): (anime: Anime) => boolean {
  if (scope === 'global') return () => true
  if (scope === 'film') return isFilmLike
  return (anime) => !isFilmLike(anime)
}

/**
 * The nearest ancestor that actually scrolls vertically.
 *
 * `row.scrollIntoView({ block: 'center' })` was tried first and landed the row
 * around 150px below the middle: the table wrapper scrolls horizontally, which
 * makes it a scrollport, so the browser centred the row inside *that* — where
 * there is nothing to scroll — rather than inside the page. Walking up to the
 * first ancestor with real vertical overflow skips it and is independent of
 * class names.
 */
function scrollingParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * Renders `text` with the parts matching `query` wrapped in `<mark>`.
 *
 * Returns the text untouched when there is no query, so the common case adds no
 * markup to the table.
 */
function Highlighted({ text, query }: { text: string; query: string }): ReactNode {
  if (query.trim() === '') return <>{text}</>
  return (
    <>
      {highlightSegments(text, query).map((segment, index) =>
        segment.match
          ? <mark key={index}>{segment.text}</mark>
          : <span key={index}>{segment.text}</span>
      )}
    </>
  )
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

  /**
   * The find bar highlights rather than filters, so the ranking keeps its order
   * and the reader keeps their place in it.
   */
  const [find, setFind] = useState('')
  const [current, setCurrent] = useState(0)
  /**
   * Bumped by Enter and the step buttons so the centring effect runs again even
   * when nothing else changed. Without it a query with a single match left those
   * controls apparently dead: there is no next match to move to, and re-centring
   * is the only useful thing left to do.
   */
  const [nudge, setNudge] = useState(0)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const findInput = useRef<HTMLInputElement>(null)

  /**
   * `/` moves the focus into the find field, the way a page-level search usually
   * does. Ignored while a field already has focus, so a slash typed into an input
   * stays a literal slash.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return
        }
      }
      event.preventDefault()
      findInput.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

  /** Ids of the rows matching the query, in the order they are displayed. */
  const matchIds = useMemo(() => {
    const query = find.trim()
    if (query === '') return []
    return rows
      .filter(
        ({ entry }) =>
          includesQuery(entry.anime.title, query) ||
          includesQuery(entry.anime.englishTitle, query) ||
          includesQuery(entry.anime.studio, query)
      )
      .map(({ entry }) => entry.anime.id)
  }, [rows, find])

  const matchSet = useMemo(() => new Set(matchIds), [matchIds])

  /**
   * Taken modulo the number of matches so the position stays valid when the
   * query, the scope or the sort order changes the list under it.
   */
  const activeIndex =
    matchIds.length === 0 ? -1 : ((current % matchIds.length) + matchIds.length) % matchIds.length
  const activeId = activeIndex === -1 ? null : matchIds[activeIndex]

  /**
   * Bring the current match to the middle of the scrolling area. `center` is what
   * spares the reader from hunting for the row at the edge of the viewport, and
   * refreshing on `find` means refining the query re-centres the row it still
   * points at. A row near either end cannot be centred, and the browser clamps
   * the scroll there, which is the correct outcome.
   *
   * Instant rather than smooth: the jump is the point of typing, and an animation
   * on every keystroke reads as lag.
   */
  useEffect(() => {
    if (activeId === null) return
    const row = rowRefs.current.get(activeId)
    if (!row) return
    const container = scrollingParent(row)
    if (!container) return

    const rowBox = row.getBoundingClientRect()
    const areaBox = container.getBoundingClientRect()
    const delta = rowBox.top + rowBox.height / 2 - (areaBox.top + areaBox.height / 2)
    container.scrollTo({ top: container.scrollTop + delta })
  }, [activeId, find, nudge])

  /**
   * Moves to the next or previous match, wrapping around. With a single match
   * there is nowhere to move, so it only re-centres, which is what makes the
   * control feel alive rather than broken.
   */
  const step = (delta: number): void => {
    if (matchIds.length === 0) return
    if (matchIds.length > 1) setCurrent((index) => index + delta)
    setNudge((value) => value + 1)
  }

  const counts = useMemo(() => {
    const films = data.anime.filter(isFilmLike).length
    return { all: data.anime.length, films, series: data.anime.length - films }
  }, [data.anime])

  const tabs: { key: Scope; label: string; count: number }[] = [
    { key: 'global', label: t('board.tab.global'), count: counts.all },
    { key: 'series', label: t('board.tab.series'), count: counts.series },
    { key: 'film', label: t('board.tab.films'), count: counts.films }
  ]

  return (
    <>
      <div className="toolbar toolbar-sticky">
        <div className="find">
          <IconSearch size={14} />
          <input
            type="search"
            ref={findInput}
            value={find}
            placeholder={t('board.find')}
            aria-label={t('board.find')}
            onChange={(event) => {
              setFind(event.target.value)
              setCurrent(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                step(event.shiftKey ? -1 : 1)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                // Clearing first, then leaving the field: one Escape to undo the
                // search, a second to give the keyboard back to the page.
                if (find === '') findInput.current?.blur()
                else setFind('')
              }
            }}
          />
          {find.trim() === '' ? (
            <kbd className="find-kbd" title={t('board.findShortcut')}>
              /
            </kbd>
          ) : (
            <>
              <span className={`find-count${matchIds.length === 0 ? ' none' : ''}`}>
                {matchIds.length === 0
                  ? t('board.findNone')
                  : t('board.findCount', {
                      current: activeIndex + 1,
                      total: matchIds.length
                    })}
              </span>
              <button
                type="button"
                className="find-step"
                title={t('board.findPrev')}
                aria-label={t('board.findPrev')}
                disabled={matchIds.length === 0}
                onClick={() => step(-1)}
              >
                <IconChevronUp size={14} />
              </button>
              <button
                type="button"
                className="find-step"
                title={t('board.findNext')}
                aria-label={t('board.findNext')}
                disabled={matchIds.length === 0}
                onClick={() => step(1)}
              >
                <IconChevronDown size={14} />
              </button>
              <button
                type="button"
                className="find-step"
                title={t('board.findClear')}
                aria-label={t('board.findClear')}
                onClick={() => {
                  setFind('')
                  findInput.current?.focus()
                }}
              >
                <IconClose size={14} />
              </button>
            </>
          )}
        </div>
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
                  const isMatch = matchSet.has(entry.anime.id)
                  const isCurrent = entry.anime.id === activeId
                  // The English title is not normally on screen, so it is shown
                  // when it is the only thing the query matched.
                  const matchedEnglish =
                    find.trim() !== '' &&
                    !!entry.anime.englishTitle &&
                    includesQuery(entry.anime.englishTitle, find) &&
                    !includesQuery(entry.anime.title, find)
                  return (
                    <tr
                      key={entry.anime.id}
                      ref={(element) => {
                        if (element) rowRefs.current.set(entry.anime.id, element)
                        else rowRefs.current.delete(entry.anime.id)
                      }}
                      className={`clickable${isMatch ? ' row-match' : ''}${
                        isCurrent ? ' row-current' : ''
                      }`}
                      onClick={() => onOpen(entry.anime.id)}
                    >
                      <td className={`rank-cell${entry.rank > 0 && entry.rank <= 3 ? ' top' : ''}`}>
                        {entry.rank > 0 ? entry.rank : '—'}
                      </td>
                      <td>
                        <div className="t-title">
                          <Highlighted text={entry.anime.title} query={find} />
                          {isFilmLike(entry.anime) && (
                            <span className="film-tag">
                              {isMovie(entry.anime) ? t('form.film') : t('form.ova')}
                            </span>
                          )}
                        </div>
                        <div className="t-sub">
                          {entry.anime.year && (
                            <>
                              {entry.anime.year}
                              {entry.anime.studio ? ' · ' : ''}
                            </>
                          )}
                          {entry.anime.studio && (
                            <Highlighted text={entry.anime.studio} query={find} />
                          )}
                          {!entry.anime.year && !entry.anime.studio && t('board.noDetails')}
                          {/* Shown only when the English title is what matched, so
                              the highlight has something to point at. */}
                          {matchedEnglish && (
                            <>
                              {' · '}
                              <Highlighted text={entry.anime.englishTitle as string} query={find} />
                            </>
                          )}
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
