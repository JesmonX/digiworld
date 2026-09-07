# Plugin UI templates

Import from `@digiworld/design-system/react`. The host supplies font declarations, initial and live theme values, controls and layout CSS. Standalone plugin previews import `tokens.css`, `base.css` and the React entry (which includes component/layout styles). Non-React consumers may import `components.css` and `layouts.css` and use the equivalent `dw-*` classes.

## A page without private appearance CSS

```tsx
import { PluginPage, PageToolbar, Panel, MetricGrid, Metric, Button } from '@digiworld/design-system/react'

export function Overview({ total, refresh }) {
  return <PluginPage toolbar={<PageToolbar actions={<Button onClick={refresh}>刷新</Button>} />}>
    <Panel><MetricGrid><Metric label="总用量" value={total ?? '—'} /></MetricGrid></Panel>
  </PluginPage>
}
```

An interactive example including forms, master/detail and split layouts lives at `/design.html?template&theme=catppuccin-latte`. Its source is `apps/desktop/src/design-template.tsx`; it has no private CSS and is excluded from the production entry graph.

## Choosing a layout

| Component | Contract |
| --- | --- |
| PluginPage | `toolbar`, `children`, `scroll="page"` (default) or `"panes"`. Owns full height, padding and gaps. Page mode scrolls vertically; panes mode delegates scrolling to child panes. |
| PageToolbar | `filters`, `actions`, or direct children. Wraps controls; trailing actions align right. |
| Section | Required `title`, optional `description` and `actions`; connects its heading to the section. |
| MetricGrid | Responsive equal-width metrics; missing data remains a dash, never invented zero. |
| SplitPane | Required `aside`, children for primary content; `side="left"` or `"right"`. Stacks below 720px of the page's available width. |
| MasterDetail | Required `list`, `detail`, `selected`, `onBack`; optional `backLabel`. Below 680px available width, shows list or detail and provides a back button. |
| FormField | `label`, `hint`, `error`, and a single form control as children; native label association and alert for validation errors. |
| EmptyState / LoadingState | EmptyState takes `title`, `description`, `icon`, `action`; LoadingState takes `label` and announces status. |

Keep business geometry in local CSS: physical keyboard rows, SVG chart coordinates, calendar cells and domain-specific list layouts. Use shared controls, surfaces and semantic color roles. Do not redefine shared layout root classes or host `--dw-*` tokens. Do not bundle fonts or paint an opaque document background. Use existing `Status` for recoverable errors while preserving stale content.

The v1 contract remains additive. Local CSS can style business-specific classes after component defaults; host token values are inserted last. Theme changes use the existing bridge and do not replace `srcDoc`. Old installed plugins continue through their existing compatibility path. Upgrading old plugins with private appearance rules requires a one-time migration; the framework cannot infer arbitrary markup's business semantics.

Before packaging, run `pnpm check:ui`, `pnpm build` and the complete `pnpm test:ui`. Filtered tests do not authorize packaging. Verify native window controls and Windows display scaling separately from browser fixtures.
