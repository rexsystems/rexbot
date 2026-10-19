import { useEffect } from "react";
import "./landing.css";

const conversationShot = "/landing/conversation.png";
const botEditorShot = "/landing/bot-editor.png";
const liveVoiceShot = "/landing/live-voice.png";

type LandingProps = {
  onOpenApp: () => void;
};

export function Landing({ onOpenApp }: LandingProps) {
  useEffect(() => {
    document.title = "Rex — AI teammates with a desk and a mic";
  }, []);

  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Rex home">
          <span className="landing-mark" aria-hidden="true" />
          Rex
        </a>
        <nav className="landing-nav-actions" aria-label="Primary">
          <a className="landing-link" href="https://github.com/rexsystems/rexbot">GitHub</a>
          <button type="button" className="landing-cta" onClick={onOpenApp}>
            Open Rex
          </button>
        </nav>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-hero-title">
          <p className="landing-kicker">Rex</p>
          <h1 id="landing-hero-title">AI teammates with a desk and a mic</h1>
          <p className="landing-lede">
            Build bots with their own look, put them in groups, hand them a local computer, and talk live when text is not enough.
          </p>
          <div className="landing-cta-row">
            <button type="button" className="landing-cta landing-cta-lg" onClick={onOpenApp}>
              Open Rex
            </button>
            <a className="landing-ghost" href="https://github.com/rexsystems/rexbot">
              View source
            </a>
          </div>
        </section>

        <section className="landing-hero-visual" aria-label="Rex conversation">
          <img
            className="landing-hero-img"
            src={conversationShot}
            alt="Rex chat with an attachment, a computer tool result, and the Rex Computer panel open"
            width={1600}
            height={1000}
          />
        </section>

        <section className="landing-band" aria-labelledby="landing-ground-title">
          <div className="landing-band-copy">
            <h2 id="landing-ground-title">Grounded in tools, not vibes</h2>
            <p>
              Search the web, fetch pages, read attachments, and run Python or shell in an isolated Podman workspace — then keep the thread in local SQLite.
            </p>
          </div>
          <ul className="landing-ticks">
            <li>Tavily search when you add a key</li>
            <li>Rex Computer for real commands</li>
            <li>Memories that stick across chats</li>
          </ul>
        </section>

        <section className="landing-split" aria-labelledby="landing-bots-title">
          <div className="landing-split-copy">
            <h2 id="landing-bots-title">Bots with a face you chose</h2>
            <p>
              Pick a name, color, shape, and motion. Give working instructions. Edit later without losing the conversation.
            </p>
          </div>
          <figure className="landing-frame">
            <img src={botEditorShot} alt="Bot editor with a green cube avatar and shape controls" width={1400} height={900} />
          </figure>
        </section>

        <section className="landing-split landing-split-flip" aria-labelledby="landing-voice-title">
          <div className="landing-split-copy">
            <h2 id="landing-voice-title">Live voice in the same chat</h2>
            <p>
              Open the mic on a bot, interrupt when you need to, mute when you do not. Transcripts land back in the thread.
            </p>
          </div>
          <figure className="landing-frame">
            <img src={liveVoiceShot} alt="Live voice bar inside a Rex conversation" width={1400} height={900} />
          </figure>
        </section>

        <section className="landing-strip" aria-label="What ships with Rex">
          <p>Groups with @mentions</p>
          <p>Private bot-to-bot notes</p>
          <p>Browser or Tauri desktop</p>
          <p>Your model, your keys</p>
        </section>

        <section className="landing-close" aria-labelledby="landing-close-title">
          <h2 id="landing-close-title">Run it on your machine</h2>
          <p>pnpm install, pnpm dev, open localhost. No cloud account required to start chatting.</p>
          <button type="button" className="landing-cta landing-cta-lg" onClick={onOpenApp}>
            Open Rex
          </button>
        </section>
      </main>

      <footer className="landing-foot">
        <span>Built by RexSystems</span>
        <a href="https://github.com/rexsystems/rexbot">GitHub</a>
      </footer>
    </div>
  );
}
