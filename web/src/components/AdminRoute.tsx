import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

interface AdminRouteProps {
  children: React.ReactNode
}

export default function AdminRoute({ children }: AdminRouteProps) {
  const { user, role, loading } = useAuthStore()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (role !== 'admin') {
    return <Navigate to="/unauthorized" replace />
  }

  return <>{children}</>
}
