import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useRegionCatalog } from '../hooks/useRegionCatalog'
import { useUnitCatalog } from '../hooks/useUnitCatalog'
import { useProcessTemplates } from '../hooks/useProcessTemplates'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  location: z.string().optional(),
  unit: z.string().optional(),
  production_amount: z.number().positive('Must be > 0'),
  stage: z
    .enum(['manufacturing', 'use', 'end_of_life'])
    .optional()
    .or(z.literal('')),
  template_id: z.string().uuid().optional().or(z.literal('')),
  comment: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ---------------------------------------------------------------------------
// Small reusable combobox used for location + template
// ---------------------------------------------------------------------------

interface ComboboxProps {
  value: string
  onSelect: (val: string) => void
  options: { value: string; label: string; sublabel?: string }[]
  placeholder: string
  searchPlaceholder?: string
  emptyLabel?: string
  disabled?: boolean
}

function Combobox({
  value,
  onSelect,
  options,
  placeholder,
  searchPlaceholder = 'Search…',
  emptyLabel = 'No results',
  disabled,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered =
    query.trim() === ''
      ? options.slice(0, 100) // show first 100 when no query (perf guard)
      : options.filter(
          (o) =>
            o.label.toLowerCase().includes(query.toLowerCase()) ||
            o.value.toLowerCase().includes(query.toLowerCase()),
        )

  const selected = options.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {/* Clear option */}
              {value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onSelect('')
                    setOpen(false)
                    setQuery('')
                  }}
                  className="text-slate-400 italic"
                >
                  Clear selection
                </CommandItem>
              )}
              {filtered.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={() => {
                    onSelect(o.value)
                    setOpen(false)
                    setQuery('')
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === o.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span>{o.label}</span>
                  {o.sublabel && (
                    <span className="ml-1.5 text-xs text-slate-400">
                      {o.sublabel}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// ProcessForm
// ---------------------------------------------------------------------------

interface ProcessFormProps {
  revisionId: string
  /** Existing process to edit. If omitted, form is in create mode. */
  process?: {
    process_id: string
    name: string
    location: string | null
    unit: string | null
    production_amount: number
    stage: string | null
    template_id: string | null
    comment: string | null
  }
  onSuccess?: () => void
  /** Render as compact icon-only trigger (for toolbar use) */
  compact?: boolean
}

export default function ProcessForm({
  revisionId,
  process,
  onSuccess,
  compact,
}: ProcessFormProps) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const { data: regions = [] } = useRegionCatalog()
  const { data: units = [] } = useUnitCatalog()
  const { data: templates = [] } = useProcessTemplates()

  const isEdit = !!process

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: process?.name ?? '',
      location: process?.location ?? '',
      unit: process?.unit ?? '',
      production_amount: process?.production_amount ?? 1.0,
      stage: (process?.stage as FormValues['stage']) ?? '',
      template_id: process?.template_id ?? '',
      comment: process?.comment ?? '',
    },
  })

  const regionOptions = regions.map((r) => ({
    value: r.code,
    label: `${r.name} (${r.code})`,
  }))

  const templateOptions = templates.map((t) => ({
    value: t.template_id,
    label: t.ui_label ?? t.canonical_name,
    sublabel: t.stage,
  }))

  async function onSubmit(values: FormValues) {
    setSubmitting(true)

    const payload = {
      revision_id: revisionId,
      name: values.name.trim(),
      location: values.location || null,
      unit: values.unit || null,
      production_amount: values.production_amount,
      production_unit: values.unit || null,
      stage: values.stage || null,
      template_id: values.template_id || null,
      system_boundary: 'foreground' as const,
      comment: values.comment?.trim() || null,
    }

    const { error } = isEdit
      ? await supabase.from('process_instance').update(payload).eq('process_id', process.process_id)
      : await supabase.from('process_instance').insert(payload)

    setSubmitting(false)

    if (error) {
      toast.error(error.message)
      return
    }

    queryClient.invalidateQueries({ queryKey: ['processes', revisionId] })
    toast.success(isEdit ? 'Process updated' : 'Process created')
    setOpen(false)
    reset()
    onSuccess?.()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <button
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title={isEdit ? 'Edit process' : 'New process'}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Button size="sm" variant={isEdit ? 'outline' : 'default'}>
            {isEdit ? 'Edit' : (
              <>
                <Plus className="mr-1.5 h-4 w-4" />
                New Process
              </>
            )}
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit "${process.name}"` : 'New Process'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="proc-name">Name *</Label>
            <Input
              id="proc-name"
              placeholder="e.g. Cell assembly"
              {...register('name')}
            />
            {errors.name && (
              <p className="text-xs text-red-500">{errors.name.message}</p>
            )}
          </div>

          {/* Location (combobox) */}
          <div className="space-y-1.5">
            <Label>Location</Label>
            <Controller
              name="location"
              control={control}
              render={({ field }) => (
                <Combobox
                  value={field.value ?? ''}
                  onSelect={field.onChange}
                  options={regionOptions}
                  placeholder="Select region…"
                  searchPlaceholder="Search 541 regions…"
                  emptyLabel="No matching region"
                />
              )}
            />
          </div>

          {/* Unit + Production amount */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="proc-unit">Unit</Label>
              <Controller
                name="unit"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value ?? ''}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger id="proc-unit">
                      <SelectValue placeholder="Select unit…" />
                    </SelectTrigger>
                    <SelectContent>
                      {units.map((u) => (
                        <SelectItem key={u.unit_id} value={u.symbol}>
                          <span className="font-mono">{u.symbol}</span>
                          {u.description && (
                            <span className="ml-1.5 text-xs text-slate-400">
                              {u.description}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="proc-amount">Production amount *</Label>
              <Input
                id="proc-amount"
                type="number"
                step="any"
                min="0"
                {...register('production_amount', { valueAsNumber: true })}
              />
              {errors.production_amount && (
                <p className="text-xs text-red-500">
                  {errors.production_amount.message}
                </p>
              )}
            </div>
          </div>

          {/* Stage */}
          <div className="space-y-1.5">
            <Label>Stage</Label>
            <Controller
              name="stage"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select stage…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manufacturing">Manufacturing</SelectItem>
                    <SelectItem value="use">Use</SelectItem>
                    <SelectItem value="end_of_life">End of life</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {/* Template (combobox, optional) */}
          {templates.length > 0 && (
            <div className="space-y-1.5">
              <Label>Template</Label>
              <Controller
                name="template_id"
                control={control}
                render={({ field }) => (
                  <Combobox
                    value={field.value ?? ''}
                    onSelect={field.onChange}
                    options={templateOptions}
                    placeholder="Optional template…"
                    searchPlaceholder="Search templates…"
                    emptyLabel="No matching template"
                  />
                )}
              />
            </div>
          )}

          {/* Comment */}
          <div className="space-y-1.5">
            <Label htmlFor="proc-comment">Comment</Label>
            <Textarea
              id="proc-comment"
              placeholder="Optional notes about this process…"
              rows={2}
              {...register('comment')}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
                reset()
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
