import type { Locale } from './i18n'

// Match complete source text so a changed permission is never hidden by an old translation.
const translations: Record<string, string> = {
  '在其他应用获得焦点时统计实体键位按下次数。': 'Count physical key presses while other applications have focus.',
  '关闭 Digiworld 窗口后继续累计键位次数。': 'Continue counting key presses after the Digiworld window is closed.',
  '在本机保存每日聚合计数和插件设置。': 'Store daily aggregate counts and plugin settings locally.',
  '读取 Codex、Claude Code、Pi、ZCode 与 Antigravity (agy) 会话文件中的 Token usage 字段。': 'Read token usage fields from Codex, Claude Code, Pi, ZCode and Antigravity (agy) session files.',
  '按需使用系统 OpenSSH 读取用户配置的远端设备统计。': 'Use system OpenSSH on demand to read statistics from devices configured by the user.',
  '通过用户选择的 Shell 和前置命令启动 Codex App Server 限额查询。': 'Run Codex App Server quota queries through the selected shell and configured pre-command.',
  '通过 Codex App Server 主动读取当前账号的用量限额和重置时间。': 'Query the current account usage limits and reset times through Codex App Server.',
  '保存聚合 Token 指标、设备设置和增量扫描游标。': 'Store aggregate token metrics, device settings and incremental scan cursors.',
  '在 Digiworld 驻留后台时定期检查新邮件。': 'Periodically check for new mail while Digiworld runs in the background.',
  '通过 Digiworld 显示按账号聚合的新邮件通知。': 'Show new mail notifications grouped by account through Digiworld.',
  '按账号选择是否使用 Digiworld 的代理策略连接用户配置的 IMAP 收件服务器，并同步用户明确请求的已读状态。': 'Connect to configured IMAP servers using each account proxy preference, and sync read status explicitly requested by the user.',
  '在本机保存邮件索引、纯文本正文、同步游标和非敏感账号设置。': 'Store mail indexes, plain text bodies, sync cursors and non-sensitive account settings locally.',
  '在操作系统凭据库中保存邮箱应用专用密码或客户端授权码。': 'Store mail app passwords or client authorization codes in the operating system credential store.',
  '通过 CalDAV 发现和同步用户选择的 iCloud 日历。': 'Discover and sync selected iCloud calendars through CalDAV.',
  '将 Apple App 专用密码保存到操作系统凭据库。': 'Store the Apple app-specific password in the operating system credential store.',
  '保存日历缓存、同步设置和本地 Todo。': 'Store calendar caches, sync settings and local tasks.',
  '读取当前账号、可访问仓库与 GitHub Actions 状态。': 'Read the current account, accessible repositories and GitHub Actions status.',
  '将 GitHub Token 保存到操作系统凭据库。': 'Store the GitHub access token in the operating system credential store.',
  '保存仓库选择与刷新设置。': 'Store repository selections and refresh settings.',
  '通过系统 OpenSSH 读取远程 Linux 状态；仅在用户点击安装后执行 vnStat 安装命令。': 'Read remote Linux status through system OpenSSH; run vnStat installation commands only when the user clicks Install.',
  '保存设备、指标选择及最近采样。': 'Store devices, metric selections and recent samples.',
  '将随笔内容和记录日期保存在本地。': 'Store note content and dates locally.',
}

export function permissionText(reason: string, locale: Locale): string {
  if (locale === 'en') return translations[reason] ?? reason
  if (!(reason in translations)) return reason
  return reason.replaceAll('Token usage', '词元用量').replaceAll('聚合 Token 指标', '聚合词元指标').replaceAll('Token', '访问令牌').replaceAll('Shell', '命令解释器').replaceAll('App 专用密码', '应用专用密码').replaceAll('Todo', '待办')
}
