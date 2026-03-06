import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Home, LogOut, User } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { useProject } from '../hooks/useProject'
import { useBatteryModels } from '../hooks/useBatteryModels'
import { useRevisions } from '../hooks/useRevision'
import { useProcesses } from '../hooks/useProcesses'
import ValidationBadge from './ValidationBadge'
import ProfileDialog from './ProfileDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Button } from './ui/button'

export default function TopBar() {
  const { projectId, modelId, revisionId, processId } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.role)
  const [profileOpen, setProfileOpen] = useState(false)

  const { data: project } = useProject(projectId)
  const { data: models } = useBatteryModels(projectId)
  const { data: revisions } = useRevisions(modelId)
  const { data: processes } = useProcesses(revisionId)

  const model = models?.find((m) => m.model_id === modelId)
  const revision = revisions?.find((r) => r.revision_id === revisionId)
  const process = processes?.find((p) => p.process_id === processId)

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? '??'

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <>
    <header className="flex h-12 items-center justify-between border-b bg-white px-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-slate-600">
        <Link
          to={role === 'admin' ? '/admin' : '/projects'}
          className="flex items-center text-slate-400 hover:text-slate-700"
        >
          <Home className="h-3.5 w-3.5" />
        </Link>
        {project && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <Link
              to={`/projects/${projectId}`}
              className="hover:text-slate-900"
            >
              {project.name}
            </Link>
          </>
        )}
        {model && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <Link
              to={`/projects/${projectId}/models/${modelId}`}
              className="hover:text-slate-900"
            >
              {model.name}
            </Link>
          </>
        )}
        {revision && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <Link
              to={`/projects/${projectId}/models/${modelId}/revisions/${revisionId}`}
              className="hover:text-slate-900"
            >
              {revision.label ?? `Rev ${revision.revision_number}`}
            </Link>
          </>
        )}
        {process && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-900">{process.name}</span>
          </>
        )}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {revisionId && <ValidationBadge revisionId={revisionId} />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 rounded-full p-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-700">
                {initials}
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5 text-xs text-slate-500 truncate">
              {user?.email}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-sm cursor-pointer"
              onClick={() => setProfileOpen(true)}
            >
              <User className="h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="gap-2 text-sm text-red-600 cursor-pointer focus:text-red-600"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>

    <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  )
}
