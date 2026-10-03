import type { AnimeEhApi } from '../../preload/index'

declare global {
  interface Window {
    animeeh: AnimeEhApi
  }
}

export {}
