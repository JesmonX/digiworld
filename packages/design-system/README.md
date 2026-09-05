# Digiworld design system

Shared tokens, full theme presets, document baseline, CSS controls and React components for the desktop and plugins. Read [the contract](../../docs/ui-design.md) before adding UI. Palette attribution is in [PALETTES.md](PALETTES.md).

Load `tokens.css` and `base.css`, then import controls from `@digiworld/design-system/react` (or `components.css` for other frameworks). The host alone supplies fonts and resolves the active palette. Build frontends before opening the development component gallery with `pnpm design:preview` at `/design.html?gallery`.
