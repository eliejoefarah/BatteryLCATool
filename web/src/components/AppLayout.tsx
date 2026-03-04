import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  BatteryFull,
  GitBranch,
  Cpu,
} from 'lucide-react'
import NewModelDialog from './NewModelDialog'
import NewRevisionDialog from './NewRevisionDialog'
import { cn } from '../lib/utils'
import { useBatteryModels } from '../hooks/useBatteryModels'
import { useRevisions } from '../hooks/useRevision'
import { useProcesses } from '../hooks/useProcesses'
import { useProject } from '../hooks/useProject'
import TopBar from './TopBar'

interface SidebarProps {
  projectId: string
}

function ProcessList({
  revisionId,
  projectId,
  modelId,
}: {
  revisionId: string
  projectId: string
  modelId: string
}) {
  const { processId: activeProcessId } = useParams()
  const navigate = useNavigate()
  const { data: processes } = useProcesses(revisionId)

  if (!processes?.length) return null

  return (
    <ul className="ml-8 mt-0.5 space-y-0.5">
      {processes.map((p) => (
        <li key={p.process_id}>
          <button
            onClick={() =>
              navigate(
                `/projects/${projectId}/models/${modelId}/revisions/${revisionId}/processes/${p.process_id}`,
              )
            }
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors',
              activeProcessId === p.process_id
                ? 'bg-slate-200 font-medium text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
            )}
          >
            <Cpu className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="truncate">{p.name}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function RevisionList({
  modelId,
  projectId,
}: {
  modelId: string
  projectId: string
}) {
  const { revisionId: activeRevisionId } = useParams()
  const navigate = useNavigate()
  const { data: revisions } = useRevisions(modelId)
  const [expandedRevisions, setExpandedRevisions] = useState<Set<string>>(
    () => new Set(activeRevisionId ? [activeRevisionId] : []),
  )

  if (!revisions?.length) return null

  function toggleRevision(id: string) {
    setExpandedRevisions((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <ul className="ml-4 mt-0.5 space-y-0.5">
      {revisions.map((rev) => {
        const isActive = activeRevisionId === rev.revision_id
        const isExpanded = expandedRevisions.has(rev.revision_id)
        const label = rev.label ?? `Rev ${rev.revision_number}`

        return (
          <li key={rev.revision_id}>
            <div className="flex items-center">
              <button
                onClick={() => toggleRevision(rev.revision_id)}
                className="flex h-6 w-4 items-center justify-center text-slate-400 hover:text-slate-600"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </button>
              <button
                onClick={() => {
                  navigate(
                    `/projects/${projectId}/models/${modelId}/revisions/${rev.revision_id}`,
                  )
                  if (!isExpanded) toggleRevision(rev.revision_id)
                }}
                className={cn(
                  'flex flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors',
                  isActive
                    ? 'bg-slate-200 font-medium text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <GitBranch className="h-3 w-3 shrink-0 text-slate-400" />
                <span className="truncate">{label}</span>
              </button>
            </div>
            {isExpanded && (
              <ProcessList
                revisionId={rev.revision_id}
                projectId={projectId}
                modelId={modelId}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function ModelList({ projectId }: { projectId: string }) {
  const { modelId: activeModelId } = useParams()
  const navigate = useNavigate()
  const { data: models } = useBatteryModels(projectId)
  const [expandedModels, setExpandedModels] = useState<Set<string>>(
    () => new Set(activeModelId ? [activeModelId] : []),
  )

  if (!models?.length) {
    return (
      <p className="ml-4 mt-1 text-xs text-slate-400 italic">No models yet</p>
    )
  }

  function toggleModel(id: string) {
    setExpandedModels((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <ul className="mt-1 space-y-0.5">
      {models.map((m) => {
        const isActive = activeModelId === m.model_id
        const isExpanded = expandedModels.has(m.model_id)

        return (
          <li key={m.model_id}>
            <div className="flex items-center">
              <button
                onClick={() => toggleModel(m.model_id)}
                className="flex h-6 w-5 items-center justify-center text-slate-400 hover:text-slate-600"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={() => {
                  navigate(`/projects/${projectId}/models/${m.model_id}`)
                  if (!isExpanded) toggleModel(m.model_id)
                }}
                className={cn(
                  'flex flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm transition-colors',
                  isActive
                    ? 'bg-slate-200 font-medium text-slate-900'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <BatteryFull className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate">{m.name}</span>
              </button>
            </div>
            {isExpanded && (
              <>
                <RevisionList modelId={m.model_id} projectId={projectId} />
                <div className="ml-5 mt-0.5">
                  <NewRevisionDialog modelId={m.model_id} compact />
                </div>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Sidebar({ projectId }: SidebarProps) {
  const { data: project } = useProject(projectId)
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Project header */}
      <button
        onClick={() => navigate(`/projects/${projectId}`)}
        className="flex items-center gap-2 border-b px-3 py-3 text-left hover:bg-slate-50"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-slate-700 text-xs font-bold text-white">
          {project?.name?.slice(0, 1).toUpperCase() ?? '…'}
        </div>
        <span className="truncate text-sm font-semibold text-slate-800">
          {project?.name ?? 'Loading…'}
        </span>
      </button>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Models
          </p>
          <NewModelDialog projectId={projectId} compact />
        </div>
        <ModelList projectId={projectId} />
      </div>
    </div>
  )
}

interface AppLayoutProps {
  children: React.ReactNode
}

export default function AppLayout({ children }: AppLayoutProps) {
  const { projectId } = useParams()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={cn(
            'flex flex-col border-r bg-white transition-all duration-200',
            collapsed ? 'w-0 overflow-hidden' : 'w-60',
          )}
        >
          {projectId && <Sidebar projectId={projectId} />}
        </aside>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="absolute left-0 top-1/2 z-10 flex h-8 w-4 -translate-y-1/2 items-center justify-center rounded-r border border-l-0 bg-white text-slate-400 shadow-sm transition-all duration-200 hover:text-slate-700"
          style={{ left: collapsed ? 0 : 240 }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  )
}
