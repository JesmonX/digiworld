# Digiworld

> 极轻量、本地优先的桌面扩展插件宿主平台
> A lightweight, privacy-first, local-first desktop shell for modular signed plugins.

[![Release](https://img.shields.io/badge/release-v0.2.31-blue.svg)](https://github.com/JesmonX/digiworld/releases)
[![Tauri](https://img.shields.io/badge/Tauri-v2-orange.svg)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-2024_Edition-black.svg)](https://www.rust-lang.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Zero Telemetry](https://img.shields.io/badge/privacy-zero_telemetry-brightgreen.svg)](docs/privacy.md)

[简体中文](README.md) | [English](README_en.md)

---

## 🌟 项目定位与核心理念

**Digiworld** 是一个专为开发者与效率探索者打造的**本地优先（Local-first）**桌面应用基座。基于 Tauri 2、Rust、React 19 与 Vite 构建，致力于通过严格的沙箱隔离架构与透明的权限管控，提供极致轻巧、免打扰、开箱即用的插件化桌面体验。

- 🛡️ **本地优先与绝对隐私 (Zero Telemetry)**：无任何用户行为上报，不收集崩溃日志，零第三方分析追踪打点。统计数据本地聚合，敏感凭据全量托管至操作系统安全凭据库。
- 🧩 **严密沙箱隔离架构 (Sandboxed Architecture)**：UI 视图运行在隔离的 iframe 沙箱中（基于安全 `postMessage` 桥通信）；原生后端作为独立低特权子进程运行，通过系统管道以换行符分隔的 JSON-RPC 2.0 交互（限制 4 MiB 载荷上限与 15s 响应超时）；权限按需显式声明，用户完全掌控数据边界。
- 🎨 **高度一致的现代美学 (Design System)**：宿主与插件完全共享 `@digiworld/design-system` 规范与语义化 Token（`--dw-*`）。原生内置 Catppuccin（Latte / Mocha）与 Rosé Pine（Dawn / Moon）精选主题，支持亚克力毛玻璃视觉效果（Glass Effect）与多级字阶缩放（100%、110%、125%）。
- 🌐 **完备的网络与全局代理引擎**：支持跟随系统代理、自定义代理（HTTP/HTTPS/SOCKS5/SOCKS5H）及全局直连，内置代理可用性检测；支持插件及单个邮箱账号独立定制代理绕过策略。

---

## 📦 官方插件矩阵与实机展示

Digiworld 目前提供三个开箱即用、深度打磨的官方插件：

### 1. Agent Overview (AI Token 用量与限额全景看板)
> 插件标识: `io.github.jesmonx.digiworld.agent-token-heatmap`

面向 AI 辅助编程与重度 LLM Agent 用户。自动聚合本地与远端服务器的 Token 消耗、模型分布、Prompt 缓存利用率及 OpenAI Codex 配额状态。

- **多 Agent 全面整合**：原生支持扫描 OpenAI Codex / Codex CLI、Anthropic Claude Code、Pi、ZCode 以及 Google Antigravity (agy)。
- **多设备与远端集群管理**：支持扫描本机工作区，并可借由系统 OpenSSH 免安装部署临时在存脚本无痕提取远端服务器（如 FServer、NServer 等）的会话统计，零残留、不留常驻进程。
- **近 7 天模型用量堆叠与缓存率走势**：直观展示各类模型（gpt-5.6-sol、gemini-3.8-flash、gpt-5.6-luna、gpt-6-astra 等）每日用量柱状堆叠，并叠加缓存命中率变化折线。
- **Codex 实时限额与重置卡监控**：直连本地 Codex App Server，精确读取 5 小时滚动限额、7 天额度剩余百分比、下次额度重置倒计时与可用重置卡状态。
- **GitHub 风格年度活跃热力图**：支持 30 天 / 90 天 / 365 天 / 全量时间范围缩放，呈现每日 Token 消耗点阵。
- **宏观看板与排行榜**：总 Token、输入、输出、缓存读取、缓存写入核心指标，来源明细占比与每日消耗 Top 10 榜单。

<div align="center">
  <img src="docs/assets/agent-overview-trends.png" alt="Agent Overview 趋势与实时限额" width="90%" />
  <p><em>图 1：Agent Overview - 多 Agent / 多设备筛选、7 日模型堆叠柱状图与 Codex 实时限额监控</em></p>
</div>

<div align="center">
  <img src="docs/assets/agent-overview-heatmap.png" alt="Agent Overview 年度热力图与明细" width="90%" />
  <p><em>图 2：Agent Overview - Token 宏观 KPI 指标、年度贡献热力图、模型来源分布与每日消耗排行榜</em></p>
</div>

---

### 2. 邮件助手 (轻量多账号聚合与极速离线阅读)
> 插件标识: `io.github.jesmonx.digiworld.mail-assistant`

专为免打扰、高隐私设计的桌面多邮箱统一查阅工具，兼顾极速与安全。

- **多账号统一收件箱**：支持 Gmail、QQ 邮箱、网易 163 邮箱以及任意标准 TLS IMAP 服务器的一站式聚合管理。
- **系统凭据库安全托管**：邮箱应用密码与客户端授权码直接存入操作系统级凭据库（Windows Credential Manager / Keyring），绝不落盘至 SQLite 或明文日志。
- **极速离线纯文本索引**：在本地建立极低资源占用的 SQLite 纯文本索引库，支持毫秒级全文检索（发件人、主题、正文）；不下载体积庞大的多媒体附件，不加载远程追踪外链代码，保护带宽与隐私。
- **一键全标已读**：后台异步批量同步 IMAP `\Seen` 状态，不执行删除、移动或发件等高风险操作。
- **后台智能轮询与独立代理**：支持自定义检查频率（如每 10 分钟），聚合发送桌面未读通知；支持单账号独立切换是否走代理，兼顾内外网邮箱。

<div align="center">
  <img src="docs/assets/mail-assistant.png" alt="邮件助手多账号统一收件箱" width="90%" />
  <p><em>图 3：邮件助手 - 多账号统一收件箱、纯文本离线检索、定时后台轮询与一键全标已读</em></p>
</div>

---

### 3. 键盘热力图 (隐私级硬件键位敲击分布)
> 插件标识: `io.github.jesmonx.digiworld.keyboard-heatmap`

面向程序员、键盘客制化玩家与文字工作者的物理按键频次分析工具。

- **主流键盘物理配列**：完美仿真并渲染 104 键、87 键（TKL）、84 键（75%）、68 键（65%）和 61 键（60%）主流物理配列。
- **严苛的隐私边界**：底层全局钩子仅统计物理键位每日累计敲击总数。**绝对不记录**按键输入内容、击键先后顺序、激活应用名称、窗口标题或设备唯一标识；不具备任何键盘记录器（Keylogger）特征。
- **动态热力色阶反馈**：物理键位根据敲击频次梯级呈现动态色彩；支持切换“今日统计”与“历史汇总”，直观展示 Top 10 热键排行与激活键位比例。
- **低开销后台常驻**：主界面最小化或关闭后，仍可在后台低功耗持续累计，数据常驻本地。

---

## 🏗️ 系统架构与技术实现

Digiworld 采用了严密的宿主-插件解耦架构，确保应用在拥有极致灵活性的同时兼具高可靠性与安全性：

```text
┌──────────────────────────────────────────────────────────┐
│                 Digiworld Desktop Shell                  │
│       (Tauri 2 + Rust 1.96+ + React 19 + TypeScript)     │
│                                                          │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────┐ │
│  │ 窗口 / 托盘管理│  │ 全局网络与代理 │  │ 插件生命周期│ │
│  └────────────────┘  └────────────────┘  └─────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  @digiworld/design-system (Semantic Tokens / Fonts) │ │
│  └─────────────────────────────────────────────────────┘ │
└───────────────┬──────────────────────────┬───────────────┘
                │ postMessage Bridge       │ Anonymous Pipe (JSON-RPC)
                ▼                          ▼
     ┌──────────────────────┐    ┌──────────────────┐
     │   Sandboxed iframe   │    │  Native Backend  │
     │  (Isolated Web UI)   │    │ (Rust Subprocess)│
     └──────────────────────┘    └──────────────────┘
```

- **UI 沙箱隔离**：插件界面运行在无特权的 iframe 沙箱（`allow-scripts allow-downloads`，严格去除 `allow-same-origin`），插件无法直接访问宿主底层 API，必须通过 `@digiworld/plugin-sdk` 的类型安全 Bridge 进行通讯。
- **后端进程沙箱**：原生后端作为受控子进程运行，与宿主通过匿名管道交换单行 JSON-RPC 2.0 报文，主应用对单条报文执行 4 MiB 截断与 15 秒超时强制熔断。
- **声明式权限清单 (Permissions Contract)**：
  - `global-input`：系统级输入统计权限（用于键盘热力图）；
  - `background`：应用退至后台时保持服务活跃；
  - `plugin-storage`：读写专属的本地轻量 SQLite 存储库；
  - `filesystem:agent-session-data`：受限读取指定开发工具会话用量字段；
  - `process:ssh`：按需调用系统 OpenSSH 执行轻量会话汇总；
  - `network:openai` / `network:imap`：声明式外部网络协议访问权限；
  - `secret:mail-credentials`：向系统级安全凭据库读写授权认证密钥；
  - `notifications`：向桌面系统推送聚合消息通知。
- **防篡改签名机制**：插件以 `.dwpkg` 格式归档，官方插件库与包体均使用 Ed25519 签名，下载后由宿主严格验证 SHA-256 哈希完整性。

---

## 🚀 快速上手与使用

### 下载安装
前往 [GitHub Releases](https://github.com/JesmonX/digiworld/releases) 页面下载最新发布的 Windows 安装包：
- `Digiworld_<version>_x64_en-US.msi` 或对应安装包
- **安全校验提示**：当前处于 Preview 预览阶段，工作流进行了完整的 Ed25519 插件与更新签名，但尚未引入 Windows Authenticode 商业证书。若 Windows SmartScreen 弹出“未知发布者”提示，请先校验 Release 页面提供的 `SHA256SUMS.txt` 校验和，确认无误后点击“仍要运行”。

### 插件启用与管理
1. 启动 Digiworld，在左侧导航栏点击 **「功能库」**；
2. 浏览官方认证的扩展插件列表，点击 **「安装」**；
3. 安装成功后，对应插件图标将即刻出现在侧边栏；
4. 点击插件即可进入专属视图，可在顶部右上角随时**启用/停用**或**彻底移除**。

---

## 🛠️ 本地开发与构建指南

### 前置环境
- **Node.js**: `24.0.0+`
- **pnpm**: `11.0.0+`
- **Rust**: `1.96.0+` (2024 edition)
- **Tauri 2**: 平台构建环境（Windows 下需具备 C++ Build Tools 与 WebView2 运行库）

### 常用命令

```sh
# 1. 安装项目所有依赖
pnpm install

# 2. 全局类型与版本一致性检查
pnpm check:versions
pnpm typecheck

# 3. 运行 Rust 单元与集成测试
cargo test --workspace

# 4. 启动桌面端调试环境 (热重载)
pnpm dev

# 5. 校验 UI 设计系统规范与浏览器矩阵渲染测试
pnpm check:ui
pnpm test:ui

# 6. 打包官方插件（生成 .dwpkg 归档）
pnpm package:agent-tokens
pnpm package:mail
pnpm package:keyboard

# 7. 构建插件 Catalog 索引
pnpm catalog:build
```

---

## 🔒 隐私与安全性

Digiworld 将隐私视为生命线：
1. **绝无用户遥测**：应用不包含任何第三方跟踪打点库与远程分析 SDK。
2. **凭据安全隔离**：邮箱账户密码等绝密数据全部交由操作系统凭据库（Keyring）加密保存，不存入任何明文配置文件。
3. **数据完全自主**：所有统计指标、SQLite 离线索引均保留在用户本机或私有服务器上。

详细隐私保护策略与安全技术细节，请阅读 [docs/privacy.md](docs/privacy.md)。

---

## 📚 开发文档与扩展指引

- [UI 设计规范与主题契约 (UI Design Contract)](docs/ui-design.md)
- [插件格式与通信规范 (Plugin Format v1)](docs/plugin-format.md)
- [隐私策略与数据边界 (Privacy Policy)](docs/privacy.md)
- [版本发布与数字签名机制 (Release Policy)](docs/release.md)

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 许可证开源。
