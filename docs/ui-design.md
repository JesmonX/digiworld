# Digiworld UI design contract v1

The desktop and plugins share `@digiworld/design-system`. Host responsibilities are full palette resolution, font resources, typography preferences, and initial/live iframe theme delivery. Plugins own business layout and data visualization. The iframe sandbox remains `allow-scripts allow-downloads`.

## Consuming the design system

Import `tokens.css`, then `base.css`, then use `@digiworld/design-system/react` for Button, Input, Select, Textarea, Card, Panel, Metric, Progress, Toolbar, Segmented, RadioGroup, Status, Switch, Dialog and Menu. Non-React plugins can consume `components.css` and the same `dw-*` classes, with equivalent native accessibility behavior. Do not copy component styles into plugin CSS. Only the host imports `@digiworld/typography/fonts.css`.

Compose pages with PluginPage, PageToolbar, Section, MetricGrid, SplitPane, MasterDetail, FormField, EmptyState and LoadingState. See [plugin templates](plugin-ui-templates.md) for interfaces and a runnable example without private CSS. The host injects component/layout defaults before business CSS and resolved tokens after it; initial glass and color-scheme attributes match live updates.

Use `--dw-*` semantic tokens. Legacy `--type-*`, `--weight-*` and `--font-*` aliases are centralized in tokens.css. New tokens should be added there and to the host palette resolver when appropriate, never defined inside a plugin. Palette provenance and MIT notices are in `packages/design-system/PALETTES.md`.

Typography roles: caption 12/18, body-sm 14/20, body 14/22, title 16/24, page 24/32, metric 28/36. Body copy is at least 14px; captions are at least 12px. Base weight is 400, labels 500, headings 600. The host's saved font and weight override these defaults. Layout uses min-height, reflow and scrolling, not transformed documents. Use tabular numerals in data regions only.

Use radii sm/md/lg (10/14/20), spacing 1–6 (4/8/12/16/24/32) and shared elevation/motion tokens. `Panel` is the structural surface for grouped sections; `Card` is for a contained item; `Metric` and `Progress` carry repeated data-display patterns. Use the material tokens (`--dw-material-panel`, `--dw-material-card`, `--dw-material-raised`, `--dw-material-inset`) instead of inventing per-page surfaces. Color roles include surface elevations, text/muted, accent/contrast/soft, success/warning/danger and their soft backgrounds, focus, chart series/grid, and heat text/background pairs. Controls need visible keyboard focus. Reduced-motion preferences suppress animation.

The host uses a fixed 72px navigation rail within a 96px slot on desktop (64px within 80px at narrow widths), an integrated window-control strip, and a transparent plugin canvas. The ambient gradient belongs to the host canvas; ordinary cards remain neutral material surfaces. Glass blur is limited to structural panels, dialogs and menus when explicitly enabled. Plugin documents must keep `html`, `body` and `#root` transparent so the host surface remains continuous. Turning glass off disables blur, not the static ambient canvas. Controls use 10px radii, cards 14px, panels and dialogs 20px.

## Theme and compatibility

The host offers Catppuccin Latte (default), Mocha, Rosé Pine Dawn/Moon, Tokyo Night/Day, Nord, GitHub Light and Dracula, with classic/ocean/pine/amber/rose color schemes. Colors are adapted for readable product semantics. New preferences use `digiworld.theme.v2`; old accent choices fall back to Latte on first load and do not overwrite a subsequently saved theme. Font/weight preferences are preserved. Glass defaults off unless explicitly enabled. Typography uses standard 100% scale (14px base font size).

The resolved theme is applied to the host root and sent through the existing `theme` message. Plugin HTML receives fonts, fallback tokens, baseline and initial theme before rendering. Later changes update root properties through the SDK without changing `srcDoc`. A plugin manifest and catalog entry declare `uiDesignVersion: 1`; installed summaries propagate it. Older plugins remain usable with a Latte compatibility theme and an adaptation label in the installed list. Unsupported/newer design versions also use compatibility mode.

## Admission and evidence

For a new catalog version, declare `uiDesignVersion: 1` and `minCoreVersion >= 0.2.27`. Run source checks, build plugin frontends, run the full browser matrix, then package backends and build the catalog. `package-plugin.mjs` rejects missing/stale/partial browser evidence and embedded fonts. Metadata records UI and final archive SHA-256. Catalog publication verifies the archive-bound validation record. Existing published versions are unchanged; the generator admits only compliant new artifacts.

`check:ui` parses CSS and JSX/TypeScript: literal colors, local typography, shadows/radii outside shared tokens, host token redefinitions, font payloads and fixed color-scheme declarations fail. This is a publishing quality gate, not a security boundary or proof against arbitrary runtime-generated CSS. External plugin submissions require source review and a representative fixture added to the browser suite; a manifest declaration alone does not qualify.

Registered domain layout exceptions: keyboard keys may specify physical row/column sizes, spacers and heat intensity; token charts may specify SVG coordinates, stroke geometry and numeric scales; mail may specify column/row layout and plaintext wrapping. These exceptions permit geometry only, not private fonts or palettes. All three use the shared text/color roles.

## Review and validation

Run `pnpm build`, `pnpm check:ui`, `pnpm test:ui`. Run `pnpm design:preview` and open `/design.html` for the actual shell with synthetic data and the built plugin HTML; `/design.html?gallery&theme=catppuccin-mocha` shows common controls. This development-only entry is excluded from the production entry graph. It never reads a user's mail or usage data.

The matrix covers the supported theme presets and 900x600 / 1280x800 / 1600x1000 windows. Screenshots and traces are in `dist/ui-results`, the browsable report in `dist/ui-report/index.html`, and artifact evidence in `dist/ui-validation.json`. Empty/error states and live plugin updates have separate tests. Partial filtered runs cannot authorize packaging.

Browser fixtures validate rendering, not real IMAP, quota services or native Windows runtime behavior. Windows CI builds the installer and runs the same UI checks; manual acceptance of the installed WebView2 app at Windows 125% and 150% display scaling remains a separate release check. Do not describe headless Chromium screenshots as native WebView2 screenshots.
