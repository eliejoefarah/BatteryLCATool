import { useState, useEffect } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronRight, RefreshCw, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import type { Database } from '../../types/database.types'
import { Badge } from '../../components/ui/badge'
import { Skeleton } from '../../components/ui/skeleton'
import { Button } from '../../components/ui/button'
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
type FlowKind = 'material' | 'energy' | 'emission' | 'waste' | 'water' | 'service'

const FLOW_KINDS: FlowKind[] = ['material', 'energy', 'emission', 'waste', 'water', 'service']
const PAGE_SIZE = 100

// ── kind styling ─────────────────────────────────────────────────────────────

const KIND_STYLE: Record<FlowKind, { bg: string; text: string; border: string }> = {
  material:  { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  energy:    { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200' },
  emission:  { bg: 'bg-rose-50',   text: 'text-rose-700',   border: 'border-rose-200' },
  waste:     { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  water:     { bg: 'bg-cyan-50',   text: 'text-cyan-700',   border: 'border-cyan-200' },
  service:   { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
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

// ── shared sub-components ─────────────────────────────────────────────────────

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

// ── FlowsTab ──────────────────────────────────────────────────────────────────

function FlowsTab() {
  const [activeKind, setActiveKind] = useState<FlowKind | null>(null)
  const [rawSearch, setRawSearch]   = useState('')
  const [search, setSearch]         = useState('')
  const [page, setPage]             = useState(0)
  const [elemFilter, setElemFilter] = useState<boolean | null>(null)

  // Debounce search → reset page
  useEffect(() => {
    const t = setTimeout(() => { setSearch(rawSearch); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [rawSearch])

  // Reset page when kind or elem filter changes
  useEffect(() => { setPage(0) }, [activeKind, elemFilter])

  // Per-kind counts (cheap HEAD requests, refresh on window focus)
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

  // Main paginated data query
  const {
    data: pageResult,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
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

        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto text-slate-500"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* ── Table ── */}
      <div className="rounded-md border bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-[42%]">Canonical Name</TableHead>
              <TableHead className="w-[12%]">Kind</TableHead>
              <TableHead className="w-[12%]">Dimension</TableHead>
              <TableHead className="w-[8%]">Unit</TableHead>
              <TableHead className="w-[10%]">Type</TableHead>
              <TableHead className="w-[16%]">CAS Number</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonRows cols={6} rows={10} />
            ) : flows.length === 0 ? (
              <NoData
                cols={6}
                message={search ? 'No flows match your search.' : 'No flows in this category.'}
              />
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
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPage(0)}
              disabled={page === 0}
            >
              «
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              ‹ Prev
            </Button>
            <span className="px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next ›
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
            >
              »
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Other tabs (unchanged) ────────────────────────────────────────────────────

function UnitsTab() {
  const { data: units, isLoading } = useQuery({
    queryKey: ['catalog', 'units'],
    queryFn: fetchUnits,
  })
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Unit ID</TableHead>
          <TableHead>Symbol</TableHead>
          <TableHead>Dimension</TableHead>
          <TableHead>Factor to SI</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <SkeletonRows cols={5} />
        ) : !units || units.length === 0 ? (
          <NoData cols={5} />
        ) : (
          units.map((u) => (
            <TableRow key={u.unit_id}>
              <TableCell className="font-mono text-xs text-slate-500">{u.unit_id}</TableCell>
              <TableCell className="font-medium">{u.symbol}</TableCell>
              <TableCell>{u.dimension}</TableCell>
              <TableCell>{u.factor_to_si}</TableCell>
              <TableCell className="text-slate-600">{u.description ?? '—'}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function DataOriginsTab() {
  const { data: origins, isLoading } = useQuery({
    queryKey: ['catalog', 'data-origins'],
    queryFn: fetchDataOrigins,
  })
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Label</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <SkeletonRows cols={3} />
        ) : !origins || origins.length === 0 ? (
          <NoData cols={3} />
        ) : (
          origins.map((o) => (
            <TableRow key={o.code}>
              <TableCell className="font-mono font-medium">{o.code}</TableCell>
              <TableCell>{o.label}</TableCell>
              <TableCell className="text-slate-600">{o.description ?? '—'}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function ValidationRulesTab() {
  const { data: rules, isLoading } = useQuery({
    queryKey: ['catalog', 'validation-rules'],
    queryFn: fetchValidationRules,
  })
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <SkeletonRows cols={3} />
        ) : !rules || rules.length === 0 ? (
          <NoData cols={3} />
        ) : (
          rules.map((r) => (
            <TableRow key={r.rule_id}>
              <TableCell className="font-mono font-medium">{r.code}</TableCell>
              <TableCell><SeverityBadge severity={r.severity} /></TableCell>
              <TableCell className="text-slate-600">{r.description ?? '—'}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
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
      <TopBar />
      <div className="flex items-center gap-1.5 border-b bg-white px-6 py-2 text-xs text-slate-500">
        <Link to="/admin" className="hover:text-slate-800">Admin</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-medium text-slate-700">Catalog</span>
      </div>

      <div className="flex-1 overflow-auto space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Catalog</h1>
          <p className="mt-1 text-sm text-slate-500">
            Read-only reference data used across all imports and validations.
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
            <div className="rounded-md border bg-white"><UnitsTab /></div>
          </TabsContent>

          <TabsContent value="data-origins" className="mt-4">
            <div className="rounded-md border bg-white"><DataOriginsTab /></div>
          </TabsContent>

          <TabsContent value="validation-rules" className="mt-4">
            <div className="rounded-md border bg-white"><ValidationRulesTab /></div>
          </TabsContent>

          <TabsContent value="flows" className="mt-4">
            <FlowsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
