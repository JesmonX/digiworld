# MarkPad

本地随笔插件。支持一天多条记录、日期筛选、跨日期内容搜索、`**加粗**`、Ctrl/⌘+B、编辑与阅读模式、700 ms 防抖自动保存、Ctrl/⌘+S 和删除确认。搜索输入时切到全部日期，之后可继续选择日期缩小范围。日期按创建时的本地日历日期归档，不随时区变化重新分组。

正文以纯文本保存，仅在阅读模式解析加粗，不执行 HTML。每条最多 50000 个 UTF-16 字符。SQLite 数据位于宿主分配的 `--data-dir/markpad.sqlite3`，使用 WAL 与 FULL 同步；插件不访问网络。所有记录加载后在本地进行搜索，适用于个人随笔；尚未实现大规模笔记分页。

自动保存失败会保留内存中的改动并提示重试；退出应用前应确认已保存。保存操作串行执行，切换记录不丢弃待保存内容，删除等待正在进行的保存结束。

开发：`pnpm --filter @digiworld/plugin-markpad-ui build`、`cargo build -p digiworld-markpad`。宿主 `/design.html` 包含 MarkPad 合成数据预览。安装包仍须通过项目完整 UI 矩阵后执行 `pnpm package:markpad`，不会绕过验证哈希门禁。
