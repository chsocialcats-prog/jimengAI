# Shared Components

The active frontend is `frontend/`. The adventure status workspace uses these primitives.

## `Avatar`

Source: `frontend/components/ui/avatar.tsx`

```tsx
function Avatar({ className, size = "default", ...props }) {
  return <AvatarPrimitive.Root data-slot="avatar" data-size={size} className={cn("group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:mix-blend-lighten", className)} {...props} />
}
function AvatarImage({ className, ...props }) {
  return <AvatarPrimitive.Image data-slot="avatar-image" className={cn("aspect-square size-full rounded-full object-cover", className)} {...props} />
}
function AvatarFallback({ className, ...props }) {
  return <AvatarPrimitive.Fallback data-slot="avatar-fallback" className={cn("flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs", className)} {...props} />
}
```

## `Badge`

Source: `frontend/components/ui/badge.tsx`

```tsx
const badgeVariants = cva("group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50", {
  variants: { variant: { default: "bg-primary text-primary-foreground", secondary: "bg-secondary text-secondary-foreground", destructive: "bg-destructive/10 text-destructive", outline: "border-border text-foreground", ghost: "hover:bg-muted hover:text-muted-foreground" } },
  defaultVariants: { variant: "default" },
})
```

## `Progress`

Source: `frontend/components/ui/progress.tsx`

```tsx
function Progress({ className, children, value, ...props }) {
  return <ProgressPrimitive.Root value={value} data-slot="progress" className={cn("flex flex-wrap gap-3", className)} {...props}>{children}<ProgressTrack><ProgressIndicator /></ProgressTrack></ProgressPrimitive.Root>
}
function ProgressTrack({ className, ...props }) { return <ProgressPrimitive.Track data-slot="progress-track" className={cn("relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted", className)} {...props} /> }
function ProgressIndicator({ className, ...props }) { return <ProgressPrimitive.Indicator data-slot="progress-indicator" className={cn("h-full bg-primary transition-all", className)} {...props} /> }
```

## `Collapsible` and `Separator`

Sources: `frontend/components/ui/collapsible.tsx`, `frontend/components/ui/separator.tsx`

```tsx
function Collapsible({ ...props }) { return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} /> }
function CollapsibleTrigger({ ...props }) { return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} /> }
function CollapsibleContent({ ...props }) { return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} /> }
function Separator({ className, orientation = "horizontal", ...props }) {
  return <SeparatorPrimitive data-slot="separator" orientation={orientation} className={cn("shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch", className)} {...props} />
}
```

## `Sheet`

Source: `frontend/components/ui/sheet.tsx`. The mobile status panel uses `SheetContent side="right"` with a width of `88%`, maximum `sm`, and vertical scrolling. It supplies dialog focus management and a close button.

## Utility

Source: `frontend/lib/utils.ts`

```ts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```
