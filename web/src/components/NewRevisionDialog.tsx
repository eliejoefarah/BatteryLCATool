import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { useRevisions } from '../hooks/useRevision'
import { queryClient } from '../lib/queryClient'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'

interface Props {
  modelId: string
  compact?: boolean
  /** If provided, puts the dialog in controlled mode */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export default function NewRevisionDialog({ modelId, compact, open: controlledOpen, onOpenChange }: Props) {
  const navigate = useNavigate()
  const { projectId } = useParams()
  const user = useAuthStore((s) => s.user)
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v)
    onOpenChange?.(v)
  }
  const [loading, setLoading] = useState(false)
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')

  const { data: revisions } = useRevisions(modelId)
  // Display-only preview — actual number is recomputed at submit time
  const previewRevNumber =
    revisions && revisions.length > 0
      ? Math.max(...revisions.map((r) => r.revision_number)) + 1
      : 1

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !projectId) return
    setLoading(true)

    // Re-fetch the current max revision_number right before inserting to avoid
    // duplicates from deleted revisions or concurrent creates.
    const { data: existing, error: fetchError } = await supabase
      .from('battery_model_revision')
      .select('revision_number')
      .eq('model_id', modelId)
      .order('revision_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchError) {
      toast.error(fetchError.message)
      setLoading(false)
      return
    }

    const nextRevNumber = existing ? existing.revision_number + 1 : 1
    // Only the first revision per model is active; subsequent ones start inactive
    const isFirstRevision = !existing

    const { data: revision, error } = await supabase
      .from('battery_model_revision')
      .insert({
        model_id: modelId,
        revision_number: nextRevNumber,
        label: label.trim() || null,
        is_active: isFirstRevision,
        status: 'draft',
        created_by: user.id,
        notes: notes.trim() || null,
      })
      .select('revision_id')
      .single()

    if (error || !revision) {
      toast.error(error?.message ?? 'Failed to create revision')
      setLoading(false)
      return
    }

    queryClient.invalidateQueries({ queryKey: ['revisions', modelId] })

    setOpen(false)
    setLabel('')
    setNotes('')
    setLoading(false)

    toast.success(`Revision ${nextRevNumber} created`)
    navigate(
      `/projects/${projectId}/models/${modelId}/revisions/${revision.revision_id}`,
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <button
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="New revision"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5">
            <Plus className="h-4 w-4" />
            New Revision
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Revision (Rev {previewRevNumber})</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              placeholder={`e.g. Rev ${previewRevNumber} — updated parameters`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              placeholder="What changed in this revision?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
