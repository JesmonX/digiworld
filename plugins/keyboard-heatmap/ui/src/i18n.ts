export type Locale = 'en' | 'zh'

export const DICTIONARY = {
  summaryAria: { en: 'Keyboard statistics summary', zh: '键盘统计摘要' },
  totalCount: { en: 'Total Strokes', zh: '总次数' },
  topKey: { en: 'Top Key', zh: '最高频' },
  scopeAria: { en: 'Time range', zh: '统计时间范围' },
  today: { en: 'Today', zh: '今天' },
  all: { en: 'All Time', zh: '全部' },
  pause: { en: 'Pause', zh: '暂停' },
  resume: { en: 'Resume', zh: '继续' },
  processing: { en: 'Processing...', zh: '处理中…' },
  layoutOptionsAria: { en: 'Keyboard layout options', zh: '键盘尺寸选项' },
  fullSize: { en: 'Full Size', zh: '全尺寸' },
  scrollAria: { en: 'Keyboard heatmap, scroll horizontally', zh: '键盘热力图，可横向滚动' },
  keyDistribution: { en: 'Key Distribution', zh: '按键分布' },
  low: { en: 'Low', zh: '低' },
  high: { en: 'High', zh: '高' },
  topKeys: { en: 'Top Keys', zh: '高频键位' },
  noData: { en: 'No data', zh: '暂无数据' },
  presses: { en: '{count} presses', zh: '{count} 次' },
  layoutFull: { en: '104-Key', zh: '104 键' },
  layout108: { en: '108-Key', zh: '108 键' },
  layout96: { en: '98-Key', zh: '98 键' },
  layoutTkl: { en: '87-Key', zh: '87 键' },
  layout75: { en: '84-Key', zh: '84 键' },
  layout65: { en: '68-Key', zh: '68 键' },
  layout60: { en: '61-Key', zh: '61 键' },
} as const

export function t(key: keyof typeof DICTIONARY, locale: Locale): string {
  return DICTIONARY[key]?.[locale] ?? DICTIONARY[key]?.en ?? key
}
