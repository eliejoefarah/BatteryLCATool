import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'

export default function Login() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.role)
  const loading = useAuthStore((s) => s.loading)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sent, setSent] = useState<'link' | 'reset' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // If already authenticated, redirect based on role
  useEffect(() => {
    if (!loading && user) {
      navigate(role === 'admin' ? '/admin' : '/projects', { replace: true })
    }
  }, [user, role, loading, navigate])

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    // On success onAuthStateChange updates the store and the effect above redirects
    if (error) setError(error.message)
  }

  // Email-based actions need the email field but not the password
  async function sendEmail(kind: 'link' | 'reset') {
    if (!email) {
      setError('Enter your email address first.')
      return
    }
    setSubmitting(true)
    setError(null)
    const { error } = kind === 'link'
      ? await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
      : await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/` })
    setSubmitting(false)
    if (error) setError(error.message)
    else setSent(kind)
  }

  // Show nothing while auth state is still resolving
  if (loading) return null

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Check your email</h1>
          <p className="text-sm text-slate-500">
            {sent === 'link'
              ? <>We sent a sign-in link to <strong>{email}</strong>. Click it to sign in.</>
              : <>If <strong>{email}</strong> has an account, we sent it a link to set a new password.</>}
          </p>
          <Button variant="link" onClick={() => setSent(null)}>Back to sign in</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm overflow-hidden rounded-lg border bg-white shadow-sm">
        <div className="h-1.5 bg-green-500" />
        <div className="space-y-6 p-8">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Battery LCA Tool</h1>
          <p className="text-sm text-slate-500">Sign in with your email and password</p>
        </div>
        <form onSubmit={handlePasswordSignIn} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <button
                type="button"
                className="text-xs text-slate-500 underline-offset-4 hover:underline"
                onClick={() => sendEmail('reset')}
                disabled={submitting}
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <div className="space-y-2 text-center">
          <p className="text-xs text-slate-400">No password yet?</p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => sendEmail('link')}
            disabled={submitting}
          >
            Email me a sign-in link
          </Button>
        </div>
        </div>
      </div>
    </div>
  )
}
