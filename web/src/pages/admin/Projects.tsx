import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, BatteryFull, GitBranch, ExternalLink } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
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
import { Badge } from '../../components/ui/badge'
import { Skeleton } from '../../components/ui/skeleton'
import { useRevisionExchangeCount, useRevisionParameterCount } from '../../hooks/useRevisionCounts'
import { cn } from '../../lib/utils'

type Project = Database['public']['Tables']['project']['Row']
type AppUser = Database['public']['Tables']['app_user']['Row']

interface ProjectRow extends Project {
  member_count: number
  model_count: number
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

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

async function createProject(name: string, description: string, memberIds: string[]) {
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

// ---------------------------------------------------------------------------
// Drill-down components
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

interface RevisionWithCreator {
  revision_id: string
  revision_number: number
  label: string | null
  status: string | null
  created_at: string
  created_by: string | null
  creator: { email: string; display_name: string | null } | null
}

function RevisionRow({
  revision,
  projectId,
  modelId,
}: {
  revision: RevisionWithCreator
  projectId: string
  modelId: string
}) {
  const navigate = useNavigate()
  const { data: exchangeCount } = useRevisionExchangeCount(revision.revision_id)
  const { data: paramCount } = useRevisionParameterCount(revision.revision_id)
  const href = `/projects/${projectId}/models/${modelId}/revisions/${revision.revision_id}`

  return (
    <div className="flex items-center gap-3 rounded px-2 py-1.5 text-xs hover:bg-slate-50">
      <GitBranch className="h-3 w-3 shrink-0 text-slate-300" />
      <span className="w-32 truncate font-medium text-slate-700">
        {revision.label ?? `Rev ${revision.revision_number}`}
      </span>
      {revision.status && (
        <Badge
          className={cn(
            'border-0 text-xs capitalize',
            STATUS_STYLES[revision.status] ?? 'bg-slate-100 text-slate-600',
          )}
        >
          {revision.status}
        </Badge>
      )}
      <span className="text-slate-400">
        {exchangeCount ?? '—'} exchanges · {paramCount ?? '—'} params
      </span>
      <span className="text-slate-400">
        {revision.creator
          ? (revision.creator.display_name ?? revision.creator.email)
          : '—'}
      </span>
      <button
        onClick={() => navigate(href)}
        title="View revision"
        className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
      >
        <ExternalLink className="h-3 w-3" />
        View
      </button>
    </div>
  )
}

function ModelDrillDown({ modelId, projectId }: { modelId: string; projectId: string }) {
  const { data: revisions, isLoading } = useQuery({
    queryKey: ['admin', 'revisions', modelId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('battery_model_revision')
        .select('revision_id, revision_number, label, status, created_at, created_by, creator:app_user!created_by(email, display_name)')
        .eq('model_id', modelId)
        .order('revision_number')
      if (error) throw error
      return data as RevisionWithCreator[]
    },
  })

  if (isLoading) return <p className="py-1 pl-4 text-xs text-slate-400">Loading…</p>
  if (!revisions?.length) return <p className="py-1 pl-4 text-xs text-slate-400 italic">No revisions</p>

  return (
    <div className="ml-4 mt-1 space-y-0.5 border-l pl-3">
      {revisions.map((rev) => (
        <RevisionRow key={rev.revision_id} revision={rev} projectId={projectId} modelId={modelId} />
      ))}
    </div>
  )
}

function ProjectDrillDown({ projectId }: { projectId: string }) {
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())

  const { data: models, isLoading } = useQuery({
    queryKey: ['admin', 'models', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('battery_model')
        .select('model_id, name, created_at')
        .eq('project_id', projectId)
        .order('created_at')
      if (error) throw error
      return data
    },
  })

  if (isLoading) return <p className="py-2 pl-6 text-xs text-slate-400">Loading models…</p>
  if (!models?.length) return <p className="py-2 pl-6 text-xs text-slate-400 italic">No models</p>

  return (
    <div className="border-t bg-slate-50 px-6 py-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Models</p>
      <div className="space-y-1">
        {models.map((m) => {
          const isExpanded = expandedModels.has(m.model_id)
          return (
            <div key={m.model_id}>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-white"
                onClick={() =>
                  setExpandedModels((prev) => {
                    const next = new Set(prev)
                    if (next.has(m.model_id)) next.delete(m.model_id)
                    else next.add(m.model_id)
                    return next
                  })
                }
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                )}
                <BatteryFull className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-medium text-slate-700">{m.name}</span>
              </button>
              {isExpanded && <ModelDrillDown modelId={m.model_id} projectId={projectId} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ProjectsPage() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

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

  function toggleProject(projectId: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
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
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar />
      <div className="flex items-center gap-1.5 border-b bg-white px-6 py-2 text-xs text-slate-500">
        <Link to="/admin" className="hover:text-slate-800">Admin</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-medium text-slate-700">Projects</span>
      </div>
    <div className="flex-1 overflow-auto space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Projects</h1>
        <Button onClick={() => setOpen(true)}>Create Project</Button>
      </div>

      <div className="rounded-lg border bg-white">
        {/* Header */}
        <div className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-4 border-b px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400">
          <span>Name</span>
          <span>Description</span>
          <span>Members</span>
          <span>Models</span>
          <span>Created</span>
        </div>

        {loadingProjects ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !projects?.length ? (
          <p className="p-6 text-center text-sm text-slate-400 italic">No projects yet</p>
        ) : (
          projects.map((p) => {
            const isExpanded = expandedProjects.has(p.project_id)
            return (
              <div key={p.project_id} className="border-b last:border-b-0">
                <button
                  className="grid w-full grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-4 px-4 py-3 text-left text-sm hover:bg-slate-50"
                  onClick={() => toggleProject(p.project_id)}
                >
                  <span className="flex items-center gap-2 font-medium text-slate-800">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    {p.name}
                  </span>
                  <span className="truncate text-slate-500">{p.description ?? '—'}</span>
                  <span className="text-slate-600">{p.member_count}</span>
                  <span className="text-slate-600">{p.model_count}</span>
                  <span className="text-slate-500">
                    {new Date(p.created_at).toLocaleDateString()}
                  </span>
                </button>
                {isExpanded && <ProjectDrillDown projectId={p.project_id} />}
              </div>
            )
          })
        )}
      </div>

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
    </div>
  )
}
