# Extractable components

## `ModelReasoningSelector`

Candidate component within `components/adventure/`.

Inputs: available configured providers, active provider/model, selected reasoning intensity, loading state, provider update action, and selected reasoning callback.

Responsibilities:

- Render the compact trailing composer trigger.
- Keep a single anchored popover open state.
- Present current model and reasoning selections with a visible selected state.
- Degrade cleanly while provider settings load or when no configured provider exists.
- Never own the message text, streaming state, or chat event lifecycle.

Do not extract correction buttons or the send control: their stream lifecycle ownership stays in `AdventureView`.
