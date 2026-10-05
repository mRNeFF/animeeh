import { contextBridge, ipcRenderer } from 'electron'
import type { AnimeDetails, AnimeSearchResult, AniListOutcome } from '../shared/anilist'
import type { EpisodeNamesOutcome } from '../shared/episodes'
import type { ScheduleOutcome } from '../shared/schedule'
import type { UpdateStatus } from '../shared/update'

const api = {
  load: (): Promise<unknown | null> => ipcRenderer.invoke('data:load'),
  save: (data: unknown): Promise<boolean> => ipcRenderer.invoke('data:save', data),
  reveal: (): Promise<string> => ipcRenderer.invoke('data:reveal'),
  exportData: (data: unknown): Promise<string | null> => ipcRenderer.invoke('data:export', data),
  importData: (): Promise<{ path: string; data: unknown } | null> =>
    ipcRenderer.invoke('data:import'),

  /**
   * Search AniList. kind is 'series' (everything but films) or 'film'.
   */
  searchAnime: (query: string, kind: 'series' | 'film' = 'series'): Promise<AniListOutcome<AnimeSearchResult[]>> =>
    ipcRenderer.invoke('anilist:search', query, kind),
  /**
   * Assemble a whole franchise (every season, episodes renumbered) from any one
   * of its seasons.
   */
  animeFranchise: (anilistId: number): Promise<AniListOutcome<AnimeDetails>> =>
    ipcRenderer.invoke('anilist:franchise', anilistId),

  /**
   * Episode names for a franchise. One array of part ids per merged season, so
   * a season split into two cours passes both ids.
   */
  loadEpisodeNames: (seasons: number[][]): Promise<EpisodeNamesOutcome> =>
    ipcRenderer.invoke('episodes:load', seasons),

  /**
   * Release calendar: upcoming episodes, announced continuations and new shows
   * this season. Served from a six-hour cache unless `force` is true.
   */
  schedule: (force = false): Promise<ScheduleOutcome> =>
    ipcRenderer.invoke('schedule:get', force),

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

