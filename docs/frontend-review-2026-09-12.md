# Frontend refinement — 2026-09-12

## Changes

- Keyboard: add a persisted Mac ANSI compact layout with Command/Option keycaps and equal half-height arrows. Fn and Eject are display-only in the current capture backend; this does not add a macOS capture backend.
- Keyboard: remove the empty function-row track, rebuild 98/84/68-key compact blocks, align arrows, center smaller boards, and separate key height from responsive width. Keep exact counts in rankings and accessible key labels; abbreviate keycap counts.
- Keyboard interaction: retain a single data Tab stop in every layout, open the layout menu with arrow keys, make the closed menu inert, constrain its height, and restore trigger focus. Add recording/loading status and short heat/ranking transitions.
- Shell: localize built-in descriptions in English, Plex and language controls, and official permission explanations. Permission translations match complete source text; unknown or changed reasons remain verbatim.
- Agent overview: localize untranslated credits, source settings, quota durations, Chinese clock notation and accessible labels.
- Calendar/workflows/servers: localize task/job terminology and host settings; show explicit refresh-in-progress text.
- MarkPad: use the valid muted-text token, remove the repeated product heading, and show save/delete progress text.
- Shared controls: allow long status messages to wrap, add brief status/dialog entrance transitions, and preserve reduced-motion behavior.

## Review scope

Inspected the shell overview/settings and all seven built plugin UIs using the development preview and synthetic data. Browser checks cover light/dark themes, five accent colors, 900×600 / 1280×800 / 1600×1000 viewports, keyboard layouts at 100% and 125% zoom, dialogs, focus, empty/error states and live theme/language updates. Screenshots and the browser report are generated under `dist/ui-results` and `dist/ui-report`; additional review images are under `dist/frontend-review`.

Product names (GitHub, Codex, MarkPad), physical key legends, protocols, model identifiers and units retain their conventional spelling. User-authored mail/calendar/note content, workflow names, provider reset-card titles, raw service errors and unknown external plugin metadata retain their original language. Native date input placeholders follow the embedded browser/system locale.

These checks validate Chromium rendering with fixtures. They do not certify native WebView2/macOS behavior, global input hooks or live mail/SSH/calendar services. Local rebuilt plugin packages and the development catalog are distinct from published Windows/macOS release artifacts.
