import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '../../shared/update'

export interface UseUpdateResult {
  status: UpdateStatus | null
  checking: boolean
  downloading: boolean
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
}

/**
 * Subscribes to update status pushed by the main process and exposes the three
 * actions the UI needs. Safe to use in any component; the main process owns the
 * single source of truth.
 */
export function useUpdate(): UseUpdateResult {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    let active = true

    void window.animeeh.updateStatus().then((initial) => {
      if (active) setStatus(initial)
    })

    const unsubscribe = window.animeeh.onUpdateStatus((next) => {
      if (active) setStatus(next)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const check = useCallback(async () => {
    setChecking(true)
    try {
      setStatus(await window.animeeh.checkForUpdates())
    } finally {
      setChecking(false)
    }
  }, [])

  const download = useCallback(async () => {
    setDownloading(true)
    try {
      setStatus(await window.animeeh.downloadUpdate())
    } finally {
      setDownloading(false)
    }
  }, [])

  const install = useCallback(async () => {
    await window.animeeh.installUpdate()
  }, [])

  return { status, checking, downloading, check, download, install }
}
