import type { PluginSummary } from '@digiworld/plugin-sdk'

export function stateLabel(plugin: PluginSummary): string {
  if (!plugin.enabled || plugin.state === 'disabled') return '已停用'
  const labels: Partial<Record<PluginSummary['state'], string>> = {
    installed: '已安装', starting: '启动中', running: '运行中', paused: '已暂停', failed: '异常',
  }
  return labels[plugin.state] ?? plugin.state
}
