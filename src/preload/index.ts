import { contextBridge, ipcRenderer } from 'electron'

const api = {
  load: (): Promise<unknown | null> => ipcRenderer.invoke('data:load'),
  save: (data: unknown): Promise<boolean> => ipcRenderer.invoke('data:save', data),
  reveal: (): Promise<string> => ipcRenderer.invoke('data:reveal'),
  exportData: (data: unknown): Promise<string | null> => ipcRenderer.invoke('data:export', data),
  importData: (): Promise<{ path: string; data: unknown } | null> =>
    ipcRenderer.invoke('data:import')
}

contextBridge.exposeInMainWorld('animeeh', api)

export type AnimeEhApi = typeof api
