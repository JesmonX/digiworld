export type Locale = 'en' | 'zh'

export const DICTIONARY = {
  connectTitle: { en: 'Connect GitHub', zh: '连接 GitHub' },
  connectSubtitle: { en: 'Personal access token is stored securely in system keychain. Requires repo Actions read permission.', zh: 'Token 只保存在系统凭据库，需要仓库 Actions 只读权限。' },
  tokenAria: { en: 'GitHub Token', zh: 'GitHub Token' },
  connectButton: { en: 'Connect Account', zh: '连接账号' },
  connecting: { en: 'Connecting...', zh: '连接中…' },
  toolbarTitle: { en: "{login}'s Actions", zh: '{login} 的 Actions' },
  updatedAt: { en: 'Updated {time}', zh: '更新于 {time}' },
  repos: { en: 'Repositories', zh: '仓库' },
  refresh: { en: 'Refresh', zh: '刷新' },
  noRuns: { en: 'No workflow runs triggered by you found', zh: '没有找到由你触发的运行' },
  noReposSelected: { en: 'Please select repositories to monitor first', zh: '请先选择仓库' },
  startedAt: { en: 'Started {time}', zh: '开始于 {time}' },
  attempt: { en: 'Attempt #{attempt}', zh: '第 {attempt} 次尝试' },
  settingsTitle: { en: 'Monitored Repositories', zh: '监控仓库' },
  settingsSubtitle: { en: 'Select repositories to display workflow runs.', zh: '选择需要显示运行状态的仓库。' },
  searchRepos: { en: 'Search repositories', zh: '搜索仓库' },
  searchPlaceholder: { en: 'Search owner/repo', zh: '搜索 owner/repo' },
  private: { en: 'Private', zh: '私有' },
  public: { en: 'Public', zh: '公开' },
  cancel: { en: 'Cancel', zh: '取消' },
  save: { en: 'Save', zh: '保存' },
  saving: { en: 'Saving...', zh: '保存中…' },
  closeError: { en: 'Dismiss error', zh: '关闭错误' },
  close: { en: 'Close', zh: '关闭' },
  queued: { en: 'Queued', zh: '排队中' },
  running: { en: 'Running', zh: '运行中' },
  success: { en: 'Success', zh: '成功' },
  failure: { en: 'Failure', zh: '失败' },
  cancelled: { en: 'Cancelled', zh: '已取消' },
  skipped: { en: 'Skipped', zh: '已跳过' },
  neutral: { en: 'Neutral', zh: '中立' },
  timed_out: { en: 'Timed out', zh: '超时' },
  action_required: { en: 'Action required', zh: '需要操作' },
  unknown: { en: 'Unknown', zh: '状态未知' },
} as const

export function t(key: keyof typeof DICTIONARY, locale: Locale): string {
  return DICTIONARY[key]?.[locale] ?? DICTIONARY[key]?.en ?? key
}
