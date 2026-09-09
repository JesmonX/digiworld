import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import '@digiworld/design-system/tokens.css'
import '@digiworld/design-system/base.css'
import '@digiworld/typography/fonts.css'
import { TooltipLayer, Button, Card, Dialog, Input, Menu, Select, Segmented, Status, Switch, Textarea, Toolbar } from '@digiworld/design-system/react'
import App from './App'
import { api } from './lib/api'
import { fixture } from './design-fixtures'
import { getAccentTheme, pluginTheme, type ColorSchemeId } from './theme'
import { DesignTemplate } from './design-template'

if (typeof window !== 'undefined' && !localStorage.getItem('digiworld.locale.v1')) {
  localStorage.setItem('digiworld.locale.v1', 'zh')
}

const names = ['keyboard-heatmap', 'agent-token-heatmap', 'mail-assistant', 'github-actions', 'server-monitor', 'calendar-todo', 'markpad']
const labels = ['键盘热力图', 'Agent Overview', '邮件助手', 'Git Actions', 'Servers', '日历与 Todo', 'MarkPad']
const localizedNames = [
  { zh: '键盘热力图', en: 'Keyboard Heatmap' },
  { zh: 'Agent 概览', en: 'Agent Overview' },
  { zh: '邮件助手', en: 'Mail Assistant' },
  { zh: 'Git 工作流', en: 'Git Actions' },
  { zh: '服务器监控', en: 'Server Monitor' },
  { zh: '日历与待办', en: 'Calendar & Todo' },
  { zh: 'MarkPad', en: 'MarkPad' },
]
const previewState = new URLSearchParams(location.search).get('state')
const plugins = names.map((name, index) => ({ id: `io.github.jesmonx.digiworld.${name}`, version: '1.0.0', name: labels[index]!, localizedNames: localizedNames[index]!, description: '界面验证数据', enabled: previewState !== 'disabled', state: previewState === 'disabled' ? 'disabled' as const : 'running' as const, permissions: [], uiDesignVersion: 1 }))
api.appState = async () => ({ version: 'Design preview', platform: 'windows', target: 'windows-x86_64', plugins, catalogSequence: 1, launchAtStartup: false })
api.catalog = async () => ({ schemaVersion: 1, sequence: 1, generatedAt: '2026-09-05', plugins: plugins.map(plugin => ({ ...plugin, author: 'Digiworld', minCoreVersion: '0.2.27', artifacts: [] })) })
api.pluginUi = async id => (await fetch(`/__design-plugin/${names.find(name => id.endsWith(name))!}`)).text()
api.pluginRequest = async <T,>(_id: string, method: string, payload?: unknown) => fixture(method, payload) as T
api.proxySettings = async () => ({ mode: 'system' })
api.onUpdateProgress = async () => () => {}
api.checkPluginUpdates = async () => []
api.checkCoreUpdate = async () => null

function Gallery() {
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState(false)
  const params = new URLSearchParams(location.search)
  const theme = pluginTheme(getAccentTheme(params.get('theme') as never, (params.get('scheme') ?? 'classic') as ColorSchemeId))
  for (const [key, value] of Object.entries(theme)) if (value) document.documentElement.style.setProperty('--dw-' + key, value)
  if (new URLSearchParams(location.search).has('template')) return <DesignTemplate />
  return <main className="design-gallery"><h1>组件与状态</h1><Card><Toolbar><Button variant="primary">主要操作</Button><Button>次要操作</Button><Button variant="danger">删除</Button><Button disabled>不可用</Button><Button aria-busy="true">载入中…</Button></Toolbar></Card><Card><Toolbar><Input aria-label="名称" placeholder="输入名称" /><Select aria-label="选择"><option>选择内容</option></Select><Switch aria-label="开关" checked={checked} onCheckedChange={setChecked} /></Toolbar><Textarea aria-label="正文" placeholder="正文" /><Segmented><Button aria-pressed="true">今天</Button><Button>全部</Button></Segmented></Card><Status>暂无内容</Status><Status tone="error">暂时无法加载，请重试</Status><Status tone="success">已保存</Status><Menu aria-label="示例菜单"><Button role="menuitem">设置</Button></Menu><Button onClick={() => setOpen(true)}>打开对话框</Button><Dialog open={open} onClose={() => setOpen(false)} aria-label="示例对话框"><h2>对话框</h2><Input aria-label="对话框输入" /><Button onClick={() => setOpen(false)}>关闭</Button></Dialog></main>
}
createRoot(document.getElementById('root')!).render(<><TooltipLayer />{new URLSearchParams(location.search).has('gallery') || new URLSearchParams(location.search).has('template') ? <Gallery /> : <App />}</>)
