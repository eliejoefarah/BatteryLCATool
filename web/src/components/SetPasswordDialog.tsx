import { useState } from 'react'
import { toast } from 'sonner'
import { MIN_PASSWORD_LENGTH, passwordProblem } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { finishPasswordSetup, useAuthStore } from '../store/auth'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

/**
 * Shown once the user is signed in from an invite link ("choose a password")
 * or a password-reset link ("set a new password"). Mounted at app level so it
 * works on whichever page the link lands on.
 */
export default function SetPasswordDialog() {
  const user = useAuthStore((s) => s.user)
  const mode = useAuthStore((s) => s.passwordSetup)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user || !mode) return null
  const isInvite = mode === 'invite'

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const problem = passwordProblem(password, confirm)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    toast.success('Password saved. You can now sign in with it.')
    finishPasswordSetup()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) finishPasswordSetup() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isInvite ? 'Choose a password' : 'Set a new password'}</DialogTitle>
          <DialogDescription>
            {isInvite
              ? 'Welcome! Choose a password to sign in with. You can also keep signing in with an email link instead.'
              : 'Choose a new password for your account.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p className="text-xs text-slate-500">At least {MIN_PASSWORD_LENGTH} characters.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm-password">Repeat password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={finishPasswordSetup}>
              {isInvite ? 'Skip for now' : 'Cancel'}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
