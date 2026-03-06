import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { useInactivityTimeout } from '../hooks/useInactivityTimeout'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'

// How long the user has to respond before being auto-logged out (seconds)
const GRACE_SECONDS = 30

interface Props {
  /** How many milliseconds of inactivity before showing the dialog */
  timeoutMs: number
}

export default function InactivityDialog({ timeoutMs }: Props) {
  const user = useAuthStore((s) => s.user)
  const { isIdle, reset } = useInactivityTimeout(timeoutMs, !!user)

  const [countdown, setCountdown] = useState(GRACE_SECONDS)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Start / stop countdown when idle state changes
  useEffect(() => {
    if (!isIdle) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      setCountdown(GRACE_SECONDS)
      return
    }

    setCountdown(GRACE_SECONDS)
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!)
          supabase.auth.signOut()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isIdle])

  function handleStillHere() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    reset()
  }

  function handleSignOut() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    supabase.auth.signOut()
  }

  if (!user) return null

  return (
    <Dialog open={isIdle}>
      <DialogContent
        className="max-w-sm"
        aria-describedby="inactivity-desc"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Are you still there?</DialogTitle>
          <DialogDescription id="inactivity-desc">
            You've been inactive for a while. You'll be signed out automatically
            in <span className="font-semibold tabular-nums">{countdown}</span> second{countdown !== 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleSignOut}>
            Sign out
          </Button>
          <Button onClick={handleStillHere}>
            I'm still here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
