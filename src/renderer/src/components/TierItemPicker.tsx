/**
 * The picker: one search bar that catalogues everything.
 *
 * The first version asked which kind of list you wanted before showing anything,
 * which put a decision in front of the user before they had anything to decide
 * with and made a mixed ranking impossible. This one searches the whole AniList
 * catalogue and narrows with filters, per search rather than once and for all, so
 * a single list can hold an anime, two of its characters and its opening.
 *
 * The filters exist because the sources cost different things:
 *
 *   anime       AniList, one request, returns everything a tile needs
 *   characters  AniList, in the SAME request as the anime, since both searches
 *               fit in one GraphQL query
 *   seasons     the library, no request at all
 *   themes      AnimeThemes, and this is the expensive one; see below
 *   ost         no source anywhere
 *
 * Themes are the awkward case. AnimeThemes' own search covers song titles, but its
 * results carry no links at all — a theme comes back as `{id, sequence, slug,
 * type}`, with no song and no anime — so one request per theme would be needed to
 * label them. Asking for the themes of an anime instead costs one request for the
 * whole show, so the filter searches anime and opens their themes.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { useStore } from '../store'
import { itemsFromSeasons } from '../tierlist'
import type { TierAnime, TierCharacter, TierTheme } from '../../../shared/tierlist'
import {
  newId,
  type TierItem,
  type TierList,
  type TierSourceKind
} from '../types'
import { IconClose, IconPlus, IconSearch } from './Icons'

/** How long the box waits before searching, so a typed word costs one request. */
const DEBOUNCE_MS = 420

type Filter = 'all' | 'anime' | 'season' | 'character' | 'theme' | 'ost'

interface Props {
  list: TierList
  onAdd: (items: TierItem[]) => void
  onClose: () => void
}

export function TierItemPicker({ list, onAdd, onClose }: Props): ReactNode {
  const { t } = useI18n()
  const { data } = useStore()

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [note, setNote] = useState('')
  const [anime, setAnime] = useState<TierAnime[]>([])
  const [characters, setCharacters] = useState<TierCharacter[]>([])
  /** Themes per AniList id, filled in when an anime is opened. */
  const [themes, setThemes] = useState<Map<number, TierTheme[]>>(new Map())
  const [openThemes, setOpenThemes] = useState<Set<number>>(new Set())
  const [loadingThemes, setLoadingThemes] = useState<number | null>(null)
  const [ostTitle, setOstTitle] = useState('')

  /** The library ids the search needs, so a result can say it is already tracked. */
  const tracked = useMemo(
    () =>
      data.anime.flatMap((entry) => {
        const anilistId = entry.source?.anilistId
        if (typeof anilistId !== 'number' || !Number.isSafeInteger(anilistId)) return []
        return [{ anilistId, id: entry.id }]
      }),
    [data.anime]
  )

  /**
   * The search itself, debounced.
   *
   * Results are ignored if the query changed while the request was in flight, so a
   * fast typist cannot end up looking at the results of an earlier prefix.
   */
  const requestId = useRef(0)
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setAnime([])
      setCharacters([])
      setSearching(false)
      return
    }

    setSearching(true)
    const id = ++requestId.current
    const timer = setTimeout(() => {
      window.animeeh
        .tierSearch(trimmed, tracked)
        .then((outcome) => {
          if (id !== requestId.current) return
          if (!outcome.ok) {
            setNote(outcome.detail ?? outcome.error)
            setAnime([])
            setCharacters([])
            return
          }
          setNote('')
          setAnime(outcome.data.anime)
          setCharacters(outcome.data.characters)
        })
        .catch(() => {
          if (id === requestId.current) setNote(t('error.unreachable', { service: t('service.anilist') }))
        })
        .finally(() => {
          if (id === requestId.current) setSearching(false)
        })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
    // `tracked` is read inside but changing it should not re-search, so it is
    // deliberately left out of the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  /* ---- Already in the list, so nothing is offered twice ---- */

  const present = useMemo(() => {
    const ids = new Set<string>()
    for (const item of list.items) {
      // The label plus the kind, because two openings of one show share a show
      // and two characters of one show share a title.
      ids.add(`${item.kind ?? '?'}::${item.label.toLowerCase()}`)
      if (item.anilistId !== undefined && item.kind !== 'theme') {
        ids.add(`${item.kind ?? '?'}::a:${item.anilistId}`)
      }
    }
    return ids
  }, [list.items])

  const keyOf = (kind: TierSourceKind, label: string, anilistId?: number): string =>
    anilistId !== undefined && kind !== 'theme'
      ? `${kind}::a:${anilistId}`
      : `${kind}::${label.toLowerCase()}`

  const isPresent = (kind: TierSourceKind, label: string, anilistId?: number): boolean =>
    present.has(keyOf(kind, label, anilistId))

  /* ---- Elements built from each source ---- */

  const animeToItem = (entry: TierAnime): TierItem => ({
    id: newId(),
    label: entry.title,
    sublabel: [entry.year ? String(entry.year) : null, entry.episodes ? `${entry.episodes} ep.` : null]
      .filter(Boolean)
      .join(' · '),
    image: entry.image ?? undefined,
    rowId: null,
    kind: 'anime',
    animeId: entry.libraryId ?? undefined,
    anilistId: entry.anilistId
  })

  const characterToItem = (character: TierCharacter): TierItem => ({
    id: newId(),
    label: character.name,
    sublabel: character.animeTitle ?? '',
    image: character.image ?? undefined,
    rowId: null,
    kind: 'character',
    anilistId: character.anilistId
  })

  const themeToItem = (theme: TierTheme, cover: string | null | undefined, entry: TierAnime): TierItem => ({
    id: newId(),
    label: theme.title,
    sublabel: [theme.slug, ...theme.artists].filter(Boolean).join(' · '),
    // The show's cover, not a video frame: AnimeThemes serves WebM files with no
    // poster image, so the cover is the only thing that can be shown — and it says
    // which anime the song belongs to.
    image: cover ?? undefined,
    rowId: null,
    kind: 'theme',
    animeId: entry.libraryId ?? undefined,
    anilistId: undefined
  })

  /* ---- Seasons, which need no network ---- */

  const seasons = useMemo(() => {
    const all = itemsFromSeasons(data.anime).map((item) => ({ ...item, kind: 'season' as const }))
    const q = query.trim().toLowerCase()
    return q === '' ? all : all.filter((item) => item.label.toLowerCase().includes(q))
  }, [data.anime, query])

  /* ---- Opening an anime's themes ---- */

  const loadThemesFor = async (entry: TierAnime): Promise<void> => {
    setLoadingThemes(entry.anilistId)
    try {
      const outcome = await window.animeeh.tierThemes([{ anilistId: entry.anilistId, title: entry.title }])
      if (!outcome.ok) {
        setNote(outcome.detail ?? outcome.error)
        return
      }
      setThemes((current) => new Map(current).set(entry.anilistId, outcome.data.themes))
      if (outcome.data.themes.length === 0) {
        setNote(t('tierlist.picker.noThemes'))
      }
    } finally {
      setLoadingThemes(null)
    }
  }

  const toggleThemes = async (entry: TierAnime): Promise<void> => {
    const next = new Set(openThemes)
    if (next.has(entry.anilistId)) {
      next.delete(entry.anilistId)
      setOpenThemes(next)
      return
    }
    next.add(entry.anilistId)
    setOpenThemes(next)
    if (!themes.has(entry.anilistId)) await loadThemesFor(entry)
  }

  /* ---- What the current filter shows ---- */

  const showAnime = filter === 'all' || filter === 'anime' || filter === 'theme'
  const showCharacters = filter === 'all' || filter === 'character'
  const showSeasons = filter === 'season'
  const showOst = filter === 'ost'

  const sections: { key: Filter; title: string; count: number; themeMode: boolean }[] = []
  // In the theme filter the same anime list is shown, but each row opens its
  // themes instead of adding the show. The flag is carried on the section rather
  // than re-read from the filter, because the section is built once and the flag
  // is what the row rendering branches on.
  const themeMode = filter === 'theme'
  if (showAnime && anime.length > 0) {
    sections.push({
      key: 'anime',
      title: themeMode ? t('tierlist.filter.theme') : t('tierlist.filter.anime'),
      count: anime.length,
      themeMode
    })
  }
  if (showCharacters && characters.length > 0) {
    sections.push({ key: 'character', title: t('tierlist.filter.character'), count: characters.length, themeMode: false })
  }
  if (showSeasons && seasons.length > 0) {
    sections.push({ key: 'season', title: t('tierlist.filter.season'), count: seasons.length, themeMode: false })
  }

  const nothing =
    note === '' &&
    !searching &&
    !showOst &&
    (showSeasons ? seasons.length === 0 : anime.length === 0 && characters.length === 0)
  const needsQuery = !showSeasons && !showOst && query.trim().length < 2

  const addAllAnime = (): void => {
    const fresh = anime.filter((entry) => !isPresent('anime', entry.title, entry.anilistId))
    if (fresh.length > 0) onAdd(fresh.map(animeToItem))
  }

  return (
    <aside className="tl-picker">
      <div className="tl-picker-head">
        <span className="t">{t('tierlist.picker.title')}</span>
        <span className="grow" />
        <button className="icon-btn" title={t('tierlist.picker.close')} onClick={onClose}>
          <IconClose size={15} />
        </button>
      </div>

      <div className="tl-search">
        <IconSearch size={14} />
        <input
          className="input"
          autoFocus
          placeholder={t('tierlist.picker.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {searching && <span className="tl-search-spin" />}
      </div>

      {/* The filters narrow one search rather than deciding a list's nature. */}
      <div className="tl-filters">
        {(['all', 'anime', 'character', 'season', 'theme', 'ost'] as Filter[]).map((key) => (
          <button
            key={key}
            className={`tl-filter${filter === key ? ' on' : ''}`}
            onClick={() => setFilter(key)}
          >
            {t(`tierlist.filter.${key}`)}
          </button>
        ))}
      </div>

      {note !== '' && <div className="hint">{note}</div>}

      {showOst ? (
        <>
          <div className="note">{t('tierlist.picker.ostWhy')}</div>
          <input
            className="input"
            placeholder={t('tierlist.picker.ostLabel')}
            value={ostTitle}
            onChange={(event) => setOstTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const title = ostTitle.trim()
                if (title === '') return
                onAdd([{ id: newId(), label: title, sublabel: list.name, rowId: null, kind: 'ost' }])
                setOstTitle('')
              }
            }}
          />
          <button
            className="btn primary"
            disabled={ostTitle.trim() === ''}
            onClick={() => {
              const title = ostTitle.trim()
              if (title === '') return
              onAdd([{ id: newId(), label: title, sublabel: list.name, rowId: null, kind: 'ost' }])
              setOstTitle('')
            }}
          >
            <IconPlus size={14} /> {t('tierlist.picker.ostAdd')}
          </button>
        </>
      ) : needsQuery ? (
        <div className="hint">{t('tierlist.picker.typeToSearch')}</div>
      ) : nothing ? (
        <div className="hint">{t('tierlist.picker.none')}</div>
      ) : (
        <div className="tl-results">
          {sections.map((section) => (
            <div className="tl-section" key={section.key}>
              <div className="tl-section-head">
                <span className="t">
                  {section.title} · {section.count}
                </span>
                <span className="grow" />
                {section.key === 'anime' && !section.themeMode && (
                  <button className="btn sm" onClick={addAllAnime}>
                    {t('tierlist.picker.all', { count: section.count })}
                  </button>
                )}
              </div>

              {section.key === 'season' &&
                seasons.slice(0, 120).map((item) => (
                  <Result
                    key={item.id}
                    image={item.image}
                    title={item.label}
                    sub={item.sublabel}
                    added={isPresent('season', item.label, item.anilistId)}
                    onAdd={() => onAdd([item])}
                  />
                ))}

              {section.key === 'character' &&
                characters.slice(0, 60).map((character) => (
                  <Result
                    key={character.anilistId}
                    image={character.image}
                    title={character.name}
                    sub={character.animeTitle ?? ''}
                    added={isPresent('character', character.name, character.anilistId)}
                    onAdd={() => onAdd([characterToItem(character)])}
                  />
                ))}

              {(section.key === 'anime' || section.key === 'theme') &&
                anime.slice(0, 60).map((entry) => {
                  const entryThemes = themes.get(entry.anilistId)
                  const open = openThemes.has(entry.anilistId)
                  return (
                    <div key={entry.anilistId}>
                      <Result
                        image={entry.image}
                        title={entry.title}
                        sub={[
                          [entry.format, entry.year].filter(Boolean).join(' '),
                          entry.episodes ? `${entry.episodes} ep.` : null,
                          entry.inLibrary ? t('tierlist.picker.tracked') : null
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        added={!section.themeMode && isPresent('anime', entry.title, entry.anilistId)}
                        onAdd={() => onAdd([animeToItem(entry)])}
                        // In the theme filter, the whole point is the sub-list, so
                        // the row opens it rather than adding the show itself.
                        extra={
                          section.themeMode ? (
                            <button
                              className="tl-open"
                              onClick={() => toggleThemes(entry)}
                              title={t('tierlist.picker.themes')}
                            >
                              {loadingThemes === entry.anilistId ? '…' : open ? '▴' : '▾'}
                            </button>
                          ) : undefined
                        }
                      />

                      {section.themeMode && open && (
                        <div className="tl-themes">
                          {entryThemes === undefined ? (
                            <span className="hint">{t('tierlist.picker.loading')}</span>
                          ) : entryThemes.length === 0 ? (
                            <span className="hint">{t('tierlist.picker.noThemes')}</span>
                          ) : (
                            <>
                              {entryThemes.map((theme) => (
                                <Result
                                  key={`${entry.anilistId}-${theme.slug}`}
                                  image={entry.image}
                                  title={theme.title}
                                  sub={[theme.slug, ...theme.artists].filter(Boolean).join(' · ')}
                                  added={isPresent('theme', theme.title)}
                                  onAdd={() => onAdd([themeToItem(theme, entry.image, entry)])}
                                />
                              ))}
                              <button
                                className="btn sm"
                                onClick={() =>
                                  onAdd(
                                    entryThemes
                                      .filter((theme) => !isPresent('theme', theme.title))
                                      .map((theme) => themeToItem(theme, entry.image, entry))
                                  )
                                }
                              >
                                {t('tierlist.picker.all', { count: entryThemes.length })}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

/** One candidate row: picture, two lines of text, and an add button. */
function Result({
  image,
  title,
  sub,
  added,
  onAdd,
  extra
}: {
  image: string | null | undefined
  title: string
  sub: string
  added: boolean
  onAdd: () => void
  extra?: ReactNode
}): ReactNode {
  const { t } = useI18n()
  return (
    <div className={`tl-res${added ? ' on' : ''}`}>
      <button
        className="tl-res-main"
        onClick={onAdd}
        disabled={added}
        title={added ? t('tierlist.picker.alreadyAdded') : title}
      >
        {image ? (
          <img className="art" src={image} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="art empty" />
        )}
        <span className="txt">
          <span className="a">{title}</span>
          {sub !== '' && <span className="b">{sub}</span>}
        </span>
        {!added && <IconPlus size={13} />}
      </button>
      {extra}
    </div>
  )
}
