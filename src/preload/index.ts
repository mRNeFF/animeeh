import { contextBridge, ipcRenderer } from 'electron'
import type { AnimeDetails, AnimeSearchResult, AniListOutcome } from '../shared/anilist'
import type { UpdateStatus } from '../shared/update'

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
  /**
   * Assemble a whole franchise (every season, episodes renumbered) from any one
   * of its seasons.
   */
  animeFranchise: (anilistId: number): Promise<AniListOutcome<AnimeDetails>> =>
    ipcRenderer.invoke('anilist:franchise', anilistId),

  /* ---- in-app updates ---- */
  updateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
  /** Subscribe to status pushes; returns an unsubscribe function. */
  onUpdateStatus: (listener: (status: UpdateStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: UpdateStatus): void => listener(status)
    ipcRenderer.on('update:status-changed', handler)
    return () => ipcRenderer.removeListener('update:status-changed', handler)
  }
}

contextBridge.exposeInMainWorld('animeeh', api)

export type AnimeEhApi = typeof api

