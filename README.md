# Rexbot

Customizable AI bots with real 3D avatars, image attachments, persistent conversations, and an isolated local computer for Python and shell work.

Built by [RexSystems](https://github.com/rexsystems). Runs in your browser or a Tauri desktop window, with **React, Mantine, Hugeicons, Three.js, Hono, and SQLite**.

![Rexbot's bot editor showing a green 3D cube character, shape options, and movement settings](docs/images/bot-editor.png)

*The bot editor with a disposable demo profile. Avatars use matte 3D meshes with no gloss or cast shadows.*

## What you can do

- **Create a bot:** start with one of 100 suggested names, then choose its color, shape, movement, blinking, and working instructions. Suggestions avoid existing bot names until the pool is exhausted, then reuse the least-used names. You can always enter your own name. Edit it later without losing the conversation.
- **Give it a character:** sphere, pebble, rounded cube, capsule, or diamond geometry. Float, orbit, rotate, or stay still. Device reduced-motion preferences are respected.
- **Attach images:** paste with Ctrl+V, drag files into the conversation, or use the attachment button. Preview before sending, remove with X, and click to enlarge. Multiple images stay above your message text after reload.
- **Keep conversations:** messages, attachments, reactions, profiles, and user memories are stored in local SQLite. Bots and people can react with emoji.
- **Make groups:** use the **+** beside Groups to bring 2-6 existing bots together, or create a new bot directly from the group editor. The first member replies by default. Type `@` in the message to pick a bot, or `@everyone` to hear from all members one at a time. Arrow keys, Enter/Tab, and mouse selection work in the inline suggestions; Escape dismisses them. Edit the group later to add members or change its name.
- **Let bots collaborate:** a bot can privately contact a teammate from a shared group, including when you ask it from its own chat. The recipient uses the configured model and can verify work with tools. Inspect requests and replies under **Group settings → Private messages**. Personal chat history is not automatically forwarded.
- **Filter generic output:** every bot receives built-in guidance to finish tasks, inspect tool results, try reasonable alternatives, and apply an adapted version of antislop's 38 core rules. The source snapshot and MIT attribution live in [vendor/antislop](vendor/antislop). No runtime `npx` install is needed.
- **Use tools:** search through Tavily, fetch pages, read text/PDF attachments, and run Python or shell commands in the computer workspace.
- **Work beside the computer:** open the right-hand drawer from the conversation toolbar. Collapsing it keeps the container running and its command output available.
- **Talk live:** open the microphone button in an individual bot's chat for Gemini 3.8 Live audio, interruptions, mute, tool calls, and saved transcripts.
- **Delete deliberately:** conversation deletion asks for confirmation and plays a short squash animation after you confirm. Reduced-motion preferences skip it; deleting a group keeps its bots.

## Run locally

You need **Node.js 22.12+** and **pnpm 10.33.2**. Development is tested with Node.js 24. Podman is optional for chat and required for the computer feature.

```bash
git clone https://github.com/rexsystems/rexbot.git
cd rexbot
pnpm install --frozen-lockfile
pnpm dev
```

Open **[localhost:5173](http://localhost:5173)** for the product page, then **Open Rex** (or go to `/app`). In **Settings**, enter your model provider's API key, base URL, and model ID. The adapter uses the OpenAI-compatible Chat Completions interface. Defaults point to DeepSeek; choose a model that supports streaming and function tools.

Create a bot with the **+** beside **Your bots**, then send it a message. Add a Tavily key in Settings if you want web search. The **+** beside **Groups** opens the group editor.

To run each process separately:

```bash
pnpm --filter @rex/shared build
pnpm dev:api
# In another terminal:
pnpm dev:web
```

The API listens on **127.0.0.1:8787**. `.env.example` documents the available variables; it is not automatically loaded by the API. Export API variables in your shell. Vite variables belong in `apps/web/.env.local`.

## Google AI Studio: memory and live voice

In **Settings**, add a **Google AI Studio API key** from [AI Studio](https://aistudio.google.com/apikey). This is separate from the chat provider key.

| Role | Default model |
| --- | --- |
| Text chat and private teammate replies | Your configured OpenAI-compatible chat model |
| Memory embeddings | `gemini-embedding-2` |
| Live voice | `gemini-3.8-live` |

Google documents [Gemini Embedding 2](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2) and [Gemini 3.8 Live](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live). The model fields remain editable. Chat-provider embeddings are still available through the embedding-provider selector; existing saved chat-provider configurations are preserved.

Memory embeddings use Google's native `embedContent` endpoint, one vector per text, with 768 dimensions. Vectors are tagged by provider/model so incompatible embeddings are never compared. Old memories are re-embedded lazily, up to 16 per retrieval. Missing keys or failed embedding requests fall back to keyword retrieval.

For voice, open an individual bot, click the microphone, and choose **Start call**. Allow microphone access; localhost or HTTPS is required. **Mute microphone** pauses sending audio, **End call** releases the microphone, and closing the dialog ends the call. Voice is currently one bot at a time; group conversations use text.

The local API issues a one-use Google ephemeral token, locked to the bot's setup and valid for ten minutes. The browser streams 16 kHz PCM and plays Google's PCM responses directly over the [Live WebSocket API](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket). It sends the last 20 chat messages, attachment metadata, up to eight recent memories, and the bot's profile/rules as context. Raw audio is not saved by Rexbot; transcripts and completed tool activity are saved in the bot's chat. Google receives the audio and context. Model access, quota, and billing depend on your Google account.

Live sessions may run the existing search, fetch, attachment, computer, and teammate tools. A call permits 24 tool calls and six private teammate requests; the computer still needs to be started by the user. In-flight tool work may finish after a call ends and remains in the activity history. Start a new call after a connection or session expires. No system packages or Google SDK installation are required.

## Rex Computer

Install local **rootless Podman** with seccomp and cgroup v2. On Fedora or Nobara:

```bash
sudo dnf install podman
podman info
podman pull docker.io/library/python:3.13-alpine
```

Use the **computer icon at the top right of the conversation**, then choose **Start computer**. Run a command in the drawer, or ask your bot to use its computer in chat.

| Resource | Limit |
| --- | --- |
| Environment | Python 3 and Alpine shell |
| CPU | 1 core |
| Memory | 512 MB, no extra swap |
| Processes | 64 |
| Workspace | 128 MB in temporary memory |
| Temporary directory | 32 MB |
| Command duration | 20 seconds |
| Command output | 32,000 characters |
| Session lifetime | 1 hour |

The container runs as a non-root user with all capabilities dropped, no new privileges, a read-only operating system, **no network**, no host directory mounts, and no container-engine socket. A timed-out command removes the entire container, including child processes. **Stop & erase workspace** deletes its temporary files.

All bots currently share one local computer. Hiding the drawer does not stop it. Containers share the host kernel and are not virtual machines. This is a Python/shell workspace; a graphical desktop and browser automation are not implemented.

## Images and attachments

Attach up to **8 files per message**, **8 MB each**. PNG, JPEG, WebP, GIF, and AVIF have inline previews. Click a thumbnail to view it at a larger size; use Previous/Next or the arrow keys to browse a group, and Escape to close it. Images can be sent with or without text.

Uploads appear immediately in the composer while transferring. Send stays disabled until they finish. Failed uploads can be retried or removed, and removing an unsent file cleans up its upload. Sent attachments are associated with their message and reload with it.

Image display is independent of the model. **The current model adapter is text-only:** it sends attachment metadata and can read text documents, but does not send image pixels for visual understanding.

## Desktop

Install Rust and the [Tauri prerequisites for your platform](https://v2.tauri.app/start/prerequisites/), then keep the API running:

```bash
pnpm --filter @rex/shared build
pnpm dev:api
# In another terminal:
pnpm dev:desktop
```

The desktop shell uses the same interface and local API as the browser version. The current computer backend expects a Linux host with rootless Podman.

## Development

| Directory | Responsibility |
| --- | --- |
| `apps/web` | React, Mantine, Hugeicons, image composer, shared Three.js avatar renderer |
| `apps/api` | Hono API, streaming model tools, SQLite, file storage, Podman lifecycle |
| `apps/desktop` | Tauri desktop shell |
| `packages/shared` | Types, bot profiles, tool definitions, and system prompt |
| `docs` | UI validation and screenshots |

```bash
pnpm build
pnpm typecheck
pnpm --filter web exec playwright install chromium
pnpm test
```

The complete test suite needs the Podman image above. API tests use disposable databases and containers. Browser tests start a separate API and web server, use a mock model instead of a paid API key, and exercise real uploads, clipboard image paste, drag & drop, image previews, profile persistence, 3D rendering, reactions, groups, private messaging, and responsive layouts. Google checks simulate the provider responses while exercising real browser microphone capture, AudioWorklet PCM conversion, WebSocket messages, playback, tool callbacks, transcripts, and cleanup. They also cover embedding-provider migration and deletion confirmation, failure recovery, animation, and reduced motion. These checks do not make a paid Google request or measure live speech quality.

Avatar meshes share **one WebGL renderer**. Animated visible characters follow the screen's animation frames; stationary characters redraw only when their appearance changes or they blink. Hidden characters and tabs skip rendering. The Three.js module loads separately from the main interface. No external model or texture downloads are required. See the [UI validation notes](docs/ui-validation.md) for the checks and implementation choices.

## Data and access

- SQLite and uploads live in `data/` by default, or the directory specified with `REX_DATA_DIR`.
- Model keys are saved in browser local storage and sent to the local API when used. Chat text, selected memories, and tool results are sent to your configured model provider.
- The Google key is sent to the local API for embeddings and ephemeral-token issuance; the live WebSocket uses only the short-lived token. Live settings stay in API memory for the session and any in-flight tool work. Google receives memory text for embeddings and microphone audio/context during voice calls.
- Group history and private exchanges use the same configured provider. A private recipient receives its profile, the passed task, and up to six recent exchanges with that teammate in the shared group, rather than either bot's personal conversation history. Private exchanges are persisted locally and inspectable by the owner; "private" means outside the shared conversation, not hidden from the owner or model provider.
- The API binds to loopback and restricts browser origins. It is a local, single-user application and is not configured for public network hosting.
- Keys, user data, uploads, build outputs, and local agent configuration are excluded from the repository.

## Current scope

Rexbot provides local chat, customizable bots, groups, private collaboration, Google live voice and memory embeddings, attachments, and an offline command workspace. Group messages get one public reply by default, from the first member or the first bot explicitly mentioned. `@everyone` gives each member one turn in group order. Requests in the same conversation cannot overlap. Each responding bot can use up to six tool rounds and four calls per round. A user turn permits at most six private requests total. Private recipients can use up to three tool rounds and cannot delegate recursively. Bots share the existing computer workspace and model settings; prompts guide behavior, while capability and answer quality depend on the configured model and available tools.

The text adapter preserves a provider's streamed `reasoning_content` through tool rounds and keeps model-scoped reasoning metadata for later turns. This supports [DeepSeek thinking-mode tool calls](https://api-docs.deepseek.com/guides/thinking_mode/). Metadata stays in local SQLite and is not part of visible chat messages or public conversation/private-exchange API responses. Reasoning from another provider/model is not forwarded. Speaker names are rendered by the interface; replies do not need to repeat `[Bot name]:` in their text.

Scheduled/background conversations, multi-user authentication, GUI computer control, and model vision are not implemented. Changes are welcome through GitHub issues and pull requests.

## License

Rexbot is licensed under the **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`). See [LICENSE](LICENSE) for the full text.

The bundled antislop source snapshot and adapted rules retain their upstream [MIT attribution](vendor/antislop/LICENSE).
