---
name: verify
description: Launch and drive latteart end-to-end to verify a change in the running app (dev server + Chrome browser tools).
---

# Verifying latteart changes

- Launch: `pnpm dev` from the repo root — starts the API server on :8899 and the web app via Vite. The web port auto-increments (5173, 5174, …); read the `Local:` line from the output. `EADDRINUSE :::8899` means another instance is already running and the web app will just use it.
- Static checks: `pnpm run check` (format + lint + types). Not a substitute for driving the app.
- Drive with the claude-in-chrome browser tools; the app is a single canvas page, no routes or login.
- Safe generation probe: switch the provider to **Mock · Mock Diffusion** (topbar picker) — instant local generations, no API keys. Type a prompt in the bottom bar, press Enter.
- Cleanup after probes: the project **autosaves to server disk**, so test layers land in the user's real project. Delete them with the trash icon on the layer row (⌘Z undo also works), and restore whatever provider was selected when you started.
- Gotcha: the Cutout toggle persists across sessions — if it's amber/active, every generation runs an isolate (remove-background) step after generating.
- Selecting a "needs key" provider in the picker opens the Settings dialog; Esc closes it.
