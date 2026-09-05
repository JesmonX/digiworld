import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import '@digiworld/design-system/tokens.css'
import '@digiworld/design-system/base.css'
import '@digiworld/typography/fonts.css'
import { Button, Card, Dialog, Input, Menu, Select, Segmented, Status, Switch, Textarea, Toolbar } from '@digiworld/design-system/react'
import App from './App'
import { api } from './lib/api'
import { fixture } from './design-fixtures'
import { getAccentTheme, pluginTheme } from './theme'

const names = ['keyboard-heatmap', 'agent-token-heatmap', 'mail-assistant']
const labels = ['键盘热力图', 'Agent Overview', '邮件助手']
const plugins = names.map((name, index) => ({ id: `io.github.jesmonx.digiworld.${name}`, version: '1.0.0', name: labels[index]!, description: '界面验证数据', enabled: true, state: 'running' as const, permissions: [], uiDesignVersion: 1 }))
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
  const theme = pluginTheme(getAccentTheme(new URLSearchParams(location.search).get('theme') as never))
  for (const [key, value] of Object.entries(theme)) if (value) document.documentElement.style.setProperty('--dw-' + key, value)
  return <main className="design-gallery"><h1>组件与状态</h1><Card><Toolbar><Button variant="primary">主要操作</Button><Button>次要操作</Button><Button variant="danger">删除</Button><Button disabled>不可用</Button><Button aria-busy="true">载入中…</Button></Toolbar></Card><Card><Toolbar><Input aria-label="名称" placeholder="输入名称" /><Select aria-label="选择"><option>选择内容</option></Select><Switch aria-label="开关" checked={checked} onCheckedChange={setChecked} /></Toolbar><Textarea aria-label="正文" placeholder="正文" /><Segmented><Button aria-pressed="true">今天</Button><Button>全部</Button></Segmented></Card><Status>暂无内容</Status><Status tone="error">暂时无法加载，请重试</Status><Status tone="success">已保存</Status><Menu aria-label="示例菜单"><Button role="menuitem">设置</Button></Menu><Button onClick={() => setOpen(true)}>打开对话框</Button><Dialog open={open} onClose={() => setOpen(false)} aria-label="示例对话框"><h2>对话框</h2><Input aria-label="对话框输入" /><Button onClick={() => setOpen(false)}>关闭</Button></Dialog></main>
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('gallery') ? <Gallery /> : <App />)
