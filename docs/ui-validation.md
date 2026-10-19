# Rex UI and Computer validation

Direction, updated 2026-10-20: preserve Mantine and Hugeicons; move the computer into a collapsible right drawer; replace New chat with persistent, customizable bots; provide sculpted avatars with color, shape, rotation, and blinking controls; replace the reaction plus with a smile and show reactions without author names. These assets and avatar animations are explicitly requested in the user's latest brief.

Design read: a conversation workspace for Rex's owner, using the existing warm dark palette and sculpted character avatars. ENERGY 2 / RHYTHM 2 / MOTION 3 for the explicitly requested avatar animation. Movement is user-selectable, blinking is separately controllable, and reduced-motion preferences disable both. Other UI motion remains limited to transitions and actual loading feedback.

## Decisions

- Scale: Mantine `scale: 1.08` increases controls and text together; message text also gets more line height for reading.
- Layout: a 290-unit sidebar holds brand, New bot, memories, and settings. The computer is accessed from the conversation's right-hand toolbar and opens in a 420-unit collapsible right panel beside the chat; its left-sidebar entry is removed.
- Mobile: a labelled Menu reveals the sidebar; the computer uses a right-hand Mantine Drawer with a labelled dialog, focus trap, and Escape dismissal.
- Color: retain warm neutrals and ember to preserve the project's existing identity; filled buttons use shade 7 for white-text contrast.
- Typography: retain IBM Plex Sans; headings now use the same family for readable conversation UI. Monospace is reserved for executable commands and output.
- Spacing: center the conversation within 880 pixels on wide screens; the composer occupies its own flex row so growing messages, attachments, and errors cannot cover the thread.
- Icons: Hugeicons is explicitly requested. Each selected glyph represents its action, including computer, terminal, attachment, settings, and memory.
- Reactions: emoji are functional message reactions explicitly requested by the user. A Hugeicons smile replaces the plus; chips contain only the emoji. Accessible descriptions distinguish bot reactions from removable user reactions.
- Bot editor: live preview remains beside the form on desktop and stacks above it on mobile; profile changes are saved server-side and reloaded with the bot's conversation.
- Avatar materials: Three.js renders actual sphere, pebble, rounded-box, capsule, and octahedron meshes with matte Lambert materials, directional/hemisphere lighting, spherical eyes, and tube-geometry mouths. Specular highlights, eye glints, floor shadows, and CSS drop shadows are removed at the user's request. A shared WebGL renderer copies each visible view to its canvas; the module is loaded separately from the main UI.
- Avatar motion: float, orbit, and spin update the character's 3D transforms; blinking scales its eye groups. Still and the blinking toggle let the user control it. Reduced motion disables movement and blinking in the renderer. Off-screen views and hidden documents are skipped; updates follow requestAnimationFrame rather than the former 24 fps cap. ResizeObserver caches pixel sizes so animation frames do not read layout; stationary avatars redraw only for blinks, resizing, or preference changes. Actual frame rate depends on the device and number of visible animated bots.
- Default names: 100 predefined, editable names are selected randomly from the least-used names among saved bots. Comparisons ignore case and surrounding whitespace. Unused names are exhausted before reuse, and repeated cycles stay balanced.
- Image composer: local object URLs show previews immediately for file selection, Ctrl+V, and file drops. Removable tiles sit inside the composer above the textarea; Send waits for uploads, with retry/error states. Image-only messages are supported.
- Image history: uploaded files are linked to the exact message in order. Raster previews sit above the user text; clicking opens a labelled Mantine image viewer with previous/next, arrow-key navigation, and Escape dismissal. Removed draft files and local object URLs are cleaned up.
- Computer: only a real Podman status is shown. Start, stop, execute, timeout, output limits, and filesystem lifetime are implemented, with no simulated desktop.
- Safety copy: the panel distinguishes a Python/shell workspace from a graphical desktop and a container from a VM.

## Verification

- Names and matte-avatar update: build and typecheck pass. Two focused name tests verify 100 unique suggestions, three complete reuse cycles, case/whitespace handling, and uneven existing counts. Browser checks verify default creation without repeats, reload/edit preservation, empty-name validation, live animated WebGL pixels, profile customization, mobile reflow, reduced motion, and editor Axe checks. The README screenshot is refreshed from the matte renderer. Smoothness improvements are implementation changes, not a guaranteed device frame rate.
- `pnpm build` and `pnpm typecheck` validate shared contracts, API, and web source. Vite reports its existing large-entry-chunk advisory; compilation succeeds.
- `pnpm --filter api test` runs three tests: legacy bot migration/profile validation, real rootless container isolation with timeout removal, and attachment serving/cleanup with active image formats forced to download.
- `pnpm --filter web test` uses an isolated temporary database, test container, mock streaming model, and separate API port. It verifies sidebar actions, uploads, computer lifecycle, actual Python execution, streamed model tools, both reaction directions, reaction persistence and removal, activity output, memory deletion, conversation deletion, bad-origin blocking, malformed commands, and JSON-only mutation requests.
- Six browser tests exercise 320, 390, 640, 768, 1024, 1280, and 1440-pixel layouts, plus doubled root text size. They check horizontal overflow, menu transitions, focus, Escape dismissal, real WebGL rendering, profiles, model instructions, computer collapse/reopen, emoji-only reactions, and reduced motion. Media tests use real clipboard Ctrl+V, file drops, delayed uploads/removal, retry, image-only sends, a multi-image viewer, and history reload.
- Axe checks cover the empty conversation, computer panel/mobile drawer, settings, populated conversation, desktop/mobile bot editor, image previews, and mobile image viewer for WCAG 2 A/AA and 2.1 AA. No violations remain in the tested states.
- The contrast checker gives white on ember 7 a ratio of 6.44:1 and dimmed text on the user bubble 7.24:1.
- Screenshots in `apps/web/test-results/` record desktop conversation, mobile, and computer states. These generated artifacts are gitignored.
- Web behavior is tested in Chromium. The native Tauri executable and a live paid model request are not part of these tests.

## Antislop delivery gate

- R-01 PASS: workspace surfaces retain the flat warm palette; character depth comes from actual 3D lights and diffuse matte materials.
- R-02 PASS: new visible copy uses plain sentences and no em dashes; reaction emoji serve the requested reaction feature.
- R-03 PASS: narrow, tablet, desktop, and larger-text browser tests verify reflow and no page overflow.
- R-04 PASS: Hugeicons is user-requested, with action-specific glyphs including a smile for reactions and a right-panel collapse control.
- R-05 PASS: the layout is a conversation plus sidebar; there are no landing-page sections, stat rows, or filler grids.
- R-06 PASS: Sans headings serve reading; command/output monospace distinguishes executable material.
- R-07 PASS: no decorative background grid or dot pattern is present.
- R-08 PASS: action labels use no decorative arrows.
- R-09 PASS: status badges represent running, stopped, working, and tool completion states from real data.
- R-10 PASS: no glassmorphism was added.
- R-11 PASS: composer, bubbles, buttons, panels, and reaction controls have distinct radii.
- R-12 PASS: overlays use Mantine's normal elevation; avatars have no floor or drop shadows.
- R-13 PASS: avatar drop-shadow glow is removed; no new glow was added.
- R-14 PASS: the computer's resource list is factual configuration, not an invented feature-card section.
- R-15 PASS: actions name their outcome: Start computer, Run command, Stop & erase workspace, and Open Rex Computer.
- R-16 PASS: product copy describes capabilities directly and contains no marketing claims.
- R-17 PASS: displayed CPU, memory, process, and storage limits match the tested container flags.
- R-18 PASS: no testimonials, fictional people, or social-proof material was introduced.
- R-19 PASS: character motion and blinking implement the user's explicit animation request; Still, the blinking toggle, and reduced motion are tested.
- R-20 PASS: retained Rex avatars, warm palette, readable conversation, and computer controls continue this project's existing visual identity.
- R-21 PASS: the existing dark workspace is retained as requested; no new theme toggle or incomplete second theme was added.
- R-22 PASS: requested characters are generated as actual Three.js mesh geometry; no unrelated stock illustration is used.
- R-23 PASS: avatar shapes, colors, lighting, animation, New bot flow, and right drawer implement explicit user instructions.
- R-24 PASS: sidebar actions open implemented views or create a bot; the computer toolbar opens its right panel and image thumbnails open the viewer.
- R-25 PASS: Axe finds no text-contrast violations in tested views; the contrast checker independently verifies key palette pairs.
- R-26 PASS: browser tests click the new controls and existing upload, memory, settings, and conversation actions; no decorative controls are shipped.
- R-27 PASS: computer/bot states remain available; attachment loading, failed upload, retry, removal, oversized-file rejection, and unavailable-image states are implemented and covered by the media tests.
- R-28 PASS: this workspace contains no FAQ.
- R-29 PASS: warm neutrals and ember remain the UI palette; user-selected character colors identify bots, and status colors mark real outcomes.
- R-30 PASS: the existing Mantine workspace is extended; no Grok layout or branding was copied.
- R-31 PASS: major color, spacing, typography, layout, icon, reaction, and computer decisions are explained above.
- R-32 PASS: accessible names are provided for dialog close buttons and key-visibility toggles; browser tests check focus and Escape behavior.
- R-33 PASS: changes are authored directly in TypeScript, TSX, and CSS source via patches.
- R-34 PASS: the retained forced-dark mode is covered by screenshot and accessibility checks; there is no partial theme toggle.
- R-35 PASS: build, types, real-container tests, browser click-through, screenshots, and Axe checks are recorded above.
- R-36 PASS: security text names tested restrictions and states that containers share the host kernel; README distinguishes inline image viewing from the current text-only model adapter.
- R-37 PASS: the user's session brief supplies the direction; its design read and dials are recorded above.
- R-38 PASS: output comes from actual command execution; mock-model content exists only in isolated tests.
- Liveliness/dials PASS: scale and focal chat give ENERGY 2; bot editor/thread/drawer give RHYTHM 2; user-requested character motion supplies MOTION 3 with explicit off/reduced-motion controls.
- Liveliness/focus PASS: the empty view centers the prompt and composer; populated views prioritize the conversation.
- Liveliness/space PASS: centered reading width and a dedicated composer row separate content from controls.
- Liveliness/accent PASS: ember marks primary actions and selected reactions; neutral surfaces hold the rest.
- Liveliness/identity PASS: the bot's saved color, shape, and motion repeat across preview, sidebar, empty conversation, and assistant messages.
- Liveliness/read PASS: the design read records audience, page type, visual language, and dials.
- C-1 PASS: each major change has a user request or a stated reading/control purpose.
- C-2 PASS: new computer and reaction controls are exercised against the real local API.
- C-3 PASS: every added section supports a requested task, capability, or its actual status.
- C-4 PASS: Chromium tests cover responsive layouts, larger text, loading/error states, focus, and dismissible overlays.
- C-5 PASS: limits match configuration; runtime and command output are real; there is no invented customer or performance evidence.

Implementation references: [Hugeicons React](https://hugeicons.com/docs/integrations/react/quick-start), [Three.js shared-renderer views](https://threejs.org/manual/pages/multiple-scenes.html), and [Podman run](https://docs.podman.io/en/latest/markdown/podman-run.1.html).
