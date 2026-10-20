# Rexbot progress log

This file tracks the big upgrade: QEMU computers, accounts, an admin panel, more model providers, and the
Grok Bot-style assistant features. It is updated with every commit. If work stops, resume from
**Where I stopped** below.

## Ground rules for this work

- Keep the existing UI language: dark warm palette (`ember` accent, `dark` scale in `apps/web/src/theme.ts`),
  IBM Plex, Mantine components, Hugeicons, 3D blob avatars. Extend, don't redesign.
- Follow the antislop rules (`vendor/antislop`, adapted in `packages/shared/src/prompt/antislop.ts`).
  Summary: real states for every control (empty/loading/error), no fake metrics or claims, WCAG AA contrast,
  keyboard access, purposeful motion, verify before claiming done.
- Small coherent commits straight to `main`, `pnpm typecheck` and API tests green before each push.
- No secrets in the repo. Provider keys are encrypted at rest on the server.

## Plan

### Phase 1: Direct QEMU computers (replaces Proxmox)
- [x] `apps/api/src/computer/qemu.ts`: start/stop QEMU directly (`qemu-system-x86_64`, `qemu-img`),
      KVM when `/dev/kvm` is usable, TCG fallback, QMP socket for graceful power-off, pidfile recovery after API restarts.
- [x] One VM per user (like a personal box): qcow2 overlay on a shared, provisioned template image,
      cloud-init NoCloud seed ISO (cloud-localds / genisoimage / xorriso), user-mode networking with
      SSH forwarded to a loopback port.
- [x] Template builder: download the Debian 13 cloud image, boot once, run the guest setup (Xvfb, Openbox,
      noVNC, Chromium...), clean cloud-init, store `template-vN.qcow2`.
- [x] Reuse the per-bot screen logic (`rex-sessiond`, noVNC proxy, locks, input, screenshots) through a
      generic `DesktopComputer` that talks to any VM power driver.
- [x] Idle shutdown (off by default, the desktop stays on like before), per-user CPU/RAM/disk limits, max running VMs (app settings; UI in Phase 3).
- [x] `scripts/qemu/setup-host.sh` (installs packages, checks KVM), docs in `docs/qemu-computer.md`, `pnpm --filter api build-image` CLI.
- [x] Remove Proxmox code, scripts, env vars, and tests.
- [x] Live per-user VM boot, network isolation, noVNC mouse/keyboard control, and guest file verification using the provisioned template.

### Phase 2: Accounts
- [x] `users`, `sessions`, `app_settings` tables; scrypt password hashes; HttpOnly session cookie
      (Bearer token also accepted by the API; the desktop now uses same-origin website cookies).
- [x] Sign in / sign up screens in the current style, account menu (name, password, sign out). First account
      becomes admin. Sign-up is closed by default; admin opens it (UI in Phase 3, setting `signupMode`).
- [x] Every conversation, bot, group, memory, upload, and computer is scoped to its owner (404 for others,
      admins included). Existing single-user data is assigned to the first admin.
- [x] `http_fetch` refuses private/loopback/metadata addresses, re-checked on each redirect and pinned at DNS
      lookup (no rebinding). The legacy private-provider override no longer lifts bot fetch boundaries.
- [x] `REX_HOST` binding. API app split into `app.ts` (testable) and `index.ts` (server).
- [x] Serve the built web app from the API for a single-origin deploy.
- [ ] Invite-only sign-up mode (admin-created accounts work through the admin panel).

### Phase 3: Admin panel (`/admin`)
- [x] Overview: users, bots, messages, running VMs (real counts from the database).
- [x] Users: search, add user, role, disable/enable (signs out + stops their VM), set password, sign out
      everywhere, delete with typed confirmation (removes chats, memory, uploads, VM disk). Can't demote,
      disable or delete yourself; the last active admin is protected.
- [x] Computers: image status/build with live log and custom base image, every user's VM with start/stop/
      force off/reset, resources dialog, boot (serial) log.
- [x] Usage: messages per day, per user; tokens per user and per model once providers report them (Phase 4).
- [x] Settings: workspace name, sign-up mode, bots per user, VM defaults, running limit, idle shutdown.
- [ ] Workspace provider keys users may share (needs Phase 4).

### Phase 4: Model providers
- [x] Provider registry (`packages/shared/src/providers.ts`): OpenAI, Anthropic, Google Gemini, xAI, DeepSeek,
      OpenRouter, Mistral, Groq, Ollama, LM Studio, any OpenAI-compatible server. No hardcoded model ids:
      models are listed live from each provider's `/models`.
- [x] Adapter (`apps/api/src/llm.ts`): OpenAI-compatible streaming and a native Anthropic Messages adapter
      (system prompt, tool_use/tool_result, streamed tool arguments) behind the same chunk interface.
- [x] Per-user connections stored server-side, keys AES-256-GCM encrypted (`secrets.ts`), only `…last4` returned.
      Active model per user, optional model per bot (also used when a teammate answers privately).
- [x] SSRF: members can only connect providers on public addresses; admins may use local servers.
- [x] Usage: token counts from providers (stream usage / Anthropic events) recorded in `usage_events`.
- [x] Logos stored in `apps/web/public/providers`, sources and licenses in `docs/provider-logos.md`.
- [x] Settings → Models: provider tiles with logos, connect/check/load models, edit, remove, active model picker;
      bot editor model picker. Older browser-stored key kept as a fallback.
- [ ] Workspace keys an admin shares with members (`shareWorkspaceKeys` setting exists, not wired yet).
- [ ] Re-check provider URLs at request time against DNS rebinding (checked at save time today).

### Phase 5: Your own Claude / ChatGPT / Cursor accounts (research summary, see bottom)
- [x] Claude: Anthropic API key (Console), native Messages adapter (Phase 4). Settings → Models says plainly that
      Pro/Max subscriptions can't be used by apps like this.
- [ ] Optional: install unmodified Claude Code inside the user's VM and let the user sign in through Anthropic's own flow.
- [ ] ChatGPT: "Sign in with ChatGPT" plan usage. Not built yet, on purpose (see "ChatGPT sign-in: why not yet").
      OpenAI API key works today.
- [x] Cursor: user API key (checked with `GET /v1/me`, encrypted in `user_settings`), `cursor_agent` tool
      (start / status / follow_up / list) offered only to users who connected a key, Settings → Models → Tools card.

### Phase 6: Assistant features (Grok Bot style)
- [x] Routines: scheduled prompts per bot or group (daily at a time, chosen weekdays, or every N hours, in the
      user's time zone with DST handled), run server-side every 30 s, results posted in the chat. Sidebar → Routines,
      plus a `routine` tool so a bot can set one up when asked ("every morning at 8..."). Routine runs can't create routines.
- [x] The bot knows the current date and time in the user's zone (browser zone, remembered per user).
- [x] Skills: per-account instruction packs (Settings → Skills). Bots see names and "when to use" in the prompt
      and pull full instructions with `load_skill`, so long skills don't cost tokens on every turn.
- [x] Guest-only autonomy, concise replies, silent instruction application, and relevant proactive routines without duplicates or recursive scheduling.
- [x] Model vision for supported image attachments and guest screenshots on vision-enabled connections.

## Done

- Phase 1 code: `ComputerFleet` (apps/api/src/computer.ts) hands each owner a computer; `DesktopComputer`
  (computer/desktop.ts) is the old per-bot screen logic over a generic `VmPower`; `QemuMachine`/`QemuHost`
  (computer/qemu.ts) run QEMU, QMP, cloud-init seeds and the template build.
- Phase 2: `auth.ts` + `routes/auth.ts` (API), `AuthScreen.tsx`, `AccountModal.tsx`, `session.tsx`, `Root.tsx` (web).
  Tests: `test/auth.test.ts` (first admin, closed sign-up, isolation, logout), `test/safeFetch.test.ts`.
  Playwright signs in once in `test/global-setup.ts`.
- Phase 3: `routes/admin.ts` (all behind `requireAdmin`), `test/admin.test.ts`, web `src/admin/*`
  (AdminPanel shell reuses the chat sidebar look; Overview, Users, Computers, Usage, WorkspaceSettings).
  Members see only "an admin needs to build the image" in the computer panel; host details are admin-only.
- Phase 4: `providers.ts`, `secrets.ts`, `routes/providers.ts`, `test/providers.test.ts` (fake Anthropic server:
  encryption at rest, model listing, tool round trip, usage rows); web `ModelsPanel.tsx`, `ProviderLogo.tsx`,
  `BotModelPicker.tsx`, tabs in `SettingsModal.tsx`.

## In progress

- Phase 1 verification on the dev box (nested KVM hangs here, so `REX_QEMU_ACCEL=tcg`). Found and fixed:
  guests tried IPv6 first on an IPv6-less host (now `ipv6=off`), and `apt-get update`
  failures were silent (now fatal). On this box apt's HTTPS transport times out through the sandbox proxy while
  curl over HTTPS works, so the build here runs with `REX_GUEST_APT_HTTP=1` (GPG-verified packages over http).

## Known gaps

- Tavily and Google keys still live in browser local storage (model keys moved server-side in Phase 4).
- Native desktop windows have not been manually exercised on Windows or macOS; Linux installers build successfully.

- Phase 5: `integrations/cursor.ts` (Cloud Agents v1, Basic auth, `REX_CURSOR_API_URL` override for tests),
  routes `GET/PUT/DELETE /integrations/cursor`, `test/cursor.test.ts` (fake Cursor server), web `CursorCard.tsx`.

- Phase 6 (routines): `chatTurn.ts` (the chat turn, shared by `POST /chat` and routines), `routines.ts`
  (table, schedule math, runner, `routine` tool), `routes/routines.ts`, `test/routines.test.ts`, web `RoutinesDrawer.tsx`.
  Open chats poll for routine results. Routines use the server-side provider connection, and web search in routines needs the Tavily key that still lives in
  the browser (see Known gaps).

- Phase 6 (skills): `skills.ts`, `routes/skills.ts`, `test/skills.test.ts`, web `SkillsPanel.tsx`.

### ChatGPT sign-in: why not yet

OpenAI's open-source "Sign in with ChatGPT" plan usage (developers.openai.com/siwc) is real and documented, but:
- The OAuth callback must be `http://127.0.0.1:<port>/auth/callback` on the machine running the browser. That only
  works when Rex runs on the user's own computer (or the Tauri app); a shared Rex server can't receive it.
- OpenAI offers plan usage to open-source tools and personal projects that run locally; remotely hosted apps
  must apply first. A multi-user Rex server is a remotely hosted app.
- Requests must go to the Responses API (`store: false`, `stream: true`, no `temperature`/`max_output_tokens`,
  function tools grouped in namespaces), so it needs a third adapter next to OpenAI-compatible and Anthropic.
- It needs a Plus/Pro account to test; nothing here has one, and I won't ship an untested OAuth flow.
Plan when it's picked up: provider kind `responses`, a loopback listener started only when `REX_HOST` is a
loopback address, `ext_agent_host_id` as `urn:uuid:` persisted in the data dir, ID token checked against
OpenAI's JWKS, refresh tokens rotated and stored encrypted, "Continue with ChatGPT" + "Manage usage" per the
OpenAI UI guidelines.

## Where I stopped

Desktop website connections, cookie-only web authentication, dependency upgrades, autonomous routine guidance,
DSML parsing, guest network boundaries, and click-to-open computer controls are implemented. DSML fixes were
pushed as `18ab9e8`. Linux DEB/RPM desktop installers build successfully. The live VM network check passed;
the live noVNC check verified browser typing by reading a file written in the guest. The full suite passes:
45 API tests, 18 web tests, 2 desktop UI tests, plus 2 Rust tests. Live checks run separately with a provisioned
VM image. npm audits report no known vulnerabilities, and no workspace packages are outdated.
Server-side Tavily/Google settings remain future work. Deployment and boundaries: `docs/desktop.md`.

The follow-up adds structured guest file editing and managed per-bot project servers, using a Python helper sent
over SSH so existing images work without rebuilding. Live VM tests verify file edits, HTTP inspection, the browser
window title, custom server commands, and stop/status. Node/npm are included in future templates. Live chat now
accepts messages during active work, interrupts provider generation, skips obsolete pending tools after a running
command finishes, and respects new group mentions. API and browser regression checks pass. The earlier DSML
screenshot was taken before the user restarted the old app; it was not evidence of a new parser regression.

Take control now reserves only mouse/keyboard input. Bots keep editing files, running background shell commands,
inspecting projects and taking screenshots. New shell calls have DISPLAY/dbus unset during owner control, and
project helpers defer browser opening. Desktop unit coverage and the live VM regression verify continued work
without stealing the owner's screen.

Expired screen URLs, noVNC disconnects, failed module loads and connection timeouts show
"Disconnected, click to reconnect". Clicking refreshes the authenticated session and remounts the viewer, including
when its URL stays unchanged. Preview and expanded screen support retry, with errors visible in the open modal.
Only messages from the current screen iframe can change its connection state. Reconnection regression coverage
uses the actual viewer HTML and exercises expiry, disconnect, keyboard retry, a failed retry and frame-message spoofing.

The remaining DeepSeek leak was traced to actual saved output using double fullwidth bars (`<｜｜DSML｜｜ calls>`).
The parser and historical-reply sanitizer now handle repeated/spaced ASCII and fullwidth bars. Regression checks
exercise all forms across character-level stream splits and preserve the command text exactly. Old stored calls
are hidden by rendering sanitization; they are never executed retroactively. The fix was pushed as `f2dae47`.

Guest image sharing now uses computer_screenshot share=true, optionally with a saved workspace image path and
caption. Captures travel from the guest over a bounded SSH channel and are stored as owner-scoped attachments
on bot-authored messages, emitted immediately and preserved after reload. Larger bot previews reuse the existing
image viewer. API checks cover real DSML execution through the sharing tool, persistence, raster validation and
cross-account denial. Live QEMU checks capture an actual screen and transfer a PNG above the old 40 KB limit.

Reference-driven prompts now require checking official pages and inspecting the guest UI before claiming visual
verification. Material ambiguity uses ask_user: persisted question cards, a mobile answer modal, custom answers,
retry without losing text, and a server runner that pauses dependent tools until the answer. Normal follow-up text
also resolves pending questions. Concurrent duplicate form submissions create only one answer. The chat scrollbar
uses LTR scrolling on the right. Vision connections receive screenshot pixels after complete tool-result groups,
and recent owner-scoped chat images are restored on later turns. Text-only connections stay honest about their limits.
Existing local Bedrock/provider and conversation-navigation edits were preserved separately from this work.

Admin token counts now abbreviate only at one million or above, with exact comma-grouped values on hover and
keyboard focus. Browser coverage checks the threshold, billion counts and exact tooltips. Follow-up messages
explicitly preserve unfinished work in the bot rules; realtime regression coverage verifies original context and
continued tool execution after a status question. Typecheck and the focused checks pass.

Sidebar bots and groups now expose context actions through right-click, Shift+F10 and a 44 px actions control.
Actions open the chosen chat, edit that bot/group, open its computer, or invoke the existing deletion confirmation.
Desktop action dots appear on hover/focus or while the menu is open; touch devices retain a visible control.
Conversation rows and the dots have transparent backgrounds, with the selected name carrying the orange accent.
The existing local App navigation guards are included with this change because sidebar navigation stays available
during streaming; a browser regression verifies that a background reply never appears in the other chat. Local
provider/Bedrock changes remain outside these commits.

Frost's stored run showed that both reference fetches returned only a title, then a GitHub search result was
mistaken for visual research. The bot wrote index.html and handed server startup back to the owner. Sparse scripted
pages now carry an explicit source-only warning. computer_browser opens the exact public reference on the guest
screen, respecting owner control and retaining the guest's public-only proxy boundary.

Website turns now check tool evidence before delivering: referenced domains need a rendered-screen capture before
structured UI writes; edited pages need a healthy matching project server, a guest browser preview and a current
shared screenshot. Vision routes must actually receive pixels. Premature drafts are withheld from SSE/history and
returned to the model for continued work, with two corrective retries and an honest incomplete result at the limit.
Tests reproduce the early-success reply with and without simultaneous tool calls, failed/stale/wrong-project
evidence, owner-control deferral, explicit stop and ordinary informational questions. All 47 API tests, focused
question/realtime browser checks, typecheck, build and a live guest reference-browser/isolation run pass. These are
workflow evidence checks, not a guarantee of a model's visual judgment or fidelity to a reference.

## Research notes: connecting your own AI accounts (Oct 2026)

- **Claude (Anthropic)**: third-party apps must use API keys from Claude Console. Anthropic's Claude Code legal
  page says developers may not offer Claude.ai login or route requests through Free/Pro/Max credentials, and may not
  collect Claude.ai session tokens. An end user may sign in to the *unmodified* Claude Code binary themselves, including
  where a platform hosts it. So Rexbot supports API keys, and can run Claude Code inside the user's own VM.
- **ChatGPT (OpenAI)**: "Sign in with ChatGPT" has an open-source flow: OAuth 2.0 Authorization Code + PKCE with
  `client_id=dynamic_agent_client`, a persisted `ext_agent_host_id`, scopes for Responses API plan usage. It is offered
  for open-source tools and locally run personal projects; paid or remotely hosted apps need OpenAI approval.
- **Cursor**: user API keys from Cursor Dashboard → API Keys work with the official Cloud Agents API
  (`https://api.cursor.com/v1/agents`) and `@cursor/sdk`. These run Cursor *agents* (repo work), not a chat-completions
  model API, so Cursor fits as a tool ("delegate this coding task to a Cursor agent"), not as a chat provider.
- No scraping or reuse of consumer session cookies anywhere.
