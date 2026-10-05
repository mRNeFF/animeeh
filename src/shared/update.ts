/**
 * Update contract shared between the main process (which drives
 * electron-updater) and the renderer (which renders the button and status).
 *
 * Types only — no runtime code.
 */

export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  stage: UpdateStage
  /** Version currently running. */
  currentVersion: string
  /** Version offered by the feed, once known. */
  availableVersion: string | null
  /** 0–100 while downloading, otherwise null. */
  percent: number | null
  bytesPerSecond: number | null
  transferred: number | null
  total: number | null
  /** Human-readable error, when stage is 'error'. */
  message: string | null
  /**
   * Translation code for the message. The main process has no dictionaries, so
   * it reports a code and the panel renders localised text from it.
   */
  messageCode?: 'noFeed' | 'noUpdateToDownload'
  /**
   * True when a feed is configured and the build can actually self-update
   * (packaged app + publish config). In dev this is false.
   */
  canUpdate: boolean
  /** Where the app looks for releases, for display. */
  feed: string | null
}

export const IDLE_UPDATE_STATUS: Omit<UpdateStatus, 'currentVersion' | 'canUpdate' | 'feed'> = {
  stage: 'idle',
  availableVersion: null,
  percent: null,
  bytesPerSecond: null,
  transferred: null,
  total: null,
  message: null
}
