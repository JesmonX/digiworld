// Deterministic, synthetic presentation data. This module is only used by design.html.
const totals = { inputTokens: 1280000, outputTokens: 240000, cacheReadTokens: 960000, cacheWriteTokens: 12000, totalTokens: 1520000, cacheRate: .75 }
const days = Array.from({ length: 30 }, (_, index) => ({
  ...totals, day: new Date(Date.now() - (29-index)*86400000).toISOString().slice(0, 10),
  totalTokens: (index % 7 + 1) * 120000, cacheAvailable: true,
  models: [{ model: 'gpt-5.6-sol', totalTokens: (index % 7 + 1) * 120000 }],
}))
const account = { id: 'demo', provider: 'custom', label: '工作邮箱', email: 'hello@example.com', username: 'hello@example.com', host: 'imap.example.com', port: 993, useProxy: true, hasCredential: true, syncPhase: 'idle', indexed: 30, total: 30, baselineComplete: true, lastError: null, nextSyncAt: '2026-09-05T06:00:00Z' }
const messages = Array.from({ length: 18 }, (_, index) => ({ id: index + 1, accountId: 'demo', accountLabel: '工作邮箱', subject: index === 0 ? '设计评审 · 框架与插件一致性 / Typography & color review' : `项目进展与本周计划 ${index + 1}`, sender: 'Design Team <design@example.com>', receivedAt: '2026-09-05T04:00:00Z', snippet: '统一排版、主题和控件，让数据更容易阅读。', serverSeen: index > 2, locallyViewed: false, size: 1200, hasBody: true }))
const calendarDate = (offset: number, time: string) => {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  const ymd = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('')
  return `${ymd}T${time}00`
}
function baseFixture(method: string, payload: unknown = {}): unknown {
  if (new URLSearchParams(location.search).get('state') === 'error') throw new Error('演示：暂时无法加载，请重试')
  const empty = new URLSearchParams(location.search).get('state') === 'empty'
  if (method === 'heatmap.getLayout') return { layout: 'full' }
  if (method === 'heatmap.setLayout') return {}
  if (method === 'heatmap.snapshot') return { scope: 'today', paused: false, total: empty ? 0 : 12840, uniqueKeys: empty ? 0 : 42, topKey: empty ? null : 'Space', counts: empty ? {} : { Space: 4000, KeyA: 1900, KeyE: 2000, Enter: 180, ShiftLeft: 420, ControlLeft: 128 }, topTen: empty ? [] : [{ key: 'Space', count: 4000 }, { key: 'KeyE', count: 2000 }, { key: 'KeyA', count: 1900 }] }
  if (method === 'usage.getSettings') return { localAgents: ['codex', 'claude', 'pi'], localRoots: {}, sshSources: [], autoRefreshIntervalSeconds: 300, codexQuota: { sourceId: 'local', shellPreset: 'auto', preCommand: '', refreshIntervalSeconds: null } }
  if (method === 'usage.saveSettings') return payload
  if (method === 'usage.refreshStatus') return { running: false, completed: 1, total: 1, errors: [] }
  if (method === 'usage.startRefresh') return { running: false, completed: 1, total: 1, errors: [] }
  if (method === 'usage.snapshot') return { startDay: new Date(Date.now()-29*86400000).toISOString().slice(0,10), endDay: new Date().toISOString().slice(0,10), totals: empty ? { ...totals, inputTokens: 0, totalTokens: 0 } : totals, days: empty ? [] : days, breakdown: [], modelBreakdown: empty ? [] : [{ ...totals, sourceId: 'local', sourceLabel: '本机', agent: 'codex', model: 'gpt-5.6-sol' }] }
  if (method === 'usage.getCodexQuota') return { status: 'ready', sourceId: 'local', sourceLabel: '本机', fetchedAt: '2026-09-05T04:00:00Z', planType: 'Plus', windows: [{ usedPercent: 32, windowDurationMins: 300, resetsAt: null }, { usedPercent: 62, windowDurationMins: 10080, resetsAt: null }] }
  if (method === 'mail.sync.status') return { accounts: empty ? [] : [account], syncingAccountIds: [] }
  if (method === 'mail.settings.get') return { pollMinutes: 10 }
  if (method === 'mail.messages.list' || method === 'mail.messages.listV2') return { items: empty ? [] : messages }
  if (method === 'mail.messages.get') return { ...messages.find(message => message.id === (payload as { id: number }).id), recipients: 'hello@example.com', bodyTruncated: false, body: '你好，\n\n这是可复现的界面评审数据。\n正文、表单与插件应使用同一套字体和主题。\n\nReadable typography makes a quiet interface useful.\n\n' + '长内容用于检查换行与滚动。'.repeat(30), attachments: [] }
  if (method === 'git.auth.status') return { connected: true, account: { login: 'jesmonx' } }
  if (method === 'git.settings.get') return { repositories: ['JesmonX/digiworld'], pollSeconds: 30 }
  if (method === 'git.repositories.list') return { items: [{ fullName: 'JesmonX/digiworld', private: false }] }
  if (method === 'git.runs.snapshot') return { login: 'jesmonx', runs: empty ? [] : [{ id: 1, repository: 'JesmonX/digiworld', name: 'Preview', title: 'Build three plugins', branch: 'main', sha: '548f11f1234', status: 'in_progress', url: 'https://github.com', createdAt: '2026-09-05T04:00:00Z', jobs: [{ id: 2, name: 'Windows build', status: 'in_progress' }] }] }
  if (method === 'servers.settings.get') return { devices: empty ? [] : [{ id: 'gpu1', label: 'GPU Server', host: 'gpu1', disks: ['/', '/data'], interfaces: ['eth0'], showCpu: true, showGpu: true, showTraffic: true, showDiskDevice: true, showGpuLabels: true, showGpuPower: true, showGpuTemperature: true, gpuMemoryDisplay: 'both' }] }
  if (method === 'servers.sample') return { devices: empty ? [] : [{ id: 'gpu1', label: 'GPU Server', hostname: 'compute-01', timestamp: 1788580800, uptimeSeconds: 864000, memory: { total: 68719476736, used: 34359738368 }, cpu: { logicalCores: 32, load1: 8.2, load5: 7.4 }, disks: [{ device: '/dev/nvme0n1p2', mount: '/', total: 1099511627776, used: 549755813888, percent: 50 }, { device: '/dev/sda1', mount: '/data', total: 4398046511104, used: 1099511627776, percent: 25 }], gpus: [{ index: 0, name: 'NVIDIA L40', utilization: 72, memoryUsedMiB: 30000, memoryTotalMiB: 46068, temperatureC: 61, powerDrawW: 180 }, { index: 1, name: 'NVIDIA RTX 4090', utilization: 15, memoryUsedMiB: 4096, memoryTotalMiB: 24576, temperatureC: 45, powerDrawW: null }], network: [{ name: 'eth0', receivedBytes: 42949672960, sentBytes: 10737418240 }], vnstat: {}, selection: { disks: ['/', '/data'], interfaces: ['eth0'], showCpu: true, showGpu: true, showTraffic: true, showDiskDevice: true, showGpuLabels: true, showGpuPower: true, showGpuTemperature: true, gpuMemoryDisplay: 'both' } }] }
  if (method === 'calendar.account.get') return { username: 'hello@icloud.com', serverUrl: 'https://caldav.icloud.com', selectedCalendars: ['/demo/calendar/'] }
  if (method === 'calendar.cached' || method === 'calendar.sync') return {
    calendars: [{ id: '/demo/calendar/', name: '个人', href: 'https://caldav.icloud.com/demo/calendar/', readOnly: false }],
    events: empty ? [] : [
      { id: 'event-0', calendarId: '/demo/calendar/', href: 'https://caldav.icloud.com/demo/calendar/event-0.ics', etag: '0', title: '昨日总结', start: calendarDate(-1, '1000'), end: calendarDate(-1, '1100'), allDay: false, location: '办公室', notes: '', recurring: false },
      { id: 'event-1', calendarId: '/demo/calendar/', href: 'https://caldav.icloud.com/demo/calendar/event-1.ics', etag: '1', title: '产品评审', start: calendarDate(0, '0900'), end: calendarDate(0, '1000'), allDay: false, location: '线上', notes: '', recurring: false },
      { id: 'event-2', calendarId: '/demo/calendar/', href: 'https://caldav.icloud.com/demo/calendar/event-2.ics', etag: '2', title: '架构讨论', start: calendarDate(0, '1400'), end: calendarDate(0, '1530'), allDay: false, location: '会议室 A', notes: '', recurring: false },
      { id: 'event-3', calendarId: '/demo/calendar/', href: 'https://caldav.icloud.com/demo/calendar/event-3.ics', etag: '3', title: '后续同步', start: calendarDate(2, '0930'), end: calendarDate(2, '1030'), allDay: false, location: '线上', notes: '', recurring: false },
      { id: 'event-4', calendarId: '/demo/calendar/', href: 'https://caldav.icloud.com/demo/calendar/event-4.ics', etag: '4', title: '月度计划', start: calendarDate(14, '1000'), end: calendarDate(14, '1100'), allDay: false, location: '线上', notes: '', recurring: false },
    ],
  }
  if (method === 'calendar.event.save') return payload
  if (method === 'calendar.event.delete') return { deleted: true }
  if (method === 'todo.list') return empty ? [] : [{ id: 'todo-1', title: '检查 Preview 构建', done: false, due: '2026-09-05', createdAt: '2026-09-04T00:00:00Z', updatedAt: '2026-09-04T00:00:00Z' }]
  throw new Error(`No design fixture for ${method}`)
}

const saved = new Map<string, unknown>()
const stateParams = () => new URLSearchParams(location.search)
export function fixture(method: string, payload: unknown = {}): unknown {
  if (stateParams().get('state')==='error') throw new Error('演示：暂时无法加载，请重试')
  const p = payload as Record<string, any>
  if (method==='job.start') return {id:crypto.randomUUID(),state:'completed',result:fixture(p.method,p.payload)}
  if (method==='host.openExternal') { saved.set('openedUrl',p.url); return {opened:true} }
  if (method==='servers.settings.get') return saved.get(method) ?? baseFixture(method)
  if (method==='servers.settings.save') {saved.set('servers.settings.get',p.settings);return p.settings}
  if (method==='servers.layout.save') { const settings=fixture('servers.settings.get') as any;saved.set('servers.settings.get',{...settings,layout:p.layout});return p }
  if (method==='servers.sample') {
    const settings=fixture('servers.settings.get') as any
    const base=baseFixture(method) as any
    return {devices:settings.devices.filter((d:any)=>!p.id||d.id===p.id).map((d:any)=>({...base.devices[0],id:d.id,label:d.label,timestamp:Math.floor(Date.now()/1000),selection:d}))}
  }
  if(method==='servers.vnstat.setup') return {status:'ready',command:'vnstat --version',verification:'vnStat 已就绪'}
  if(method==='git.settings.get')return saved.get(method) ?? baseFixture(method)
  if(method==='git.settings.save'){saved.set('git.settings.get',p.settings);return p.settings}
  if(method==='git.runs.cached')return baseFixture('git.runs.snapshot')
  if(method==='git.jobs.get')return {jobs:[{id:20,name:'build',status:'completed',conclusion:'success'}]}
  if(method==='git.auth.remove'){saved.set('git.auth.status',{connected:false});return {removed:true}}
  if(method==='git.auth.save'){saved.set('git.auth.status',{connected:true,account:{login:'demo'}});return {login:'demo'}}
  if(method==='git.auth.status')return saved.get(method) ?? baseFixture(method)
  if(method==='calendar.account.get')return saved.has(method)?saved.get(method):stateParams().get('state')==='unconfigured'?null:baseFixture(method)
  if(method==='calendar.account.save'){saved.set('calendar.account.get',p.account);return (baseFixture('calendar.cached') as any).calendars}
  if(method==='calendar.selection.save'){const account=fixture('calendar.account.get') as any;const next={...account,selectedCalendars:p.calendarIds};saved.set('calendar.account.get',next);return next}
  if(method==='calendar.cached'||method==='calendar.sync')return saved.get('calendar.cached') ?? baseFixture(method)
  if(method==='calendar.event.save'||method==='calendar.event.delete'){
    const data=fixture('calendar.cached') as any
    const event={...p.event,id:p.event.id||crypto.randomUUID(),href:p.event.href||`https://caldav.icloud.com/demo/calendar/${crypto.randomUUID()}.ics`}
    const events=data.events.filter((e:any)=>e.id!==event.id)
    if(method.endsWith('save'))events.push(event)
    saved.set('calendar.cached',{...data,events});return event
  }
  if(method==='todo.list')return saved.get(method) ?? baseFixture(method)
  if(method==='todo.save'||method==='todo.delete'){
    const todo={...p.todo,id:p.todo?.id||p.id||crypto.randomUUID()}
    const todos=(fixture('todo.list') as any[]).filter(t=>t.id!==todo.id)
    if(method==='todo.save')todos.push(todo)
    saved.set('todo.list',todos);return todo
  }
  if(method==='mail.messages.listV2'){
    const data=baseFixture(method) as any
    const read=saved.get('mail-read') as number[] ?? []
    const items=data.items.map((m:any)=>({...m,locallyViewed:m.locallyViewed||read.includes(m.id)})).filter((m:any)=>(!p.accountId||m.accountId===p.accountId)&&(!p.query||m.subject.includes(p.query))&&(!p.unread||!m.serverSeen&&!m.locallyViewed))
    return {items,nextCursor:null}
  }
  if(method==='mail.messages.mark_all_read'||method==='mail.messages.mark_read'){const ids=p.ids ?? messages.map(m=>m.id);saved.set('mail-read',ids);return {ok:true,updated:ids.length}}
  if(method==='mail.accounts.remove'){saved.set('mail.sync.status',{accounts:[],syncingAccountIds:[]});return {removed:true}}
  if(method==='mail.sync.status')return saved.get(method) ?? baseFixture(method)
  if(method==='mail.accounts.save'||method==='mail.accounts.test'||method==='mail.sync.start'||method==='mail.settings.save')return {ok:true}
  if(method==='heatmap.setPaused'){saved.set('keyboard-paused',p.paused);return p}
  if(method==='heatmap.setLayout'){saved.set('keyboard-layout',p.layout);return p}
  if(method==='heatmap.getLayout')return {layout:saved.get('keyboard-layout') ?? 'full'}
  if(method==='heatmap.snapshot')return {...baseFixture(method) as object,scope:p.scope,paused:saved.get('keyboard-paused') ?? false}
  if(method==='usage.saveFilters')return p
  return baseFixture(method,payload)
}
