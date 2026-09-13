import { useState } from 'react'
import { Button, Card, Dialog, Input, Panel, Status } from '@digiworld/design-system/react'
import { api } from '../lib/api'
import type { Locale } from '../lib/i18n'

const preferenceKeys = [
  'digiworld.theme.v2', 'digiworld.font-theme.v1', 'digiworld.font-weight.v1',
  'digiworld.glass.v1', 'digiworld.color-scheme.v1', 'digiworld.locale.v1',
]

export function ConfigTransfer({ locale }: { locale: Locale }) {
  const zh = locale === 'zh'
  const [mode, setMode] = useState<'export' | 'import' | null>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [imported, setImported] = useState(false)

  function close() {
    if (busy) return
    setMode(null)
    setPassword('')
    setConfirmation('')
  }

  async function transfer() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const preferences = Object.fromEntries(preferenceKeys.flatMap(key => {
        const value = localStorage.getItem(key)
        return value === null ? [] : [[key, value]]
      }))
      const result = await api.transferConfig(mode === 'import', password, preferences)
      if (!result) return
      if (mode === 'import') {
        for (const [key, value] of Object.entries(result.preferences)) {
          if (preferenceKeys.includes(key)) localStorage.setItem(key, value)
        }
        setImported(true)
      }
      setMessage([
        mode === 'import'
          ? (zh ? '配置已导入，点击刷新界面加载最新设置。' : 'Configuration imported. Refresh to load the restored settings.')
          : (zh ? '加密配置已导出。请妥善保管文件和备份密码。' : 'Encrypted configuration exported. Keep the file and password safe.'),
        ...result.warnings,
      ].join('\n'))
      setMode(null)
      setPassword('')
      setConfirmation('')
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  return <Panel className="settings-section" padding="none">
    <div className="settings-section-header"><h2>{zh ? '配置备份' : 'Configuration backup'}</h2></div>
    <div className="settings-section-body">
      <Card className="settings-card">
        <h3>{zh ? '一键导出 / 导入' : 'Export / Import'}</h3>
        <p>{zh ? '包含邮箱及授权码、GitHub Token、iCloud 凭据、SSH 服务器配置、代理和外观设置。文件使用密码加密。' : 'Includes mail accounts and passwords, GitHub token, iCloud credentials, SSH server settings, proxy and appearance. Backups are password encrypted.'}</p>
        <p>{zh ? 'SSH 配置包含应用内的服务器别名和路径；系统 SSH 配置与私钥需单独迁移。邮件、日历事件、笔记和统计历史不包含在内。' : 'SSH settings include in-app aliases and paths. Transfer system SSH configuration and private keys separately. Mail, calendar events, notes and usage history are excluded.'}</p>
        <div className="modal-actions">
          <Button onClick={() => { setError(''); setMode('export') }}>{zh ? '导出配置' : 'Export configuration'}</Button>
          <Button onClick={() => { setError(''); setMode('import') }}>{zh ? '导入配置' : 'Import configuration'}</Button>
        </div>
        {message && <Status tone="success"><span style={{ whiteSpace: 'pre-wrap' }}>{message}</span></Status>}
        {imported && <Button onClick={() => window.location.reload()}>{zh ? '刷新界面' : 'Refresh'}</Button>}
      </Card>
    </div>
    <Dialog open={mode !== null} onClose={close} className="modal" aria-labelledby="config-transfer-title">
      <h2 id="config-transfer-title">{mode === 'import' ? (zh ? '导入配置' : 'Import configuration') : (zh ? '导出配置' : 'Export configuration')}</h2>
      <p>{mode === 'import'
        ? (zh ? '导入会覆盖备份中同名配置与凭据，保留其他配置和业务数据。插件会短暂暂停后重新启动。请输入导出时设置的密码。' : 'Import overwrites matching settings and credentials while preserving other configuration and data. Plugins briefly pause and restart. Enter the backup password.')
        : (zh ? '设置至少 8 个字符的备份密码。忘记密码将无法恢复此备份。' : 'Choose a backup password with at least 8 characters. A forgotten password cannot be recovered.')}</p>
      <label>{zh ? '备份密码' : 'Backup password'}<Input type="password" autoComplete="off" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
      {mode === 'export' && <label>{zh ? '确认密码' : 'Confirm password'}<Input type="password" autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>}
      {error && <Status tone="error">{error}</Status>}
      <div className="modal-actions">
        <Button disabled={busy} onClick={close}>{zh ? '取消' : 'Cancel'}</Button>
        <Button disabled={busy || [...password].length < 8 || (mode === 'export' && password !== confirmation)} onClick={() => void transfer()}>
          {busy ? (zh ? '处理中…' : 'Working…') : (zh ? '选择文件并继续' : 'Choose file and continue')}
        </Button>
      </div>
    </Dialog>
  </Panel>
}
