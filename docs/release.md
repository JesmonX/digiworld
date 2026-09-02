# Release policy

The `Windows Preview release (no Authenticode)` workflow is the zero-cost
release path. It produces:

- an Ed25519-signed `.dwpkg` plugin archive;
- a Tauri updater bundle and `latest.json` signed by the Tauri updater key;
- `SHA256SUMS.txt` for independent verification; and
- a `PREVIEW-UNSIGNED.txt` notice.

The preview intentionally does not add a Windows Authenticode certificate.
Consequently, Windows SmartScreen can show an unknown-publisher warning, and
Windows 11 Smart App Control may block the installer. Users should verify the
published SHA-256 list and download only from the official GitHub release.

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

The workflow input also updates the checked-out Tauri version and updater
public key for that build; it does not modify the repository. When a
public-trust signing provider is available, Authenticode signing will be added
as a separate step without changing the plugin or updater keys.
