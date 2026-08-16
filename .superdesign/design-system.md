# Zhimeng Design System

## Product context

- Zhimeng is a local, single-user Chinese AI text-adventure workspace.
- The `/adventure` view is a focused reading and writing workspace: story timeline and composer are primary; live session state is a compact supporting panel.
- This task redesigns only the status area. The design must preserve the story timeline, composer, streaming behaviour, and API contracts.

## Visual foundation

- Source of truth: `frontend/app/globals.css`.
- Fonts: `--font-noto-sans-sc` for UI/body and `--font-zen-maru` for softly rounded display/story text. Do not introduce another font.
- Light palette uses warm near-white `--background: oklch(0.986 0.008 40)`, white `--card`, rose `--primary: oklch(0.77 0.12 12)`, gray-pink foreground, blush `--secondary`, and lavender `--accent`.
- Dark mode uses the existing muted plum tokens. Keep semantic token mappings and contrast intact.
- Use only semantic Tailwind tokens: `background`, `foreground`, `card`, `popover`, `border`, `muted`, `secondary`, `accent`, `primary`, `ring`, and their foreground variants. No gradients, neon, or decorative blobs.

## Component language

- Controls use Lucide icons, `focus-visible` rings, thin token borders, quiet shadows, and short functional transitions.
- The adventure shell uses `rounded-3xl` message/composer surfaces; smaller panel sections use `rounded-2xl` or unframed groups. Avoid a stack of nested cards.
- Avatars are circular with a muted fallback initial. Badges are short rounded pills for status only.
- Numeric values from 0 to 100 should be shown with the existing rose `Progress`; all other values use compact label/value rows.
- Text must truncate in role rosters and wrap or clamp gracefully in narrow drawers.

## Status workspace direction

- Keep the compact journey overview first. Make the selected character's identity and current attributes the detail focus.
- Present frozen conversation roles in their source order, append runtime-only roles, and make Player a visually secondary final entry.
- The initial selection is the first role; Player is selected only when explicitly chosen or when no role exists.
- The same hierarchy and selection model must work in the desktop side panel and the mobile right drawer. The panel remains read-only.
