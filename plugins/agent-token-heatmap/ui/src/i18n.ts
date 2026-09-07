export type Locale = 'en' | 'zh'

export const DICTIONARY = {
  settings: { en: 'Settings', zh: '设置' },
  manualRefresh: { en: 'Refresh', zh: '手动刷新' },
  scanning: { en: 'Scanning...', zh: '扫描中…' },
  agents: { en: 'Agent', zh: 'Agent' },
  devices: { en: 'Device', zh: '设备' },
  localDevice: { en: 'Local', zh: '本机' },
  last7Days: { en: 'Last 7 Days', zh: '最近 7 天' },
  codexQuota: { en: 'Codex Quota', zh: 'Codex 限额' },
  dailyHeatmap: { en: 'Daily Heatmap', zh: '每日热力图' },
  to: { en: 'to', zh: '至' },
  all: { en: 'All', zh: '全部' },
  daysUnit: { en: 'Days', zh: '天' },
  totalTokens: { en: 'Total Tokens', zh: '总 Token' },
  inputTokens: { en: 'Input', zh: '输入' },
  outputTokens: { en: 'Output', zh: '输出' },
  cacheReadTokens: { en: 'Cache Read', zh: '缓存读取' },
  cacheWriteTokens: { en: 'Cache Write', zh: '缓存写入' },
  cacheRate: { en: 'Cache Rate', zh: '缓存率' },
  tokenMetric: { en: 'Metric', zh: '热力图指标' },
  sourceBreakdown: { en: 'Source Breakdown', zh: '来源明细' },
  dailyRanking: { en: 'Top Usage Days', zh: '每日用量排行' },
  modelBreakdown: { en: 'Model Breakdown', zh: '模型来源明细' },
  modelAggregated: { en: 'Token consumption grouped by model', zh: '按模型聚合 Token 用量' },
  low: { en: 'Low', zh: '低' },
  high: { en: 'High', zh: '高' },
  noData: { en: 'No data yet', zh: '暂无数据' },
  noDataDesc: { en: 'Click "Refresh" to start scanning.', zh: '点击“手动刷新”开始扫描。' },
  resetCards: { en: 'Reset Cards', zh: '重置卡' },
  availableResets: { en: '{count} available', zh: '{count} 张可用' },
  defaultResetCard: { en: 'Quota Reset Card', zh: '额度重置卡' },
  granted: { en: 'Granted:', zh: '获得：' },
  expires: { en: 'Expires:', zh: '到期：' },
  remaining: { en: 'Remaining', zh: '剩余' },
} as const

export function t(key: keyof typeof DICTIONARY, locale: Locale): string {
  return DICTIONARY[key]?.[locale] ?? DICTIONARY[key]?.en ?? key
}
