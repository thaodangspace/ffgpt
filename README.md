# ffgpt

`ffgpt` is a small **fire-and-forget** CLI: it automates an existing, logged-in ChatGPT web session in Firefox, submits a prompt, confirms that the UI accepted it, and exits. It does **not** scrape, print, or wait for the assistant response. Firefox and ChatGPT remain open while the model continues generating.

## Requirements

- Node.js 20 or newer.
- `pnpm` for the developer install path.
- Firefox with WebDriver BiDi remote debugging enabled.
- An existing Firefox session already signed in to ChatGPT.

`ffgpt` uses Firefox WebDriver BiDi, not Chromium CDP. It does not launch Firefox, manage a profile, or store ChatGPT credentials.

## Start Firefox

Start a separate Firefox process with the remote endpoint on loopback:

```bash
firefox --remote-debugging-port 9222
```

Keep port `9222` local. Do not bind it to `0.0.0.0` or expose it to a network. Open `https://chatgpt.com/` in that Firefox session and sign in normally before using `ffgpt`.

## Install and build from source

The v0.1 source release is not assumed to be published to a package registry. Use the developer install path:

```bash
git clone https://github.com/thaodangspace/ffgpt.git
cd ffgpt
pnpm install
pnpm build
```

The package exposes the `ffgpt` executable. In a checkout, use `pnpm exec ffgpt ...` or install the packed artifact in a separate directory. The packed-artifact smoke test is available with `pnpm pack:smoke`.

## Basic usage

```bash
ffgpt ask "Review this architecture"

cat error.log | ffgpt ask "Analyze this error"

git diff | ffgpt ask "Review this diff"
```

With no piped input, the positional argument is the prompt. With stdin only, use:

```bash
cat prompt.txt | ffgpt ask
```

When both are present, `ffgpt` submits the positional instruction, one blank line, and the stdin content. Multiline text, Unicode, tabs, and code indentation are preserved. A final transport newline from stdin is removed; input is never silently truncated. Empty or oversized prompts fail before Firefox is contacted.

The command prints `Prompt submitted.` after bounded UI confirmation and does not wait for model completion. An ambiguous confirmation is a failure: inspect the browser before retrying because `ffgpt` never automatically resubmits.

## Project aliases

Project aliases are explicit local mappings; v0.1 does not scrape or discover project names from the ChatGPT sidebar. On Linux/macOS the default config path is `~/.config/ffgpt/config.yaml`, or `$XDG_CONFIG_HOME/ffgpt/config.yaml` when `XDG_CONFIG_HOME` is set. On Windows it is `%APPDATA%\\ffgpt\\config.yaml`.

Example:

```yaml
browser:
  host: 127.0.0.1
  port: 9222
  timeoutMs: 5000

projects:
  coding: https://chatgpt.com/g/g-p-xxxxxxxx/project
  work: https://chatgpt.com/g/g-p-yyyyyyyy/project

defaultProject: coding
```

Use an alias explicitly or rely on `defaultProject`:

```bash
ffgpt ask --project coding "Continue the implementation"
```

Project values must be HTTPS URLs on `chatgpt.com` or `www.chatgpt.com`. Unknown aliases and invalid URLs fail before browser automation. Browser CLI flags override environment variables (`FFGPT_HOST`, `FFGPT_PORT`, `FFGPT_TIMEOUT_MS`), which override the config file, which overrides built-in defaults. `FFGPT_CONFIG` can point to an alternate config file.

## Diagnostics

Run the read-only readiness checks before sending a prompt:

```bash
ffgpt doctor
```

`doctor` validates configuration, connects to Firefox, establishes WebDriver BiDi, enumerates contexts, finds an existing ChatGPT tab, and checks the composer without navigating, typing, submitting, or closing anything. A missing config file is allowed because built-in loopback defaults are used; no ChatGPT tab or unusable composer is a blocking failure.

Use `--verbose` for sanitized lifecycle details:

```bash
ffgpt doctor --verbose
```

## Exit codes

Successful commands write no assistant response and exit `0`. Operational errors use this stable v0.1 mapping:

| Code | Meaning                                                              |
| ---: | -------------------------------------------------------------------- |
|    0 | Success                                                              |
|    1 | Unexpected/internal error                                            |
|    2 | CLI usage or prompt input error, including empty/oversized input     |
|    3 | Configuration or Project alias error                                 |
|    4 | Firefox/WebDriver BiDi connection or protocol error                  |
|    5 | ChatGPT navigation or readiness error                                |
|    6 | Prompt insertion or submission failure                               |
|    7 | Submission confirmation is ambiguous; the prompt may already be sent |
|    8 | A bounded operation timed out                                        |

Expected failures are concise and go to stderr. `--verbose` adds category and sanitized cause information; it never prints cookies, tokens, passwords, browser storage, or auth headers.

## Security and browser boundaries

Remote debugging grants powerful control over the Firefox session. Keep the WebDriver BiDi endpoint on the local machine and never expose port `9222` to the network or Internet. `ffgpt`:

- does not need ChatGPT credentials in its config;
- does not persist cookies, tokens, passwords, or session storage;
- never attempts credential entry;
- disconnects only its WebDriver BiDi client;
- does not close Firefox or unrelated tabs;
- never reads or prints assistant responses.

If submission confirmation is ambiguous, inspect the ChatGPT tab before retrying. Retrying immediately may duplicate the prompt.

## v0.1 limitations and non-goals

- No response scraping, response output, or waiting for model completion.
- No file/image uploads or binary stdin.
- No project creation, deletion, discovery, or sidebar-name lookup.
- No browser launch, profile management, or multi-account support.
- No Chromium/CDP support.
- No conversation-history management or dedicated new-conversation workflow.
- ChatGPT UI changes may require selector updates.
- The Firefox session must already be running, logged in, and reachable on the configured endpoint.

## Troubleshooting

### Connection refused on `9222`

Start Firefox with remote debugging enabled and keep the endpoint local:

```bash
firefox --remote-debugging-port 9222
```

Use `--host`, `--port`, or the config `browser` block only when the endpoint is intentionally different.

### Remote debugging is not enabled or the BiDi session is incompatible

Close an incompatible remote-debugging session, restart Firefox with the command above, and run `ffgpt doctor`. `ffgpt` does not discover remote endpoints or manage Firefox profiles.

### No ChatGPT tab or ChatGPT is logged out

Open `https://chatgpt.com/` in the remote Firefox session and sign in interactively. `ffgpt` will fail with an actionable non-zero error instead of entering credentials. `doctor` never creates or navigates a tab.

### Composer not found or send cannot be confirmed

Refresh the ChatGPT page, leave a normal conversation open, and run `ffgpt doctor` again. A pre-existing draft is not silently combined with a requested prompt. If confirmation is ambiguous, inspect the tab before retrying; there is no automatic second send.

### Unknown project or invalid project URL

Check the alias spelling and ensure its URL is HTTPS on `chatgpt.com` or `www.chatgpt.com`. The alias must exist in the configured `projects` mapping.

### The CLI exits while ChatGPT continues generating

That is expected v0.1 behavior. `ffgpt` confirms acceptance and disconnects without waiting for or scraping the assistant response.

## Development and verification

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
FFGPT_RUN_FIREFOX_INTEGRATION=1 pnpm test:integration
pnpm build
pnpm pack:smoke
```

The local Firefox integration test only connects, enumerates contexts, and disconnects. It does not require a ChatGPT account. See [docs/architecture.md](docs/architecture.md) for the implementation boundary between browser transport and ChatGPT DOM automation.
