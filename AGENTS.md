# Repository Guidance

## Scope

- This is the canonical standalone source for the Datacat SillyTavern Browser
  extension.
- Keep Browser runtime, presentation, and Datacat API integration inside this
  repository.
- Datacat Reskin is a separate companion extension. Preserve Browser's popup
  fallback when Reskin is unavailable.
- Character imports must use upstream SillyTavern's native
  `/api/characters/import` PNG endpoint. Do not add custom server-fetch routes,
  server plugins, or remote-host allowlists to this extension.
- Production bridge origins must remain exact HTTPS origins. Development-only
  localhost origins require an explicit, non-default opt-in and must never ship
  in the public manifest/runtime defaults.

## Verification

- Preserve a valid SillyTavern `manifest.json` with repository-relative
  JavaScript and CSS entry points.
- Run `npm test`, `npm run check`, and `git diff --check` before committing.
- After runtime changes, verify both the Reskin-hosted and popup presentations
  in an authenticated SillyTavern browser session when the user authorizes live
  browser actions.

## Git and runtime guardrails

- Do not push, publish, rewrite history, or change remotes without explicit
  user approval.
- Do not start or restart SillyTavern as part of source-only work unless the
  user explicitly requests it.
