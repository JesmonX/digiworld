# Release policy

The `Windows Preview releases (no Authenticode)` workflow is the zero-cost
release path. It produces:

- an Ed25519-signed `.dwpkg` plugin archive;
- a Tauri updater bundle and `latest.json` signed by the Tauri updater key;
- `SHA256SUMS.txt` for independent verification; and
- a `PREVIEW-UNSIGNED.txt` notice.

The preview intentionally does not add a Windows Authenticode certificate.
Consequently, Windows SmartScreen can show an unknown-publisher warning, and
Windows 11 Smart App Control may block the installer. Users should verify the
published SHA-256 list and download only from the official GitHub release.

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

The resolved Preview version also updates the checked-out Tauri version and
updater public key for that build; it does not modify the repository. Manual
workflow runs use the same automatic patch increment policy. When a public-trust
signing provider is available, Authenticode signing will be added as a separate
step without changing the plugin or updater keys.
