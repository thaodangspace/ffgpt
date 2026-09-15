# Architecture

ffgpt keeps Firefox transport separate from ChatGPT-specific DOM knowledge:

```text
CLI
 ├── input + option parsing
 ├── config loader
 ├── error/exit-code + sanitized logging
 ├── BrowserDriver
 │    └── FirefoxBiDiDriver
 └── ChatGPTAdapter
      ├── target selection
      ├── composer selectors/fallbacks
      ├── prompt insertion
      └── one submit action + bounded confirmation
```

## Responsibilities

- **CLI** parses `ask` and `doctor`, builds the final prompt, and owns the process exit code. Library modules throw typed errors instead of calling `process.exit()`.
- **Input** reads positional text and piped stdin without waiting on a TTY, preserves opaque Unicode/multiline content, and applies the named size limit before browser automation.
- **Config** loads the platform user config, applies CLI > environment > file > built-in precedence, validates loopback/browser settings, and resolves explicit HTTPS ChatGPT Project aliases.
- **BrowserDriver** owns the WebSocket and WebDriver BiDi command lifecycle. `FirefoxBiDiDriver` sends `session.new`, lists top-level browsing contexts, navigates/evaluates/presses keys, and closes only its own WebSocket. It never sends browser- or tab-close commands.
- **ChatGPTAdapter** owns ChatGPT URL rules, DOM selectors, login/readiness detection, composer insertion, and UI submission confirmation. It never reads the assistant response. A submission action is issued at most once per invocation; confirmation timeout is deliberately not retried.
- **Doctor** uses only read operations after connecting. It does not call the adapter's navigation or submission methods.

## End-to-end `ask` flow

```text
parse options
  → read argv/stdin
  → load + validate config
  → resolve optional project alias
  → connect Firefox BiDi
  → select/reuse or create ChatGPT context
  → wait for composer
  → insert and verify prompt
  → dispatch exactly one send action
  → confirm acceptance with a short UI signal
  → disconnect WebDriver BiDi
  → print concise confirmation and exit
```

The orchestration owns `try/finally` cleanup. Disconnecting the automation connection leaves Firefox, tabs, and any ongoing model generation running.

## Browser protocol boundary

The Firefox driver uses the WebDriver BiDi WebSocket endpoint:

```text
ws://127.0.0.1:9222/session
```

It does not use Chromium `connectOverCDP` APIs. Page DOM operations are sent through BiDi `script.callFunction`; browser protocol errors are kept out of the ChatGPT selector module. The endpoint default is loopback and there is no remote-host discovery.

## Test strategy

Pure input, config, error, timeout, logging, selector, and CLI logic has focused unit coverage. Adapter orchestration uses a fake `BrowserDriver` to cover safe cleanup boundaries and no-retry behavior, while synthetic HTML fixtures contain no account or conversation data. `pnpm test:integration` is opt-in for a developer's local Firefox session and checks connect → enumerate contexts → disconnect only; no live ChatGPT credentials are required in CI.
