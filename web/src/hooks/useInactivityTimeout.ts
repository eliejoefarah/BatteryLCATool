import { useCallback, useEffect, useRef, useState } from 'react'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']

/**
 * Tracks user inactivity. After `timeoutMs` of no activity, sets `isIdle=true`.
 * The caller is responsible for showing a warning dialog and calling `reset()`
 * if the user responds, or `signOut()` after the grace period.
 *
 * Only active when `enabled=true` (i.e. user is logged in).
 */
export function useInactivityTimeout(timeoutMs: number, enabled: boolean) {
  const [isIdle, setIsIdle] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    setIsIdle(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!enabled) return
    timerRef.current = setTimeout(() => setIsIdle(true), timeoutMs)
  }, [timeoutMs, enabled])

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current)
      setIsIdle(false)
      return
    }

    // Start the timer and listen for activity
    reset()
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [enabled, reset])

  return { isIdle, reset }
}
