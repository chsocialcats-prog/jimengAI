# Theme summary

- Product style: calm, compact Chinese writing workspace.
- Surface: light neutral backgrounds with a clearly bounded composer.
- Accent: existing warm rose/pink semantic accent and application foreground tokens.
- Type: inherit the existing application font variables; utility text remains compact and readable.
- Radius: existing compact control radii; avoid oversized floating cards.
- Icons: Lucide, inheriting current muted foreground / selected foreground treatment.

## Existing theme source

Theme implementation is in `ai/ai/app/globals.css`. Its CSS variables and Tailwind token mapping are the authority for this page. The proposed selector reuses `background`, `popover`, `border`, `muted`, `accent`, `foreground`, `muted-foreground`, `primary`, and `ring`; it introduces no new color tokens.
