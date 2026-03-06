import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, FlaskConical, FolderOpen, GitBranch, ShieldCheck, User } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

// ---------------------------------------------------------------------------
// Stats hook
// ---------------------------------------------------------------------------

interface ProfileStats {
  projectCount: number
  modelCount: number
  revisionCount: number
  validationRunCount: number
}

async function fetchProfileStats(userId: string): Promise<ProfileStats> {
  const [memberships, validationRuns] = await Promise.all([
    supabase
      .from('project_member')
      .select('project_id, project(battery_model(model_id, battery_model_revision(revision_id)))')
      .eq('user_id', userId),
    supabase
      .from('validation_run')
      .select('validation_id', { count: 'exact', head: true })
      .eq('triggered_by', userId),
  ])

  const projects = memberships.data ?? []
  const projectCount = projects.length

  let modelCount = 0
  let revisionCount = 0
  for (const m of projects) {
    const models = (m.project as { battery_model?: { model_id: string; battery_model_revision?: { revision_id: string }[] }[] } | null)?.battery_model ?? []
    modelCount += models.length
    for (const model of models) {
      revisionCount += model.battery_model_revision?.length ?? 0
    }
  }

  return {
    projectCount,
    modelCount,
    revisionCount,
    validationRunCount: validationRuns.count ?? 0,
  }
}

function useProfileStats(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile-stats', userId],
    queryFn: () => fetchProfileStats(userId!),
    enabled: !!userId,
  })
}

// ---------------------------------------------------------------------------
// Role badge
// ---------------------------------------------------------------------------

const ROLE_STYLES: Record<string, string> = {
  admin:  'bg-purple-100 text-purple-700',
  editor: 'bg-blue-100 text-blue-700',
  viewer: 'bg-slate-100 text-slate-600',
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[role] ?? 'bg-slate-100 text-slate-600'}`}>
      <ShieldCheck className="h-3 w-3" />
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | undefined }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border bg-slate-50 p-3">
      <div className="text-slate-400">{icon}</div>
      <span className="text-lg font-semibold text-slate-800 tabular-nums">
        {value ?? '—'}
      </span>
      <span className="text-center text-xs text-slate-500">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface Props {
  open: boolean
  onClose: () => void
}

export default function ProfileDialog({ open, onClose }: Props) {
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.role)
  const { data: stats } = useProfileStats(user?.id)

  const displayName =
    user?.user_metadata?.display_name as string | undefined
    ?? user?.email?.split('@')[0]
    ?? '—'

  const initials = displayName.slice(0, 2).toUpperCase()

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : '—'

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
        </DialogHeader>

        {/* Avatar + identity */}
        <div className="flex items-center gap-4 py-2">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xl font-semibold text-slate-700">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{displayName}</p>
            <p className="truncate text-sm text-slate-500">{user?.email}</p>
            <div className="mt-1">
              <RoleBadge role={role} />
            </div>
          </div>
        </div>

        {/* Member since */}
        <div className="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
          <span>Member since <span className="font-medium text-slate-800">{memberSince}</span></span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          <StatTile icon={<FolderOpen className="h-4 w-4" />}   label="Projects"  value={stats?.projectCount} />
          <StatTile icon={<User className="h-4 w-4" />}         label="Models"    value={stats?.modelCount} />
          <StatTile icon={<GitBranch className="h-4 w-4" />}    label="Revisions" value={stats?.revisionCount} />
          <StatTile icon={<FlaskConical className="h-4 w-4" />} label="Validations run" value={stats?.validationRunCount} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
