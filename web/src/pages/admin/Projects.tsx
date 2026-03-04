import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase, getSession } from '../../lib/supabase'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { Skeleton } from '../../components/ui/skeleton'

type Project = Database['public']['Tables']['project']['Row']
type AppUser = Database['public']['Tables']['app_user']['Row']

interface ProjectRow extends Project {
  member_count: number
  model_count: number
}

async function fetchProjects(): Promise<ProjectRow[]> {
  const { data: projects, error } = await supabase
    .from('project')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error

  const withCounts = await Promise.all(
    projects.map(async (p) => {
      const [{ count: member_count }, { count: model_count }] = await Promise.all([
        supabase
          .from('project_member')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', p.project_id),
        supabase
          .from('battery_model')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', p.project_id),
      ])
      return { ...p, member_count: member_count ?? 0, model_count: model_count ?? 0 }
    }),
  )
  return withCounts
}

async function fetchManufacturers(): Promise<AppUser[]> {
  const { data, error } = await supabase
    .from('app_user')
    .select('*')
    .eq('role', 'editor')
    .order('email')
  if (error) throw error
  return data
}

async function createProject(
  name: string,
  description: string,
  memberIds: string[],
) {
  const session = await getSession()
  if (!session) throw new Error('Not authenticated')

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const res = await fetch(`${supabaseUrl}/functions/v1/create_project`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ name, description, member_ids: memberIds }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Failed (${res.status})`)
  }
}

export default function ProjectsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const { data: projects, isLoading: loadingProjects } = useQuery({
    queryKey: ['admin', 'projects'],
    queryFn: fetchProjects,
  })

  const { data: manufacturers } = useQuery({
    queryKey: ['admin', 'manufacturers'],
    queryFn: fetchManufacturers,
    enabled: open,
  })

  function toggleMember(userId: string) {
    setSelectedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  async function handleCreate() {
    if (!name.trim()) return
    setSubmitting(true)
    try {
      await createProject(name.trim(), description.trim(), selectedIds)
      toast.success(`Project "${name}" created`)
      setOpen(false)
      setName('')
      setDescription('')
      setSelectedIds([])
      queryClient.invalidateQueries({ queryKey: ['admin', 'projects'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Projects</h1>
        <Button onClick={() => setOpen(true)}>Create Project</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Models</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loadingProjects
            ? Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : projects?.map((p) => (
                <TableRow key={p.project_id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="max-w-xs truncate text-slate-500">
                    {p.description ?? '—'}
                  </TableCell>
                  <TableCell>{p.member_count}</TableCell>
                  <TableCell>{p.model_count}</TableCell>
                  <TableCell>
                    {new Date(p.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                placeholder="Battery Pack LCA 2025"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="project-desc">Description</Label>
              <Input
                id="project-desc"
                placeholder="Optional description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Assign Manufacturers</Label>
              {!manufacturers ? (
                <Skeleton className="h-24 w-full" />
              ) : manufacturers.length === 0 ? (
                <p className="text-sm text-slate-500">No manufacturer users found.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                  {manufacturers.map((u) => (
                    <label
                      key={u.user_id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(u.user_id)}
                        onChange={() => toggleMember(u.user_id)}
                        className="accent-slate-800"
                      />
                      <span className="text-sm">{u.email}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || submitting}>
              {submitting ? 'Creating…' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
