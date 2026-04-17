import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Badge } from '../ui/badge'
import { Skeleton } from '../ui/skeleton'
import { Separator } from '../ui/separator'
import { Textarea } from '../ui/textarea'
import { cn } from '../../lib/utils'
import {
  useBwSearch,
  useConfirmMapping,
  useUnmapFlow,
  useSkipFlow,
  useUnskipFlow,
  type BwCatalogRow,
  type ConfirmMappingPayload,
  type FlowMappingGroup,
} from '../../hooks/useBwMapping'

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ResultRow({
  row,
  selected,
  onSelect,
}: {
  row: BwCatalogRow
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50',
        selected && 'bg-slate-50',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {selected && <Check className="h-3.5 w-3.5 shrink-0 text-slate-700" />}
          <p className={cn('text-sm font-medium text-slate-800 truncate', selected && 'text-slate-900')}>
            {row.activity_name}
          </p>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          {row.reference_product && (
            <span className="text-xs text-slate-500 truncate max-w-[220px]">{row.reference_product}</span>
          )}
          {row.location && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] h-4 font-normal">
              {row.location}
            </Badge>
          )}
          {row.unit && <span className="text-xs text-slate-400">· {row.unit}</span>}
        </div>
      </div>
      <span className="text-xs text-slate-300 shrink-0 pt-0.5 tabular-nums">
        {Math.round(row.similarity_score * 100)}%
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

interface ManualForm {
  activity_name: string
  reference_product: string
  location: string
  unit: string
  ecoinvent_version: string
  system_model: string
  notes: string
}

const EMPTY_MANUAL: ManualForm = {
  activity_name: '',
  reference_product: '',
  location: '',
  unit: '',
  ecoinvent_version: '',
  system_model: '',
  notes: '',
}

export function FlowMappingDialog({
  flow,
  revisionId,
  open,
  onOpenChange,
}: {
  flow: FlowMappingGroup
  revisionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [activeTab, setActiveTab] = useState<'search' | 'manual'>('search')
  const [searchQuery, setSearchQuery] = useState(flow?.raw_name ?? '')
  const [selectedRow, setSelectedRow] = useState<BwCatalogRow | null>(null)
  const [manualForm, setManualForm] = useState<ManualForm>(EMPTY_MANUAL)

  // Reset all state when dialog opens for a (possibly different) flow
  useEffect(() => {
    if (open) {
      setSearchQuery(flow?.raw_name ?? '')
      setSelectedRow(null)
      setActiveTab('search')
      setManualForm(EMPTY_MANUAL)
    }
  }, [open, flow?.raw_name])

  const { data: searchData, isLoading: searchLoading } = useBwSearch(searchQuery)
  const confirmMutation = useConfirmMapping()
  const unmapMutation = useUnmapFlow()
  const skipMutation = useSkipFlow()
  const unskipMutation = useUnskipFlow()

  const isAlreadyMapped = !!flow?.mapping
  const isSkipped = flow?.mapping_status === 'skipped'

  // Best match: top catalog result with score > 0.3
  const bestMatch =
    searchData?.results[0] &&
    searchData.results[0].similarity_score > 0.3
      ? searchData.results[0]
      : null

  const displayResults = searchData?.results ?? []

  const canConfirm =
    activeTab === 'search'
      ? selectedRow !== null
      : manualForm.activity_name.trim() !== ''

  function buildPayload(scope: 'all' | 'revision'): ConfirmMappingPayload {
    const base: ConfirmMappingPayload = {
      revision_id: revisionId,
      raw_name: flow.raw_name!,
      unit: flow.unit,
      direction: flow.direction,
      mapping_notes: manualForm.notes.trim() || null,
      scope,
    }
    if (activeTab === 'search' && selectedRow) {
      base.catalog_id = selectedRow.id
    } else {
      base.manual_override = {
        activity_name: manualForm.activity_name,
        reference_product: manualForm.reference_product.trim() || null,
        location: manualForm.location.trim() || null,
        unit: manualForm.unit.trim() || null,
        ecoinvent_version: manualForm.ecoinvent_version.trim() || null,
        system_model: manualForm.system_model.trim() || null,
      }
    }
    return base
  }

  function handleConfirm(scope: 'all' | 'revision' = 'all') {
    confirmMutation.mutate(buildPayload(scope), {
      onSuccess: () => onOpenChange(false),
    })
  }

  function handleUnmap() {
    unmapMutation.mutate(
      { raw_name: flow.raw_name!, unit: flow.unit, direction: flow.direction },
      {
        onSuccess: () => {
          toast.success('Mapping removed')
          onOpenChange(false)
        },
      },
    )
  }

  function handleSkip() {
    skipMutation.mutate(
      { revision_id: revisionId, raw_name: flow.raw_name!, unit: flow.unit, direction: flow.direction },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  function handleUnskip() {
    unskipMutation.mutate(
      { raw_name: flow.raw_name!, unit: flow.unit, direction: flow.direction },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  const isBusy = confirmMutation.isPending || unmapMutation.isPending || skipMutation.isPending || unskipMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl flex flex-col gap-0 p-0 overflow-hidden max-h-[85vh]">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{flow.raw_name ?? 'Unknown Flow'}</DialogTitle>
            <DialogDescription className="flex items-center gap-2 flex-wrap mt-1">
              {flow.unit && <span>{flow.unit}</span>}
              {flow.unit && <span className="text-slate-300">·</span>}
              <Badge variant="outline" className="px-1.5 py-0 text-[10px] h-4 font-normal capitalize">
                {flow.direction}
              </Badge>
              <span className="text-slate-300">·</span>
              <span>used in {flow.exchange_count} exchange{flow.exchange_count !== 1 ? 's' : ''}</span>
            </DialogDescription>
          </DialogHeader>

          {/* Skipped card */}
          {isSkipped && !isAlreadyMapped && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-sm text-slate-600">
                <span className="font-medium">Skipped</span> — will export as-is (manufacturer value, no BW activity linked)
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1 text-xs text-slate-500 hover:bg-slate-100"
                onClick={handleUnskip}
                disabled={isBusy}
              >
                {unskipMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                Undo skip
              </Button>
            </div>
          )}

          {/* Current mapping card */}
          {isAlreadyMapped && flow.mapping && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
              <p className="text-sm text-green-800 truncate">
                <span className="font-medium">Currently mapped to: </span>
                {flow.mapping.confirmed_activity_name}
                {flow.mapping.confirmed_location && ` · ${flow.mapping.confirmed_location}`}
                {flow.mapping.confirmed_ecoinvent_version && ` · v${flow.mapping.confirmed_ecoinvent_version}`}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={handleUnmap}
                disabled={isBusy}
              >
                {unmapMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
                Remove
              </Button>
            </div>
          )}
        </div>

        <Separator />

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'search' | 'manual')}
          className="flex flex-col flex-1 overflow-hidden px-6 pt-3 pb-0"
        >
          <TabsList className="shrink-0 w-fit">
            <TabsTrigger value="search">Search Catalog</TabsTrigger>
            <TabsTrigger value="manual">Manual Entry</TabsTrigger>
          </TabsList>

          {/* ── Search tab ──────────────────────────────────────────────── */}
          <TabsContent value="search" className="flex flex-col gap-3 mt-3 overflow-hidden">

            {/* Catalog not seeded warning */}
            {searchData?.catalog_seeded === false && (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                The Brightway activity catalog is not yet seeded. Search is unavailable.
              </div>
            )}

            {/* Search input */}
            <div className="flex gap-2 shrink-0">
              <Input
                placeholder="Search activities…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={searchData?.catalog_seeded === false}
                className="flex-1"
              />
            </div>

            {/* Best match card (catalog results only, first result > 0.3) */}
            {bestMatch && (
              <div
                className={cn(
                  'shrink-0 rounded-lg border-2 p-3 transition-colors',
                  selectedRow?.id === bestMatch.id
                    ? 'border-slate-700 bg-slate-50'
                    : 'border-slate-200 bg-slate-50 hover:border-slate-300',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                    <Check className="h-3.5 w-3.5" />
                    Best Match
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs shrink-0"
                    onClick={() => setSelectedRow(bestMatch)}
                  >
                    {selectedRow?.id === bestMatch.id ? 'Selected ✓' : 'Select'}
                  </Button>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-800">{bestMatch.activity_name}</p>
                <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {bestMatch.reference_product && (
                    <span className="text-xs text-slate-500">{bestMatch.reference_product}</span>
                  )}
                  {bestMatch.location && (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] h-4 font-normal">
                      {bestMatch.location}
                    </Badge>
                  )}
                  {bestMatch.unit && <span className="text-xs text-slate-400">· {bestMatch.unit}</span>}
                </div>
              </div>
            )}

            {/* Results list */}
            <div className="overflow-y-auto rounded-md border divide-y min-h-0 max-h-[240px]">
              {searchLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex flex-col gap-1.5 px-3 py-2.5">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))
              ) : displayResults.length === 0 ? (
                <p className="p-4 text-center text-sm text-slate-400">
                  {searchQuery.length < 2
                    ? 'Type at least 2 characters to search'
                    : 'No results found'}
                </p>
              ) : (
                displayResults.map((row) => (
                  <ResultRow
                    key={row.id}
                    row={row}
                    selected={selectedRow?.id === row.id}
                    onSelect={() => setSelectedRow(row)}
                  />
                ))
              )}
            </div>
          </TabsContent>

          {/* ── Manual entry tab ────────────────────────────────────────── */}
          <TabsContent value="manual" className="mt-3 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 pb-2">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="manual-activity">Activity Name *</Label>
                <Input
                  id="manual-activity"
                  placeholder="e.g. electricity production, nuclear, pressure water reactor"
                  value={manualForm.activity_name}
                  onChange={(e) => setManualForm((f) => ({ ...f, activity_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-product">Reference Product</Label>
                <Input
                  id="manual-product"
                  placeholder="e.g. electricity, high voltage"
                  value={manualForm.reference_product}
                  onChange={(e) => setManualForm((f) => ({ ...f, reference_product: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-location">Location</Label>
                <Input
                  id="manual-location"
                  placeholder="e.g. GLO, DE, RoW"
                  value={manualForm.location}
                  onChange={(e) => setManualForm((f) => ({ ...f, location: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-unit">Unit</Label>
                <Input
                  id="manual-unit"
                  placeholder="e.g. kWh, kg"
                  value={manualForm.unit}
                  onChange={(e) => setManualForm((f) => ({ ...f, unit: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manual-version">ecoinvent Version</Label>
                <Input
                  id="manual-version"
                  placeholder="e.g. 3.10"
                  value={manualForm.ecoinvent_version}
                  onChange={(e) => setManualForm((f) => ({ ...f, ecoinvent_version: e.target.value }))}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="manual-model">System Model</Label>
                <Input
                  id="manual-model"
                  placeholder="e.g. cutoff, apos"
                  value={manualForm.system_model}
                  onChange={(e) => setManualForm((f) => ({ ...f, system_model: e.target.value }))}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="manual-notes">Notes</Label>
                <Textarea
                  id="manual-notes"
                  placeholder="Optional notes about this mapping"
                  rows={2}
                  value={manualForm.notes}
                  onChange={(e) => setManualForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 border-t bg-white px-6 py-4 shrink-0">
          {isAlreadyMapped ? (
            <>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canConfirm || isBusy}
                  onClick={() => handleConfirm('revision')}
                >
                  {confirmMutation.isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                  Update this revision only
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canConfirm || isBusy}
                  onClick={() => handleConfirm('all')}
                >
                  Update all revisions
                </Button>
              </div>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                Cancel
              </Button>
            </>
          ) : isSkipped ? (
            <>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canConfirm || isBusy}
                  onClick={() => handleConfirm('all')}
                >
                  {confirmMutation.isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                  Map instead
                </Button>
              </div>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                Close
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-slate-400 hover:text-slate-600"
                disabled={isBusy}
                onClick={handleSkip}
              >
                {skipMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Skip this flow
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                  Cancel
                </Button>
                <Button
                  disabled={!canConfirm || isBusy}
                  onClick={() => handleConfirm('all')}
                >
                  {confirmMutation.isPending ? (
                    <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Confirming…</>
                  ) : (
                    'Confirm Mapping'
                  )}
                </Button>
              </div>
            </>
          )}
        </div>

      </DialogContent>
    </Dialog>
  )
}
