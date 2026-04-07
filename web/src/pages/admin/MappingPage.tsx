import { useParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { ChevronRight, Link2 } from 'lucide-react'
import TopBar from '../../components/TopBar'

export default function MappingPage() {
  const { revisionId } = useParams<{
    projectId: string
    modelId: string
    revisionId: string
  }>()

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar />

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 border-b bg-white px-6 py-2 text-xs text-slate-500">
        <Link to="/admin" className="hover:text-slate-800">Admin</Link>
        <ChevronRight className="h-3 w-3" />
        <Link to="/admin/projects" className="hover:text-slate-800">Projects</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-medium text-slate-700">Mapping</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <Link2 className="h-7 w-7 text-slate-400" />
        </div>
        <div className="text-center">
          <h1 className="text-lg font-semibold text-slate-800">Flow Mapping</h1>
          <p className="mt-1 text-sm text-slate-500">
            Mapping interface coming soon.
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            Revision: <code className="font-mono">{revisionId}</code>
          </p>
        </div>
      </div>
    </div>
  )
}
