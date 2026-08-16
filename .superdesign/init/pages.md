# Pages

## `/adventure`

Route source: `frontend/app/adventure/page.tsx`

```
frontend/app/adventure/page.tsx
└── frontend/components/adventure/adventure-view.tsx
    ├── desktop <aside> and mobile <SheetContent>
    │   └── frontend/components/adventure/status-panel.tsx
    │       ├── frontend/components/ui/avatar.tsx
    │       ├── frontend/components/ui/badge.tsx
    │       ├── frontend/components/ui/progress.tsx
    │       ├── frontend/components/ui/collapsible.tsx
    │       └── frontend/components/ui/separator.tsx
    ├── frontend/components/ui/sheet.tsx
    ├── message timeline
    ├── input composer and stream lifecycle
    └── frontend/lib/api.ts (Conversation and AdventureState types)
```

`StatusPanel` currently displays `state.attributes` under an incorrect "角色属性" heading. That data is player data. The redesign puts characters first and makes Player an explicit secondary list entry.
