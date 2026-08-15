# Zhimeng Design System

## Product context

- Zhimeng is a local, single-user Chinese AI text-adventure workspace for reading, writing, managing story materials, and continuing story sessions.
- The product needs calm, compact, practical controls that stay out of the way of reading and composition.
- The shared shell is `ai/ai/components/app-shell.tsx`; its sticky header, page content, and footer appear across the application.

## Visual foundation

- Source of truth: `ai/ai/app/globals.css`.
- Use the existing Noto Sans SC and rounded Chinese display font variables. Do not introduce another font.
- Light mode uses a warm near-white background, white card surfaces, muted gray-pink text, a rose primary accent, and a restrained lavender secondary accent.
- Dark mode must use the existing dark token values. Do not add gradients, saturated neon colors, or decorative background blobs.
- Reuse only existing semantic tokens: `background`, `foreground`, `card`, `popover`, `border`, `muted`, `accent`, `primary`, `ring`, and their foreground variants.

## Component language

- Use Lucide icons for familiar actions. Keep controls compact, with clear hover and focus-visible states.
- Buttons are often rounded-full in the current interface; circular icon buttons are appropriate for compact utilities.
- Avoid floating cards and nested cards. Contextual utilities should be a compact cluster of circular controls.
- Shadows are subtle. Borders are thin and token-based. Motion is short and functional, with reduced-motion support.

## Global floating quick actions

- Add one global, fixed utility launcher outside scrollable page content and below modal layers.
- Its default is the vertical center of the left edge. On pointer devices it is visually half-hidden while idle and fully revealed on hover, focus, or when its menu is open.
- The primary launcher is a rose circular icon control. Three smaller circular actions appear as an inward-facing arc: Daily check-in, AI assistant, and Random scenario.
- The launcher can be dragged and then snaps to the nearest viewport edge. It must remain within safe viewport bounds and preserve a 44px touch target on touch devices.
- No labels are rendered inside the circles. Labels are available through tooltips and accessible names. The three secondary actions are visual placeholders only in this release.
- Keep all existing navigation, story composer, modal, account, and provider behavior unchanged.
