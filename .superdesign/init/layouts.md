# Layouts

## Adventure workspace

Source: `frontend/components/adventure/adventure-view.tsx`

`/adventure` is a full-height two-column conversation workspace. The content column holds a compact header, scrollable story timeline, and lower composer. The status area is the only desktop sidebar.

```tsx
<div className="flex min-h-0 flex-1">
  <div className="flex min-w-0 flex-1 flex-col">{/* timeline and composer */}</div>
  {panelOpen && <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border/60 bg-secondary/30 lg:block xl:w-96"><StatusPanel state={state} conversation={conversation} /></aside>}
</div>
```

## Mobile status drawer

The header exposes the exact same panel below `lg`; it is a right-side sheet, not a second implementation.

```tsx
<Sheet>
  <SheetTrigger render={<Button variant="outline" size="icon" className="rounded-full lg:hidden" aria-label="打开状态面板"><Menu /></Button>} />
  <SheetContent side="right" className="w-[88%] max-w-sm overflow-y-auto p-0 sm:w-96">
    <SheetHeader className="border-b border-border/60"><SheetTitle>冒险状态</SheetTitle></SheetHeader>
    <StatusPanel state={state} conversation={conversation} />
  </SheetContent>
</Sheet>
```

The desktop toggle only hides or shows the aside. The state panel must own selection state so streamed `state` updates do not reset the selected role.
