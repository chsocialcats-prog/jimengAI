# Routes

| Route | Page | Purpose |
| --- | --- | --- |
| `/` | home | Local story library |
| `/adventure` | adventure | Active story conversation and message composer |
| `/settings` | settings | Providers, account API configuration, and non-per-turn generation settings |
| `/materials` | materials | Role card and worldbook library |
| `/editor` | editor | Story work authoring |
| `/saves` | saves | Conversation save management |
| `/account` | account | Account profile |

The current redesign is confined to `/adventure`. It reads provider state supplied by the existing settings API and moves the per-turn reasoning choice from `/settings` into the conversation composer.
