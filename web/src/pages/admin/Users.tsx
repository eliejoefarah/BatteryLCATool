import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { supabase, getSession } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import type { Database } from '../../types/database.types'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { Skeleton } from '../../components/ui/skeleton'
import { Badge } from '../../components/ui/badge'

type AppUser = Database['public']['Tables']['app_user']['Row']

async function fetchUsers(): Promise<AppUser[]> {
  const { data, error } = await supabase
    .from('app_user')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

async function inviteUser(email: string, role: string) {
  const session = await getSession()
  if (!session) throw new Error('Not authenticated')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const res = await fetch(`${supabaseUrl}/functions/v1/invite_user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email, role }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Failed (${res.status})`)
  }
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  editor: 'Manufacturer',
  reviewer: 'Reviewer',
}

const ROLE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  admin: 'default',
  editor: 'secondary',
  reviewer: 'outline',
}

export default function UsersPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [submitting, setSubmitting] = useState(false)

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: fetchUsers,
  })

  async function handleInvite() {
    if (!email) return
    setSubmitting(true)
    try {
      await inviteUser(email, role)
      toast.success(`Invite sent to ${email}`)
      setOpen(false)
      setEmail('')
      setRole('editor')
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invite')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar />
      <div className="flex items-center gap-1.5 border-b bg-white px-6 py-2 text-xs text-slate-500">
        <Link to="/admin" className="hover:text-slate-800">Admin</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-medium text-slate-700">Users</span>
      </div>
    <div className="flex-1 overflow-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Users</h1>
        <Button onClick={() => setOpen(true)}>Invite User</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Display Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Active</TableHead>
            <TableHead>Joined</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : users?.map((u) => (
                <TableRow key={u.user_id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>{u.display_name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={ROLE_VARIANTS[u.role] ?? 'outline'}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>{u.is_active ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    {new Date(u.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="manufacturer@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Manufacturer</SelectItem>
                  <SelectItem value="reviewer">Reviewer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={!email || submitting}>
              {submitting ? 'Sending…' : 'Send Invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  )
}
