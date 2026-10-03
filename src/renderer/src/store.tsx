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
  type StoreData
} from './types'

const EMPTY_STORE: StoreData = {
  version: STORE_VERSION,
  anime: [],
  settings: DEFAULT_SETTINGS
}

interface StoreContextValue {
  data: StoreData
  loaded: boolean
  saving: boolean
  addAnime: (anime: Anime) => void
  updateAnime: (id: string, patch: Partial<Anime>) => void
  removeAnime: (id: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  replaceAll: (data: StoreData) => void
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

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }))
  }, [])

  const replaceAll = useCallback((next: StoreData) => {
    setData(normaliseStore(next))
  }, [])

  const value = useMemo<StoreContextValue>(
    () => ({ data, loaded, saving, addAnime, updateAnime, removeAnime, updateSettings, replaceAll }),
    [data, loaded, saving, addAnime, updateAnime, removeAnime, updateSettings, replaceAll]
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
