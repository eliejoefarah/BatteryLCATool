import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useParameters, invalidateParameters, type Parameter } from '../hooks/useParameters'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

// ---------------------------------------------------------------------------
// Add / Edit dialog
// ---------------------------------------------------------------------------

const DISTRIBUTIONS = ['', 'uniform', 'triangular', 'normal', 'lognormal'] as const

interface ParamFormProps {
  revisionId: string
  existing?: Parameter
  onDone: () => void
}

function ParamForm({ revisionId, existing, onDone }: ParamFormProps) {
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [value, setValue] = useState(existing?.value != null ? String(existing.value) : '')
  const [distribution, setDistribution] = useState(existing?.distribution_type ?? '')
  const [minVal, setMinVal] = useState(existing?.min_value != null ? String(existing.min_value) : '')
  const [maxVal, setMaxVal] = useState(existing?.max_value != null ? String(existing.max_value) : '')
  const [modeVal, setModeVal] = useState(existing?.mode_value != null ? String(existing.mode_value) : '')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Name is required'); return }
    const numVal = parseFloat(value)
    if (isNaN(numVal)) { toast.error('Value must be a number'); return }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        revision_id: revisionId,
        name: name.trim(),
        description: description.trim() || null,
        value: numVal,
        param_type: 'scalar',
        distribution_type: distribution || null,
        min_value: minVal !== '' ? parseFloat(minVal) : null,
        max_value: maxVal !== '' ? parseFloat(maxVal) : null,
        mode_value: modeVal !== '' ? parseFloat(modeVal) : null,
      }

      if (existing) {
        const { error } = await supabase
          .from('model_parameter')
          .update(payload)
          .eq('param_id', existing.param_id)
        if (error) throw error
        toast.success(`Parameter "${name.trim()}" updated`)
      } else {
        const { error } = await supabase
          .from('model_parameter')
          .insert(payload)
        if (error) throw error
        toast.success(`Parameter "${name.trim()}" added`)
      }

      invalidateParameters(queryClient, revisionId)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save parameter')
    } finally {
      setSaving(false)
    }
  }

  const showDistributionFields = !!distribution

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="p-name">
            Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="p-name"
            placeholder="e.g. capacity_Ah"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!!existing} // renaming would break formulas
          />
          {existing && (
            <p className="text-xs text-slate-400">
              Name cannot be changed (used in formulas)
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-value">
            Value <span className="text-red-500">*</span>
          </Label>
          <Input
            id="p-value"
            type="number"
            step="any"
            placeholder="e.g. 100"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="p-description">Description</Label>
        <Textarea
          id="p-description"
          rows={2}
          placeholder="What does this parameter represent?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {/* Uncertainty / distribution */}
      <div className="space-y-1.5">
        <Label>Distribution (for Monte Carlo)</Label>
        <Select value={distribution} onValueChange={setDistribution}>
          <SelectTrigger>
            <SelectValue placeholder="None (deterministic)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">None (deterministic)</SelectItem>
            <SelectItem value="uniform">Uniform</SelectItem>
            <SelectItem value="triangular">Triangular</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="lognormal">Log-normal</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {showDistributionFields && (
        <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Distribution parameters
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-min">Min</Label>
              <Input
                id="p-min"
                type="number"
                step="any"
                placeholder="—"
                value={minVal}
                onChange={(e) => setMinVal(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-mode">
                {distribution === 'normal' || distribution === 'lognormal' ? 'Mean' : 'Mode'}
              </Label>
              <Input
                id="p-mode"
                type="number"
                step="any"
                placeholder="—"
                value={modeVal}
                onChange={(e) => setModeVal(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-max">
                {distribution === 'normal' || distribution === 'lognormal' ? 'Std dev' : 'Max'}
              </Label>
              <Input
                id="p-max"
                type="number"
                step="any"
                placeholder="—"
                value={maxVal}
                onChange={(e) => setMaxVal(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Add parameter'}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Parameter row — inline display + expand for distribution detail
// ---------------------------------------------------------------------------

interface RowProps {
  param: Parameter
  revisionId: string
  onEdit: (p: Parameter) => void
  onDelete: (p: Parameter) => void
}

function ParameterRow({ param, revisionId, onEdit, onDelete }: RowProps) {
  const [expanded, setExpanded] = useState(false)
  const hasDistribution = !!param.distribution_type

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Expand toggle */}
        <button
          type="button"
          className="text-slate-300 hover:text-slate-500 transition-colors"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse' : 'Expand'}
          disabled={!hasDistribution}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className={`h-4 w-4 ${!hasDistribution ? 'opacity-0' : ''}`} />
          )}
        </button>

        {/* Name */}
        <code className="min-w-[140px] rounded bg-slate-100 px-2 py-0.5 text-sm font-mono text-slate-800">
          {param.name}
        </code>

        {/* Value */}
        <span className="min-w-[80px] text-sm font-medium text-slate-700 tabular-nums">
          {param.value}
        </span>

        {/* Distribution badge */}
        {param.distribution_type ? (
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700 capitalize">
            {param.distribution_type}
          </span>
        ) : (
          <span className="text-xs text-slate-300">deterministic</span>
        )}

        {/* Description */}
        <span className="flex-1 truncate text-xs text-slate-400">
          {param.description ?? ''}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-slate-500"
            onClick={() => onEdit(param)}
          >
            Edit
          </Button>
          <button
            type="button"
            title="Delete parameter"
            className="flex h-7 w-7 items-center justify-center rounded text-slate-300 transition-colors hover:text-red-500"
            onClick={() => onDelete(param)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Distribution detail */}
      {expanded && hasDistribution && (
        <div className="border-t bg-slate-50 px-4 py-3">
          <div className="grid grid-cols-4 gap-4 text-xs">
            <div>
              <p className="text-slate-400">Distribution</p>
              <p className="mt-0.5 font-medium capitalize text-slate-700">
                {param.distribution_type}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Min</p>
              <p className="mt-0.5 font-medium text-slate-700">
                {param.min_value ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-slate-400">
                {param.distribution_type === 'normal' || param.distribution_type === 'lognormal'
                  ? 'Mean'
                  : 'Mode'}
              </p>
              <p className="mt-0.5 font-medium text-slate-700">
                {param.mode_value ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-slate-400">
                {param.distribution_type === 'normal' || param.distribution_type === 'lognormal'
                  ? 'Std dev'
                  : 'Max'}
              </p>
              <p className="mt-0.5 font-medium text-slate-700">
                {param.max_value ?? '—'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ParameterEditor — main exported component
// ---------------------------------------------------------------------------

interface Props {
  revisionId: string
}

export default function ParameterEditor({ revisionId }: Props) {
  const { data: parameters = [], isLoading } = useParameters(revisionId)
  const [addOpen, setAddOpen] = useState(false)
  const [editParam, setEditParam] = useState<Parameter | null>(null)
  const [deleteParam, setDeleteParam] = useState<Parameter | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!deleteParam) return
    setDeleting(true)
    const { error } = await supabase
      .from('model_parameter')
      .delete()
      .eq('param_id', deleteParam.param_id)
    setDeleting(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success(`Parameter "${deleteParam.name}" deleted`)
    invalidateParameters(queryClient, revisionId)
    setDeleteParam(null)
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-slate-700">Parameters</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Scalar values referenced by formula strings in exchanges (e.g.{' '}
            <code className="rounded bg-slate-100 px-1">capacity_Ah * 0.5</code>)
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1.5 h-4 w-4" />
              Add Parameter
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Parameter</DialogTitle>
            </DialogHeader>
            <ParamForm
              revisionId={revisionId}
              onDone={() => setAddOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Available names hint */}
      {parameters.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {parameters.map((p) => (
            <code
              key={p.param_id}
              className="rounded bg-violet-50 px-2 py-0.5 text-xs font-mono text-violet-700"
              title={`value = ${p.value}${p.description ? ` · ${p.description}` : ''}`}
            >
              {p.name}
            </code>
          ))}
          <span className="text-xs text-slate-400 self-center">
            — use these names in exchange formulas
          </span>
        </div>
      )}

      {/* Parameter list */}
      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : parameters.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-6 py-8 text-center">
          <p className="text-sm text-slate-500">No parameters yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Add parameters to use in exchange formulas, or import them from an xlsx file.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {parameters.map((p) => (
            <ParameterRow
              key={p.param_id}
              param={p}
              revisionId={revisionId}
              onEdit={setEditParam}
              onDelete={setDeleteParam}
            />
          ))}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editParam} onOpenChange={(v) => { if (!v) setEditParam(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Parameter</DialogTitle>
          </DialogHeader>
          {editParam && (
            <ParamForm
              revisionId={revisionId}
              existing={editParam}
              onDone={() => setEditParam(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteParam} onOpenChange={(v) => { if (!v) setDeleteParam(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete parameter?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">
            Parameter{' '}
            <code className="rounded bg-slate-100 px-1 text-slate-800">
              {deleteParam?.name}
            </code>{' '}
            will be permanently deleted. Any exchange formulas referencing it
            will stop resolving correctly.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteParam(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
