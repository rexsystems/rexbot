type Args = Record<string, unknown>;

export class WebWorkflow {
  active: boolean;
  private edited = false;
  private healthy = false;
  private preview = false;
  private captured = false;
  private shared = false;
  private screen: string | undefined;
  private references = new Set<string>();
  private inspected = new Set<string>();
  private lastFile: string | undefined;
  private directory: string | undefined;
  private retries = 0;
  private cancelled = false;

  constructor(message: string, private vision: boolean) {
    const website = /\b(website|webpage|site|landing|dashboard|frontend|web app)\b/i.test(message);
    this.active = website && /\b(make|build|create|design|implement|rebuild|clone|fix|update|improve|change|add|faci|fa|fă|creeaz[aă]|construie[șs]te|modific[aă]|repar[aă])\b/i.test(message);
    if (website && /\b(like|similar|reference|inspired|ca|precum)\b/i.test(message)) {
      for (const match of message.matchAll(/(?:https?:\/\/)?(?:www\.)?[a-z\d](?:[a-z\d-]*\.)+[a-z]{2,}(?:\/[^\s<>"`]*)?/gi)) {
        try {
          const url = new URL(/^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`);
          this.references.add(url.hostname.replace(/^www\./, ""));
        } catch { /* The model can clarify malformed reference addresses. */ }
      }
    }
  }

  observe(name: string, args: Args, output: string) {
    if (this.cancelled || !args || typeof args !== "object") return;
    let result: Args;
    try { result = JSON.parse(output); } catch { return; }
    if (!result || typeof result !== "object" || result.error) return;
    if (name === "computer_files" && result.saved === true && /\.(html?|css|[jt]sx|vue|svelte)$/i.test(String(result.path))) {
      this.active = true;
      this.edited = true;
      this.lastFile = String(result.path);
      this.healthy = false;
      this.captured = false;
      this.shared = false;
    }
    if (name === "computer_browser" && result.browser_launched === true) {
      try { this.screen = new URL(String(result.url)).hostname.replace(/^www\./, ""); } catch { this.screen = undefined; }
    }
    if (name === "computer_project") {
      const check = result.check as { http_status?: number } | undefined;
      const status = check?.http_status ?? 0;
      this.directory = typeof result.directory === "string" ? result.directory : this.directory;
      if (check || result.running === false) this.healthy = result.running === true && status >= 200 && status < 400
        && (!this.lastFile || !!this.directory && this.lastFile.startsWith(`${this.directory.replace(/\/$/, "")}/`));
      if (result.browser_launched === true) { this.preview = true; this.screen = "project"; }
      if (result.running === false) { this.preview = false; this.captured = false; this.shared = false; }
    }
    const observation = result.observation as Args | undefined;
    if (observation?.pixels_included === true) {
      if (this.screen && this.references.has(this.screen)) this.inspected.add(this.screen);
      if (this.screen === "project" && this.healthy && this.edited) this.captured = true;
    }
    if (name === "computer_screenshot" && !args.path && (result.path || result.shared || result.pixels_included)) {
      if (this.screen && this.references.has(this.screen) && (!this.vision || result.pixels_included === true)) this.inspected.add(this.screen);
      if (this.screen === "project" && this.healthy && this.edited) {
        this.captured = !this.vision || result.pixels_included === true;
        if (result.shared === true) this.shared = true;
      }
    }
  }

  update(message: string) {
    if (/^(?:please\s+)?(?:stop|cancel|pause|forget it|opre[șs]te|anuleaz[aă])\b/i.test(message.trim())) {
      this.cancelled = true;
      this.active = false;
    }
  }

  before(name: string, args: Args): string | undefined {
    if (this.cancelled || !args || !this.active || name !== "computer_files" || !["write", "replace"].includes(String(args.action)) || !/\.(html?|css|[jt]sx|vue|svelte)$/i.test(String(args.path))) return;
    const missing = [...this.references].filter((host) => !this.inspected.has(host));
    if (missing.length) return `computer_files unavailable: Inspect the requested rendered reference before writing UI: ${missing.join(", ")}. Use computer_browser, then computer_screenshot. A fetched title or search snippet is insufficient.`;
  }

  missing(): string[] {
    if (!this.active) return [];
    return [
      ...[...this.references].filter((host) => !this.inspected.has(host)).map((host) => `Open https://${host} with computer_browser and capture computer_screenshot${this.vision ? " with inspection enabled to receive its actual pixels" : "; your text-only model cannot judge its appearance"}. Search snippets and a fetched title do not establish its design.`),
      ...(!this.edited ? ["Implement the requested site in the guest workspace with computer_files."] : []),
      ...(!this.healthy ? ["Start the actual project using computer_project (or inspect the existing server) and get a successful HTTP check for the edited project."] : []),
      ...(!this.preview ? ["Open the project on your guest screen with computer_project open. Never ask the owner to run a server or open guest localhost on their PC."] : []),
      ...(!this.captured || !this.shared ? ["After the latest edits, capture the running project screen with computer_screenshot share=true, inspect=true. Check the result, fix observed defects and exercise relevant interactions."] : []),
    ];
  }

  correction(): string | undefined {
    const missing = this.missing();
    if (!missing.length || this.retries++ >= 2) return;
    return `APPLICATION COMPLETION CHECK: Your draft was withheld because this website task is not verified. Continue the authorized work now using tools. Missing evidence:\n${missing.join("\n")}\nDo not repeat a success claim, invent evidence, or hand the remaining work to the owner. If a tool fails, use its real error to diagnose it. If the owner has the screen, keep independent work going and report that specific verification blocker without stealing control.`;
  }

  incomplete(): string {
    const missing = [
      ...[...this.references].filter((host) => !this.inspected.has(host)).map((host) => `rendered reference check for ${host}`),
      ...(!this.edited ? ["the requested project files"] : []),
      ...(!this.healthy ? ["a successful check of the running preview"] : []),
      ...(!this.preview ? ["the preview open on my guest screen"] : []),
      ...(!this.captured || !this.shared ? ["a verified, shared screenshot of the latest result"] : []),
    ];
    return `Site verification is incomplete. I haven't verified this site as ready. Still missing: ${missing.join("; ")}.`;
  }
}
