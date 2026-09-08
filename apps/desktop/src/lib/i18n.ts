export type Locale = 'en' | 'zh'

export const LOCALE_STORAGE_KEY = 'digiworld.locale.v1'
export const DEFAULT_LOCALE: Locale = 'en'

export const DICTIONARY = {
  // Navigation & Shell
  menu: { en: 'MENU', zh: '主菜单' },
  overview: { en: 'Overview', zh: '概览' },
  catalog: { en: 'Plugins Store', zh: '功能库' },
  installedSection: { en: 'PLUGINS', zh: '已安装插件' },
  systemSection: { en: 'SYSTEM', zh: '系统' },
  settings: { en: 'Settings', zh: '设置' },
  workspace: { en: 'Workspace', zh: '工作台' },
  collapseSidebar: { en: 'Collapse sidebar', zh: '收起侧栏' },
  expandSidebar: { en: 'Expand sidebar', zh: '展开侧栏' },
  workspaceNavLabel: { en: 'Workspace navigation', zh: '工作台导航' },
  installedPluginsNavLabel: { en: 'Installed plugins', zh: '已安装插件导航' },
  systemNavLabel: { en: 'System navigation', zh: '系统导航' },

  // Header & Greetings
  goodMorning: { en: 'Good Morning', zh: '早上好' },
  goodAfternoon: { en: 'Good Afternoon', zh: '下午好' },
  goodEvening: { en: 'Good Evening', zh: '晚上好' },
  subtitle: { en: 'Personal Digital Workspace', zh: '你的本地数字工作台' },
  toggleLanguage: { en: 'Toggle language', zh: '切换语言' },
  switchToChinese: { en: 'Switch to Chinese', zh: '切换为中文' },
  switchToEnglish: { en: 'Switch to English', zh: '切换为英文' },
  toggleTheme: { en: 'Toggle theme', zh: '切换主题' },
  switchToDarkMode: { en: 'Switch to Dark mode', zh: '切换为深色模式' },
  switchToLightMode: { en: 'Switch to Light mode', zh: '切换为浅色模式' },

  // HomePage / Overview
  summaryTitle: { en: 'Digiworld Status Summary', zh: 'Digiworld 状态摘要' },
  installedCount: { en: 'Installed', zh: '已安装' },
  installedUnit: { en: 'tools', zh: '个功能' },
  activeUnit: { en: 'active', zh: '运行中' },
  runningCount: { en: 'Active Workers', zh: '运行中' },
  allRunning: { en: 'All plugins operational', zh: '所有功能正在运行' },
  someRunning: { en: 'Status details below', zh: '其余功能状态见下方' },
  needsAttention: { en: 'Attention', zh: '需关注' },
  issuesFound: { en: 'Check failed plugins', zh: '请查看异常功能' },
  noIssues: { en: 'All systems normal', zh: '暂无异常' },
  needsCheck: { en: 'Needs Check', zh: '需要检查' },
  operational: { en: 'Operational', zh: '运行正常' },
  installedTools: { en: 'Installed Tools', zh: '已安装功能' },
  installedToolsDesc: { en: 'Select a tool to start working.', zh: '选择工具，继续你的工作。' },
  refresh: { en: 'Refresh', zh: '刷新' },
  addPlugin: { en: 'Add Tool', zh: '添加功能' },
  openTool: { en: 'Open to view tool', zh: '打开以查看功能' },
  noInstalledTitle: { en: 'No Tools Installed Yet', zh: '还没有安装功能' },
  noInstalledDesc: { en: 'Browse the catalog to customize your digital workspace.', zh: '从功能库选择需要的工具，建立你的本地工作台。' },
  browseCatalog: { en: 'Browse Store', zh: '浏览功能库' },

  // Statuses
  running: { en: 'Running', zh: '运行中' },
  starting: { en: 'Starting', zh: '启动中' },
  paused: { en: 'Paused', zh: '已暂停' },
  failed: { en: 'Error', zh: '异常' },
  disabled: { en: 'Disabled', zh: '已停用' },
  installed: { en: 'Installed', zh: '已安装' },

  // Settings
  settingsTitle: { en: 'Settings', zh: '设置' },
  settingsSubtitle: { en: 'Customize visual appearance, language, and runtime settings.', zh: '自定义界面视觉、语言偏好与运行时配置。' },
  appearanceTitle: { en: 'Appearance & Theme', zh: '界面外观与主题' },
  appearanceDesc: { en: 'Select between high-contrast Light and rich Dark themes.', zh: '在干净利落的高对比浅色与深邃现代的深色模式之间切换。' },
  lightTheme: { en: 'Light', zh: '浅色模式' },
  lightThemeDesc: { en: 'High contrast clean white canvas with subtle ambient blur', zh: '柔和微光底色与纯净白卡片，清晰护眼' },
  darkTheme: { en: 'Dark', zh: '深色模式' },
  darkThemeDesc: { en: 'Obsidian dark palette with glowing emerald indicators', zh: '曜石黑卡片与翡翠绿高亮，沉浸深邃' },
  themeColorTitle: { en: 'Theme Color', zh: '主题颜色' },
  themeColorDesc: { en: 'Select an accent color for highlights, badges, and charts.', zh: '设置应用的高亮色、状态角标与图表主色调。' },
  languageTitle: { en: 'Display Language', zh: '界面语言' },
  languageDesc: { en: 'Choose your default language across the app and plugins.', zh: '设置桌面主程序与插件的显示语言。' },
  langEn: { en: 'English (Default)', zh: 'English (默认)' },
  langZh: { en: 'Chinese (简体中文)', zh: '简体中文' },
  typographyTitle: { en: 'Interface Typography', zh: '界面字体' },
  typographyDesc: { en: 'Choose typography preset tailored for high-density tools.', zh: '选择清晰易读、信息密度合理的字体栈预设。' },
  fontWeightTitle: { en: 'Body Weight', zh: '正文字重' },
  fontWeightDesc: { en: 'Fine-tune typography weight hierarchy for your display.', zh: '微调整体正文字重与对比层级。' },
  glassTitle: { en: 'Panel Frost Effect', zh: '面板毛玻璃' },
  glassDesc: { en: 'Subtle translucent backdrop blur on floating panels and dialogs.', zh: '为结构面板与对话框启用背景高斯模糊。' },
  glassEnabled: { en: 'Enabled', zh: '已启用' },
  glassDisabled: { en: 'Disabled', zh: '已关闭' },
  generalTitle: { en: 'System & Startup', zh: '系统与启动' },
  generalDesc: { en: 'Configure system integration and background execution.', zh: '配置系统开机自启与网络代理。' },
  launchAtStartup: { en: 'Launch Digiworld on system startup', zh: '开机时自动启动 Digiworld' },
  proxyTitle: { en: 'Network Proxy', zh: '网络代理' },
  proxyDesc: { en: 'Manage HTTP/SOCKS proxy for remote services and plugin updates.', zh: '配置插件更新与远端数据访问的网络代理。' },
  updatesTitle: { en: 'Digiworld Updates', zh: 'Digiworld 更新' },
  updatesDesc: { en: 'Check for newer versions of tools and the host application', zh: '检查插件与主程序的新版本' },
  pluginUpdates: { en: 'Plugin Updates', zh: '插件更新' },
  coreUpdates: { en: 'Core Updates', zh: '主程序更新' },

  // Catalog
  availableTools: { en: 'Available Tools', zh: '可用功能' },
  searchPlugins: { en: 'Search plugins', zh: '搜索插件' },
  searchPluginsPlaceholder: { en: 'Search by plugin name', zh: '按插件名称搜索' },
  noPluginSearchResults: { en: 'No plugins match this search.', zh: '没有匹配的插件。' },
  refreshStore: { en: 'Refresh Store', zh: '刷新功能库' },
  statusInstalled: { en: 'Installed', zh: '已安装' },
  statusAvailable: { en: 'Available', zh: '可安装' },
  statusUnsupported: { en: 'Unsupported', zh: '暂未适配' },
  openBtn: { en: 'Open', zh: '打开' },
  installBtn: { en: 'Install', zh: '安装' },
  unsupportedBtn: { en: 'Not supported on current system', zh: '暂未适配当前系统' },
  unsupportedArchitecture: { en: 'Plugin not yet supported on architecture', zh: '插件暂未适配当前架构' },

  // Window controls
  minimizeWindow: { en: 'Minimize', zh: '最小化' },
  maximizeWindow: { en: 'Maximize', zh: '最大化' },
  restoreWindow: { en: 'Restore', zh: '还原' },
  closeWindow: { en: 'Close window', zh: '关闭窗口' },

  // Plugin Management
  enable: { en: 'Enable', zh: '启用' },
  disable: { en: 'Disable', zh: '停用' },
  moreActions: { en: 'More actions', zh: '更多插件操作' },
  removePlugin: { en: 'Remove Plugin', zh: '移除插件' },
  removeConfirm: { en: 'Remove "{name}"? Usage data will be preserved.', zh: '移除“{name}”？统计数据会保留。' },
  loadingPlugin: { en: 'Loading Plugin...', zh: '载入插件…' },
  loadingUi: { en: 'Loading Interface...', zh: '载入界面…' },
  pluginDisabled: { en: 'Plugin is Disabled', zh: '已停用' },
  close: { en: 'Close', zh: '关闭' },
  cancel: { en: 'Cancel', zh: '取消' },
  save: { en: 'Save', zh: '保存' },
  search: { en: 'Search', zh: '搜索' },
  testConnection: { en: 'Test Connection', zh: '测试连接' },
  testing: { en: 'Testing...', zh: '测试中…' },
  saving: { en: 'Saving...', zh: '保存中…' },
  proxySaved: { en: 'Proxy settings saved', zh: '代理设置已保存' },
  checkAllPlugins: { en: 'Check All Plugins', zh: '检查全部插件' },
  checkCore: { en: 'Check Digiworld Core', zh: '检查主程序' },
  checking: { en: 'Checking...', zh: '检查中…' },
  allPluginsUpToDate: { en: 'All plugins are up to date', zh: '所有插件均为最新版本' },
  coreUpToDate: { en: 'Digiworld is up to date', zh: '当前已是最新版本' },
  coreUpdateFound: { en: 'Digiworld Core Update Found', zh: '发现 Digiworld 主程序更新' },
  pluginUpdatesFound: { en: 'Plugin Updates Found', zh: '发现插件更新' },
  agreeAndUpdate: { en: 'Agree & Update', zh: '同意并更新' },

  // Update progress
  progressPreparing: { en: 'Preparing', zh: '准备中' },
  progressDownloading: { en: 'Downloading', zh: '下载中' },
  progressCompleted: { en: 'Completed', zh: '已完成' },
  progressFailed: { en: 'Failed', zh: '失败' },
  progressInstalling: { en: 'Installing', zh: '安装中' },
  updateProgress: { en: 'Update progress', zh: '更新进度' },
} as const

export type TranslationKey = keyof typeof DICTIONARY

export function loadLocale(storage?: Pick<Storage, 'getItem'>): Locale {
  try {
    const saved = (storage ?? window.localStorage).getItem(LOCALE_STORAGE_KEY)
    return saved === 'zh' ? 'zh' : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

export function saveLocale(locale: Locale, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(LOCALE_STORAGE_KEY, locale)
  } catch {}
}

export function t(key: TranslationKey, locale: Locale = DEFAULT_LOCALE): string {
  const item = DICTIONARY[key]
  if (!item) return key
  return item[locale] ?? item.en
}
