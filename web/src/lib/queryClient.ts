import { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
    mutations: {
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'An unexpected error occurred')
      },
    },
  },
})

// Global query error handler — fires for every failed useQuery
queryClient.getQueryCache().config.onError = (error) => {
  toast.error(error instanceof Error ? error.message : 'Failed to load data')
}
