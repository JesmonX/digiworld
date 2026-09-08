# Digiworld 十项细节优化验收记录

日期：2026-09-08  
基线：core `0.2.57`，实施前提交 `2356b42`。本记录只包含本地源码、fixture、单元测试和 Chromium UI 证据；没有读取私人邮箱正文，也没有写入真实日历。

## 逐项结果

| # | 修改与复现覆盖 | 本地验收证据 | 外部边界 |
|---|---|---|---|
| 1 | Agent quota 的 Codex/AGY 内容改为同一 Grid 槽位叠放；隐藏页使用 `visibility`、`aria-hidden`、`inert`；reset 日期允许换行。fixture 加入长 `Full reset (Weekly + 5 hr)`、长有效期和密集 AGY 分组。 | `quota card keeps one outer size while Codex and AGY content changes`；同一窗口切换前后外框宽高差不超过 1 CSS px。 | 真实平台异步数据仅由本地 fixture 覆盖，仍需实际账号数据抽查。 |
| 2 | 周图日汇总、模型段、缓存点 Tooltip 移除日期，横轴和 `aria-label` 保留日期。 | `weekly chart tooltips omit dates while axes and accessible labels retain them`，覆盖鼠标和键盘聚焦。 | 无。 |
| 3 | 共享 `TooltipLayer` 传递 Agent accent 变体；共享主题增加 `accent-strong`，不写插件固定色。 | `agent accent tooltips remain themed and readable across schemes and modes` 覆盖 5 配色 × 明暗，正文/背景对比度断言 ≥ 4.5:1。 | 无。 |
| 4 | 非空热力格 hover/focus 放大 1.3 倍，主题圆环独立绘制并在减动效时保留静态圆环；滚动边缘预留空间。 | `heatmap focus ring scales at the scroll edges and respects reduced motion` 覆盖首尾格、空白格、键盘聚焦和 reduced-motion。 | 原生 WebView2 仍需人工确认边缘裁切。 |
| 5 | 删除 Keycap 点击 pressed 状态、定时器、键帽 Tooltip/title；按压效果仅由鼠标 hover 提供，焦点只保留焦点框。 | `keyboard data uses one Tab stop and hover-only key feedback`；检查点击、聚焦、悬浮、reduced-motion 均无 Tooltip/`is-pressing`。 | 无。 |
| 6 | 暗色热度计数统一使用中性正文色和不透明 raised material。 | `keyboard counts stay readable on every dark color scheme` 覆盖五种暗色配色和所有 fixture 非零热度，断言对比度 ≥ 4.5:1。 | 无。 |
| 7 | run 终态优先显示 100%；旧步骤详情显示“更新中”；缓存键包含 repository/run/attempt；请求代次和 attempt 校验；backend 支持 attempt jobs API。 | Git UI 单元测试 3 项 + `actions shows running state as localized status`；fixture 覆盖“旧 Report upload → 新 Test”。 | 未连接真实 GitHub；只读权限和 30 秒轮询代码路径未做线上运行。 |
| 8 | SQLite 增量增加 body 统计和 `body_retries`，保留 messages/FTS/已读/UIDVALIDITY；正文按 MIME part，缺失 section 计单封失败；重试退避 1/5/30/120 分钟；每账号单任务，连接失败结束本轮。 | mail backend 12 tests、Clippy；fixture 首屏显示 `正文 1799/1799`；数据库测试覆盖迁移兼容、计数、重试记录。 | 没有真实 QQ 凭据；“真实 QQ 连续两轮同步稳定”仍待完成，不能由模拟 fixture 代替。 |
| 9 | CalDAV 权限改为 `quick-xml` 命名空间感知解析，仅使用成功 propstat；新增 create/update/delete 三态 capabilities；保存/删除保留 ETag 并区分 401/403/412；目标事件必要时刷新自身权限。 | calendar backend 11 tests 覆盖前缀、默认命名空间、all/write/read、缺失/失败 propstat；权限 fixture 验证“待确认”仍允许显式保存；Clippy 通过。 | 没有真实 iCloud 账号；新建、Apple 日历可见、修改、删除往返仍待完成。 |
| 10 | Manifest/Catalog/摘要模型透传 `localizedNames`；宿主统一显示名和搜索回退；六个内置插件 manifest、旧 manifest、第三方名均覆盖。 | `pluginNames` 单元测试 2 项；浏览器测试覆盖中英切换、侧栏/首页/目录/确认/标题以及按中文搜索英文插件。 | 无。 |

## 最终本地检查

以下命令均在最终源码上通过：

- `pnpm typecheck`
- `pnpm test`：core 版本一致，workspace 单元测试全部通过（含 desktop 36 tests、Agent 16、Git 3、Mail UI 5、Keyboard 4）。
- `pnpm build`
- `pnpm check:ui`
- `pnpm test:ui`：55/55 passed；生成 `dist/ui-validation.json`，状态 `passed`，包含六个插件最终 UI SHA-256。
- `cargo fmt --all -- --check`
- `cargo test -p digiworld-mail-assistant`
- `cargo test -p digiworld-calendar-todo`
- `cargo test -p digiworld-github-actions`
- 上述三个受影响 package 的 `cargo clippy --all-targets -- -D warnings`
- 六个插件 release backend 编译、六个 `.dwpkg` 打包和 artifact-bound catalog 校验。

六个插件版本为：Agent `0.1.23`、Keyboard `0.1.16`、Git Actions `0.1.6`、Mail `0.1.9`、Calendar/Todo `0.1.9`、Server Monitor `0.1.9`。本地生成的 `catalog/v1/index.dev.json` 是开发/未签名 catalog；生产签名 catalog 需要 release workflow 的 `DIGIWORLD_PLUGIN_SIGNING_KEY_B64`，未在本地伪造签名。

## 尚未完成的真实环境验收

- QQ：使用明确选定的测试账号完成两轮同步，确认真实服务器下缓存、断线、重启和失败 UID 续传。
- iCloud：使用明确选定的测试日历完成创建、Apple 日历可见、修改、删除往返，并记录服务器返回的 ETag/权限结果。
- Windows：在实际 WebView2 安装包上检查 125% / 150% 显示缩放；Chromium fixture 不等同于此验收。

本次未执行上述外部操作，因此本地通过结果不扩展为 QQ、iCloud 或 Windows 平台结论。
