# Digiworld

Digiworld is a lightweight, local-first desktop shell for installing official,
signed feature plugins on demand. The first plugin is a privacy-preserving
Windows keyboard heatmap and a cross-agent Token usage heatmap.

## Status

This repository contains the desktop shell, plugin protocol and SDK, official
plugin sources, catalog tooling, tests, and Windows release workflows. The
current zero-cost Preview workflow signs plugin archives and updater bundles,
but intentionally omits Windows Authenticode; stable releases will add a
public-trust signer such as SignPath Foundation when approved.

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
and Pi session files on the local computer. Optional SSH sources reuse the
system OpenSSH configuration and run an ephemeral Python 3 parser remotely;
only normalized usage totals are returned.

Network access can follow the operating-system proxy, use an unauthenticated
HTTP/HTTPS/SOCKS5 proxy URL, or bypass proxies. The selected policy is used for
the official catalog, plugin downloads, core updates, and plugin backends that
declare a `network:*` permission.

Set `DIGIWORLD_DEV_CATALOG` to a local catalog JSON file to test unsigned local
packages in a debug build. Release builds reject unsigned catalogs and plugins.

## Privacy

Digiworld has no telemetry. The keyboard heatmap stores daily aggregate counts
by physical key only. It never stores text, key order, active applications,
window titles, or device identities. See [docs/privacy.md](docs/privacy.md).
