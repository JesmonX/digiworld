# Digiworld Privacy Policy

Effective date: 2026-09-03

Digiworld is local-first and does not collect or transmit analytics, usage
telemetry, keyboard data, crash reports, or personal information.

The Keyboard Heatmap plugin receives keyboard press and release notifications
while it is enabled. It immediately converts them into aggregate counters for
physical key positions. It does not store characters, key order, shortcuts,
foreground application names, window titles, or keyboard device identities.
Because the listener is global, key positions may be counted while a password
field is focused; only the aggregate counter is retained.

The app contacts GitHub Pages and GitHub Releases to check the official catalog,
download plugins, and check for updates. GitHub may process ordinary web request
metadata under its own privacy terms.

Diagnostic logs stay on the local computer, omit individual key events and
credentials, and are exported only when the user explicitly requests it.

The optional Agent Token Heatmap plugin reads Codex, Claude Code, Pi,
ZCode, and Antigravity (agy) session files only when the user starts a scan. It extracts timestamps and
input, output, cache-read, and cache-write token counts. It stores aggregated
daily counts, source identifiers, hashed file paths, and scan fingerprints;
it does not store prompts, responses, tool payloads, project paths, SSH
passwords, or private keys.

When the user enables Codex quota display, the plugin starts the installed
Codex App Server on one selected local or SSH device and asks it for current
rate-limit percentages and reset times. Digiworld stores the selected device,
shell preset, optional pre-command, and refresh interval, but not Codex
authentication tokens, account identifiers, or quota responses. The
pre-command is stored as plain text in local plugin storage; users should refer
to scripts or environment variables instead of placing secrets in this field.

The optional Mail Assistant connects only to IMAP accounts explicitly added by
the user. Application passwords and client authorization codes are stored in the
operating-system credential store and are never written to Digiworld's SQLite
databases or logs. The plugin stores account settings, message headers, up to
1 MiB of decoded plain-text body per message, attachment names, types, sizes,
and sync cursors in local plugin storage so the Inbox can be searched and read
offline. It does not retain attachment contents, render remote HTML resources,
send mail, or modify server flags, folders, and messages.

For an SSH source, Digiworld reuses the system OpenSSH client, SSH config,
known-hosts policy, ssh-agent, and keys. An ephemeral Python 3 parser runs in
memory on the selected Unix device and returns only normalized usage records,
hashed paths, and file fingerprints. No Digiworld helper is installed remotely.
