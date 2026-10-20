import type { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const control =
  'w-full rounded-xl border border-sand-300 bg-white px-3.5 py-2.5 text-[0.9375rem] text-sand-900 placeholder:text-sand-400 focus:border-jade-600 focus:ring-0 disabled:bg-sand-100 disabled:text-sand-500'

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sand-800 block text-sm font-medium', className)} {...props} />
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-24 resize-y', className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, 'appearance-none pr-9', className)} {...props} />
}

export function Hint({ className, ...props }: LabelHTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sand-500 text-xs', className)} {...props} />
}

export function FieldError({ className, ...props }: LabelHTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs font-medium text-red-700', className)} {...props} />
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label?: string
  hint?: string
  error?: string
  htmlFor?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? <Label htmlFor={htmlFor}>{label}</Label> : null}
      {children}
      {hint && !error ? <Hint>{hint}</Hint> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}
