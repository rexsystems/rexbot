# Provider logos

Provider marks in `apps/web/public/providers/` are stored in the repository (never hotlinked) and shown only to
identify which service a connection talks to. All names and logos are trademarks of their owners; their use here
does not imply endorsement.

| File | Mark | Source | License of the SVG |
| --- | --- | --- | --- |
| `anthropic.svg` | Anthropic | [Simple Icons](https://simpleicons.org) 16.35.0 | CC0-1.0 |
| `claude.svg` | Claude | Simple Icons 16.35.0 | CC0-1.0 |
| `cursor.svg` | Cursor | Simple Icons 16.35.0 | CC0-1.0 |
| `deepseek.svg` | DeepSeek | Simple Icons 16.35.0 | CC0-1.0 |
| `gemini.svg` | Google Gemini | Simple Icons 16.35.0 (`googlegemini`) | CC0-1.0 |
| `lmstudio.svg` | LM Studio | Simple Icons 16.35.0 | CC0-1.0 |
| `mistral.svg` | Mistral AI | Simple Icons 16.35.0 (`mistralai`) | CC0-1.0 |
| `ollama.svg` | Ollama | Simple Icons 16.35.0 | CC0-1.0 |
| `openrouter.svg` | OpenRouter | Simple Icons 16.35.0 | CC0-1.0 |
| `openai.svg` | OpenAI | [homarr-labs/dashboard-icons](https://github.com/homarr-labs/dashboard-icons) (`openai-light`) | Apache-2.0 |
| `xai.svg` | xAI / Grok | homarr-labs/dashboard-icons (`grok`) | Apache-2.0 |

Changes made here: each file's fill is set once for the dark UI (the brand color from Simple Icons' data when it
has enough contrast on `#24221e`, otherwise the UI's light text color `#f0ebe3`), and fixed width/height
attributes were removed. Shapes are unchanged.

Groq and the generic OpenAI-compatible option have no file and show a letter tile instead.

Before adding a mark, check the brand's own guidelines (Simple Icons links them per icon). CC0 covers the SVG
file, not the trademark.

The Apache-2.0 license of dashboard-icons is copied in `docs/licenses/dashboard-icons-LICENSE.txt`.
