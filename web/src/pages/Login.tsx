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
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // If already authenticated, redirect based on role
  useEffect(() => {
    if (!loading && user) {
      navigate(role === 'admin' ? '/admin' : '/projects', { replace: true })
    }
  }, [user, role, loading, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
  }

  // Show nothing while auth state is still resolving
  if (loading) return null

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Check your email</h1>
          <p className="text-sm text-slate-500">
            We sent a magic link to <strong>{email}</strong>. Click it to sign
            in.
          </p>
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
          <p className="text-sm text-slate-500">Sign in with your email</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send magic link'}
          </Button>
        </form>
        </div>
      </div>
    </div>
  )
}
