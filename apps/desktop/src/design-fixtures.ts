// Deterministic, synthetic presentation data. This module is only used by design.html.
const totals = { inputTokens: 1280000, outputTokens: 240000, cacheReadTokens: 960000, cacheWriteTokens: 12000, totalTokens: 1520000, cacheRate: .75 }
const days = Array.from({ length: 30 }, (_, index) => ({
  ...totals, day: new Date(Date.UTC(2026, 7, 7 + index)).toISOString().slice(0, 10),
  totalTokens: (index % 7 + 1) * 120000, cacheAvailable: true,
  models: [{ model: 'gpt-5.6-sol', totalTokens: (index % 7 + 1) * 120000 }],
}))
const account = { id: 'demo', provider: 'custom', label: '工作邮箱', email: 'hello@example.com', username: 'hello@example.com', host: 'imap.example.com', port: 993, useProxy: true, hasCredential: true, syncPhase: 'idle', indexed: 30, total: 30, baselineComplete: true, lastError: null, nextSyncAt: '2026-09-05T06:00:00Z' }
const messages = Array.from({ length: 18 }, (_, index) => ({ id: index + 1, accountId: 'demo', accountLabel: '工作邮箱', subject: index === 0 ? '设计评审 · 框架与插件一致性 / Typography & color review' : `项目进展与本周计划 ${index + 1}`, sender: 'Design Team <design@example.com>', receivedAt: '2026-09-05T04:00:00Z', snippet: '统一排版、主题和控件，让数据更容易阅读。', serverSeen: index > 2, locallyViewed: false, size: 1200, hasBody: true }))
export function fixture(method: string, payload: unknown = {}): unknown {
  if (new URLSearchParams(location.search).get('state') === 'error') throw new Error('演示：暂时无法加载，请重试')
  const empty = new URLSearchParams(location.search).get('state') === 'empty'
  if (method === 'heatmap.getLayout') return { layout: 'full' }
  if (method === 'heatmap.setLayout') return {}
  if (method === 'heatmap.snapshot') return { scope: 'today', paused: false, total: empty ? 0 : 12840, uniqueKeys: empty ? 0 : 42, topKey: empty ? null : 'Space', counts: empty ? {} : { Space: 4000, KeyA: 1900, KeyE: 2000, Enter: 180, ShiftLeft: 420, ControlLeft: 128 }, topTen: empty ? [] : [{ key: 'Space', count: 4000 }, { key: 'KeyE', count: 2000 }, { key: 'KeyA', count: 1900 }] }
  if (method === 'usage.getSettings') return { localAgents: ['codex', 'claude', 'pi'], localRoots: {}, sshSources: [], autoRefreshIntervalSeconds: 300, codexQuota: { sourceId: 'local', shellPreset: 'auto', preCommand: '', refreshIntervalSeconds: null } }
  if (method === 'usage.saveSettings') return payload
  if (method === 'usage.refreshStatus') return { running: false, completed: 1, total: 1, errors: [] }
  if (method === 'usage.startRefresh') return { running: false, completed: 1, total: 1, errors: [] }
  if (method === 'usage.snapshot') return { startDay: '2026-08-07', endDay: '2026-09-05', totals: empty ? { ...totals, inputTokens: 0, totalTokens: 0 } : totals, days: empty ? [] : days, breakdown: [], modelBreakdown: empty ? [] : [{ ...totals, sourceId: 'local', sourceLabel: '本机', agent: 'codex', model: 'gpt-5.6-sol' }] }
  if (method === 'usage.getCodexQuota') return { status: 'ready', sourceId: 'local', sourceLabel: '本机', fetchedAt: '2026-09-05T04:00:00Z', planType: 'Plus', windows: [{ usedPercent: 32, windowDurationMins: 300, resetsAt: null }, { usedPercent: 62, windowDurationMins: 10080, resetsAt: null }] }
  if (method === 'mail.sync.status') return { accounts: empty ? [] : [account], syncingAccountIds: [] }
  if (method === 'mail.settings.get') return { pollMinutes: 10 }
  if (method === 'mail.messages.list') return { items: empty ? [] : messages }
  if (method === 'mail.messages.get') return { ...messages.find(message => message.id === (payload as { id: number }).id), recipients: 'hello@example.com', bodyTruncated: false, body: '你好，\n\n这是可复现的界面评审数据。\n正文、表单与插件应使用同一套字体和主题。\n\nReadable typography makes a quiet interface useful.\n\n' + '长内容用于检查换行与滚动。'.repeat(30), attachments: [] }
  if (method === 'git.auth.status') return { connected: true, account: { login: 'jesmonx' } }
  if (method === 'git.settings.get') return { repositories: ['JesmonX/digiworld'], pollSeconds: 30 }
  if (method === 'git.repositories.list') return { items: [{ fullName: 'JesmonX/digiworld', private: false }] }
  if (method === 'git.runs.snapshot') return { login: 'jesmonx', runs: empty ? [] : [{ id: 1, repository: 'JesmonX/digiworld', name: 'Preview', title: 'Build three plugins', branch: 'main', sha: '548f11f1234', status: 'in_progress', url: 'https://github.com', createdAt: '2026-09-05T04:00:00Z', jobs: [{ id: 2, name: 'Windows build', status: 'in_progress' }] }] }
  if (method === 'servers.settings.get') return { devices: empty ? [] : [{ id: 'gpu1', label: 'GPU Server', host: 'gpu1', disks: ['/', '/data'], interfaces: ['eth0'], showCpu: true, showGpu: true, showTraffic: true, showDiskDevice: true, showGpuLabels: true, showGpuPower: true }] }
  if (method === 'servers.sample') return { devices: empty ? [] : [{ id: 'gpu1', label: 'GPU Server', hostname: 'compute-01', timestamp: 1788580800, uptimeSeconds: 864000, memory: { total: 68719476736, used: 34359738368 }, cpu: { logicalCores: 32, load1: 8.2, load5: 7.4 }, disks: [{ device: '/dev/nvme0n1p2', mount: '/', total: 1099511627776, used: 549755813888, percent: 50 }, { device: '/dev/sda1', mount: '/data', total: 4398046511104, used: 1099511627776, percent: 25 }], gpus: [{ index: 0, name: 'NVIDIA L40', utilization: 72, memoryUsedMiB: 30000, memoryTotalMiB: 46068, temperatureC: 61, powerDrawW: 180 }, { index: 1, name: 'NVIDIA RTX 4090', utilization: 15, memoryUsedMiB: 4096, memoryTotalMiB: 24576, temperatureC: 45, powerDrawW: null }], network: [{ name: 'eth0', receivedBytes: 42949672960, sentBytes: 10737418240 }], vnstat: {}, selection: { disks: ['/', '/data'], interfaces: ['eth0'], showCpu: true, showGpu: true, showTraffic: true, showDiskDevice: true, showGpuLabels: true, showGpuPower: true } }] }
  if (method === 'calendar.account.get') return { username: 'hello@icloud.com', serverUrl: 'https://caldav.icloud.com', selectedCalendars: ['/demo/calendar/'] }
  if (method === 'calendar.cached' || method === 'calendar.sync') return {
    calendars: [{ id: '/demo/calendar/', name: '个人', href: 'https://caldav.icloud.com/demo/calendar/', readOnly: false }],
    events: empty ? [] : [
      { id: 'event-0', calendarId: '/demo/calendar/', href: 'https://caldav.icloud.com/demo/calendar/event-0.ics', etag: '0', title: '昨日总结', start: '20260904T100000Z', end: '20260904T110000Z', allDay: false, location: '办公室', notes: '', recurring: false },
      { id: 'event-1', calendarId: '/demo/calendar/', href: 'https://caldav.icloud.com/demo/calendar/event-1.ics', etag: '1', title: '产品评审', start: '20260905T090000Z', end: '20260905T100000Z', allDay: false, location: '线上', notes: '', recurring: false },
      { id: 'event-2', calendarId: '/demo/calendar/', href: 'https://caldav.icloud.com/demo/calendar/event-2.ics', etag: '2', title: '架构讨论', start: '20260905T140000Z', end: '20260905T153000Z', allDay: false, location: '会议室 A', notes: '', recurring: false },
      { id: 'event-3', calendarId: '/demo/calendar/', href: 'https://caldav.icloud.com/demo/calendar/event-3.ics', etag: '3', title: '周一同步', start: '20260907T093000Z', end: '20260907T103000Z', allDay: false, location: '线上', notes: '', recurring: false },
      { id: 'event-4', calendarId: '/demo/calendar/', href: 'https://caldav.icloud.com/demo/calendar/event-4.ics', etag: '4', title: '十月计划', start: '20261002T100000Z', end: '20261002T110000Z', allDay: false, location: '线上', notes: '', recurring: false },
    ],
  }
  if (method === 'calendar.event.save') return payload
  if (method === 'calendar.event.delete') return { deleted: true }
  if (method === 'todo.list') return empty ? [] : [{ id: 'todo-1', title: '检查 Preview 构建', done: false, due: '2026-09-05', createdAt: '2026-09-04T00:00:00Z', updatedAt: '2026-09-04T00:00:00Z' }]
  throw new Error(`No design fixture for ${method}`)
}
