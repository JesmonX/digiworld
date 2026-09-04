# Digiworld

Digiworld is a lightweight, local-first desktop shell for installing official,
signed feature plugins on demand. Official plugins include a privacy-preserving
Windows keyboard heatmap, a cross-agent Token usage heatmap, and an IMAP mail
assistant.

## Status

This repository contains the desktop shell, plugin protocol and SDK, official
plugin sources, catalog tooling, tests, and Windows release workflows. The
current zero-cost Preview workflow signs plugin archives and updater bundles,
but intentionally omits Windows Authenticode; stable releases will add a
public-trust signer such as SignPath Foundation when approved.

The desktop shell and official plugin UIs share semantic colors, radii,
shadows, and motion through `@digiworld/design-system`. Host-owned typography,
including Inter Variable for Latin UI text and Plex Sans SC for Chinese, is
injected into isolated plugin frames without duplicating font assets.

Preview users may see a Windows SmartScreen unknown-publisher warning. Verify
the published `SHA256SUMS.txt` before running the installer.

## Development

Requirements: Node.js 24+, pnpm 11+, Rust 1.96+, and the platform prerequisites
for Tauri 2.

```sh
pnpm install
pnpm typecheck
cargo test --workspace
pnpm dev
```

The Agent Token Heatmap plugin reads usage metadata from Codex, Claude Code,
Pi, ZCode, and Antigravity (agy) session files on the local computer. Optional SSH sources reuse the
system OpenSSH configuration and run an ephemeral Python 3 parser remotely;
only normalized usage totals are returned.

The plugin can also query one selected device's current ChatGPT Codex quota
through the official local Codex App Server. The selected shell, optional
pre-command, and refresh interval stay in plugin storage; authentication tokens
and account identifiers are neither read nor retained by Digiworld.

Network access can follow the operating-system proxy, use an unauthenticated
HTTP/HTTPS/SOCKS5/SOCKS5H proxy URL, or bypass proxies. The selected policy is used for
the official catalog, plugin downloads, core updates, and plugin backends that
declare a `network:*` permission.

The optional Mail Assistant connects to Gmail, QQ, 163, or a custom TLS IMAP
server. It keeps application passwords and client authorization codes in the
operating-system credential store, caches a searchable plain-text copy of the
Inbox locally, and does not download attachment contents. For a selected
account, the explicit “全部标为已读” action synchronizes the IMAP `\Seen`
flag in the background; it does not send, delete, or move messages. Background
checks use the same Digiworld proxy policy.

Plugin and core update checks are explicit: Digiworld displays the available
versions and asks for confirmation before downloading. Confirmed downloads and
installs report progress in the app and use the saved proxy policy.

Set `DIGIWORLD_DEV_CATALOG` to a local catalog JSON file to test unsigned local
packages in a debug build. Release builds reject unsigned catalogs and plugins.

## Privacy

Digiworld has no telemetry. The keyboard heatmap stores daily aggregate counts
by physical key only. It never stores text, key order, active applications,
window titles, or device identities. See [docs/privacy.md](docs/privacy.md).
