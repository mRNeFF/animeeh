/**
 * The element picker: one place that catalogues what a tier list can be made of.
 *
 * What it offers depends on the list's kind, and so does the cost. Anime and
 * seasons come from the library and appear instantly. Characters and themes have
 * to be fetched, so they are behind a button and report progress; a library of
 * seventy costs about a minute for themes, because AnimeThemes is asked once per
 * anime. Soundtracks have no source at all, so the picker says why and takes a
 * typed title rather than showing an empty panel.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { useStore } from '../store'
import { addItems, itemsFromAnime, itemsFromSeasons } from '../tierlist'
import { newId, type Anime, type TierItem, type TierList, type TierListKind } from '../types'
import { IconClose, IconPlus, IconSearch } from './Icons'

/** How many entries are sent per theme request, so progress can be reported. */
const THEME_BATCH = 6

interface Props {
  list: TierList
  onAdd: (items: TierItem[]) => void
  onClose: () => void
}

/** A short line under a candidate, from whatever the item carries. */
function itemSubtitle(item: TierItem): string {
  return item.sublabel
}

export function TierItemPicker({ list, onAdd, onClose }: Props): ReactNode {
  const { t } = useI18n()
  const { data } = useStore()

  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<TierItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [note, setNote] = useState('')
  const [ostTitle, setOstTitle] = useState('')

  const labels: Record<TierListKind, string> = {
    anime: t('tierlist.kind.anime'),
    season: t('tierlist.kind.season'),
    character: t('tierlist.kind.character'),
    op: t('tierlist.kind.op'),
    ed: t('tierlist.kind.ed'),
    ost: t('tierlist.kind.ost')
  }

  /** Entries that carry an AniList id, which is what the fetches need. */
  const linked = useMemo(
    () =>
      data.anime.flatMap((entry) => {
        const anilistId = entry.source?.anilistId
        if (typeof anilistId !== 'number' || !Number.isSafeInteger(anilistId)) return []
        return [{ entry, anilistId }]
      }),
    [data.anime]
  )

  /** Already in the list, so a candidate can say so and not be offered twice. */
  const present = useMemo(() => {
    const ids = new Set<number>()
    const labels2 = new Set<string>()
    for (const item of list.items) {
      if (item.anilistId) ids.add(item.anilistId)
      labels2.add(item.label.toLowerCase())
    }
    return { ids, labels: labels2 }
  }, [list.items])

  const isPresent = (item: TierItem): boolean =>
    item.anilistId ? present.ids.has(item.anilistId) : present.labels.has(item.label.toLowerCase())

  /* ---- Sources that need no network ---- */

  const localCandidates = useMemo((): TierItem[] => {
    if (list.kind === 'anime') return itemsFromAnime(data.anime, data.settings.weights)
    if (list.kind === 'season') return itemsFromSeasons(data.anime)
    return []
  }, [list.kind, data.anime, data.settings.weights])

  const source = candidates ?? (list.kind === 'anime' || list.kind === 'season' ? localCandidates : [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = source
    const filtered = q === '' ? all : all.filter((item) => item.label.toLowerCase().includes(q))
    // Most relevant first, and anything already present last.
    return [...filtered].sort((a, b) => {
      const ap = isPresent(a) ? 1 : 0
      const bp = isPresent(b) ? 1 : 0
      if (ap !== bp) return ap - bp
      return a.label.localeCompare(b.label)
    })
    // isPresent closes over `present`, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, query, present])

  /* ---- Characters, from AniList ---- */

  const loadCharacters = async (): Promise<void> => {
    setBusy(true)
    setNote('')
    setCandidates([])
    const collected: TierItem[] = []
    try {
      for (let i = 0; i < linked.length; i += 20) {
        const slice = linked.slice(i, i + 20)
        setProgress({ done: i, total: linked.length })
        const outcome = await window.animeeh.tierCharacters(
          slice.map(({ entry, anilistId }) => ({ anilistId, animeId: entry.id }))
        )
        if (!outcome.ok) {
          setNote(outcome.detail ?? outcome.error)
          break
        }
        const byAnime = new Map<string, Anime>(slice.map(({ entry }) => [entry.id, entry]))
        for (const character of outcome.data.characters) {
          collected.push({
            id: newId(),
            label: character.name,
            sublabel: byAnime.get(character.animeId)?.title ?? '',
            image: character.image ?? undefined,
            rowId: null,
            animeId: character.animeId,
            anilistId: character.anilistId
          })
        }
        // Streamed rather than waited on: the first batch is useful on its own,
        // and a screen that stays empty until the last request looks broken.
        setCandidates([...collected])
      }
      setNote(
        collected.length === 0 ? t('tierlist.picker.none') : `${collected.length}`
      )
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  /* ---- Themes, from AnimeThemes ---- */

  /**
   * The slowest path: AnimeThemes is keyed on its own ids, so each entry costs a
   * search plus a confirmation, paced to about one request a second. For a library
   * of seventy that is a couple of minutes, which is why the results appear batch
   * by batch instead of all at the end.
   */
  const loadThemes = async (): Promise<void> => {
    setBusy(true)
    setNote('')
    setCandidates([])
    const wanted = list.kind === 'op' ? 'OP' : 'ED'
    const collected: TierItem[] = []
    let unmatched = 0
    let failed = false
    try {
      for (let i = 0; i < linked.length; i += THEME_BATCH) {
        const slice = linked.slice(i, i + THEME_BATCH)
        setProgress({ done: i, total: linked.length })
        const outcome = await window.animeeh.tierThemes(
          slice.map(({ entry, anilistId }) => ({ anilistId, title: entry.title }))
        )
        if (!outcome.ok) {
          setNote(outcome.detail ?? outcome.error)
          failed = true
          break
        }
        unmatched += outcome.data.unmatched
        const byAnime = new Map<string, Anime>(slice.map(({ entry }) => [entry.id, entry]))
        for (const theme of outcome.data.themes) {
          if (theme.type !== wanted) continue
          const entry = [...byAnime.values()].find(
            (candidate) => candidate.source?.anilistId === theme.anilistId
          )
          collected.push({
            id: newId(),
            label: theme.title,
            sublabel: [theme.slug, ...theme.artists].filter(Boolean).join(' · '),
            // The show's cover, not a video frame: AnimeThemes serves WebM files
            // with no poster image, so the cover is the only thing that can be
            // shown — and it says which anime the song belongs to.
            image: entry?.coverImage,
            rowId: null,
            animeId: entry?.id,
            // The song title is the identity, not the anime, so two openings of
            // the same show stay distinct and the same opening is not added twice.
            anilistId: undefined
          })
        }
        setCandidates([...collected])
        setNote(
          `${t('tierlist.picker.loaded', { themes: collected.length, anime: i + slice.length })}${
            unmatched > 0 ? ` · ${t('tierlist.picker.unmatched', { count: unmatched })}` : ''
          }`
        )
      }
      if (!failed && collected.length === 0) setNote(t('tierlist.picker.none'))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const addOne = (item: TierItem): void => {
    if (isPresent(item)) return
    onAdd([item])
  }

  const addAll = (): void => {
    const fresh = visible.filter((item) => !isPresent(item))
    if (fresh.length === 0) return
    onAdd(fresh)
    setNote(t('tierlist.picker.added', { count: fresh.length }))
  }

  const addOst = (): void => {
    const title = ostTitle.trim()
    if (title === '') return
    onAdd([
      { id: newId(), label: title, sublabel: list.name, rowId: null, image: undefined }
    ])
    setOstTitle('')
  }

  const needsFetch = list.kind === 'character' || list.kind === 'op' || list.kind === 'ed'
  const canFetch = list.kind === 'character' ? linked.length > 0 : linked.length > 0

  return (
    <aside className="tl-picker">
      <div className="tl-picker-head">
        <span className="t">{t('tierlist.picker.title')}</span>
        <span className="pill">{labels[list.kind]}</span>
        <span className="grow" />
        <button className="icon-btn" title={t('tierlist.picker.close')} onClick={onClose}>
          <IconClose size={15} />
        </button>
      </div>

      {list.kind === 'ost' ? (
        <>
          <div className="note">{t('tierlist.picker.ostWhy')}</div>
          <input
            className="input"
            placeholder={t('tierlist.picker.ostLabel')}
            value={ostTitle}
            onChange={(event) => setOstTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addOst()
            }}
          />
          <button className="btn primary" onClick={addOst} disabled={ostTitle.trim() === ''}>
            <IconPlus size={14} /> {t('tierlist.picker.ostAdd')}
          </button>
          <OstAlready list={list} onRemove={() => undefined} />
        </>
      ) : (
        <>
          <div className="tl-search">
            <IconSearch size={14} />
            <input
              className="input"
              placeholder={t('tierlist.picker.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {needsFetch && (
            <button className="btn primary" onClick={list.kind === 'character' ? loadCharacters : loadThemes} disabled={busy || !canFetch}>
              {busy ? t('tierlist.picker.loading') : list.kind === 'character' ? t('tierlist.picker.characters') : t('tierlist.picker.load')}
            </button>
          )}

          {progress && (
            <div>
              <div className="progress">
                <i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {progress.done} / {progress.total} · {t('tierlist.picker.step')}
              </div>
            </div>
          )}

          {note !== '' && <div className="hint">{note}</div>}

          <div className="tl-picker-actions">
            <span className="hint">{t('tierlist.picker.library')} · {visible.length}</span>
            <span className="grow" />
            <button className="btn sm" onClick={addAll} disabled={visible.length === 0}>
              {t('tierlist.picker.all', { count: visible.filter((i) => !isPresent(i)).length })}
            </button>
          </div>

          <div className="tl-results">
            {visible.length === 0 ? (
              <div className="hint">{t('tierlist.picker.none')}</div>
            ) : (
              visible.slice(0, 120).map((item) => {
                const already = isPresent(item)
                return (
                  <button
                    key={item.id}
                    className={`tl-res${already ? ' on' : ''}`}
                    onClick={() => addOne(item)}
                    disabled={already}
                    title={already ? `${item.label} — ${t('tierlist.picker.added', { count: 1 })}` : item.label}
                  >
                    {item.image ? (
                      <img className="art" src={item.image} alt="" loading="lazy" draggable={false} />
                    ) : (
                      <span className="art empty" />
                    )}
                    <span className="txt">
                      <span className="a">{item.label}</span>
                      <span className="b">{itemSubtitle(item)}</span>
                    </span>
                    {!already && <IconPlus size={13} />}
                  </button>
                )
              })
            )}
          </div>
        </>
      )}
    </aside>
  )
}

/** The tracks already typed in, so the panel is not just an empty field. */
function OstAlready({ list, onRemove }: { list: TierList; onRemove: () => void }): ReactNode {
  void onRemove
  if (list.items.length === 0) return null
  return (
    <div className="tl-results" style={{ marginTop: 4 }}>
      {list.items.map((item) => (
        <div key={item.id} className="tl-res on">
          <span className="art empty" />
          <span className="txt">
            <span className="a">{item.label}</span>
            <span className="b">{item.sublabel}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

/** Re-exported so the view can build the same elements without a second import. */
export { addItems }
