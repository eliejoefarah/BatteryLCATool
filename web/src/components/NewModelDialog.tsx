import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
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
  projectId: string
  compact?: boolean
}

export default function NewModelDialog({ projectId, compact }: Props) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [chemistry, setChemistry] = useState('')
  const [functionalUnit, setFunctionalUnit] = useState('1 kWh battery pack')
  const [label, setLabel] = useState('Initial draft')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setLoading(true)

    // 1. Create battery_model
    const { data: model, error: modelError } = await supabase
      .from('battery_model')
      .insert({
        project_id: projectId,
        name: name.trim(),
        chemistry: chemistry.trim() || null,
        functional_unit: functionalUnit.trim() || null,
        created_by: user.id,
      })
      .select('model_id')
      .single()

    if (modelError || !model) {
      toast.error(modelError?.message ?? 'Failed to create model')
      setLoading(false)
      return
    }

    // 2. Create first revision
    const { data: revision, error: revError } = await supabase
      .from('battery_model_revision')
      .insert({
        model_id: model.model_id,
        revision_number: 1,
        label: label.trim() || null,
        is_active: true,
        status: 'draft',
        created_by: user.id,
        notes: null,
      })
      .select('revision_id')
      .single()

    if (revError || !revision) {
      toast.error(revError?.message ?? 'Failed to create revision')
      setLoading(false)
      return
    }

    // Invalidate caches
    queryClient.invalidateQueries({ queryKey: ['battery-models', projectId] })
    queryClient.invalidateQueries({
      queryKey: ['revisions', model.model_id],
    })

    setOpen(false)
    setName('')
    setChemistry('')
    setFunctionalUnit('1 kWh battery pack')
    setLabel('Initial draft')
    setLoading(false)

    toast.success(`Model "${name}" created`)
    navigate(
      `/projects/${projectId}/models/${model.model_id}/revisions/${revision.revision_id}`,
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <button
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="New model"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            New Model
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Battery Model</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Model name *</Label>
            <Input
              id="name"
              placeholder="e.g. NMC811 Parametric Model"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chemistry">Chemistry</Label>
            <Input
              id="chemistry"
              placeholder="e.g. NMC811, LFP"
              value={chemistry}
              onChange={(e) => setChemistry(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="functional_unit">Functional unit</Label>
            <Input
              id="functional_unit"
              placeholder="e.g. 1 kWh battery pack"
              value={functionalUnit}
              onChange={(e) => setFunctionalUnit(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="label">First revision label</Label>
            <Input
              id="label"
              placeholder="e.g. Initial draft"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
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
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
