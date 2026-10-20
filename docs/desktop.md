# Desktop websites and isolation

The desktop app opens your hosted Rex website. It no longer embeds the chat frontend with a hardcoded localhost API. Start it, enter a website address, then use the website's sign-in or account creation screen. Existing sessions remain in the system webview's cookie store. Registration follows the server's setting; the app cannot bypass closed registration.

Only HTTPS websites are accepted, with certificate validation. HTTP is accepted for loopback development addresses. The launcher checks `/auth/state`, rejects redirects and oversized responses, and saves only the origin in its application config directory. Passwords and session tokens are not saved by the launcher or in JavaScript local storage. The website keeps its HttpOnly session cookie; authentication responses no longer return its bearer token.

The bundled launcher and remote workspace are separate webviews. Only the launcher has permission to run the two connection commands. The workspace has no native shell, filesystem, process or opener permissions. Rust also checks the calling webview and launcher origin. External links open in the normal browser. Use **Rex → Change website** (`Ctrl/Cmd+Shift+W`) to select another server, or **Rex → Reload workspace** to reload. Closing the workspace returns to the launcher.

This follows Tauri's [capability boundaries](https://v2.tauri.app/security/capabilities/), including explicit permissions for application commands. These boundaries limit native APIs; they do not establish that a user-selected website is trustworthy.

## Run or build

```sh
pnpm install --frozen-lockfile
pnpm dev:desktop
pnpm --filter desktop tauri build --bundles deb,rpm
```

Rust and Tauri's platform prerequisites are required. The installed desktop app needs no local API or QEMU. Computers run on the website's API host, inside their assigned VMs.

## Host a website

```sh
pnpm build
REX_WEB_ORIGIN=https://rex.example.com pnpm --filter api start
```

The API serves `apps/web/dist`, including direct links to bots, groups and the admin pages. Production web builds use their own origin for the API by default. `REX_WEB_DIST` can select another absolute build directory. API requests to admin endpoints remain JSON; browser page requests receive the SPA. The API binds to loopback by default.

Put it behind an HTTPS reverse proxy. Example Caddy configuration, replacing the example domain:

```caddy
rex.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Keep the database, generated encryption key and VM disks in the server's persistent data directory, outside the web build directory. Forward WebSockets through the reverse proxy for the computer screen. Do not expose guest SSH or noVNC ports publicly.

## Computer boundaries

Bot shell commands run through `rex-sessiond` inside the account's VM. No host filesystem mount, container socket or native desktop command API is exposed to bots. QEMU's `restrict=on` blocks direct guest traffic to the host and private network. Internet access goes through a loopback proxy exposed at `http://10.0.2.100:3128` inside the guest. The proxy allows public HTTP on port 80 and HTTPS on port 443, validates and pins DNS answers, and refuses private, loopback, metadata and known host addresses. Set `REX_WEB_ORIGIN` so its resolved public host address is refused too. Raw outbound TCP/UDP and IPv6 are unavailable. SSH connections initiated by the API still work.

The QEMU relay is a fixed netcat connection to that proxy; guest input cannot select a host command or relay destination. Install the host prerequisite with `scripts/qemu/setup-host.sh`. Keep `REX_VM_PROXY_PORT` stable across API restarts. Existing unrestricted VMs restart on their next use to apply the boundary; their disks are retained. Existing shells should keep the injected proxy environment and use `sudo -E` for network-dependent package commands. New guests also have apt proxy configuration. See QEMU's [user-network options](https://www.qemu.org/docs/master/system/qemu-manpage.html).

Computer previews open when clicked. Take control opens the interactive screen and reserves mouse/keyboard input for the owner. The bot continues editing files, running commands, checking projects, and taking screenshots. New shell commands have DISPLAY/dbus unset while the owner controls the screen, and project servers defer opening browser windows so they do not steal focus. A command already running in the guest can finish. Control leases expire if the client stops renewing them. The screen runs in a sandboxed iframe without same-origin privileges, so scripts served by the guest cannot read the parent page or make authenticated API requests. A valid short-lived view token is required for screen files and WebSockets.

An expired screen URL or lost connection shows "Disconnected, click to reconnect". Clicking it fetches a current authenticated screen session and reloads the viewer in place. The preview and expanded modal both support retry; failed retries keep the action available and show an error. The parent accepts connection notifications only from its current iframe, including its opaque sandbox origin. Module-load failures and connection timeouts also enter the disconnected state.

HTTP fetch tools also enforce the public-address boundary, even if the legacy `REX_ALLOW_PRIVATE_FETCH` provider override is set. Admin-connected local model providers are a separate, explicit server configuration.

## Autonomous routines

Bots may create a relevant routine when an ongoing user task warrants follow-up. They must first list existing routines, use the least frequent useful schedule and tell the user what was scheduled. The tool also reuses identical tasks instead of creating duplicates. Routines remain scoped to their owner and chat; scheduled runs cannot create more routines. Models still determine whether to use the tool, so prompt instructions are guidance rather than a guarantee of model behavior.

Scheduled work uses a model connected under Settings → Models. Browser-only fallback keys are unavailable when the browser is closed. The API must remain running for routines to execute.

## Projects inside the computer

Bots now have `computer_files` for listing, reading, writing, and exact text replacement in their own workspace. File contents travel as structured data over SSH, rather than being embedded in shell heredocs. Paths must resolve inside that bot's workspace. The helper runs in the guest using Python already present in existing images; no template rebuild is needed for these tools.

`computer_project` starts one managed server per bot, checks its HTTP response, reads logs, opens its URL in the guest browser, and stops its process group. Static sites use Python's server without installing packages. Framework projects can provide a server command; `PORT` is allocated automatically and `HOST` is `127.0.0.1`. For example, a Vite project can use `npm run dev -- --host 127.0.0.1 --port $PORT` after dependency installation. New templates include distro Node.js/npm; bots may install missing build dependencies inside an older guest.

The server runs inside the VM and survives individual tool calls. The owner sees the site on the bot's screen and interacts using Take control. Guest localhost URLs are not public links or URLs for the owner's own browser. The project server stops when its guest shuts down; source files remain. HTTP inspection reports source and status, without pretending to execute JavaScript or inspect rendered pixels.

## Sending messages while a bot works

The composer remains available during a reply, including attachments. New messages are saved immediately. During text generation, the server cancels that provider stream and restarts with the updated conversation; partial text already shown stays in history. During a tool command, that command finishes, remaining obsolete tool calls are skipped, and the next model round receives the update. Group mentions can select a different member while the group is working.

There is one active runner per conversation, with up to 32 pending messages. Browser reloads do not cancel that runner. An API process restart still ends active work; this is not a durable job queue or a guarantee of immediate cancellation of guest processes.

## Images from the guest

`computer_screenshot` accepts `share: true` to attach an actual PNG capture to the owner's conversation. An optional `path` selects an existing raster image inside that bot's workspace, such as a browser capture at another viewport; an optional `caption` adds up to 1000 characters. With no share flag, the tool keeps its existing metadata-only behavior.

Capture and file reads run inside the VM. The guest resolves paths within the bot workspace, refuses escaping paths/symlinks, and reads at most 8 MB. Only this transfer uses a larger bounded SSH response limit; ordinary command output keeps its 40 KB limit. The API validates raster signatures, assigns a new upload ID, and attaches the image to a bot-authored message in the owner's conversation. The normal authenticated upload endpoint serves it, with other accounts receiving 404. Private bot replies cannot post images into the owner's conversation.

The image appears immediately through an assistant-message event, persists with the conversation, and uses the existing image viewer. Bot image previews use a larger uncropped surface for reviewing work; click to enlarge. Capturing or sharing an image does not give a text-only model access to its pixels.

## Reference research, clarifications and vision

`computer_browser` opens a public reference URL directly on the bot's guest screen. Capture the rendered page with
`computer_screenshot`; the browser launch result alone does not prove the page loaded. Sparse JavaScript page
responses from `http_fetch` now warn that source text is insufficient to infer the rendered design.

Website implementation turns validate tool evidence before releasing the final reply: referenced domains are
captured before structured UI writes, and the edited project has a successful server check, an open guest preview
and a shared screenshot after its latest edits. A vision route must receive the screenshot pixels. Early delivery
drafts are withheld and returned to the model for up to two corrective attempts. Failure remains visible as an
incomplete verification report. This check follows known website intent and structured UI writes; it cannot prove
visual similarity, infer every arbitrary shell edit or replace the model's interpretation of screenshots. Owner
control can defer browser opening while independent work continues.

The bot instructions require inspecting official reference pages when a request names a product or website. For example, "like Cloudflare" should lead to reference research and, when needed, a clarification about visual style versus product functionality. The computer workflow asks bots to open their project, test relevant interactions, capture meaningful before/after screenshots and correct observed defects. These are model instructions, not a guarantee that every model follows them on every turn.

The `ask_user` tool creates one persisted question card in the current conversation, with one to three focused questions and optional choices. The answer dialog always supports custom text. A successful tool call pauses dependent work rather than letting the bot guess. `POST /questions/:id/answer` validates account ownership, rejects repeated answers and resumes the bot in that conversation. An ordinary user message can also answer a pending question. Reloading preserves pending/answered cards; cancelling the modal does not discard its local draft. Model/provider errors during continuation are saved as a visible chat reply.

For a model connection with image support enabled, `computer_screenshot` sends actual pixels into the next model round by default. `inspect: false` skips this; `share: true` independently posts the picture in chat. PNG, JPEG and WebP images up to 5 MB are accepted for inspection. At most four recent images are sent per request, including restored chat attachments and tool captures. Image text is treated as untrusted data, and another account's uploads cannot enter the model context. Models without image input receive metadata and must use source, HTTP, logs and tests without claiming visual observations.

Wire formats follow the [official OpenAI Chat Completions image input reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [Claude vision documentation](https://platform.claude.com/docs/en/build-with-claude/vision). Local provider fixtures verify payloads and tool ordering; no paid provider key was used for these tests. Enable image support only for a model that actually accepts image inputs.
