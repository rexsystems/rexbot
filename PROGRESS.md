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
- [ ] `apps/api/src/computer/qemu.ts`: start/stop QEMU directly (`qemu-system-x86_64`, `qemu-img`),
      KVM when `/dev/kvm` is usable, TCG fallback, QMP socket for graceful power-off, pidfile recovery after API restarts.
- [ ] One VM per user (like a personal box): qcow2 overlay on a shared, provisioned template image,
      cloud-init NoCloud seed ISO (cloud-localds / genisoimage / xorriso), user-mode networking with
      SSH forwarded to a loopback port.
- [ ] Template builder: download Debian 12 cloud image, boot once, run the guest setup (Xvfb, Openbox,
      noVNC, Chromium...), clean cloud-init, store `template-vN.qcow2`.
- [ ] Reuse the per-bot screen logic (`rex-sessiond`, noVNC proxy, locks, input, screenshots) through a
      generic `DesktopComputer` that talks to any VM power driver.
- [ ] Idle shutdown, per-user CPU/RAM/disk limits, max running VMs (admin settings).
- [ ] `scripts/qemu/setup-host.sh` (installs packages, checks KVM), docs in `docs/qemu-computer.md`.
- [ ] Remove Proxmox code, scripts, env vars, and tests.

### Phase 2: Accounts
- [ ] `users`, `sessions`, `app_settings` tables; scrypt password hashes; HttpOnly session cookie
      (Bearer token also accepted for the desktop shell).
- [ ] Sign in / sign up screens in the current style. First account becomes admin. Admin can turn
      sign-up on/off (and choose invite-only).
- [ ] Every conversation, bot, group, memory, upload, and computer is scoped to its owner.
      Existing single-user data is assigned to the first admin.
- [ ] Optional `REX_HOST` binding and serving the built web app from the API for a single-origin deploy.

### Phase 3: Admin panel (`/admin`)
- [ ] Overview: users, bots, messages, running VMs (real counts from the database).
- [ ] Users: search, role, disable/enable, reset password, delete (with confirmation), sessions sign-out.
- [ ] Computers: template status/build, every user's VM with start/stop/reset/delete, resources.
- [ ] Usage: messages and tokens per user and provider.
- [ ] Settings: sign-up mode, default limits, workspace provider keys users may share.

### Phase 4: Model providers
- [ ] Provider abstraction in the API: OpenAI-compatible adapter (OpenAI, xAI, DeepSeek, OpenRouter, Groq,
      Mistral, Google Gemini OpenAI endpoint, Ollama/LM Studio local) and a native Anthropic Messages adapter.
- [ ] Per-user provider connections stored server-side (encrypted), model picker per bot.
- [ ] Provider logos stored in the repo (`apps/web/public/providers`), license noted in `docs/provider-logos.md`.
- [ ] Polished provider settings UI (connection cards, test connection, model list).

### Phase 5: Your own Claude / ChatGPT / Cursor accounts (research summary, see bottom)
- [ ] Claude: Anthropic API key (Console). Optional: install unmodified Claude Code inside the user's VM and let
      the user sign in through Anthropic's own flow.
- [ ] ChatGPT: "Sign in with ChatGPT" open-source flow (OAuth + PKCE, Responses API) for locally hosted installs;
      OpenAI API key otherwise.
- [ ] Cursor: user API key from Cursor Dashboard; a `cursor_agent` tool that starts Cursor Cloud Agents on the
      user's repos through the official Cloud Agents API.

### Phase 6: Assistant features (Grok Bot style)
- [ ] Routines: scheduled prompts per bot (cron-like), run server-side, results posted in chat.
- [ ] Skills: reusable instruction packs a bot can load.
- [ ] Better bot rules in the system prompt.
- [ ] Model vision for image attachments where the provider supports it.

## Done

(nothing yet)

## In progress

- Phase 1: QEMU backend.

## Where I stopped

Plan written. Next: implement `apps/api/src/computer/qemu.ts` and the generic desktop computer.

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
