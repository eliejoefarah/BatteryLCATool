import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from './components/ui/sonner'
import AdminRoute from './components/AdminRoute'
import InactivityDialog from './components/InactivityDialog'
import Unauthorized from './pages/Unauthorized'
import Login from './pages/Login'
import UsersPage from './pages/admin/Users'
import ProjectsPage from './pages/admin/Projects'
import ProjectListPage from './pages/manufacturer/ProjectListPage'
import ProjectPage from './pages/manufacturer/ProjectPage'
import ModelPage from './pages/manufacturer/ModelPage'
import RevisionPage from './pages/manufacturer/RevisionPage'
import ProcessPage from './pages/manufacturer/ProcessPage'

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<ProjectListPage />} />
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
      </Routes>
      <Toaster />
      {/* 1 min inactivity → "still there?" dialog → 30 s grace → sign out */}
      <InactivityDialog timeoutMs={60_000} />
    </BrowserRouter>
  )
}
