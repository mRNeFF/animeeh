/**
 * Error codes shared between the main process and the renderer.
 *
 * The main process runs outside React and has no access to the dictionaries, so
 * it cannot produce a translated message. Instead it reports one of these codes,
 * the renderer turns it into localised text, and the original English message is
 * kept only as a detail for codes the renderer does not know.
 *
 * Types only — no runtime code.
 */

export type ErrorCode =
  | 'unreachable'
  | 'timeout'
  | 'rateLimit'
  | 'http'
  | 'empty'
  | 'noReference'
  | 'noEpisodeNames'
  | 'noFeed'
  | 'noUpdateToDownload'

/** Which service a message should name. */
export type ServiceName = 'anilist' | 'kitsu'

export interface Failure {
  ok: false
  code: ErrorCode
  /** English text from the main process, used only when `code` is unknown. */
  detail?: string
  /** HTTP status, for the `http` code. */
  status?: number
  /** Service the failure came from, for messages that name it. */
  service?: ServiceName
  /** Raw message, kept for logging. */
  error: string
}

/** Attach a code to an error so it survives the IPC hop. */
export class CodedError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly meta: { status?: number; service?: ServiceName } = {}
  ) {
    super(message)
    this.name = 'CodedError'
  }
}
