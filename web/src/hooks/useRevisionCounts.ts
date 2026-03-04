import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/** Total exchanges across all processes in a revision */
export function useRevisionExchangeCount(revisionId: string | undefined) {
  return useQuery({
    queryKey: ['exchange-count', revisionId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('process_exchange')
        .select('exchange_id, process_instance!inner(revision_id)', {
          count: 'exact',
          head: true,
        })
        .eq('process_instance.revision_id', revisionId!)
      if (error) throw error
      return count ?? 0
    },
    enabled: !!revisionId,
  })
}

/** Total parameters defined in a revision */
export function useRevisionParameterCount(revisionId: string | undefined) {
  return useQuery({
    queryKey: ['parameter-count', revisionId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('model_parameter')
        .select('parameter_id', { count: 'exact', head: true })
        .eq('revision_id', revisionId!)
      if (error) throw error
      return count ?? 0
    },
    enabled: !!revisionId,
  })
}
