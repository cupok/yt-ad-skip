# Privacy and diagnostics

This describes the current extension source, not YouTube's own privacy practices.

## Data used by the extension

The content script runs on `https://www.youtube.com/*`. It reads the page's
language, video source, playback state, visible chat content, and timestamp links.
It opens the video AI chat and sends a generated timestamp request through that
interface. YouTube processes that request according to its own policies.

The extension has no custom server, analytics endpoint, API key, or account
system. It does not send diagnostic logs to the maintainer automatically.

## Local storage

`chrome.storage.local` contains settings and recent diagnostic log lines.
The logger retains up to 1,000 lines, with a target size cap of 2 MiB. A single
oversized newest log line can exceed that cap. Console debug is off by default;
existing saved preferences are preserved. Changing the console debug setting
does not disable local log collection.

Diagnostics can include the current page URL and video ID, media URLs, playback
state, DOM text samples, snippets of AI chat replies, errors, and extension state.
URLs may include parameters you do not want to publish. The logger also listens
for page errors and unhandled promise rejections, so records can include errors
from YouTube rather than the extension itself.

## Export and deletion

**Export logs** explicitly downloads `yt-ad-skip.log` through Chrome. Opening the
settings popup does not start a download. Exported copies remain on disk until
you delete them.

Uninstalling the extension removes its local extension storage. **Reset defaults**
resets settings; it does not delete stored diagnostics or exported files.

Before sharing a log, read it and remove sensitive URLs, account-related text,
private chat content, and anything else you do not intend to make public. Prefer
the smallest relevant excerpt. Public GitHub issues and attachments are public.
