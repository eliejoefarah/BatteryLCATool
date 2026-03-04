import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, ChevronRight } from 'lucide-react'
import { useProjects } from '../../hooks/useProjects'
import { useAuthStore } from '../../store/auth'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/skeleton'

export default function ProjectListPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const authLoading = useAuthStore((s) => s.loading)
  const { data: projects, isLoading } = useProjects()

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login', { replace: true })
    }
  }, [user, authLoading, navigate])

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  if (authLoading || !user) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex h-12 items-center justify-between border-b bg-white px-6">
        <span className="text-sm font-semibold text-slate-800">
          Battery LCA Tool
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{user.email}</span>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-6 text-xl font-semibold text-slate-900">
          My Projects
        </h1>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : !projects?.length ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
            No projects assigned yet. Ask your administrator to assign you to a
            project.
          </div>
        ) : (
          <ul className="space-y-2">
            {projects.map((p) => (
              <li key={p.project_id}>
                <button
                  onClick={() => navigate(`/projects/${p.project_id}`)}
                  className="flex w-full items-center justify-between rounded-lg border bg-white px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3">
                    <FolderOpen className="h-5 w-5 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {p.name}
                      </p>
                      {p.description && (
                        <p className="mt-0.5 text-xs text-slate-400 line-clamp-1">
                          {p.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
