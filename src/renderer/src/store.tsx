import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { normaliseStore } from './scoring'
import {
  DEFAULT_SETTINGS,
  STORE_VERSION,
  type Anime,
  type Settings,
  type StoreData,
  type TierList
} from './types'

const EMPTY_STORE: StoreData = {
  version: STORE_VERSION,
  anime: [],
  tierLists: [],
  settings: DEFAULT_SETTINGS
}

interface StoreContextValue {
  data: StoreData
  loaded: boolean
  saving: boolean
  addAnime: (anime: Anime) => void
  /** Bulk append, used by the bundled list import. */
  addAnimeMany: (anime: Anime[]) => void
  updateAnime: (id: string, patch: Partial<Anime>) => void
  removeAnime: (id: string) => void
  /** Wipe every anime while keeping weights, language and preferences. */
  clearAnime: () => void
  updateSettings: (patch: Partial<Settings>) => void
  replaceAll: (data: StoreData) => void
  /** Tier lists. `updateTierList` takes a function so a caller can build on the
   *  current value without racing another update. */
  addTierList: (list: TierList) => void
  updateTierList: (id: string, next: (list: TierList) => TierList) => void
  removeTierList: (id: string) => void
}

const StoreContext = createContext<StoreContextValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [data, setData] = useState<StoreData>(EMPTY_STORE)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const lastSaved = useRef<string>('')

  // Load once from disk.
  useEffect(() => {
    let cancelled = false
    window.animeeh
      .load()
      .then((raw) => {
        if (cancelled) return
        const next = raw ? normaliseStore(raw) : EMPTY_STORE
        lastSaved.current = JSON.stringify(next)
        setData(next)
      })
      .catch((err) => {
        console.error('Failed to load ANIMEEH data', err)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Debounced persist — skips writes when nothing actually changed.
  useEffect(() => {
    if (!loaded) return
    const serialized = JSON.stringify(data)
    if (serialized === lastSaved.current) return
    setSaving(true)
    const timer = setTimeout(() => {
      window.animeeh
        .save(data)
        .then(() => {
          lastSaved.current = serialized
        })
        .catch((err) => console.error('Failed to save ANIMEEH data', err))
        .finally(() => setSaving(false))
    }, 350)
    return () => clearTimeout(timer)
  }, [data, loaded])

  const addAnime = useCallback((anime: Anime) => {
    setData((prev) => ({ ...prev, anime: [anime, ...prev.anime] }))
  }, [])

  const addAnimeMany = useCallback((list: Anime[]) => {
    if (list.length === 0) return
    setData((prev) => ({ ...prev, anime: [...prev.anime, ...list] }))
  }, [])

  const updateAnime = useCallback((id: string, patch: Partial<Anime>) => {
    setData((prev) => ({
      ...prev,
      anime: prev.anime.map((a) =>
        a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a
      )
    }))
  }, [])

  const removeAnime = useCallback((id: string) => {
    setData((prev) => ({ ...prev, anime: prev.anime.filter((a) => a.id !== id) }))
  }, [])

  /**
   * Removes every anime but keeps `settings`, so language, weights and
   * preferences survive a reset of the ranking.
   */
  const clearAnime = useCallback(() => {
    setData((prev) => ({ ...prev, anime: [] }))
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }))
  }, [])

  const replaceAll = useCallback((next: StoreData) => {
    setData(normaliseStore(next))
  }, [])

  const addTierList = useCallback((list: TierList) => {
    setData((prev) => ({ ...prev, tierLists: [list, ...prev.tierLists] }))
  }, [])

  /**
   * Applies a change to one tier list.
   *
   * Takes an updater rather than a finished list so two quick edits — dragging
   * two items in a row — both land, instead of the second overwriting the first
   * with a value read before it.
   */
  const updateTierList = useCallback((id: string, next: (list: TierList) => TierList) => {
    setData((prev) => {
      const index = prev.tierLists.findIndex((list) => list.id === id)
      if (index === -1) return prev
      const updated = next(prev.tierLists[index])
      if (updated === prev.tierLists[index]) return prev
      const tierLists = [...prev.tierLists]
      tierLists[index] = updated
      return { ...prev, tierLists }
    })
  }, [])

  const removeTierList = useCallback((id: string) => {
    setData((prev) => ({ ...prev, tierLists: prev.tierLists.filter((list) => list.id !== id) }))
  }, [])

  const value = useMemo<StoreContextValue>(
    () => ({
      data,
      loaded,
      saving,
      addAnime,
      addAnimeMany,
      updateAnime,
      removeAnime,
      clearAnime,
      updateSettings,
      replaceAll,
      addTierList,
      updateTierList,
      removeTierList
    }),
    [
      data,
      loaded,
      saving,
      addAnime,
      addAnimeMany,
      updateAnime,
      removeAnime,
      clearAnime,
      updateSettings,
      replaceAll,
      addTierList,
      updateTierList,
      removeTierList
    ]
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
