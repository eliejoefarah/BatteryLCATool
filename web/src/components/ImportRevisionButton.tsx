import { useRef, useState } from 'react'
import { AlertTriangle, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import NewRevisionDialog from './NewRevisionDialog'

interface Props {
  revisionId: string
  modelId: string
  onImported?: (result: ImportResult) => void
}

interface ImportResult {
  processes_created: number
  exchanges_created: number
  warnings: string[]
  already_has_data?: boolean
}

export default function ImportRevisionButton({ revisionId, modelId, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)

  // Conflict resolution state
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [showConflict, setShowConflict] = useState(false)
  const [showNewRevision, setShowNewRevision] = useState(false)

  async function doImport(file: File, force = false) {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      toast.error('Not authenticated')
      return
    }

    const apiUrl = import.meta.env.VITE_RAILWAY_FASTAPI_URL as string
    if (!apiUrl) {
      toast.error('API URL not configured (VITE_RAILWAY_FASTAPI_URL)')
      return
    }

    setLoading(true)
    const toastId = toast.loading(`Importing "${file.name}"…`)
    const form = new FormData()
    form.append('file', file)

    try {
      const url = force
        ? `${apiUrl}/api/v1/import/${revisionId}?force=true`
        : `${apiUrl}/api/v1/import/${revisionId}`

      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      })

      const body: ImportResult & { detail?: string } = await res.json()

      if (!res.ok) {
        if (res.status === 409) {
          // Revision already has data — show conflict dialog
          toast.dismiss(toastId)
          setPendingFile(file)
          setShowConflict(true)
        } else {
          toast.error(body.detail ?? 'Import failed', { id: toastId })
        }
        return
      }

      const { processes_created, exchanges_created, warnings = [] } = body
      const summary =
        `Imported ${processes_created} process${processes_created !== 1 ? 'es' : ''}, ` +
        `${exchanges_created} exchange${exchanges_created !== 1 ? 's' : ''}` +
        (warnings.length
          ? ` · ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`
          : '')

      toast.success(summary, { id: toastId })

      queryClient.invalidateQueries({ queryKey: ['processes', revisionId] })
      queryClient.invalidateQueries({ queryKey: ['exchanges'] })
      queryClient.invalidateQueries({ queryKey: ['exchange-count', revisionId] })
      queryClient.invalidateQueries({ queryKey: ['parameter-count', revisionId] })

      onImported?.(body)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed', {
        id: toastId,
      })
    } finally {
      setLoading(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    doImport(file)
  }

  async function handleOverride() {
    if (!pendingFile) return
    setShowConflict(false)
    await doImport(pendingFile, true)
    setPendingFile(null)
  }

  function handleCreateNewRevision() {
    setShowConflict(false)
    setShowNewRevision(true)
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={loading}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="mr-1.5 h-4 w-4" />
        {loading ? 'Importing…' : 'Import xlsx'}
      </Button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Conflict dialog */}
      <Dialog open={showConflict} onOpenChange={(v) => { if (!v) { setShowConflict(false); setPendingFile(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              This revision already has data
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-slate-500">
            This revision already contains processes and exchanges. How would
            you like to proceed?
          </p>

          <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-800">
              Overriding will permanently delete all existing processes and
              exchanges in this revision before importing the new file.
            </p>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant="destructive"
              className="w-full"
              onClick={handleOverride}
            >
              Override this revision
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleCreateNewRevision}
            >
              Create a new revision instead
            </Button>
            <Button
              variant="ghost"
              className="w-full text-slate-400"
              onClick={() => { setShowConflict(false); setPendingFile(null) }}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New revision dialog — opened programmatically after conflict */}
      <NewRevisionDialog
        modelId={modelId}
        open={showNewRevision}
        onOpenChange={setShowNewRevision}
      />
    </>
  )
}
