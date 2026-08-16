# Theme

Source: `frontend/app/globals.css`

```css
:root {
  --background: oklch(0.986 0.008 40); --foreground: oklch(0.36 0.03 350);
  --card: oklch(1 0.002 60); --card-foreground: oklch(0.36 0.03 350);
  --popover: oklch(1 0.002 60); --popover-foreground: oklch(0.36 0.03 350);
  --primary: oklch(0.77 0.12 12); --primary-foreground: oklch(0.99 0.005 60);
  --secondary: oklch(0.95 0.02 340); --secondary-foreground: oklch(0.44 0.06 350);
  --muted: oklch(0.96 0.012 60); --muted-foreground: oklch(0.58 0.03 350);
  --accent: oklch(0.93 0.04 300); --accent-foreground: oklch(0.42 0.08 300);
  --border: oklch(0.91 0.015 350); --ring: oklch(0.77 0.12 12); --radius: 1rem;
}
.dark {
  --background: oklch(0.24 0.02 330); --foreground: oklch(0.94 0.01 340);
  --card: oklch(0.28 0.022 330); --primary: oklch(0.8 0.11 14);
  --secondary: oklch(0.34 0.03 330); --muted: oklch(0.33 0.025 330);
  --accent: oklch(0.4 0.05 300); --border: oklch(1 0 0 / 12%);
}
```

`@theme inline` maps these values to Tailwind semantic utilities. Fonts are `--font-noto-sans-sc`, `--font-zen-maru`, and `--font-rounded`. The status area uses `bg-secondary/30`, thin `border-border/60`, and compact `text-sm` / `text-xs` data typography.
