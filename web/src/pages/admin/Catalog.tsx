import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import type { Database } from '../../types/database.types'
import { Badge } from '../../components/ui/badge'
import { Skeleton } from '../../components/ui/skeleton'
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

async function fetchFlows(): Promise<FlowRow[]> {
  const { data, error } = await supabase
    .from('flow_catalog')
    .select('*')
    .order('canonical_name', { ascending: true })
    .limit(200)
  if (error) throw error
  return data
}

function SeverityBadge({ severity }: { severity: string }) {
  const s = severity as ValidationSeverity
  if (s === 'error') {
    return <Badge variant="destructive">error</Badge>
  }
  if (s === 'warning') {
    return (
      <Badge variant="secondary" className="text-amber-600">
        warning
      </Badge>
    )
  }
  return <Badge variant="outline">info</Badge>
}

function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

function NoData({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-center text-slate-400 py-8">
        No data
      </TableCell>
    </TableRow>
  )
}

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
              <TableCell>
                <SeverityBadge severity={r.severity} />
              </TableCell>
              <TableCell className="text-slate-600">{r.description ?? '—'}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function FlowsTab() {
  const [search, setSearch] = useState('')

  const { data: flows, isLoading } = useQuery({
    queryKey: ['catalog', 'flows'],
    queryFn: fetchFlows,
  })

  const filtered = flows
    ? flows.filter((f) =>
        f.canonical_name.toLowerCase().includes(search.toLowerCase())
      )
    : []

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Filter by canonical name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Canonical Name</TableHead>
            <TableHead>Display Name</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Dimension</TableHead>
            <TableHead>Default Unit</TableHead>
            <TableHead>Elementary</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <SkeletonRows cols={6} />
          ) : !flows || flows.length === 0 ? (
            <NoData cols={6} />
          ) : filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-slate-400 py-8">
                No flows match your search.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((f) => (
              <TableRow key={f.flow_id}>
                <TableCell className="font-mono text-xs">{f.canonical_name}</TableCell>
                <TableCell>{f.display_name ?? '—'}</TableCell>
                <TableCell>{f.kind}</TableCell>
                <TableCell>{f.dimension ?? '—'}</TableCell>
                <TableCell>{f.default_unit ?? '—'}</TableCell>
                <TableCell>{f.is_elementary_flow ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export default function CatalogPage() {
  const { data: flows } = useQuery({
    queryKey: ['catalog', 'flows'],
    queryFn: fetchFlows,
  })

  const flowCount = flows?.length ?? null

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar />
      <div className="flex items-center gap-1.5 border-b bg-white px-6 py-2 text-xs text-slate-500">
        <Link to="/admin" className="hover:text-slate-800">
          Admin
        </Link>
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
              Flows{flowCount !== null ? ` (${flowCount})` : ''}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="units" className="mt-4">
            <div className="rounded-md border bg-white">
              <UnitsTab />
            </div>
          </TabsContent>

          <TabsContent value="data-origins" className="mt-4">
            <div className="rounded-md border bg-white">
              <DataOriginsTab />
            </div>
          </TabsContent>

          <TabsContent value="validation-rules" className="mt-4">
            <div className="rounded-md border bg-white">
              <ValidationRulesTab />
            </div>
          </TabsContent>

          <TabsContent value="flows" className="mt-4">
            <div className="rounded-md border bg-white p-4">
              <FlowsTab />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
