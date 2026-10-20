import { COMPUTER_INPUT_ACTIONS, type ComputerBackendKind, type ToolName } from "./types.js";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const PODMAN_EXEC: ToolDefinition = {
  name: "computer_exec",
  description: "Run a shell command on Rex Computer, ONLY if the user has started it. Python 3 and Alpine shell are available. Work in /workspace. No network, host files, credentials or GUI. Files last until Stop; commands time out after 20 seconds. Never claim access to the user's computer.",
  parameters: {
    type: "object",
    properties: { command: { type: "string", description: "Shell command to execute inside the isolated container" } },
    required: ["command"],
  },
};

const DESKTOP_EXEC: ToolDefinition = {
  name: "computer_exec",
  description: "Run a bash command on Rex Computer. cwd is /workspace/bots/<your id>; ./shared is shared. Passwordless sudo, network, DISPLAY + dbus for your screen. Prefer computer_files for file editing and computer_project for servers. Commands keep working when the user takes the keyboard; DISPLAY/dbus are unset then, so continue background builds and tests without opening windows or sending screen input. Otherwise launch GUI apps detached: `setsid -f rex-browser URL >/dev/null 2>&1`. 5-minute limit. Not the user's PC.",
  parameters: {
    type: "object",
    properties: { command: { type: "string", description: "Bash command to run on the VM" } },
    required: ["command"],
  },
};

const DESKTOP_INPUT: ToolDefinition = {
  name: "computer_input",
  description: "Control the mouse and keyboard on your own Rex Computer screen (1280x800). The user's view becomes read-only while you control it and unlocks after about a minute without input. Call computer_screenshot first to learn window titles and the screen size. Coordinates are pixels from the top-left.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...COMPUTER_INPUT_ACTIONS] },
      x: { type: "number", description: "X pixel for move/click actions" },
      y: { type: "number", description: "Y pixel for move/click actions" },
      text: { type: "string", description: "Text for action=type, up to 2000 characters" },
      keys: { type: "string", description: "xdotool key combo for action=key, e.g. ctrl+l, Return, alt+F4" },
      direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
      amount: { type: "number", description: "Scroll steps, 1-20" },
    },
    required: ["action"],
  },
};

const DESKTOP_FILES: ToolDefinition = {
  name: "computer_files",
  description: "Read and edit text files directly inside your guest workspace without shell quoting. Prefer this for project code. Paths are relative to /workspace/bots/<your id>. Actions: list a directory; read text (next_offset supports continuation); write content (up to 256 KiB); replace one exact old_text with new_text. Replacement must match exactly once. Never paste these file contents into the chat.",
  parameters: { type: "object", properties: {
    action: { type: "string", enum: ["list", "read", "write", "replace"] },
    path: { type: "string", description: "Workspace-relative file or directory path" },
    content: { type: "string", description: "Full text for write" },
    old_text: { type: "string", description: "Exact unique text for replace" },
    new_text: { type: "string", description: "Replacement text" },
    offset: { type: "integer", minimum: 0, description: "Character offset for read continuation" },
  }, required: ["action", "path"] },
};

const DESKTOP_PROJECT: ToolDefinition = {
  name: "computer_project",
  description: "Manage one persistent project server on your guest computer. start serves an existing directory with Python by default, or runs a command for a framework project. Server survives tool calls; start/open launches its URL in your own screen's browser so the user can interact using Take control. An available port is chosen automatically; command receives PORT and HOST=127.0.0.1, e.g. npm run dev -- --host 127.0.0.1 --port $PORT. Use computer_exec only for dependencies and builds. status/inspect check real HTTP source and logs (not rendered pixels); logs reads output; stop ends the managed process group. A guest localhost URL is not a public link and cannot be opened on the user's PC. Do not publish without authorization.",
  parameters: { type: "object", properties: {
    action: { type: "string", enum: ["start", "status", "inspect", "logs", "open", "stop"] },
    directory: { type: "string", description: "For start: existing workspace-relative project directory" },
    command: { type: "string", description: "Optional guest server command; omit for a static website" },
    port: { type: "integer", minimum: 1024, maximum: 65535, description: "Optional fixed port, otherwise allocated automatically" },
    path: { type: "string", description: "For inspect: local HTTP route, e.g. /contact" },
  }, required: ["action"] },
};

const DESKTOP_BROWSER: ToolDefinition = {
  name: "computer_browser",
  description: "Open a public reference website in your own guest browser, without shell commands. Then use computer_screenshot to inspect the rendered page (pixels require a vision connection). Use this before implementing a site inspired by a URL; http_fetch only extracts source text and may return just a title for JavaScript apps. For your local project, use computer_project open instead. Does not take the owner's keyboard.",
  parameters: { type: "object", properties: { url: { type: "string", description: "Public http(s) reference URL" } }, required: ["url"] },
};

const DESKTOP_SCREENSHOT: ToolDefinition = {
  name: "computer_screenshot",
  description: "Capture your Rex Computer screen for inspection. If the selected connection supports vision, image pixels are included in the next model round by default; inspect=false skips this. Otherwise only metadata is available: do not claim to see pixels. With share=true, also attach the actual image to the owner's current chat. Optional path selects a saved screenshot inside your workspace (e.g. another viewport); caption is optional. Private bot replies cannot post chat attachments.",
  parameters: { type: "object", properties: { inspect: { type: "boolean", description: "Inspect the pixels if the selected model supports vision; defaults true" }, share: { type: "boolean", description: "Attach the actual image to this chat" }, path: { type: "string", description: "Optional image path in your own workspace, for inspection or sharing" }, caption: { type: "string", description: "Optional short image caption, up to 1000 characters" } } },
};

const BASE_TOOLS: ToolDefinition[] = [
  {
    name: "ask_user",
    description: "Ask the owner 1 to 3 focused clarification questions in a chat card with an answer dialog. Use only when a material requirement remains ambiguous after checking available context/references. Provide 2 to 4 concise options, or omit options for a text answer; the owner can always write a custom answer. Do useful independent research first. Do not ask for choices you can reasonably make. After success, stop this turn and wait for the owner's answer. Never perform dependent work while waiting. Unavailable in private teammate replies.",
    parameters: { type: "object", properties: { questions: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" }, maxItems: 4 } }, required: ["question"] } } }, required: ["questions"] },
  },
  {
    name: "message_bot",
    description: "Send a private question or task to a bot listed in your available teammates, and receive its real reply. Use when the user asks you to contact it, or a specific second opinion would help. Only bots sharing a group may communicate. Include the context the teammate needs; it cannot see your personal chat. Exchanges are visible to the owner in the group's private-message log. No recursive delegation.",
    parameters: { type: "object", properties: { bot_id: { type: "string", description: "Exact teammate id from the roster" }, message: { type: "string", description: "Self-contained question/task, up to 4000 characters" } }, required: ["bot_id", "message"] },
  },
  {
    name: "react_message",
    description: "Optionally react to the user's latest message when a reaction feels natural. Use sparingly, at most once per turn. This adds a visible reaction on their message; still answer normally.",
    parameters: {
      type: "object",
      properties: { emoji: { type: "string", enum: ["👍", "❤️", "😂", "🔥", "👀"] } },
      required: ["emoji"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the live web for current information. Use when facts may have changed or you need sources.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        max_results: {
          type: "number",
          description: "Max results (1-8)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_upload",
    description:
      "Read the text content of a file the user uploaded in this conversation.",
    parameters: {
      type: "object",
      properties: {
        upload_id: {
          type: "string",
          description: "Upload id from the conversation",
        },
      },
      required: ["upload_id"],
    },
  },
  {
    name: "http_fetch",
    description:
      "Fetch a public URL with GET and return text content (HTML/text truncated).",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute http(s) URL",
        },
      },
      required: ["url"],
    },
  },
];

/** Offered only when the user connected their own Cursor API key. */
export const CURSOR_AGENT_TOOL: ToolDefinition = {
  name: "cursor_agent",
  description: "Delegate coding work on a git repository to a Cursor Cloud Agent running under the user's own Cursor account. Use ONLY when the user asks for work on a specific repository (fix, feature, refactor, review) or asks you to use Cursor. action=start launches an agent (it may push a branch and, with auto_create_pr, open a pull request), status reads its progress and final summary, follow_up sends more instructions to an existing agent, list shows recent agents. Agents take minutes: start, tell the user the link, and check status when asked. Never start one without the user's request.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["start", "status", "follow_up", "list"] },
      prompt: { type: "string", description: "Task for start/follow_up, self-contained, up to 8000 characters" },
      repo_url: { type: "string", description: "For start: repository URL, e.g. https://github.com/owner/repo" },
      starting_ref: { type: "string", description: "For start: branch or commit to start from (default branch if omitted)" },
      auto_create_pr: { type: "boolean", description: "For start: open a pull request when done. Only if the user asked for a PR." },
      agent_id: { type: "string", description: "For status/follow_up: the bc-... id returned by start" },
    },
    required: ["action"],
  },
};

export const ROUTINE_TOOL: ToolDefinition = {
  name: "routine",
  description: "Manage scheduled routines for this chat. A routine sends a self-contained task to your future self daily, on selected weekdays, or every N hours. Create one when the user asks, or when useful ongoing follow-up directly serves their task. First list existing routines to avoid duplicates. Do not schedule unrelated activity or ordinary one-off questions. Choose the least frequent useful schedule in the user's time zone and confirm its name, task and schedule only after success. action=list shows this chat's routines; pause, resume and delete need routine_id from list or create. Scheduled runs cannot create more routines.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "list", "pause", "resume", "delete"] },
      title: { type: "string", description: "For create: short name, e.g. Morning news brief" },
      prompt: { type: "string", description: "For create: what to do each time, self-contained, up to 4000 characters" },
      time: { type: "string", description: "For a daily/weekly routine: local time HH:MM (24h)" },
      days: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "Optional weekdays, 0=Sunday..6=Saturday. Omit for every day." },
      every_hours: { type: "integer", minimum: 1, maximum: 168, description: "For an interval routine instead of time: repeat every N hours" },
      routine_id: { type: "string", description: "For pause/resume/delete" },
    },
    required: ["action"],
  },
};

export const LOAD_SKILL_TOOL: ToolDefinition = {
  name: "load_skill",
  description: "Load the full instructions of one of the user's skills (listed in your system prompt under Skills). Load a skill before doing a task its description matches, then follow it. Don't load skills you won't use.",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "The skill name exactly as listed" } },
    required: ["name"],
  },
};

export interface ComputerToolOptions {
  backend?: ComputerBackendKind;
  desktop?: boolean;
  /** The user has a Cursor API key connected. */
  cursor?: boolean;
  /** Scheduled routines are available in this context (not inside a routine run). */
  routines?: boolean;
  /** The user has skills. */
  skills?: boolean;
}

export function toolDefinitions(options: ComputerToolOptions = {}): ToolDefinition[] {
  const computerTools = options.desktop ? [DESKTOP_BROWSER, DESKTOP_FILES, DESKTOP_PROJECT, DESKTOP_EXEC, DESKTOP_INPUT, DESKTOP_SCREENSHOT] : [PODMAN_EXEC];
  return [BASE_TOOLS[0]!, ...computerTools, ...BASE_TOOLS.slice(1), ...(options.cursor ? [CURSOR_AGENT_TOOL] : []), ...(options.routines ? [ROUTINE_TOOL] : []), ...(options.skills ? [LOAD_SKILL_TOOL] : [])];
}

/** Tool list for the local Podman computer; use toolDefinitions() when the backend is known. */
export const TOOL_DEFINITIONS: ToolDefinition[] = toolDefinitions();

/** Live-voice only: hang up when the user asks or the bot decides the call should end. */
export const END_CALL_TOOL: ToolDefinition = {
  name: "end_call",
  description:
    "End this live voice call now. Use when the user asks to hang up, end the call, stop the call, disconnect, or says goodbye in a way that closes the call. Also use when you decide the conversation is finished and should disconnect. Say a brief goodbye first if natural, then call this tool. Do not claim the call ended until this tool runs.",
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Optional short reason for ending the call" },
    },
  },
};

export function toOpenAiTools(options: ComputerToolOptions = {}) {
  return toolDefinitions(options).map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
