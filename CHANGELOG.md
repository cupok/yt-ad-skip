# Changelog

Notable user-facing changes are recorded here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The initial public release is prepared from the previously untagged development
history. Development changes stay under `Unreleased` until release preparation.

## [Unreleased]

## [1.0.0] - 2026-10-20

### Added

- AI-generated timestamp detection for sponsor segments, paid advertisements,
  fundraising, and donation appeals.
- Automatic skipping with a live cancellation countdown and remembered
  cancellation choices for the current video.
- Keyboard shortcuts for immediately skipping a marked segment.
- English, Ukrainian, and Russian interface and prompt support.
- Persistent timing settings, console-debug control, and explicit local log export.
- Automated tests, GitHub CI, release packaging, and contributor documentation.

### Changed

- Chat closure waits for a new AI timestamp response to settle and restarts when
  more content arrives. Response timeouts leave the panel open.

### Fixed

- Old chat history cannot start the closing countdown or reintroduce old ranges.
- Normal startup conditions and answers without skippable segments are logged
  as informational diagnostics rather than extension warnings.
- Media source resets, stale work after navigation, and other expected lifecycle
  events no longer appear as extension warnings. Actual failures still do.
