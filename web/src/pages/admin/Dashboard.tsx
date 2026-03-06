import { useNavigate } from 'react-router-dom'
import { FolderOpen, Users } from 'lucide-react'
import { useAuthStore } from '../../store/auth'
import TopBar from '../../components/TopBar'

const CARDS = [
  {
    icon: FolderOpen,
    title: 'Projects',
    description: 'Create projects, assign team members, and view the full hierarchy of models, revisions, and exchanges.',
    href: '/admin/projects',
  },
  {
    icon: Users,
    title: 'Users',
    description: 'Invite new team members and manage or revoke access for existing users.',
    href: '/admin/users',
  },
]

export default function AdminDashboard() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar />
      <main className="flex flex-1 flex-col items-center justify-center p-8">
        <div className="w-full max-w-2xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Admin Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">
              Welcome back, {user?.email}. What would you like to manage?
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {CARDS.map(({ icon: Icon, title, description, href }) => (
              <button
                key={href}
                onClick={() => navigate(href)}
                className="group flex flex-col gap-4 rounded-xl border bg-white p-6 text-left shadow-sm transition-all hover:border-green-200 hover:shadow-md"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-green-700 transition-colors group-hover:bg-green-600 group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-slate-800">{title}</p>
                  <p className="mt-1 text-sm text-slate-500">{description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
