/**
 * Episode-name lookup contract, shared between main and renderer.
 * Types only.
 */

export interface EpisodeName {
  /** 1-based, continuing across seasons. */
  number: number
  /** 1-based season this episode belongs to. */
  season: number
  title: string
}

export interface EpisodeNamesResult {
  episodes: EpisodeName[]
  /** Which source supplied the data. */
  source: 'kitsu' | 'anilist' | 'tvmaze'
  /** Season numbers that returned nothing, so the UI can say so. */
  missingSeasons: number[]
}

import type { Failure } from './errors'

export type EpisodeNamesOutcome = { ok: true; data: EpisodeNamesResult } | Failure
