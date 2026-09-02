# Digiworld

Digiworld is a lightweight, local-first desktop shell for installing official,
signed feature plugins on demand. The first plugin is a privacy-preserving
Windows keyboard heatmap.

## Status

This repository contains the desktop shell, plugin protocol and SDK, official
plugin sources, catalog tooling, tests, and Windows release workflows. Windows
release artifacts must be Authenticode-signed before they are published as a
stable release.

## Development

Requirements: Node.js 24+, pnpm 11+, Rust 1.96+, and the platform prerequisites
for Tauri 2.

```sh
pnpm install
pnpm typecheck
cargo test --workspace
pnpm dev
```

Set `DIGIWORLD_DEV_CATALOG` to a local catalog JSON file to test unsigned local
packages in a debug build. Release builds reject unsigned catalogs and plugins.

## Privacy

Digiworld has no telemetry. The keyboard heatmap stores daily aggregate counts
by physical key only. It never stores text, key order, active applications,
window titles, or device identities. See [docs/privacy.md](docs/privacy.md).
