/**
 * useFlowResolver
 *
 * Shared hook that drives the two-step flow-resolution UX:
 *   1. Exact case-insensitive match  → resolve immediately (silent)
 *   2. Substring / similar matches   → "Did you mean…?" dialog
 *   3. No matches at all             → "Create new flow?" confirmation
 *
 * Usage:
 *   const { resolveFlow, FlowResolverModal } = useFlowResolver()
 *   // call resolveFlow(name, knownId) — async, may open a modal
 *   // render <FlowResolverModal allowCancel /> somewhere in JSX
 *
 * resolveFlow returns:
 *   string  — a flow_id (existing or newly created)
 *   null    — user chose "Skip" (save exchange without catalog link)
 *   throws  — user chose "Cancel" (caller should abort the operation)
 */

import { useRef, useState } from 'react'
import { AlertCircle, Search } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'

// ── types ──────────────────────────────────────────────────────────────────────

interface FlowCandidate {
  flow_id: string
  canonical_name: string
  display_name: string | null
}

type Step = 'fuzzy' | 'confirm-create'

interface ModalState {
  open: boolean
  name: string
  candidates: FlowCandidate[]
  step: Step
  creating: boolean
}

interface ResolverCallbacks {
  resolve: (flowId: string | null) => void
  reject: () => void
}

const CANCELLED = 'FLOW_RESOLVER_CANCELLED'

// ── hook ───────────────────────────────────────────────────────────────────────

export function useFlowResolver() {
  const cbRef = useRef<ResolverCallbacks | null>(null)
  const [modal, setModal] = useState<ModalState>({
    open: false,
    name: '',
    candidates: [],
    step: 'fuzzy',
    creating: false,
  })

  // ── public API ──────────────────────────────────────────────────────────────

  async function resolveFlow(
    name: string,
    knownId: string | null,
  ): Promise<string | null> {
    // Already selected from the typeahead dropdown — use it directly.
    if (knownId) return knownId

    const trimmed = name.trim()
    if (!trimmed) return null

    // 1. Exact case-insensitive match.
    const esc = trimmed.replace(/"/g, '""')
    const { data: exact } = await supabase
      .from('flow_catalog')
      .select('flow_id')
      .or(`canonical_name.ilike."${esc}",display_name.ilike."${esc}"`)
      .limit(1)
      .maybeSingle()
    if (exact) return exact.flow_id

    // 2. Fuzzy / substring search.
    const { data: similar } = await supabase
      .from('flow_catalog')
      .select('flow_id, canonical_name, display_name')
      .or(`canonical_name.ilike."%${esc}%",display_name.ilike."%${esc}%"`)
      .limit(8)

    const candidates: FlowCandidate[] = similar ?? []

    // 3. Open the interactive dialog and wait for the user.
    return new Promise<string | null>((resolve, reject) => {
      cbRef.current = { resolve, reject }
      setModal({
        open: true,
        name: trimmed,
        candidates,
        step: candidates.length > 0 ? 'fuzzy' : 'confirm-create',
        creating: false,
      })
    })
  }

  // ── modal event handlers ────────────────────────────────────────────────────

  function pickCandidate(flowId: string) {
    setModal((s) => ({ ...s, open: false }))
    cbRef.current?.resolve(flowId)
    cbRef.current = null
  }

  function noneOfThese() {
    setModal((s) => ({ ...s, step: 'confirm-create' }))
  }

  async function confirmCreate() {
    const { name } = modal
    setModal((s) => ({ ...s, creating: true }))

    try {
      const { data: catalogSet } = await supabase
        .from('catalog_set')
        .select('catalog_set_id')
        .limit(1)
        .maybeSingle()

      if (!catalogSet) throw new Error('No catalog set found')

      const { data: result, error } = await supabase.functions.invoke(
        'create_flow',
        {
          body: {
            catalog_set_id: catalogSet.catalog_set_id,
            canonical_name: name,
            kind: 'material',
          },
        },
      )
      if (error || !result?.flow_id) throw new Error(`Could not create flow "${name}"`)

      toast.success(`New flow "${name}" added to catalog`)
      setModal((s) => ({ ...s, open: false, creating: false }))
      cbRef.current?.resolve(result.flow_id as string)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create flow')
      setModal((s) => ({ ...s, creating: false }))
      cbRef.current?.resolve(null) // skip rather than leave dialog stuck
    }
    cbRef.current = null
  }

  /** Skip — save exchange without a catalog link (flow_id = null). */
  function skip() {
    setModal((s) => ({ ...s, open: false }))
    cbRef.current?.resolve(null)
    cbRef.current = null
  }

  /** Cancel — caller should abort the entire operation. */
  function cancel() {
    setModal((s) => ({ ...s, open: false }))
    cbRef.current?.reject()
    cbRef.current = null
  }

  // ── FlowResolverModal component (returned for the caller to render) ─────────

  function FlowResolverModal({ allowCancel = false }: { allowCancel?: boolean }) {
    return (
      <Dialog
        open={modal.open}
        onOpenChange={(v) => { if (!v) cancel() }}
      >
        <DialogContent
          className="sm:max-w-md"
          aria-describedby={undefined}
          // Prevent closing by clicking the backdrop during creation
          onPointerDownOutside={modal.creating ? (e) => e.preventDefault() : undefined}
        >
          {modal.step === 'fuzzy' ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-slate-400" />
                  Similar flows found
                </DialogTitle>
              </DialogHeader>

              <p className="text-sm text-slate-500">
                No exact match for{' '}
                <span className="font-medium text-slate-700">"{modal.name}"</span>.
                Did you mean one of these?
              </p>

              <div className="mt-1 max-h-64 overflow-y-auto rounded-md border divide-y">
                {modal.candidates.map((c) => (
                  <button
                    key={c.flow_id}
                    type="button"
                    onClick={() => pickCandidate(c.flow_id)}
                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors"
                  >
                    <span className="font-medium text-slate-800">
                      {c.display_name ?? c.canonical_name}
                    </span>
                    {c.display_name && c.display_name !== c.canonical_name && (
                      <span className="block font-mono text-xs text-slate-400 mt-0.5">
                        {c.canonical_name}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex justify-between gap-2 pt-1">
                {allowCancel && (
                  <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                    Cancel
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={noneOfThese}
                >
                  None of these — use "{modal.name}"
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  Flow not in catalog
                </DialogTitle>
              </DialogHeader>

              <p className="text-sm text-slate-500">
                <span className="font-medium text-slate-700">"{modal.name}"</span>{' '}
                doesn't exist in the flow catalog. Would you like to create a new
                entry for it?
              </p>

              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                New flows are created as <strong>intermediate material</strong> flows.
                You can update the kind and dimension in the Catalog page afterward.
              </div>

              <div className="flex justify-between gap-2 pt-1">
                {allowCancel ? (
                  <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                    Cancel
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" size="sm" onClick={skip}>
                    Skip (no catalog link)
                  </Button>
                )}
                <div className="flex gap-2">
                  {allowCancel && (
                    <Button type="button" variant="outline" size="sm" onClick={skip}>
                      Skip (no catalog link)
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    disabled={modal.creating}
                    onClick={confirmCreate}
                  >
                    {modal.creating ? 'Creating…' : 'Yes, create flow'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    )
  }

  return { resolveFlow, FlowResolverModal }
}

export { CANCELLED }
