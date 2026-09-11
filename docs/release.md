# Release policy

The `Windows and macOS Preview releases` workflow is the zero-cost release
path. It produces:

- Ed25519-signed `.dwpkg` plugin archives for Windows x86-64, Apple Silicon,
  and Intel macOS;
- a Windows NSIS installer and native macOS DMGs for Apple Silicon and Intel;
- Tauri updater bundles and one cross-platform `latest.json`, signed by the
  Tauri updater key;
- `SHA256SUMS.txt` for independent verification; and
- a `PREVIEW-UNSIGNED.txt` notice.

The preview intentionally does not add a Windows Authenticode certificate or
Apple Developer ID notarization. Windows SmartScreen can show an
unknown-publisher warning, and Windows 11 Smart App Control may block the
installer. macOS app and plugin executables use ad-hoc code signing, but
Gatekeeper can still require the user to approve the app in Privacy & Security
after the first launch attempt. Users should verify the published SHA-256 list
and download only from the official GitHub release.

The macOS build matrix uses native GitHub-hosted runners for both architectures:
`darwin-aarch64` for Apple Silicon and `darwin-x86_64` for Intel. The keyboard
heatmap backend currently relies on the Windows global keyboard hook, so its
catalog artifact remains Windows-only. The other official plugins are packaged
for both macOS architectures. The macOS-only Tauri overlay enables the private
window API required by Digiworld's transparent custom window; this direct DMG
distribution is therefore not an App Store build.

The signed updater manifest is deployed to
`https://jesmonx.github.io/digiworld/updates/latest.json`. Preview releases are
distributed as unsigned prereleases and are not marked as GitHub's stable
latest release. The same Pages deployment publishes the signed plugin catalog.

Every push to `main` directly builds a Preview release. Its version is the
higher of the root package version and all remote stable SemVer tags, with the
patch component incremented once. For example, source version `0.2.6` and
latest tag `v0.2.5` produce `v0.2.7`; the next successful release produces
`v0.2.8`. Alpha suffixes and workflow run numbers are not used. Each successful
build deploys `latest.json` and the plugin catalog to GitHub Pages. A newer push
cancels an older Preview build that is still in progress.

The workflow requires the following values in the `production-release`
Environment:

Secrets:

```text
DIGIWORLD_PLUGIN_SIGNING_KEY_B64
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Variables:

```text
DIGIWORLD_PLUGIN_PUBLIC_KEY_B64
DIGIWORLD_UPDATER_PUBLIC_KEY
```

`DIGIWORLD_PLUGIN_SIGNING_KEY_B64` accepts base64-encoded PEM/PKCS#8 private
keys and base64-encoded 32-byte Ed25519 seeds. The recommended value is a
single-line base64 encoding of an Ed25519 PEM private key.

The workflow resolves the Preview version once, builds every platform from the
same source revision and release metadata, and publishes the version commit and
tag only after all platform builds pass. It then merges the three platform
entries into the updater manifest and all available plugin targets into the
signed catalog. Manual workflow runs use the same automatic patch increment
policy. Public-trust Windows signing and Apple notarization can be added later
without changing the plugin or updater keys.
