import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

type ExchangeRow = Database['public']['Tables']['process_exchange']['Row']
type FlowRow = Database['public']['Tables']['flow_catalog']['Row']

export interface Exchange extends ExchangeRow {
  flow_display_name: string | null
  flow_canonical_name: string | null
  flow_kind: FlowRow['kind'] | null
  flow_default_unit: string | null
}

async function fetchExchanges(processId: string): Promise<Exchange[]> {
  const { data, error } = await supabase
    .from('process_exchange')
    .select(`
      *,
      flow_catalog (
        display_name,
        canonical_name,
        kind,
        default_unit
      )
    `)
    .eq('process_id', processId)
    .order('sort_order', { ascending: true, nullsFirst: false })
  if (error) throw error

  return (data ?? []).map((row) => {
    const flow = row.flow_catalog as {
      display_name: string | null
      canonical_name: string
      kind: FlowRow['kind']
      default_unit: string | null
    } | null
    return {
      ...row,
      flow_catalog: undefined,
      flow_display_name: flow?.display_name ?? null,
      flow_canonical_name: flow?.canonical_name ?? null,
      flow_kind: flow?.kind ?? null,
      flow_default_unit: flow?.default_unit ?? null,
    }
  })
}

export function useExchanges(processId: string | undefined) {
  return useQuery({
    queryKey: ['exchanges', processId],
    queryFn: () => fetchExchanges(processId!),
    enabled: !!processId,
  })
}
