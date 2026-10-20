# YT Ad Skip

An experimental Chrome extension that uses YouTube's built-in AI chat to find
in-video sponsor and fundraising segments, then skips them after a cancellable
countdown.

**Requires YouTube's video AI chat to be available for your account and the
video.** Availability varies; see [YouTube's help page](https://support.google.com/youtube/answer/14110396).
The extension cannot enable that feature for you.

## Features

- Detects sponsor segments, paid advertisements, fundraising, and donation appeals
  from AI-generated timestamp ranges.
- Shows a **Cancel auto-skip** button with a live countdown before skipping.
- Remembers canceled segments for the current video, including when you seek back.
- Supports English, Ukrainian, and Russian. Timestamp prompts follow YouTube's
  selected language, then browser preferences, with English as the fallback.
- Provides configurable delays, a console-debug toggle, and explicit log export.
- Starts the chat flow in fullscreen for videos at least three minutes long.
  Existing skip controls continue to work after leaving fullscreen.

YouTube's platform-served ads are outside the current scope. AI results can miss
segments or supply incorrect boundaries, and YouTube UI changes can break the
integration. Other browsers and mobile devices are not currently supported.

## Install

There is no Chrome Web Store listing yet. Install an unpacked copy:

1. Download and extract a release ZIP from this repository's **Releases** page,
   when available. You can also clone the repository or download its source ZIP.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Refresh any YouTube tabs that were already open.

Use tagged releases for a reproducible version; `main` contains ongoing work.
To update, replace the files in the same installed folder, click **Reload** on
the extension's card, and refresh YouTube tabs. Unpacked copies do not update
automatically when a GitHub release is published.

## Use

1. Open an eligible YouTube video and enter fullscreen.
2. The extension opens the video AI chat and submits a timestamp prompt.
3. After a new response settles, it starts the configured chat-closing countdown.
4. When playback reaches a marked segment, **Cancel auto-skip (5s)** counts down.
   Click it to keep watching that segment; otherwise playback jumps to its end.

The cancellation window uses elapsed real time. Playback events do not restart
it. Canceling one segment does not disable skipping for other segments.

You can also skip the current marked segment immediately:

| Platform | Shortcut |
| --- | --- |
| macOS | Option + Right Arrow |
| Windows/Linux | Ctrl + Alt + Right Arrow |

Shortcuts are ignored while typing in an input, textarea, or editable element.

## Settings

Click the toolbar icon, change values, then click **Save settings**. The settings
page uses the browser's preferred supported language.

| Setting | Purpose |
| --- | --- |
| Open chat after | Delay before opening the timestamp chat. |
| Close chat after | Delay after a new AI timestamp response settles. Further response mutations restart it. |
| Cancel button duration | Time to cancel before automatically skipping. `0` disables auto-skip and hides the button. |
| Advanced timing | Retry delay, chat-input timeout, response timeout, and response settling delay. |
| Debug logging | Enable or disable browser console diagnostics. |

Timing fields use whole seconds in the UI. Existing fractional values are rounded
for display. Saved settings apply to open tabs; most existing timers finish with
their original delay, while changing the auto-skip duration restarts a pending
countdown. A response timeout leaves the chat open.

## Permissions and privacy

| Access | Why it is needed |
| --- | --- |
| YouTube content script | Read video/chat state, submit the AI prompt, show cancellation controls, and seek playback. Runs on `https://www.youtube.com/*`. |
| `storage` | Keep settings and recent diagnostics locally. |
| `downloads` | Export a log file when you click **Export logs**. |

The extension has no analytics or maintainer-operated backend. It submits a
prompt through YouTube's own chat interface. Diagnostics can contain video URLs,
media URLs, and snippets from the chat. Turning console debug off does not stop
local file-log collection. Review [PRIVACY.md](PRIVACY.md) before sharing logs.

## Troubleshooting

- **Chat does not open:** check that video AI chat is available, the video is at
  least three minutes long, and playback is in fullscreen.
- **An old prompt is still submitted:** reload the extension, refresh the tab,
  and start a new run. Existing chat messages are not rewritten.
- **No fundraising or sponsor range appears:** the AI may not have identified it,
  or its response may lack two usable timestamp links for the range.
- **A segment should not be skipped:** click **Cancel auto-skip**, or disable
  auto-skip in settings. Use the issue form for reproducible detection problems.
- **Need diagnostics:** enable **Debug logging** for the page's DevTools console,
  or explicitly export logs from settings. Remove private information first.

## Development

Clone the source repository for development; release ZIPs contain the installable
extension and documentation, without tests or development tooling.

Use Git and Node.js 22.5 or newer; Node 24 is the recommended local version (`.nvmrc`).
There are no package dependencies and no install or build step for development.

```sh
npm run check
npm test
npm run test:coverage
```

Tests use browser doubles and controlled timers. A manual check in Chrome is
still needed for YouTube's current DOM, actual AI output, and layout. See the
[testing guide](tests/README.md).

| File | Responsibility |
| --- | --- |
| `content.js` | Video lifecycle, AI chat, timestamp parsing, countdowns, and shortcuts. |
| `background.js` | Local log storage and explicit download export. |
| `settings.js` | Shared defaults, validation, and storage key. |
| `settings-ui.js`, `settings.html`, `settings.css` | Localized settings interface. |
| `scripts/` | Metadata checks, release preparation, and distribution packaging. |

## Contributing and releases

Bug reports, documentation fixes, translations, and focused pull requests are
welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting a substantial
change and [SECURITY.md](SECURITY.md) for security reports.

Notable changes go into [CHANGELOG.md](CHANGELOG.md). The maintainer's
[release guide](RELEASING.md) explains versions, tags, draft releases, and updates.
`package.json` remains `private: true` to prevent accidental npm publication;
this does not affect GitHub visibility or the open-source license.

## License

[MIT](LICENSE), copyright 2026 Serhii N. This is an independent project and is
not affiliated with YouTube or Google.
