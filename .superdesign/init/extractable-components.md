# Extractable Components

## `StatusPanel`

- Source: `frontend/components/adventure/status-panel.tsx`
- Category: responsive session-state workspace
- Inputs: `state: AdventureState`, `conversation: Conversation`
- Responsibilities: compact journey overview, character roster/detail, player entry, collapsed story memory; render-only and shared by desktop aside and mobile drawer.
- Planned internal state: selected entity id/name, initialised to the first frozen role and preserved during streamed `state` updates.

Do not extract the panel into the global shell. It remains specific to the conversation route and must not own API requests, writes, or streaming lifecycle.
