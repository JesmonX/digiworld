import React from 'react'
import { Button } from '@digiworld/design-system/react'
import { MoreHorizontal } from 'lucide-react'
import type { PluginSummary } from '@digiworld/plugin-sdk'

export function permissionLabel(id: string): string {
  const labels: Record<string, string> = {
    'background': '后台运行',
    'global-input': '读取全局键位事件',
    'plugin-storage': '本地插件存储',
    'filesystem:agent-session-data': '读取 Coding Agent 会话数据',
    'process:ssh': '使用系统 SSH',
    'process:shell': '运行已配置的系统 Shell',
    'network:openai': '访问 OpenAI Codex 服务',
    'network:imap': '访问 IMAP 邮箱服务',
    'network:github': '访问 GitHub 服务',
    'network:icloud': '访问 iCloud 日历服务',
    'notifications': '显示系统通知',
    'secret:mail-credentials': '保存邮箱授权码',
    'secret:github-token': '保存 GitHub Token',
    'secret:icloud-app-password': '保存 iCloud App 专用密码',
  }
  return labels[id] ?? id
}

export function stateLabel(plugin: PluginSummary): string {
  if (!plugin.enabled || plugin.state === 'disabled') return '已停用'
  const labels: Partial<Record<PluginSummary['state'], string>> = {
    installed: '已安装',
    starting: '启动中',
    running: '运行中',
    paused: '已暂停',
    failed: '异常',
  }
  return labels[plugin.state] ?? plugin.state
}

export function PluginManagement({
  plugin,
  busy,
  menuOpen,
  onMenuOpenChange,
  onToggleEnabled,
  onUninstall,
}: {
  plugin: PluginSummary
  busy: boolean
  menuOpen: boolean
  onMenuOpenChange(open: boolean | ((prev: boolean) => boolean)): void
  onToggleEnabled(): void
  onUninstall(): void
}) {
  return (
    <div className="plugin-management">
      <span className={`compact-status ${plugin.state}`}>{stateLabel(plugin)}</span>
      <Button className="secondary compact" disabled={busy} onClick={onToggleEnabled}>
        {plugin.enabled ? '停用' : '启用'}
      </Button>
      <div className="plugin-more">
        <Button
          className="secondary compact icon-button"
          aria-label="更多插件操作"
          aria-expanded={menuOpen}
          onClick={() => onMenuOpenChange(open => !open)}
        >
          <MoreHorizontal />
        </Button>
        {menuOpen && (
          <div className="plugin-more-menu" role="menu">
            <Button
              role="menuitem"
              className="danger-button"
              disabled={busy}
              onClick={() => {
                onMenuOpenChange(false)
                onUninstall()
              }}
            >
              移除插件
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
