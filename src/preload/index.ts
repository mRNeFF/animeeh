import { contextBridge, ipcRenderer } from 'electron'
import type { AnimeDetails, AnimeSearchResult, AniListOutcome } from '../shared/anilist'

const api = {
  load: (): Promise<unknown | null> => ipcRenderer.invoke('data:load'),
  save: (data: unknown): Promise<boolean> => ipcRenderer.invoke('data:save', data),
  reveal: (): Promise<string> => ipcRenderer.invoke('data:reveal'),
  exportData: (data: unknown): Promise<string | null> => ipcRenderer.invoke('data:export', data),
  importData: (): Promise<{ path: string; data: unknown } | null> =>
    ipcRenderer.invoke('data:import'),

  /** Search MyAnimeList-reference titles through the AniList API. */
  searchAnime: (query: string): Promise<AniListOutcome<AnimeSearchResult[]>> =>
    ipcRenderer.invoke('anilist:search', query),
  /** Full details (including per-episode titles) for one AniList entry. */
  animeDetails: (anilistId: number): Promise<AniListOutcome<AnimeDetails>> =>
    ipcRenderer.invoke('anilist:details', anilistId)
}

contextBridge.exposeInMainWorld('animeeh', api)

export type AnimeEhApi = typeof api
