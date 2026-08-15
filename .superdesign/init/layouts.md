# Layouts

## Adventure workspace

`/adventure` is a single conversation workspace inside `AppShell`.

- Main column: story header, message timeline, composer fixed to the lower portion of the available reading column.
- Composer: vertically stacked textarea and action row within one bordered rounded input surface.
- Action row: left side holds correction and reply-length controls; right side holds model/reasoning selector, then stop or send. On narrow screens the model control may take a full trailing row but the send button remains anchored at the logical end.
- Model panel: an anchored, small-width popover above the selector. It has two compact preference rows, not nested cards: current model and reasoning intensity. Expanding a row reveals its choices in-place.

## Responsive constraints

- Preserve the textarea's usable width; model naming must use `truncate` and a stable maximum width.
- The popover aligns to the trailing composer edge where possible and stays within the viewport.
- Each option row uses a fixed icon column, wrapping text label, and a trailing selected indicator.
