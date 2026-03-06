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
import { themeQuartz } from 'ag-grid-community'
import type {
  CellValueChangedEvent,
  ColDef,
  GetRowIdParams,
  ICellEditor,
  ICellEditorParams,
  ICellRendererParams,
  RowClassParams,
} from 'ag-grid-community'
import { useLocation } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useExchanges, type Exchange } from '../hooks/useExchanges'
import { useUnitCatalog } from '../hooks/useUnitCatalog'
import { useValidationIssues } from '../hooks/useValidationIssues'
import { useParameterNames } from '../hooks/useParameters'
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
        const escaped = trimmed.replace(/"/g, '""')
        const { data } = await supabase
          .from('flow_catalog')
          .select('flow_id, canonical_name, display_name')
          .or(
            `canonical_name.ilike."%${escaped}%",display_name.ilike."%${escaped}%"`,
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
  readOnly?: boolean
}

export default function ExchangeGrid({ processId, revisionId, readOnly = false }: Props) {
  const gridRef = useRef<AgGridReact>(null)
  const [pendingDeleteRow, setPendingDeleteRow] = useState<Exchange | null>(null)
  const location = useLocation()

  const { data: exchanges, isLoading } = useExchanges(processId)
  const { data: units = [] } = useUnitCatalog()
  const paramNames = useParameterNames(revisionId)
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

  // Flash a row when navigated here with a highlightExchangeId in router state
  const highlightExchangeId = (location.state as { highlightExchangeId?: string } | null)
    ?.highlightExchangeId
  useEffect(() => {
    if (!highlightExchangeId || isLoading) return
    const timer = setTimeout(() => {
      const api = gridRef.current?.api
      if (!api) return
      const node = api.getRowNode(highlightExchangeId)
      if (!node) return
      api.ensureNodeVisible(node, 'middle')
      api.flashCells({ rowNodes: [node], flashDuration: 2000, fadeDuration: 500 })
    }, 300)
    return () => clearTimeout(timer)
  }, [highlightExchangeId, isLoading])

  // Lookup or create a flow by name, returns flow_id
  async function resolveFlow(
    name: string,
    knownFlowId: string | null,
  ): Promise<string | null> {
    if (knownFlowId) return knownFlowId
    const trimmed = name.trim()
    if (!trimmed) return null

    // Exact match search first
    const esc = trimmed.replace(/"/g, '""')
    const { data: match } = await supabase
      .from('flow_catalog')
      .select('flow_id')
      .or(`canonical_name.ilike."${esc}",display_name.ilike."${esc}"`)
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
      toast.success('Exchange deleted')
    },
    [processId],
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
    () => {
      const cols: ColDef[] = [
      {
        field: 'raw_name',
        headerName: 'Flow name',
        flex: 2,
        minWidth: 200,
        editable: readOnly ? false : true,
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
        width: 100,
        editable: readOnly ? false : (p) => !(p.data as Exchange).formula_user,
        cellEditor: 'agNumberCellEditor',
        valueFormatter: (p) => (p.value != null ? String(p.value) : ''),
        // Dim the quantity cell when a formula is overriding it
        cellStyle: (p) =>
          (p.data as Exchange).formula_user
            ? { color: '#94a3b8', fontStyle: 'italic' }
            : null,
        tooltipValueGetter: (p) =>
          (p.data as Exchange).formula_user
            ? 'Overridden by formula'
            : undefined,
      },
      {
        field: 'formula_user',
        headerName: 'Formula',
        width: 160,
        editable: readOnly ? false : true,
        cellEditor: 'agTextCellEditor',
        headerTooltip: paramNames.length
          ? `Available: ${paramNames.join(', ')}`
          : 'Enter an expression using parameter names (e.g. capacity_Ah * 2)',
        // Show ƒ prefix + violet text when a formula is set
        cellStyle: (p) =>
          p.value ? { color: '#7c3aed', fontWeight: 500 } : null,
        valueFormatter: (p) =>
          p.value ? `ƒ  ${p.value}` : '',
      },
      {
        field: 'user_unit',
        headerName: 'Unit',
        width: 100,
        editable: readOnly ? false : true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: unitSymbols },
      },
      {
        field: 'exchange_direction',
        headerName: 'Direction',
        width: 110,
        editable: readOnly ? false : true,
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
        editable: readOnly ? false : (p) =>
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
        editable: readOnly ? false : true,
        cellEditor: 'agTextCellEditor',
      },
      {
        field: 'comment',
        headerName: 'Comment',
        flex: 1,
        minWidth: 120,
        editable: readOnly ? false : true,
        cellEditor: 'agTextCellEditor',
      },
    ]
    if (!readOnly) {
      cols.push({
        headerName: '',
        width: 48,
        minWidth: 48,
        maxWidth: 48,
        sortable: false,
        resizable: false,
        suppressMovable: true,
        cellRenderer: DeleteButtonRenderer,
        cellRendererParams: { onDelete: setPendingDeleteRow },
      })
    }
    return cols
    },
    [unitSymbols, paramNames, readOnly],
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
        {!readOnly && (
          <AddExchangeDialog
            processId={processId}
            revisionId={revisionId}
            unitSymbols={unitSymbols}
            onAdded={handleExchangeAdded}
          />
        )}
        <span className={readOnly ? 'text-xs text-slate-400' : 'ml-auto text-xs text-slate-400'}>
          {exchanges?.length ?? 0} exchange
          {(exchanges?.length ?? 0) !== 1 ? 's' : ''}
          {readOnly ? ' · read-only' : ' · edits auto-save'}
        </span>
      </div>

      {/* Grid */}
      <div style={{ height: 420, width: '100%' }}>
        <AgGridReact<Exchange>
          ref={gridRef}
          theme={themeQuartz}
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
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
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
