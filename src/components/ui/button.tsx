import { cva, type VariantProps } from 'class-variance-authority'
import Link from 'next/link'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-jade-800 text-jade-50 hover:bg-jade-900 active:bg-jade-950',
        accent: 'bg-terracotta-600 text-white hover:bg-terracotta-700 active:bg-terracotta-800',
        outline: 'border border-sand-300 bg-white text-sand-900 hover:bg-sand-100',
        ghost: 'text-sand-800 hover:bg-sand-200/70',
        subtle: 'bg-sand-200 text-sand-900 hover:bg-sand-300',
        danger: 'border border-red-200 bg-red-50 text-red-800 hover:bg-red-100',
      },
      size: {
        sm: 'h-9 rounded-lg px-3 text-sm',
        md: 'h-11 rounded-xl px-4 text-[0.9375rem]',
        lg: 'h-13 rounded-xl px-6 text-base',
        icon: 'size-10 rounded-lg',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  children?: ReactNode
}

export function Button({ className, variant, size, block, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size, block }), className)} {...props} />
}

export { button as buttonVariants }

/**
 * A link styled as a button. Preferred over an `asChild` slot: navigation
 * should render a real anchor so middle-click, copy-link and prefetch all work.
 */
export function LinkButton({
  className,
  variant,
  size,
  block,
  href,
  children,
  ...props
}: VariantProps<typeof button> & { href: string } & Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    'href'
  >) {
  return (
    <Link href={href} className={cn(button({ variant, size, block }), className)} {...props}>
      {children}
    </Link>
  )
}
