# Tests

Run with Git and Node.js 24. No package dependencies or installation
are required. Release tests create isolated temporary Git repositories.

```sh
npm test
npm run test:coverage
```

The suite uses Node's test runner and executes the extension's JavaScript in
isolated VM contexts. Browser API doubles and a controlled clock keep tests
independent of network access, real waiting, and an installed extension.

| Suite | Behavior covered |
| --- | --- |
| `content.test.cjs` | English, Ukrainian, and Russian; language fallbacks; sponsor markers; existing answer exclusion; saved settings and live updates |
| `fundraising.test.cjs` | Fundraising prompts and labels in all three languages; mixed sponsor/fundraising answers; history exclusion; invalid ranges; auto-skip cancellation; automatic and keyboard skipping; response-driven chat closure |
| `player.test.cjs` | Existing and future video discovery; fullscreen and readiness gates; short and live videos; listener deduplication; source changes; navigation and cleanup; initialization |
| `chat.test.cjs` | Element waiting and timeouts; chat retries; text and editable inputs; prompt submission; streamed answer debouncing; stale async work; timestamp parsing; delayed chat closure; complete playback-to-skip flow |
| `skipping.test.cjs` | Segment boundaries; continuous fill animation setup and cleanup; live countdown; pausing and resuming with the remaining delay; paused seeking and cancellation; cancel-button reuse and recreation; cancellation per segment and video; configured duration; stale timer protection; automatic skips; duration clamping; Mac and Windows shortcuts; editable focus protection |
| `logging.test.cjs` | Saved and live debug toggles; independent file logging; levels and metadata; safe serialization; size/depth limits; delivery failures; throttling; global error capture |
| `background.test.cjs` | Log batching and persistence; line and byte retention caps; overlapping writes; storage failures and recovery; export flushing; download failures; lifecycle diagnostics |
| `settings.test.cjs` | Configuration validation and defaults; manifest wiring; explicit log export |
| `settings-ui.test.cjs` | Localized form controls; storage loading; saving and resetting; seconds conversion; validation handling; loading and saving errors; explicit export and error feedback |
| `release.test.cjs` | Version synchronization; changelog preparation; release notes; packaging allowlist and checksum; dirty-tree protection; release command behavior in isolated temporary projects |

The doubles register the selectors used by the extension. These are behavior
tests, not a full browser or a copy of YouTube. They do not verify YouTube's
current markup, the AI's actual responses, native HTML validation or event
propagation, Chrome permission behavior, or visual layout. Those still need a
manual check in an installed extension. A useful smoke check is to open settings,
save a delay, play a supported video in fullscreen, and confirm chat, skip
controls, keyboard shortcuts, and explicit log export work.

VM scripts use their real filenames so Node's coverage report includes the
extension source. Content tests replace only the final startup call with test
hooks and override configuration flags per test. Production files do not expose
test APIs.

## Browser testing with Chrome DevTools MCP

Chrome DevTools MCP is an optional way to run browser checks with an AI coding
agent. Configure it using the [official setup guide](https://github.com/ChromeDevTools/chrome-devtools-mcp/#mcp-client-configuration).
Add `--categoryExtensions` to the server arguments to enable extension tools;
restart the MCP server or client after changing its configuration. MCP is not
required for the Node test suite or CI.

For a browser check, load this repository as an unpacked extension with
`install_extension`, then use `list_extensions` to confirm it is enabled. After
code changes, reload the extension and refresh the test tab. The controlled
browser has its own profile; confirm its account, installed extensions, and
YouTube AI chat availability before attempting the complete flow.

Use snapshots and scripts to inspect YouTube's current DOM, screenshots for
layout, console messages for content-script diagnostics, and service-worker
evaluation for background state. Exercise the behavior affected by the fix,
including settings, fullscreen, cancellation, or seeking as appropriate.

For unpredictable AI responses, reproduce the reported format in a deterministic
regression test first. Preserve both displayed timestamp text and linked
`data-time` values. For example, `(0:20:47) [SPONSOR] Sponsor segment:
(19:07 – 20:36)` must produce the range `1147–1236`, ignoring the chapter time
`1247`. Cover the resulting countdown and skip behavior, as well as malformed
ranges. Do not wait for the live AI to generate the same answer again.

A controlled Chrome DOM fixture can additionally verify parsing or rendering.
Label it as a fixture check: it does not verify the current YouTube integration.
Record which checks passed and whether a live installed-extension check was
performed. A focused parser fix can be validated with regression tests and a
Chrome fixture when its live AI response cannot be reproduced; changes to
YouTube selectors still need a check against the current page.
