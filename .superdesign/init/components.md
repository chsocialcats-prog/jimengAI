# Shared components

The application uses the shadcn-style primitives in `ai/ai/components/ui/`.

## Button

Source: `components/ui/button.tsx`. Variant-driven command control. The design uses `ghost` for secondary input actions and `default`/icon sizing for the send action.

## Input and InputGroup

Source: `components/ui/input.tsx` and `components/ui/input-group.tsx`. `InputGroup` is the editable chat surface. It stacks `InputGroupTextarea` over a `block-end` `InputGroupAddon`, preserving a stable action row. The new selector belongs in this addon rather than a floating page card.

## Badge and Card

Source: `components/ui/badge.tsx` and `components/ui/card.tsx`. Badges communicate compact status only; cards frame repeated material settings and are not used for the composer itself.

## Popover

Source: `components/ui/popover.tsx`. Radix popover primitive. It is the established anchored overlay for compact, contextual editing and will contain model and reasoning choices.

## AppShell

Source: `components/app-shell.tsx`. Owns application navigation, top-level page boundaries, responsive sidebar behavior, and the current Chinese product language.

## RootLayout

Source: `app/layout.tsx`. Loads `globals.css`, font variables, the session provider, and the app shell around all route content.

## Composer action language

Use Lucide icons where there is a known metaphor. Existing commands remain textual only when the Chinese label disambiguates its destructive or correction effect. Model selection is a compact icon-plus-text control with truncation at small widths.
