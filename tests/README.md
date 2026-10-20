# Tests

Run with Node.js 22.5 or newer. No dependencies or installation are required.

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
| `player.test.cjs` | Existing and future video discovery; fullscreen and readiness gates; short and live videos; listener deduplication; source changes; navigation and cleanup; initialization |
| `chat.test.cjs` | Element waiting and timeouts; chat retries; text and editable inputs; prompt submission; streamed answer debouncing; stale async work; timestamp parsing; delayed chat closure; complete playback-to-skip flow |
| `skipping.test.cjs` | Segment boundaries; progress fill; button reuse and recreation; manual and automatic skips; duration clamping; timer cancellation; Mac and Windows shortcuts; editable focus protection |
| `logging.test.cjs` | Console and file toggles; levels and metadata; safe serialization; size/depth limits; delivery failures; throttling; global error capture |
| `background.test.cjs` | Log batching and persistence; line and byte retention caps; overlapping writes; storage failures and recovery; export flushing; download failures; lifecycle diagnostics |
| `settings.test.cjs` | Configuration validation and defaults; manifest wiring; explicit log export |
| `settings-ui.test.cjs` | Localized form controls; storage loading; saving and resetting; seconds conversion; validation handling; loading and saving errors; explicit export and error feedback |

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
