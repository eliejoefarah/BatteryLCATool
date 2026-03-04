import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AgGridReact } from 'ag-grid-react'
import type {
  CellValueChangedEvent,
  ColDef,
  GetRowIdParams,
  ICellEditor,
  ICellEditorParams,
  ICellRendererParams,
  RowClassParams,
} from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useExchanges, type Exchange } from '../hooks/useExchanges'
import { useUnitCatalog } from '../hooks/useUnitCatalog'
import { useValidationIssues } from '../hooks/useValidationIssues'
import AddExchangeDialog from './AddExchangeDialog'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

// ---------------------------------------------------------------------------
// Flow name cell editor — inline input with typeahead dropdown
// ---------------------------------------------------------------------------

interface FlowResult {
  flow_id: string
  name: string
}

interface FlowEditorValue {
  name: string
  flow_id: string | null
}

const FlowNameEditor = forwardRef<ICellEditor, ICellEditorParams>(
  (props, ref) => {
    const initial = (props.value as string | null) ?? ''
    const [query, setQuery] = useState(initial)
    const [results, setResults] = useState<FlowResult[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => ({
      getValue(): FlowEditorValue {
        return { name: query, flow_id: selectedId }
      },
      afterGuiAttached() {
        inputRef.current?.focus()
        inputRef.current?.select()
      },
      isPopup() {
        return true
      },
      getPopupPosition() {
        return 'under'
      },
    }))

    // Debounced flow search
    useEffect(() => {
      const trimmed = query.trim()
      if (!trimmed) {
        setResults([])
        return
      }
      const timer = setTimeout(async () => {
        const { data } = await supabase
          .from('flow_catalog')
          .select('flow_id, canonical_name, display_name')
          .or(
            `canonical_name.ilike.%${trimmed}%,display_name.ilike.%${trimmed}%`,
          )
          .limit(12)
        setResults(
          (data ?? []).map((f) => ({
            flow_id: f.flow_id,
            name: f.display_name ?? f.canonical_name,
          })),
        )
      }, 200)
      return () => clearTimeout(timer)
    }, [query])

    return (
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelectedId(null)
          }}
          style={{
            width: '100%',
            height: '100%',
            padding: '0 8px',
            border: 'none',
            outline: 'none',
            fontSize: 'inherit',
            fontFamily: 'inherit',
          }}
        />
        {results.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: 'white',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
              zIndex: 9999,
              maxHeight: '220px',
              overflowY: 'auto',
            }}
          >
            {results.map((r) => (
              <div
                key={r.flow_id}
                onMouseDown={() => {
                  setQuery(r.name)
                  setSelectedId(r.flow_id)
                  setResults([])
                }}
                style={{
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  borderBottom: '1px solid #f3f4f6',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = '#f0f9ff')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = 'white')
                }
              >
                {r.name}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  },
)
FlowNameEditor.displayName = 'FlowNameEditor'

// ---------------------------------------------------------------------------
// Delete button cell renderer
// ---------------------------------------------------------------------------

interface DeleteButtonParams extends ICellRendererParams {
  onDelete: (row: Exchange) => void
}

function DeleteButtonRenderer({ data, onDelete }: DeleteButtonParams) {
  return (
    <button
      onClick={() => onDelete(data as Exchange)}
      title="Delete exchange"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: '#cbd5e1',
        transition: 'color 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
      onMouseLeave={(e) => (e.currentTarget.style.color = '#cbd5e1')}
    >
      <Trash2 size={15} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// ExchangeGrid
// ---------------------------------------------------------------------------

interface Props {
  processId: string
  revisionId: string
}

export default function ExchangeGrid({ processId, revisionId }: Props) {
  const gridRef = useRef<AgGridReact>(null)
  const validationTimer = useRef<ReturnType<typeof setTimeout>>()
  const [pendingDeleteRow, setPendingDeleteRow] = useState<Exchange | null>(null)

  const { data: exchanges, isLoading } = useExchanges(processId)
  const { data: units = [] } = useUnitCatalog()
  const { data: validationIssues = [] } = useValidationIssues(
    revisionId,
    processId,
  )

  // Build exchange_id → worst severity map for row colouring
  const issueMap = useMemo(() => {
    const map = new Map<string, 'error' | 'warning'>()
    for (const issue of validationIssues) {
      if (!issue.exchange_id) continue
      const existing = map.get(issue.exchange_id)
      if (
        !existing ||
        (existing === 'warning' && issue.severity === 'error')
      ) {
        map.set(issue.exchange_id, issue.severity as 'error' | 'warning')
      }
    }
    return map
  }, [validationIssues])

  const unitSymbols = useMemo(() => units.map((u) => u.symbol), [units])

  // Debounced validation trigger
  const scheduleValidation = useCallback(() => {
    clearTimeout(validationTimer.current)
    validationTimer.current = setTimeout(async () => {
      try {
        await supabase.functions.invoke('trigger_validation', {
          body: { revision_id: revisionId },
        })
        queryClient.invalidateQueries({
          queryKey: ['validation-issues', revisionId, processId],
        })
      } catch {
        // Validation errors are non-fatal; ValidationBadge will reflect status
      }
    }, 3000)
  }, [revisionId, processId])

  // Lookup or create a flow by name, returns flow_id
  async function resolveFlow(
    name: string,
    knownFlowId: string | null,
  ): Promise<string | null> {
    if (knownFlowId) return knownFlowId
    const trimmed = name.trim()
    if (!trimmed) return null

    // Exact match search first
    const { data: match } = await supabase
      .from('flow_catalog')
      .select('flow_id')
      .or(
        `canonical_name.ilike.${trimmed},display_name.ilike.${trimmed}`,
      )
      .limit(1)
      .maybeSingle()

    if (match) return match.flow_id

    // Get default catalog set id
    const { data: catalogSet } = await supabase
      .from('catalog_set')
      .select('catalog_set_id')
      .limit(1)
      .maybeSingle()

    if (!catalogSet) return null

    // Create new flow via Edge Function
    const { data: result, error } = await supabase.functions.invoke(
      'create_flow',
      {
        body: {
          catalog_set_id: catalogSet.catalog_set_id,
          canonical_name: trimmed,
          kind: 'material',
        },
      },
    )

    if (error || !result?.flow_id) {
      toast.error(`Could not register flow "${trimmed}"`)
      return null
    }

    toast.success(`New flow "${trimmed}" added to catalog`)
    return result.flow_id as string
  }

  // Auto-save on every cell value change
  async function handleCellValueChanged(params: CellValueChangedEvent) {
    const row = params.data as Exchange
    const colId = params.column.getColId()

    try {
      if (colId === 'raw_name') {
        // params.newValue is FlowEditorValue | string
        const editorVal = params.newValue as FlowEditorValue | string
        const name =
          typeof editorVal === 'object' ? editorVal.name : (editorVal ?? '')
        const hintFlowId =
          typeof editorVal === 'object' ? editorVal.flow_id : null

        const flow_id = await resolveFlow(name, hintFlowId)

        const { error } = await supabase
          .from('process_exchange')
          .update({ raw_name: name, flow_id })
          .eq('exchange_id', row.exchange_id)

        if (error) throw error

        // Reflect flow_id back onto the row so the grid stays consistent
        params.node.setDataValue('flow_id', flow_id)
      } else if (colId === 'exchange_direction') {
        // When switching to input, clear output_type (DB constraint)
        const updates: Record<string, unknown> = {
          exchange_direction: params.newValue,
        }
        if (params.newValue === 'input') {
          updates.output_type = null
          params.node.setDataValue('output_type', null)
        }
        const { error } = await supabase
          .from('process_exchange')
          .update(updates)
          .eq('exchange_id', row.exchange_id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('process_exchange')
          .update({ [colId]: params.newValue })
          .eq('exchange_id', row.exchange_id)
        if (error) throw error
      }

      scheduleValidation()
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save change',
      )
    }
  }

  // Called by AddExchangeDialog after a successful insert
  function handleExchangeAdded(exchange: Exchange) {
    gridRef.current?.api.applyTransaction({ add: [exchange] })
    queryClient.invalidateQueries({ queryKey: ['exchanges', processId] })
    scheduleValidation()
  }

  // Delete a row from DB and remove it from the grid
  const handleDeleteRow = useCallback(
    async (row: Exchange) => {
      const { error } = await supabase
        .from('process_exchange')
        .delete()
        .eq('exchange_id', row.exchange_id)

      if (error) {
        toast.error(error.message)
        return
      }

      gridRef.current?.api.applyTransaction({ remove: [row] })
      queryClient.invalidateQueries({ queryKey: ['exchanges', processId] })
      scheduleValidation()
      toast.success('Exchange deleted')
    },
    [processId, scheduleValidation],
  )

  // Row colouring — validation takes priority, then zebra stripe
  const getRowStyle = useCallback(
    (params: RowClassParams<Exchange, unknown>) => {
      const severity = params.data?.exchange_id
        ? issueMap.get(params.data.exchange_id)
        : undefined
      if (severity === 'error') return { background: '#fef2f2' }
      if (severity === 'warning') return { background: '#fffbeb' }
      if (params.rowIndex != null && params.rowIndex % 2 !== 0)
        return { background: '#f8fafc' }
      return undefined
    },
    [issueMap],
  )

  const getRowId = useCallback(
    (params: GetRowIdParams) => params.data.exchange_id,
    [],
  )

  // ---------------------------------------------------------------------------
  // Column definitions
  // ---------------------------------------------------------------------------

  const columnDefs = useMemo<ColDef[]>(
    () => [
      {
        field: 'raw_name',
        headerName: 'Flow name',
        flex: 2,
        minWidth: 200,
        editable: true,
        cellEditor: FlowNameEditor,
        // The editor returns FlowEditorValue; display the name string
        valueGetter: (p) =>
          (p.data as Exchange).flow_display_name ??
          (p.data as Exchange).raw_name ??
          '',
        valueSetter: (p) => {
          const val = p.newValue as FlowEditorValue | string
          p.data.raw_name =
            typeof val === 'object' ? val.name : (val ?? '')
          return true
        },
      },
      {
        field: 'quantity_user',
        headerName: 'Quantity',
        width: 110,
        editable: true,
        cellEditor: 'agNumberCellEditor',
        valueFormatter: (p) =>
          p.value != null ? String(p.value) : '',
        tooltipValueGetter: (p) =>
          (p.data as Exchange).formula_user ?? undefined,
      },
      {
        field: 'user_unit',
        headerName: 'Unit',
        width: 100,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: unitSymbols },
      },
      {
        field: 'exchange_direction',
        headerName: 'Direction',
        width: 110,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: ['input', 'output'] },
        cellClass: (p) =>
          (p.data as Exchange).exchange_direction === 'output'
            ? 'text-blue-600'
            : 'text-slate-600',
      },
      {
        field: 'output_type',
        headerName: 'Output type',
        width: 140,
        editable: (p) =>
          (p.data as Exchange).exchange_direction === 'output',
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: {
          values: ['reference', 'coproduct', 'waste_output', 'stock'],
        },
        valueFormatter: (p) =>
          (p.data as Exchange).exchange_direction === 'input' ? '' : (p.value ?? ''),
      },
      {
        field: 'source_database',
        headerName: 'Source DB',
        width: 130,
        editable: true,
        cellEditor: 'agTextCellEditor',
      },
      {
        field: 'comment',
        headerName: 'Comment',
        flex: 1,
        minWidth: 120,
        editable: true,
        cellEditor: 'agTextCellEditor',
      },
      {
        headerName: '',
        width: 48,
        minWidth: 48,
        maxWidth: 48,
        sortable: false,
        resizable: false,
        suppressMovable: true,
        cellRenderer: DeleteButtonRenderer,
        cellRendererParams: { onDelete: setPendingDeleteRow },
      },
    ],
    [unitSymbols],
  )

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      resizable: true,
      suppressMovable: false,
    }),
    [],
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <AddExchangeDialog
          processId={processId}
          unitSymbols={unitSymbols}
          onAdded={handleExchangeAdded}
        />
        <span className="ml-auto text-xs text-slate-400">
          {exchanges?.length ?? 0} exchange
          {(exchanges?.length ?? 0) !== 1 ? 's' : ''} · edits auto-save
        </span>
      </div>

      {/* Grid */}
      <div
        className="ag-theme-alpine"
        style={{ height: 420, width: '100%' }}
      >
        <AgGridReact<Exchange>
          ref={gridRef}
          rowData={isLoading ? null : (exchanges ?? [])}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={getRowId}
          getRowStyle={getRowStyle}
          onCellValueChanged={handleCellValueChanged}
          enableBrowserTooltips
          stopEditingWhenCellsLoseFocus
          singleClickEdit={false}
          loadingOverlayComponent={() => (
            <span className="text-sm text-slate-400">Loading…</span>
          )}
          noRowsOverlayComponent={() => (
            <span className="text-sm text-slate-400">
              No exchanges yet — click Add Exchange to start.
            </span>
          )}
        />
      </div>

      {/* Validation legend */}
      {issueMap.size > 0 && (
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-100 ring-1 ring-red-300" />
            Validation error
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-300" />
            Validation warning
          </span>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!pendingDeleteRow}
        onOpenChange={(v) => { if (!v) setPendingDeleteRow(null) }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete exchange?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500">
            <span className="font-medium text-slate-700">
              {pendingDeleteRow?.flow_display_name ?? pendingDeleteRow?.raw_name ?? 'This exchange'}
            </span>{' '}
            will be permanently removed. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setPendingDeleteRow(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (pendingDeleteRow) {
                  await handleDeleteRow(pendingDeleteRow)
                  setPendingDeleteRow(null)
                }
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
