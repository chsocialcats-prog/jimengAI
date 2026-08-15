# Pages

## `/adventure`

Route source: `app/adventure/page.tsx`.

Composition:

`app/adventure/page.tsx` -> `components/adventure/adventure-view.tsx` -> `StatusPanel`, `InputGroup` primitives, session provider, `api`, `reply-length`.

The page streams chat replies, exposes correction actions and reply length in the composer, and reacts to a conversation's current status. The planned model/reasoning control is a per-conversation composer preference: it must not break streaming, stop, autosave, or offline message behavior.

## `/settings`

`components/settings/settings-view.tsx` manages providers and persistent API configuration. Its old generation-parameter reasoning control is being relocated conceptually to `/adventure`; provider setup remains here.
