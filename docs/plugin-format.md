# Digiworld plugin format v1

New catalog versions must declare `uiDesignVersion: 1` and require core 0.2.27 or newer. See [UI design contract](ui-design.md) for shared controls, full light/dark themes, host-provided typography and artifact-bound publication checks. Installed older versions remain usable with the host's light compatibility theme.

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

Backends may also emit JSON-RPC notifications without an `id`. The host currently
accepts `host.notification` with string `title` and `body` fields. It is ignored
unless the plugin declared the `notifications` permission; titles are limited to
120 characters and bodies to 512 characters. Notifications and request responses
may be interleaved on stdout.

Native official backends run with the current user's operating-system rights.
The permission screen is consent and transparency, not an OS sandbox.

The optional manifest `icon` is a stable host icon token. Official plugins use
the tokens `keyboard`, `tokens`, `chatgpt`, and `mail`; the desktop host falls back to a
generic icon for unknown tokens.

Backends declaring a `network:*` permission receive `DIGIWORLD_PROXY_MODE`.
In custom mode the host also provides the standard upper- and lower-case
HTTP(S)/ALL proxy environment variables; in direct mode it removes them.
Plugins using system mode must enable their runtime's native system-proxy
support. SSH routing remains the responsibility of OpenSSH configuration.
