import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from './components/ui/sonner'
import AdminRoute from './components/AdminRoute'
import InactivityDialog from './components/InactivityDialog'
import Unauthorized from './pages/Unauthorized'
import Login from './pages/Login'
import AdminDashboard from './pages/admin/Dashboard'
import UsersPage from './pages/admin/Users'
import ProjectsPage from './pages/admin/Projects'
import CatalogPage from './pages/admin/Catalog'
import GlobalDataView from './pages/admin/GlobalDataView'
import ProjectListPage from './pages/manufacturer/ProjectListPage'
import ProjectPage from './pages/manufacturer/ProjectPage'
import ModelPage from './pages/manufacturer/ModelPage'
import RevisionPage from './pages/manufacturer/RevisionPage'
import ProcessPage from './pages/manufacturer/ProcessPage'
import { useAuthStore } from './store/auth'

function RootRedirect() {
  const role = useAuthStore((s) => s.role)
  const loading = useAuthStore((s) => s.loading)
  if (loading) return null
  return <Navigate to={role === 'admin' ? '/admin' : '/projects'} replace />
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/unauthorized" element={<Unauthorized />} />

        {/* Manufacturer routes */}
        <Route path="/projects" element={<ProjectListPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route
          path="/projects/:projectId/models/:modelId"
          element={<ModelPage />}
        />
        <Route
          path="/projects/:projectId/models/:modelId/revisions/:revisionId"
          element={<RevisionPage />}
        />
        <Route
          path="/projects/:projectId/models/:modelId/revisions/:revisionId/processes/:processId"
          element={<ProcessPage />}
        />

        {/* Admin routes */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminDashboard />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <AdminRoute>
              <UsersPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/projects"
          element={
            <AdminRoute>
              <ProjectsPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/catalog"
          element={
            <AdminRoute>
              <CatalogPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/global"
          element={
            <AdminRoute>
              <GlobalDataView />
            </AdminRoute>
          }
        />
      </Routes>
      <Toaster />
      {/* 1 min inactivity → "still there?" dialog → 30 s grace → sign out */}
      <InactivityDialog timeoutMs={60*60_000} />
    </BrowserRouter>
  )
}
