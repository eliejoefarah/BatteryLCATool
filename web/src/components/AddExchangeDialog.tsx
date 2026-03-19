import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import type { Exchange } from '../hooks/useExchanges'
import { useParameterNames } from '../hooks/useParameters'
import { useFlowResolver } from '../hooks/useFlowResolver'
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

interface FlowResult {
  flow_id: string
  name: string
}

interface Props {
  processId: string
  revisionId: string
  unitSymbols: string[]
  onAdded: (exchange: Exchange) => void
}

const OUTPUT_TYPES = ['reference', 'coproduct', 'waste_output', 'stock'] as const

export default function AddExchangeDialog({ processId, revisionId, unitSymbols, onAdded }: Props) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const paramNames = useParameterNames(revisionId)
  const { resolveFlow, FlowResolverModal } = useFlowResolver()

  // Flow name typeahead state
  const [rawName, setRawName] = useState('')
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null)
  const [flowResults, setFlowResults] = useState<FlowResult[]>([])
  const flowInputRef = useRef<HTMLInputElement>(null)

  // Other fields
  const [quantity, setQuantity] = useState('')
  const [formulaUser, setFormulaUser] = useState('')
  const [userUnit, setUserUnit] = useState('')
  const [direction, setDirection] = useState<'input' | 'output'>('input')
  const [outputType, setOutputType] = useState('')
  const [sourceDb, setSourceDb] = useState('')
  const [sourceLocation, setSourceLocation] = useState('')
  const [comment, setComment] = useState('')
  const [details, setDetails] = useState('')
  const [costPerUnit, setCostPerUnit] = useState('')
  const [observations, setObservations] = useState('')

  // Debounced flow search
  useEffect(() => {
    const trimmed = rawName.trim()
    if (!trimmed) { setFlowResults([]); return }
    const timer = setTimeout(async () => {
      const escaped = trimmed.replace(/"/g, '""')
      const { data } = await supabase
        .from('flow_catalog')
        .select('flow_id, canonical_name, display_name')
        .or(`canonical_name.ilike."%${escaped}%",display_name.ilike."%${escaped}%"`)
        .limit(10)
      setFlowResults(
        (data ?? []).map((f) => ({
          flow_id: f.flow_id,
          name: f.display_name ?? f.canonical_name,
        })),
      )
    }, 200)
    return () => clearTimeout(timer)
  }, [rawName])

  function reset() {
    setRawName('')
    setSelectedFlowId(null)
    setFlowResults([])
    setQuantity('')
    setFormulaUser('')
    setUserUnit('')
    setDirection('input')
    setOutputType('')
    setSourceDb('')
    setSourceLocation('')
    setComment('')
    setDetails('')
    setCostPerUnit('')
    setObservations('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!rawName.trim()) {
      toast.error('Flow name is required')
      return
    }

    setSubmitting(true)
    try {
      // resolveFlow may open an interactive modal; throws if user cancels
      const flowId = await resolveFlow(rawName, selectedFlowId)

      const payload: Record<string, unknown> = {
        process_id: processId,
        exchange_direction: direction,
        raw_name: rawName.trim(),
        flow_id: flowId,
      }
      if (formulaUser.trim()) payload.formula_user = formulaUser.trim()
      else if (quantity !== '') payload.quantity_user = parseFloat(quantity)
      if (userUnit) payload.user_unit = userUnit
      if (direction === 'output' && outputType) payload.output_type = outputType
      if (sourceDb.trim()) payload.source_database = sourceDb.trim()
      if (sourceLocation.trim()) payload.source_location = sourceLocation.trim()
      if (comment.trim()) payload.comment = comment.trim()
      if (details.trim()) payload.details = details.trim()
      if (costPerUnit !== '') payload.cost_per_unit = parseFloat(costPerUnit)
      if (observations.trim()) payload.observations = observations.trim()

      const { data, error } = await supabase
        .from('process_exchange')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(payload as any)
        .select('*')
        .single()

      if (error) throw error

      const newExchange: Exchange = {
        ...data,
        flow_display_name: null,
        flow_canonical_name: null,
        flow_kind: null,
        flow_default_unit: null,
      }
      onAdded(newExchange)
      setOpen(false)
      reset()
    } catch (err) {
      // resolveFlow rejects (void) when user hits Cancel — don't show an error
      if (err !== undefined) {
        toast.error(err instanceof Error ? err.message : 'Failed to add exchange')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
    <FlowResolverModal allowCancel />
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Exchange
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add Exchange</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Flow name with typeahead */}
          <div className="space-y-1.5">
            <Label htmlFor="flow-name">Flow name <span className="text-red-500">*</span></Label>
            <div className="relative">
              <Input
                id="flow-name"
                ref={flowInputRef}
                placeholder="Search flow catalog or enter a new name…"
                value={rawName}
                onChange={(e) => { setRawName(e.target.value); setSelectedFlowId(null) }}
                autoComplete="off"
              />
              {flowResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg">
                  {flowResults.map((r) => (
                    <button
                      key={r.flow_id}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                      onMouseDown={() => {
                        setRawName(r.name)
                        setSelectedFlowId(r.flow_id)
                        setFlowResults([])
                        flowInputRef.current?.blur()
                      }}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedFlowId && (
              <p className="text-xs text-green-600">Matched in catalog</p>
            )}
            {rawName.trim() && !selectedFlowId && (
              <p className="text-xs text-amber-600">Will create a new flow in catalog</p>
            )}
          </div>

          {/* Quantity / Formula + Unit */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="quantity">
                  Quantity{formulaUser.trim() && (
                    <span className="ml-1.5 text-xs text-slate-400">(overridden by formula)</span>
                  )}
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  step="any"
                  placeholder="e.g. 1.5"
                  value={quantity}
                  disabled={!!formulaUser.trim()}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select value={userUnit} onValueChange={setUserUnit}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {unitSymbols.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Formula field */}
            <div className="space-y-1.5">
              <Label htmlFor="formula">
                Formula{' '}
                <span className="font-normal text-slate-400">(optional — overrides quantity)</span>
              </Label>
              <Input
                id="formula"
                placeholder="e.g. capacity_Ah * 0.5"
                value={formulaUser}
                onChange={(e) => setFormulaUser(e.target.value)}
                className={formulaUser.trim() ? 'border-violet-300 font-mono text-violet-700' : ''}
              />
              {paramNames.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <span className="text-xs text-slate-400">Available:</span>
                  {paramNames.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="rounded bg-violet-50 px-1.5 py-0.5 font-mono text-xs text-violet-700 hover:bg-violet-100"
                      onClick={() =>
                        setFormulaUser((f) => (f ? `${f} * ${n}` : n))
                      }
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Direction + Output type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Direction</Label>
              <Select
                value={direction}
                onValueChange={(v) => {
                  setDirection(v as 'input' | 'output')
                  if (v === 'input') setOutputType('')
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="input">Input</SelectItem>
                  <SelectItem value="output">Output</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {direction === 'output' && (
              <div className="space-y-1.5">
                <Label>Output type</Label>
                <Select value={outputType} onValueChange={setOutputType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTPUT_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">
                        {t.replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Source DB + Origin in a two-column row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="source-db">Source database</Label>
              <Input
                id="source-db"
                placeholder="e.g. ecoinvent 3.9"
                value={sourceDb}
                onChange={(e) => setSourceDb(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source-location">Origin / geography</Label>
              <Input
                id="source-location"
                placeholder="e.g. DE, RoW, GLO"
                value={sourceLocation}
                onChange={(e) => setSourceLocation(e.target.value)}
              />
            </div>
          </div>

          {/* Comment */}
          <div className="space-y-1.5">
            <Label htmlFor="comment">Comment</Label>
            <Textarea
              id="comment"
              placeholder="Optional notes…"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          {/* Details */}
          <div className="space-y-1.5">
            <Label htmlFor="details">Details</Label>
            <Input
              id="details"
              placeholder="Range / min-max values…"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>

          {/* Cost per unit */}
          <div className="space-y-1.5">
            <Label htmlFor="cost-per-unit">Cost (€/unit)</Label>
            <Input
              id="cost-per-unit"
              type="number"
              step="any"
              placeholder="e.g. 5.20"
              value={costPerUnit}
              onChange={(e) => setCostPerUnit(e.target.value)}
            />
          </div>

          {/* Observations */}
          <div className="space-y-1.5">
            <Label htmlFor="observations">Observations</Label>
            <Textarea
              id="observations"
              placeholder="Supplier, % recycled content…"
              rows={2}
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add Exchange'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    </>
  )
}
