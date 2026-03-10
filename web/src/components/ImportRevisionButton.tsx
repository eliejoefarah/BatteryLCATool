import { useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Upload } from 'lucide-react'
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

/** Removes raw Pydantic / framework boilerplate from a backend message. */
function cleanMessage(msg: string): string {
  return msg
    // strip "N validation error(s) for XlsxExchangeRow …" prefix
    .replace(/\d+ validation errors? for \w+\s*/gi, '')
    // strip "[type=…, input_value=…, input_type=…]" suffix
    .replace(/\[type=[^\]]+\]/g, '')
    // strip "For further information visit https://…" suffix
    .replace(/\s*For further information visit https?:\/\/\S+/gi, '')
    .trim()
}

/** Matches the API's ImportJobResponse model. */
interface ImportResult {
  activities_created: number
  exchanges_created: number
  parameters_created: number
  warnings_count: number
  errors_count: number
  warnings: string[]
  errors: string[]
}

export default function ImportRevisionButton({ revisionId, modelId, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)

  // Conflict resolution state
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [showConflict, setShowConflict] = useState(false)
  const [showNewRevision, setShowNewRevision] = useState(false)

  // Import messages dialog
  const [importMessages, setImportMessages] = useState<ImportResult | null>(null)
  const [undoing, setUndoing] = useState(false)

  async function undoImport() {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    const apiUrl = import.meta.env.VITE_RAILWAY_FASTAPI_URL as string
    setUndoing(true)
    try {
      await fetch(`${apiUrl}/api/v1/import/${revisionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      queryClient.invalidateQueries({ queryKey: ['processes', revisionId] })
      queryClient.invalidateQueries({ queryKey: ['exchanges'] })
      queryClient.invalidateQueries({ queryKey: ['exchange-count', revisionId] })
      queryClient.invalidateQueries({ queryKey: ['parameter-count', revisionId] })
      queryClient.invalidateQueries({ queryKey: ['parameters', revisionId] })
      toast.success('Import undone — revision is now empty.')
    } catch {
      toast.error('Could not undo the import.')
    } finally {
      setUndoing(false)
      setImportMessages(null)
    }
  }

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

      const {
        activities_created = 0,
        exchanges_created = 0,
        parameters_created = 0,
        warnings = [],
        errors = [],
      } = body

      const hasIssues = warnings.length > 0 || errors.length > 0

      const summary =
        `Imported ${activities_created} process${activities_created !== 1 ? 'es' : ''}, ` +
        `${exchanges_created} exchange${exchanges_created !== 1 ? 's' : ''}` +
        (parameters_created > 0 ? `, ${parameters_created} parameter${parameters_created !== 1 ? 's' : ''}` : '') +
        (errors.length ? ` · ${errors.length} error${errors.length !== 1 ? 's' : ''}` : '') +
        (warnings.length ? ` · ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}` : '')

      if (errors.length > 0) {
        toast.error(summary, { id: toastId })
      } else {
        toast.success(summary, { id: toastId })
      }

      if (hasIssues) {
        setImportMessages(body)
      }

      queryClient.invalidateQueries({ queryKey: ['processes', revisionId] })
      queryClient.invalidateQueries({ queryKey: ['exchanges'] })
      queryClient.invalidateQueries({ queryKey: ['exchange-count', revisionId] })
      queryClient.invalidateQueries({ queryKey: ['parameter-count', revisionId] })
      queryClient.invalidateQueries({ queryKey: ['parameters', revisionId] })

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
        {loading ? 'Importing…' : 'Import Sheet'}
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

      {/* Import messages dialog — shown when there are warnings or errors */}
      {importMessages && (
        <ImportMessagesDialog
          result={importMessages}
          onKeep={() => setImportMessages(null)}
          onUndo={undoImport}
          undoing={undoing}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Import messages dialog
// ---------------------------------------------------------------------------

function ImportMessagesDialog({
  result,
  onKeep,
  onUndo,
  undoing,
}: {
  result: ImportResult
  onKeep: () => void
  onUndo: () => void
  undoing: boolean
}) {
  const [showWarnings, setShowWarnings] = useState(true)
  const [showErrors, setShowErrors] = useState(true)

  const allMessages = [...result.errors, ...result.warnings]
  const total = allMessages.length

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !undoing) onKeep() }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Import completed — {total} issue{total !== 1 ? 's' : ''} found
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-slate-600">
          <span className="font-medium">{result.activities_created}</span> process{result.activities_created !== 1 ? 'es' : ''} and{' '}
          <span className="font-medium">{result.exchanges_created}</span> exchange{result.exchanges_created !== 1 ? 's' : ''} were imported,
          including any rows with issues.
          You can keep the import and fix issues later using the Exchanges panel,
          or undo it to correct your spreadsheet first.
        </p>

        <div className="flex-1 overflow-auto space-y-3 mt-2">
          {result.errors.length > 0 && (
            <MessageSection
              title={`Issues (${result.errors.length})`}
              messages={result.errors.map(cleanMessage)}
              open={showErrors}
              onToggle={() => setShowErrors((v) => !v)}
              variant="warning"
            />
          )}
          {result.warnings.length > 0 && (
            <MessageSection
              title={`Notices (${result.warnings.length})`}
              messages={result.warnings.map(cleanMessage)}
              open={showWarnings}
              onToggle={() => setShowWarnings((v) => !v)}
              variant="info"
            />
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
            onClick={onUndo}
            disabled={undoing}
          >
            {undoing ? 'Undoing…' : 'Undo import'}
          </Button>
          <Button className="flex-1" onClick={onKeep}>
            Keep import
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MessageSection({
  title,
  messages,
  open,
  onToggle,
  variant,
}: {
  title: string
  messages: string[]
  open: boolean
  onToggle: () => void
  variant: 'warning' | 'info'
}) {
  const isWarning = variant === 'warning'
  return (
    <div className={`rounded-lg border ${isWarning ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
      <button
        className={`flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium ${isWarning ? 'text-amber-700' : 'text-blue-700'}`}
        onClick={onToggle}
      >
        {title}
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <ul className="border-t px-4 py-2 space-y-2 max-h-60 overflow-auto">
          {messages.map((msg, i) => (
            <li key={i} className={`text-xs ${isWarning ? 'text-amber-800' : 'text-blue-800'}`}>
              {msg}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
