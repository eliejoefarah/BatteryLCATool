import { useState, useEffect } from 'react'
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import type { Database } from '../../types/database.types'
import { Badge } from '../../components/ui/badge'
import { Skeleton } from '../../components/ui/skeleton'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs'

type UnitRow = Database['public']['Tables']['unit_catalog']['Row']
type DataOriginRow = Database['public']['Tables']['data_origin_catalog']['Row']
type ValidationRuleRow = Database['public']['Tables']['validation_rule']['Row']
type FlowRow = Database['public']['Tables']['flow_catalog']['Row']

type ValidationSeverity = 'error' | 'warning' | 'info'
type FlowKind = 'material' | 'energy' | 'emission' | 'waste' | 'water' | 'service' | 'infrastructure'
type FlowDimension = 'mass' | 'energy' | 'volume' | 'area' | 'length' | 'count' | 'transport' | 'radioactivity' | 'time' | 'other'

const FLOW_KINDS: FlowKind[] = ['material', 'energy', 'emission', 'waste', 'water', 'service', 'infrastructure']
const FLOW_DIMENSIONS: FlowDimension[] = ['mass', 'energy', 'volume', 'area', 'length', 'count', 'transport', 'radioactivity', 'time', 'other']
const SEVERITIES: ValidationSeverity[] = ['error', 'warning', 'info']
const PAGE_SIZE = 100
const DEFAULT_CATALOG_SET_ID = '00000000-0000-0000-0001-000000000001'

// ── kind styling ─────────────────────────────────────────────────────────────

const KIND_STYLE: Record<FlowKind, { bg: string; text: string; border: string }> = {
  material:       { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  energy:         { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  emission:       { bg: 'bg-rose-50',   text: 'text-rose-700',   border: 'border-rose-200' },
  waste:          { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  water:          { bg: 'bg-cyan-50',   text: 'text-cyan-700',   border: 'border-cyan-200' },
  service:        { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  infrastructure: { bg: 'bg-slate-50',  text: 'text-slate-700',  border: 'border-slate-200' },
}

function KindBadge({ kind }: { kind: string }) {
  const s = KIND_STYLE[kind as FlowKind]
  if (!s) return <span className="text-slate-400 text-xs">{kind}</span>
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text} ${s.border}`}>
      {kind}
    </span>
  )
}

// ── data fetchers ─────────────────────────────────────────────────────────────

async function fetchFlowCount(kind: FlowKind | null): Promise<number> {
  let q = supabase.from('flow_catalog').select('*', { count: 'exact', head: true })
  if (kind) q = q.eq('kind', kind)
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

async function fetchFlowsPage(
  kind: FlowKind | null,
  search: string,
  page: number,
  elementaryFilter: boolean | null,
): Promise<{ data: FlowRow[]; count: number }> {
  let q = supabase
    .from('flow_catalog')
    .select('*', { count: 'exact' })
    .order('canonical_name', { ascending: true })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

  if (kind) q = q.eq('kind', kind)
  if (elementaryFilter !== null) q = q.eq('is_elementary_flow', elementaryFilter)
  if (search.trim()) {
    const term = `%${search.trim()}%`
    q = q.or(`canonical_name.ilike.${term},display_name.ilike.${term},cas_number.ilike.${term}`)
  }

  const { data, count, error } = await q
  if (error) throw error
  return { data: data ?? [], count: count ?? 0 }
}

async function fetchUnits(): Promise<UnitRow[]> {
  const { data, error } = await supabase
    .from('unit_catalog')
    .select('*')
    .order('symbol', { ascending: true })
  if (error) throw error
  return data
}

async function fetchDataOrigins(): Promise<DataOriginRow[]> {
  const { data, error } = await supabase
    .from('data_origin_catalog')
    .select('*')
    .order('code', { ascending: true })
  if (error) throw error
  return data
}

async function fetchValidationRules(): Promise<ValidationRuleRow[]> {
  const { data, error } = await supabase
    .from('validation_rule')
    .select('*')
    .order('severity', { ascending: true })
    .order('code', { ascending: true })
  if (error) throw error
  return data
}

// ── shared sub-components ─────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const s = severity as ValidationSeverity
  if (s === 'error') return <Badge variant="destructive">error</Badge>
  if (s === 'warning') return <Badge variant="secondary" className="text-amber-600">warning</Badge>
  return <Badge variant="outline">info</Badge>
}

function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((__, j) => (
            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

function NoData({ cols, message = 'No data' }: { cols: number; message?: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-center text-slate-400 py-8">{message}</TableCell>
    </TableRow>
  )
}

function DeleteConfirmDialog({
  name,
  open,
  busy,
  onConfirm,
  onCancel,
}: {
  name: string
  open: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete entry?</DialogTitle>
          <DialogDescription>
            This will permanently remove <strong>{name}</strong>. This cannot be undone
            and may break existing data referencing this entry.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors"
      title="Delete"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}

// ── UnitsTab ──────────────────────────────────────────────────────────────────

interface AddUnitForm {
  unit_id: string
  symbol: string
  dimension: FlowDimension | ''
  factor_to_si: string
  description: string
}

const EMPTY_UNIT_FORM: AddUnitForm = {
  unit_id: '',
  symbol: '',
  dimension: '',
  factor_to_si: '',
  description: '',
}

function UnitsTab() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<AddUnitForm>(EMPTY_UNIT_FORM)
  const [addBusy, setAddBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UnitRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const { data: units, isLoading, refetch } = useQuery({
    queryKey: ['catalog', 'units'],
    queryFn: fetchUnits,
  })

  async function handleAdd() {
    if (!form.unit_id.trim() || !form.symbol.trim() || !form.dimension || !form.factor_to_si) return
    const factor = parseFloat(form.factor_to_si)
    if (isNaN(factor)) { toast.error('Factor to SI must be a number'); return }
    setAddBusy(true)
    try {
      const { error } = await supabase.from('unit_catalog').insert({
        unit_id: form.unit_id.trim(),
        symbol: form.symbol.trim(),
        dimension: form.dimension as FlowDimension,
        factor_to_si: factor,
        description: form.description.trim() || null,
      })
      if (error) throw error
      toast.success('Unit added')
      setAddOpen(false)
      setForm(EMPTY_UNIT_FORM)
      queryClient.invalidateQueries({ queryKey: ['catalog', 'units'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add unit')
    } finally {
      setAddBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      const { error } = await supabase
        .from('unit_catalog')
        .delete()
        .eq('unit_id', deleteTarget.unit_id)
      if (error) throw error
      toast.success('Unit deleted')
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['catalog', 'units'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete unit')
    } finally {
      setDeleteBusy(false)
    }
  }

  const canAdd = form.unit_id.trim() && form.symbol.trim() && !!form.dimension && !!form.factor_to_si

  return (
    <div className="space-y-0">
      <DeleteConfirmDialog
        name={deleteTarget?.symbol ?? ''}
        open={!!deleteTarget}
        busy={deleteBusy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setForm(EMPTY_UNIT_FORM) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Unit</DialogTitle>
            <DialogDescription>Add a new unit to the unit catalog.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="u-id">Unit ID *</Label>
              <Input id="u-id" placeholder="e.g. kg" value={form.unit_id}
                onChange={(e) => setForm(f => ({ ...f, unit_id: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-symbol">Symbol *</Label>
              <Input id="u-symbol" placeholder="e.g. kg" value={form.symbol}
                onChange={(e) => setForm(f => ({ ...f, symbol: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Dimension *</Label>
              <Select value={form.dimension} onValueChange={(v) => setForm(f => ({ ...f, dimension: v as FlowDimension }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {FLOW_DIMENSIONS.map(d => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-factor">Factor to SI *</Label>
              <Input id="u-factor" placeholder="e.g. 1.0" value={form.factor_to_si}
                onChange={(e) => setForm(f => ({ ...f, factor_to_si: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-desc">Description</Label>
              <Input id="u-desc" placeholder="Optional" value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addBusy}>Cancel</Button>
            <Button onClick={handleAdd} disabled={addBusy || !canAdd}>
              {addBusy ? 'Adding…' : 'Add Unit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50/60">
        <span className="text-sm font-medium text-slate-600">Units</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-slate-500 h-8">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh
          </Button>
          <Button size="sm" className="h-8" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Add Unit
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Unit ID</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead>Dimension</TableHead>
            <TableHead>Factor to SI</TableHead>
            <TableHead>Description</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <SkeletonRows cols={6} />
          ) : !units || units.length === 0 ? (
            <NoData cols={6} />
          ) : (
            units.map((u) => (
              <TableRow key={u.unit_id}>
                <TableCell className="font-mono text-xs text-slate-500">{u.unit_id}</TableCell>
                <TableCell className="font-medium">{u.symbol}</TableCell>
                <TableCell>{u.dimension}</TableCell>
                <TableCell>{u.factor_to_si}</TableCell>
                <TableCell className="text-slate-600">{u.description ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <DeleteButton onClick={() => setDeleteTarget(u)} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

// ── DataOriginsTab ────────────────────────────────────────────────────────────

interface AddOriginForm {
  code: string
  label: string
  description: string
}

const EMPTY_ORIGIN_FORM: AddOriginForm = { code: '', label: '', description: '' }

function DataOriginsTab() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<AddOriginForm>(EMPTY_ORIGIN_FORM)
  const [addBusy, setAddBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DataOriginRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const { data: origins, isLoading, refetch } = useQuery({
    queryKey: ['catalog', 'data-origins'],
    queryFn: fetchDataOrigins,
  })

  async function handleAdd() {
    if (!form.code.trim() || !form.label.trim()) return
    setAddBusy(true)
    try {
      const { error } = await supabase.from('data_origin_catalog').insert({
        code: form.code.trim(),
        label: form.label.trim(),
        description: form.description.trim() || null,
      })
      if (error) throw error
      toast.success('Data origin added')
      setAddOpen(false)
      setForm(EMPTY_ORIGIN_FORM)
      queryClient.invalidateQueries({ queryKey: ['catalog', 'data-origins'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add data origin')
    } finally {
      setAddBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      const { error } = await supabase
        .from('data_origin_catalog')
        .delete()
        .eq('code', deleteTarget.code)
      if (error) throw error
      toast.success('Data origin deleted')
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['catalog', 'data-origins'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete data origin')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-0">
      <DeleteConfirmDialog
        name={deleteTarget?.code ?? ''}
        open={!!deleteTarget}
        busy={deleteBusy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setForm(EMPTY_ORIGIN_FORM) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Data Origin</DialogTitle>
            <DialogDescription>Add a new data origin to the catalog.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="do-code">Code *</Label>
              <Input id="do-code" placeholder="e.g. MEASURED" value={form.code}
                onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="do-label">Label *</Label>
              <Input id="do-label" placeholder="e.g. Measured data" value={form.label}
                onChange={(e) => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="do-desc">Description</Label>
              <Input id="do-desc" placeholder="Optional" value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addBusy}>Cancel</Button>
            <Button onClick={handleAdd} disabled={addBusy || !form.code.trim() || !form.label.trim()}>
              {addBusy ? 'Adding…' : 'Add Origin'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50/60">
        <span className="text-sm font-medium text-slate-600">Data Origins</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-slate-500 h-8">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh
          </Button>
          <Button size="sm" className="h-8" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Add Origin
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Description</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <SkeletonRows cols={4} />
          ) : !origins || origins.length === 0 ? (
            <NoData cols={4} />
          ) : (
            origins.map((o) => (
              <TableRow key={o.code}>
                <TableCell className="font-mono font-medium">{o.code}</TableCell>
                <TableCell>{o.label}</TableCell>
                <TableCell className="text-slate-600">{o.description ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <DeleteButton onClick={() => setDeleteTarget(o)} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

// ── ValidationRulesTab ────────────────────────────────────────────────────────

interface AddRuleForm {
  code: string
  severity: ValidationSeverity | ''
  description: string
  rule_json: string
}

const EMPTY_RULE_FORM: AddRuleForm = { code: '', severity: '', description: '', rule_json: '{}' }

function ValidationRulesTab() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<AddRuleForm>(EMPTY_RULE_FORM)
  const [addBusy, setAddBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ValidationRuleRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const { data: rules, isLoading, refetch } = useQuery({
    queryKey: ['catalog', 'validation-rules'],
    queryFn: fetchValidationRules,
  })

  async function handleAdd() {
    if (!form.code.trim() || !form.severity) return
    let parsedJson: unknown = {}
    if (form.rule_json.trim()) {
      try { parsedJson = JSON.parse(form.rule_json) } catch {
        toast.error('Rule JSON is not valid JSON'); return
      }
    }
    setAddBusy(true)
    try {
      const { error } = await supabase.from('validation_rule').insert({
        code: form.code.trim(),
        severity: form.severity as ValidationSeverity,
        description: form.description.trim() || null,
        rule_json: parsedJson as Database['public']['Tables']['validation_rule']['Insert']['rule_json'],
      })
      if (error) throw error
      toast.success('Validation rule added')
      setAddOpen(false)
      setForm(EMPTY_RULE_FORM)
      queryClient.invalidateQueries({ queryKey: ['catalog', 'validation-rules'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add rule')
    } finally {
      setAddBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      const { error } = await supabase
        .from('validation_rule')
        .delete()
        .eq('rule_id', deleteTarget.rule_id)
      if (error) throw error
      toast.success('Validation rule deleted')
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['catalog', 'validation-rules'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete rule')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-0">
      <DeleteConfirmDialog
        name={deleteTarget?.code ?? ''}
        open={!!deleteTarget}
        busy={deleteBusy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setForm(EMPTY_RULE_FORM) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Validation Rule</DialogTitle>
            <DialogDescription>Add a new validation rule to the catalog.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="vr-code">Code *</Label>
              <Input id="vr-code" placeholder="e.g. E001" value={form.code}
                onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Severity *</Label>
              <Select value={form.severity} onValueChange={(v) => setForm(f => ({ ...f, severity: v as ValidationSeverity }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="vr-desc">Description</Label>
              <Input id="vr-desc" placeholder="Optional" value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="vr-json">Rule JSON</Label>
              <textarea
                id="vr-json"
                rows={3}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                placeholder="{}"
                value={form.rule_json}
                onChange={(e) => setForm(f => ({ ...f, rule_json: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addBusy}>Cancel</Button>
            <Button onClick={handleAdd} disabled={addBusy || !form.code.trim() || !form.severity}>
              {addBusy ? 'Adding…' : 'Add Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50/60">
        <span className="text-sm font-medium text-slate-600">Validation Rules</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-slate-500 h-8">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh
          </Button>
          <Button size="sm" className="h-8" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Add Rule
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Description</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <SkeletonRows cols={4} />
          ) : !rules || rules.length === 0 ? (
            <NoData cols={4} />
          ) : (
            rules.map((r) => (
              <TableRow key={r.rule_id}>
                <TableCell className="font-mono font-medium">{r.code}</TableCell>
                <TableCell><SeverityBadge severity={r.severity} /></TableCell>
                <TableCell className="text-slate-600">{r.description ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <DeleteButton onClick={() => setDeleteTarget(r)} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

// ── FlowsTab ──────────────────────────────────────────────────────────────────

interface AddFlowForm {
  canonical_name: string
  display_name: string
  kind: FlowKind | ''
  dimension: FlowDimension | ''
  default_unit: string
  cas_number: string
  is_elementary_flow: boolean
}

const EMPTY_FLOW_FORM: AddFlowForm = {
  canonical_name: '',
  display_name: '',
  kind: '',
  dimension: '',
  default_unit: '',
  cas_number: '',
  is_elementary_flow: false,
}

function FlowsTab() {
  const queryClient = useQueryClient()
  const [activeKind, setActiveKind] = useState<FlowKind | null>(null)
  const [rawSearch, setRawSearch]   = useState('')
  const [search, setSearch]         = useState('')
  const [page, setPage]             = useState(0)
  const [elemFilter, setElemFilter] = useState<boolean | null>(null)
  const [addOpen, setAddOpen]       = useState(false)
  const [form, setForm]             = useState<AddFlowForm>(EMPTY_FLOW_FORM)
  const [addBusy, setAddBusy]       = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FlowRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  // Debounce search → reset page
  useEffect(() => {
    const t = setTimeout(() => { setSearch(rawSearch); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [rawSearch])

  // Reset page when kind or elem filter changes
  useEffect(() => { setPage(0) }, [activeKind, elemFilter])

  async function handleAdd() {
    if (!form.canonical_name.trim() || !form.kind) return
    setAddBusy(true)
    try {
      const { error } = await supabase.from('flow_catalog').insert({
        canonical_name: form.canonical_name.trim(),
        display_name: form.display_name.trim() || null,
        kind: form.kind as FlowKind,
        dimension: (form.dimension || null) as FlowDimension | null,
        default_unit: form.default_unit.trim() || null,
        cas_number: form.cas_number.trim() || null,
        is_elementary_flow: form.is_elementary_flow,
        catalog_set_id: DEFAULT_CATALOG_SET_ID,
      })
      if (error) throw error
      toast.success('Flow added to catalog')
      setAddOpen(false)
      setForm(EMPTY_FLOW_FORM)
      queryClient.invalidateQueries({ queryKey: ['flows'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add flow')
    } finally {
      setAddBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      const { error } = await supabase
        .from('flow_catalog')
        .delete()
        .eq('flow_id', deleteTarget.flow_id)
      if (error) throw error
      toast.success('Flow removed from catalog')
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['flows'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete flow')
    } finally {
      setDeleteBusy(false)
    }
  }

  // Per-kind counts
  const countResults = useQueries({
    queries: [
      { queryKey: ['flows', 'count', null], queryFn: () => fetchFlowCount(null), staleTime: 30_000, refetchOnWindowFocus: true },
      ...FLOW_KINDS.map(k => ({
        queryKey: ['flows', 'count', k] as const,
        queryFn: () => fetchFlowCount(k),
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      })),
    ],
  })

  const [totalCountQ, ...kindCountQs] = countResults
  const totalCount = totalCountQ.data ?? null

  const { data: pageResult, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['flows', 'page', activeKind, search, page, elemFilter],
    queryFn: () => fetchFlowsPage(activeKind, search, page, elemFilter),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  })

  const flows      = pageResult?.data ?? []
  const totalRows  = pageResult?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE))
  const pageStart  = page * PAGE_SIZE + 1
  const pageEnd    = Math.min((page + 1) * PAGE_SIZE, totalRows)

  return (
    <div className="space-y-4">

      <DeleteConfirmDialog
        name={deleteTarget?.canonical_name ?? ''}
        open={!!deleteTarget}
        busy={deleteBusy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ── Add Flow dialog ── */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setForm(EMPTY_FLOW_FORM) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Flow to Catalog</DialogTitle>
            <DialogDescription>Add a new flow entry to the default catalog set.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="f-canonical">Canonical Name *</Label>
              <Input id="f-canonical" placeholder="e.g. Carbon dioxide, fossil" value={form.canonical_name}
                onChange={(e) => setForm(f => ({ ...f, canonical_name: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="f-display">Display Name</Label>
              <Input id="f-display" placeholder="Optional human-readable name" value={form.display_name}
                onChange={(e) => setForm(f => ({ ...f, display_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Kind *</Label>
              <Select value={form.kind} onValueChange={(v) => setForm(f => ({ ...f, kind: v as FlowKind }))}>
                <SelectTrigger><SelectValue placeholder="Select kind" /></SelectTrigger>
                <SelectContent>
                  {FLOW_KINDS.map(k => <SelectItem key={k} value={k} className="capitalize">{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Dimension</Label>
              <Select value={form.dimension} onValueChange={(v) => setForm(f => ({ ...f, dimension: v as FlowDimension }))}>
                <SelectTrigger><SelectValue placeholder="Select dimension" /></SelectTrigger>
                <SelectContent>
                  {FLOW_DIMENSIONS.map(d => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-unit">Default Unit</Label>
              <Input id="f-unit" placeholder="e.g. kg" value={form.default_unit}
                onChange={(e) => setForm(f => ({ ...f, default_unit: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-cas">CAS Number</Label>
              <Input id="f-cas" placeholder="e.g. 124-38-9" value={form.cas_number}
                onChange={(e) => setForm(f => ({ ...f, cas_number: e.target.value }))} />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input
                id="f-elementary"
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={form.is_elementary_flow}
                onChange={(e) => setForm(f => ({ ...f, is_elementary_flow: e.target.checked }))}
              />
              <Label htmlFor="f-elementary" className="cursor-pointer">Elementary flow</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addBusy}>Cancel</Button>
            <Button onClick={handleAdd} disabled={addBusy || !form.canonical_name.trim() || !form.kind}>
              {addBusy ? 'Adding…' : 'Add Flow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Kind filter strip ── */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveKind(null)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            activeKind === null
              ? 'bg-slate-800 text-white border-slate-800'
              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
          }`}
        >
          All {totalCount !== null ? <span className="ml-1 opacity-70">{totalCount.toLocaleString()}</span> : null}
        </button>
        {FLOW_KINDS.map((k, i) => {
          const count = kindCountQs[i]?.data ?? null
          const s = KIND_STYLE[k]
          const isActive = activeKind === k
          return (
            <button
              key={k}
              onClick={() => setActiveKind(k)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors capitalize ${
                isActive
                  ? `${s.bg} ${s.text} ${s.border} ring-1 ring-offset-1 ring-current`
                  : `bg-white text-slate-600 border-slate-200 hover:${s.border} hover:${s.text}`
              }`}
            >
              {k}
              {count !== null && (
                <span className="ml-1 opacity-70">{count.toLocaleString()}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Search + filters ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search name, CAS number…"
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            className="w-72 rounded-md border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>

        {/* Elementary filter pills */}
        <div className="flex items-center gap-1.5 text-xs">
          {(
            [
              { label: 'All types',     value: null  },
              { label: 'Elementary',    value: true  },
              { label: 'Intermediate',  value: false },
            ] as { label: string; value: boolean | null }[]
          ).map(({ label, value }) => (
            <button
              key={String(value)}
              onClick={() => setElemFilter(value)}
              className={`rounded-full border px-2.5 py-0.5 transition-colors ${
                elemFilter === value
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="text-slate-500">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Add Flow
          </Button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rounded-md border bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-[36%]">Canonical Name</TableHead>
              <TableHead className="w-[11%]">Kind</TableHead>
              <TableHead className="w-[11%]">Dimension</TableHead>
              <TableHead className="w-[8%]">Unit</TableHead>
              <TableHead className="w-[10%]">Type</TableHead>
              <TableHead className="w-[14%]">CAS Number</TableHead>
              <TableHead className="w-[10%]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonRows cols={7} rows={10} />
            ) : flows.length === 0 ? (
              <NoData cols={7} message={search ? 'No flows match your search.' : 'No flows in this category.'} />
            ) : (
              flows.map((f) => (
                <TableRow key={f.flow_id} className="hover:bg-slate-50/60">
                  <TableCell className="font-mono text-xs text-slate-700 break-all leading-snug py-2">
                    {f.canonical_name}
                    {f.display_name && f.display_name !== f.canonical_name && (
                      <span className="block text-slate-400 font-sans not-italic mt-0.5">{f.display_name}</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2"><KindBadge kind={f.kind} /></TableCell>
                  <TableCell className="text-xs text-slate-600 py-2">{f.dimension ?? '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-slate-600 py-2">{f.default_unit ?? '—'}</TableCell>
                  <TableCell className="py-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs border ${
                      f.is_elementary_flow
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}>
                      {f.is_elementary_flow ? 'elementary' : 'intermediate'}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-500 py-2">{f.cas_number ?? '—'}</TableCell>
                  <TableCell className="py-2 text-right">
                    <DeleteButton onClick={() => setDeleteTarget(f)} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Pagination ── */}
      {!isLoading && totalRows > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {isFetching && !isLoading ? (
              <span className="text-slate-400 italic">Updating…</span>
            ) : (
              <>Showing {pageStart}–{pageEnd} of {totalRows.toLocaleString()} flows</>
            )}
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs"
              onClick={() => setPage(0)} disabled={page === 0}>«</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs"
              onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>‹ Prev</Button>
            <span className="px-2">Page {page + 1} of {totalPages}</span>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next ›</Button>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs"
              onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CatalogPage() {
  const { data: totalCount } = useQuery({
    queryKey: ['flows', 'count', null],
    queryFn: () => fetchFlowCount(null),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar adminBreadcrumb={[{ label: 'Catalog', to: '/admin/catalog' }]} />

      <div className="flex-1 overflow-auto space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Catalog</h1>
          <p className="mt-1 text-sm text-slate-500">
            Reference data used across all imports and validations. All catalog entries can be added or removed.
          </p>
        </div>

        <Tabs defaultValue="units">
          <TabsList>
            <TabsTrigger value="units">Units</TabsTrigger>
            <TabsTrigger value="data-origins">Data Origins</TabsTrigger>
            <TabsTrigger value="validation-rules">Validation Rules</TabsTrigger>
            <TabsTrigger value="flows">
              Flows{totalCount != null ? ` (${totalCount.toLocaleString()})` : ''}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="units" className="mt-4">
            <div className="rounded-md border bg-white overflow-hidden"><UnitsTab /></div>
          </TabsContent>

          <TabsContent value="data-origins" className="mt-4">
            <div className="rounded-md border bg-white overflow-hidden"><DataOriginsTab /></div>
          </TabsContent>

          <TabsContent value="validation-rules" className="mt-4">
            <div className="rounded-md border bg-white overflow-hidden"><ValidationRulesTab /></div>
          </TabsContent>

          <TabsContent value="flows" className="mt-4">
            <FlowsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
