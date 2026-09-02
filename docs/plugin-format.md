# Digiworld plugin format v1

Official plugins are ZIP-compatible `.dwpkg` archives containing:

```text
manifest.json
ui/index.html
bin/<target>/<backend executable>
```

The catalog and complete archive are signed with the Digiworld Ed25519 release
key. Every backend also has a manifest SHA-256 digest and, on Windows production
releases, a valid Authenticode signature.

Plugin UIs run in a sandboxed iframe and communicate with the host bridge by
`postMessage`. The desktop host loads the signed, self-contained HTML through
`iframe.srcdoc`; its CSP therefore keeps inline script and style execution
explicitly enabled while disabling Tauri's automatic nonce/hash rewriting for
those two directives. This is required for bundled plugin UIs to execute in
the production WebView. Do not add `allow-same-origin` to the iframe sandbox.
Backends run as child processes and speak newline-delimited
JSON-RPC 2.0 over inherited anonymous pipes. Messages are serialized per plugin,
limited to 4 MiB, and time out after 15 seconds.

Native official backends run with the current user's operating-system rights.
The permission screen is consent and transparency, not an OS sandbox.
