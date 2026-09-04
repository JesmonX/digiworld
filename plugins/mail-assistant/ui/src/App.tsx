import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, ChevronDown, Inbox, LoaderCircle, Mail, Paperclip, Plus, RefreshCw,
  Search, Settings, Trash2, X,
} from 'lucide-react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import './styles.css'

const PLUGIN_ID = 'io.github.jesmonx.digiworld.mail-assistant'
const bridge = createPluginBridge(PLUGIN_ID)

type Provider = 'gmail' | 'qq' | '163' | 'custom'
interface Account {
  id: string; provider: Provider; label: string; email: string; username: string; host: string; port: number
  hasCredential: boolean; syncPhase: string; indexed: number; total: number; baselineComplete: boolean
  lastSuccessAt?: string; lastError?: string; nextSyncAt?: string
}
interface MailSummary {
  id: number; accountId: string; accountLabel: string; subject: string; sender: string; receivedAt?: string
  snippet: string; serverSeen: boolean; locallyViewed: boolean; size: number; hasBody: boolean
}
interface Attachment { filename: string; mimeType: string; size: number }
interface MailDetail extends MailSummary { recipients: string; body: string; bodyTruncated: boolean; attachments: Attachment[] }
interface MailPage { items: MailSummary[]; nextCursor?: number }
interface SyncStatus { accounts: Account[]; syncingAccountIds: string[] }
interface AccountDraft {
  id?: string; provider: Provider; label: string; email: string; username: string; host: string; port: number; secret: string
}

const providers: Record<Provider, { label: string; host: string; port: number }> = {
  gmail: { label: 'Gmail', host: 'imap.gmail.com', port: 993 },
  qq: { label: 'QQ 邮箱', host: 'imap.qq.com', port: 993 },
  '163': { label: '163 邮箱', host: 'imap.163.com', port: 993 },
  custom: { label: '自定义 IMAP', host: '', port: 993 },
}

const emptyDraft = (): AccountDraft => ({ provider: 'gmail', label: 'Gmail', email: '', username: '', host: 'imap.gmail.com', port: 993, secret: '' })
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const fmtDate = (value?: string) => value ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : ''
const fmtSize = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [syncing, setSyncing] = useState<string[]>([])
  const [accountId, setAccountId] = useState('')
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<MailSummary[]>([])
  const [nextCursor, setNextCursor] = useState<number | undefined>()
  const [selected, setSelected] = useState<MailDetail | null>(null)
  const [pollMinutes, setPollMinutes] = useState(10)
  const [draft, setDraft] = useState<AccountDraft | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const messageRequest = useRef(0)

  const refreshStatus = useCallback(async () => {
    const status = await bridge.request<SyncStatus>('mail.sync.status')
    setAccounts(status.accounts)
    setSyncing(status.syncingAccountIds)
  }, [])

  const loadMessages = useCallback(async (append = false, cursor = 0) => {
    const request = ++messageRequest.current
    const page = await bridge.request<MailPage>('mail.messages.list', {
      accountId: accountId || undefined, query: query.trim(), cursor,
    })
    if (request !== messageRequest.current) return
    setMessages(current => append ? [...current, ...page.items] : page.items)
    setNextCursor(page.nextCursor)
  }, [accountId, query])

  useEffect(() => {
    Promise.all([
      refreshStatus(),
      bridge.request<{ pollMinutes: number }>('mail.settings.get').then(value => setPollMinutes(value.pollMinutes)),
    ]).catch(reason => setError(errorText(reason)))
    bridge.ready()
  }, [refreshStatus])

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshStatus().then(() => loadMessages()).catch(reason => setError(errorText(reason)))
    }, syncing.length ? 2_000 : 15_000)
    return () => window.clearInterval(timer)
  }, [loadMessages, refreshStatus, syncing.length])

  useEffect(() => {
    const timer = window.setTimeout(() => loadMessages().catch(reason => setError(errorText(reason))), 180)
    return () => window.clearTimeout(timer)
  }, [loadMessages])

  useEffect(() => setSelected(null), [accountId, query])

  const currentAccount = useMemo(() => accounts.find(account => account.id === accountId), [accountId, accounts])

  const syncNow = async () => {
    setBusy('sync'); setError('')
    try {
      await bridge.request('mail.sync.start', { accountId: accountId || undefined })
      await refreshStatus()
    } catch (reason) { setError(errorText(reason)) } finally { setBusy('') }
  }

  const openMessage = async (message: MailSummary) => {
    setError('')
    try {
      const detail = await bridge.request<MailDetail>('mail.messages.get', { id: message.id })
      setSelected(detail)
      setMessages(items => items.map(item => item.id === message.id ? { ...item, locallyViewed: true } : item))
    } catch (reason) { setError(errorText(reason)) }
  }

  const changePoll = async (minutes: number) => {
    setPollMinutes(minutes)
    try { await bridge.request('mail.settings.save', { settings: { pollMinutes: minutes } }) }
    catch (reason) { setError(errorText(reason)) }
  }

  const editAccount = (account?: Account) => setDraft(account ? {
    id: account.id, provider: account.provider, label: account.label, email: account.email,
    username: account.username, host: account.host, port: account.port, secret: '',
  } : emptyDraft())

  const applyProvider = (provider: Provider) => {
    const preset = providers[provider]
    setDraft(current => current ? { ...current, provider, label: provider === 'custom' ? current.label : preset.label, host: preset.host, port: preset.port } : current)
  }

  const saveAccount = async (testOnly = false) => {
    if (!draft) return
    const account = { ...draft, username: draft.username || draft.email, secret: draft.secret || undefined }
    setBusy(testOnly ? 'test' : 'save'); setError(''); setNotice('')
    try {
      if (testOnly) {
        await bridge.request('mail.accounts.test', { account })
        setNotice('连接成功')
      } else {
        await bridge.request('mail.accounts.save', { account })
        setDraft(null)
        await refreshStatus()
      }
    } catch (reason) { setError(errorText(reason)) } finally { setBusy('') }
  }

  const removeAccount = async () => {
    if (!draft?.id || !window.confirm(`删除“${draft.label}”及其本地邮件缓存？`)) return
    setBusy('remove'); setError('')
    try {
      await bridge.request('mail.accounts.remove', { id: draft.id })
      if (accountId === draft.id) setAccountId('')
      setDraft(null); setSelected(null)
      await refreshStatus(); await loadMessages()
    } catch (reason) { setError(errorText(reason)) } finally { setBusy('') }
  }

  return <main className="mail-app">
    <header className="toolbar">
      <div className="search"><Search size={15} /><input aria-label="搜索邮件" placeholder="搜索发件人、主题或正文" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <label className="poll"><Settings size={15} /><span>每</span><select value={pollMinutes} onChange={event => void changePoll(Number(event.target.value))}>
        {[5, 10, 15, 30].map(value => <option key={value} value={value}>{value} 分钟</option>)}
      </select></label>
      <button className="secondary" onClick={() => void syncNow()} disabled={busy === 'sync'}>{busy === 'sync' ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}刷新</button>
      <button className="primary" onClick={() => editAccount()}><Plus size={16} />添加账号</button>
    </header>

    {error && <div className="error"><AlertCircle size={16} /><span>{error}</span><button onClick={() => setError('')}><X size={15} /></button></div>}
    <section className="workspace">
      <aside className="accounts">
        <button className={!accountId ? 'active' : ''} onClick={() => setAccountId('')}><Inbox size={17} /><span>全部收件箱</span></button>
        {accounts.map(account => <button key={account.id} className={accountId === account.id ? 'active' : ''} onClick={() => setAccountId(account.id)} onDoubleClick={() => editAccount(account)}>
          <Mail size={17} /><span><strong>{account.label}</strong><small title={account.lastError}>{syncing.includes(account.id) ? `${account.syncPhase === 'indexing' ? '索引' : '正文'} ${account.indexed}/${account.total}` : account.lastError || account.email}</small></span>
          {syncing.includes(account.id) ? <LoaderCircle className="spin" size={14} /> : account.lastError ? <span aria-label="同步失败" title={account.lastError}><AlertCircle className="warn" size={14} /></span> : null}
        </button>)}
        {currentAccount && <button className="manage" onClick={() => editAccount(currentAccount)}><Settings size={15} />账号设置</button>}
      </aside>

      <section className="message-list" aria-label="邮件列表">
        {accounts.length === 0 ? <Empty icon={<Mail />} title="添加邮箱账号" text="支持 Gmail、QQ、163 和自定义 IMAP。" action={() => editAccount()} /> : messages.length === 0 ? <Empty icon={<Inbox />} title={syncing.length ? '正在同步收件箱' : '没有找到邮件'} text={syncing.length ? '首次完整同步可在后台继续。' : '尝试刷新或更换搜索条件。'} /> : <>
          {messages.map(message => <button key={message.id} className={`mail-row ${selected?.id === message.id ? 'selected' : ''} ${!message.locallyViewed ? 'new' : ''}`} onClick={() => void openMessage(message)}>
            <span className="row-top"><strong>{message.sender || '未知发件人'}</strong><time>{fmtDate(message.receivedAt)}</time></span>
            <span className="subject">{message.subject || '（无主题）'}</span>
            <span className="snippet">{message.hasBody ? message.snippet : '正文正在后台同步…'}</span>
            <small>{message.accountLabel}{message.size ? ` · ${fmtSize(message.size)}` : ''}</small>
          </button>)}
          {nextCursor !== undefined && <button className="load-more" onClick={() => void loadMessages(true, nextCursor)}>加载更多<ChevronDown size={15} /></button>}
        </>}
      </section>

      <article className="detail">
        {!selected ? <Empty icon={<Mail />} title="选择一封邮件" text="正文以纯文本显示，不加载远程图片。" /> : <>
          <div className="detail-head"><h2>{selected.subject || '（无主题）'}</h2><div><strong>{selected.sender || '未知发件人'}</strong><time>{fmtDate(selected.receivedAt)}</time></div><p>收件人：{selected.recipients || '未提供'}</p></div>
          {selected.attachments.length > 0 && <div className="attachments">{selected.attachments.map((attachment, index) => <span key={`${attachment.filename}-${index}`}><Paperclip size={13} />{attachment.filename}<small>{fmtSize(attachment.size)}</small></span>)}</div>}
          <pre>{selected.body || (selected.hasBody ? '这封邮件没有纯文本正文。' : '正文正在后台同步…')}{selected.bodyTruncated ? '\n\n[正文已截断]' : ''}</pre>
        </>}
      </article>
    </section>

    {draft && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="邮箱账号设置">
      <header><div><h2>{draft.id ? '账号设置' : '添加邮箱账号'}</h2><p>使用应用专用密码或客户端授权码，凭据只保存到系统凭据库。</p></div><button className="icon" onClick={() => setDraft(null)}><X size={18} /></button></header>
      <div className="provider-tabs">{(Object.keys(providers) as Provider[]).map(provider => <button key={provider} className={draft.provider === provider ? 'active' : ''} onClick={() => applyProvider(provider)}>{providers[provider].label}</button>)}</div>
      <div className="form-grid">
        <label>显示名称<input value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} /></label>
        <label>邮箱地址<input type="email" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value, username: event.target.value })} /></label>
        <label>IMAP 主机<input disabled={draft.provider !== 'custom'} value={draft.host} onChange={event => setDraft({ ...draft, host: event.target.value })} /></label>
        <label>端口<input type="number" disabled={draft.provider !== 'custom'} value={draft.port} onChange={event => setDraft({ ...draft, port: Number(event.target.value) })} /></label>
        <label className="wide">用户名<input value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} placeholder="默认使用完整邮箱地址" /></label>
        <label className="wide">{draft.id ? '新授权码（留空则不修改）' : '应用专用密码 / 客户端授权码'}<input type="password" autoComplete="new-password" value={draft.secret} onChange={event => setDraft({ ...draft, secret: event.target.value })} /></label>
      </div>
      {notice && <div className="success">{notice}</div>}
      <footer>{draft.id ? <button className="danger" onClick={() => void removeAccount()} disabled={!!busy}><Trash2 size={15} />删除账号</button> : <span />}
        <div><button className="secondary" onClick={() => void saveAccount(true)} disabled={!!busy}>{busy === 'test' && <LoaderCircle className="spin" size={14} />}测试连接</button><button className="primary" onClick={() => void saveAccount(false)} disabled={!!busy}>{busy === 'save' && <LoaderCircle className="spin" size={14} />}保存并同步</button></div></footer>
    </section></div>}
  </main>
}

function Empty({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: () => void }) {
  return <div className="empty"><span>{icon}</span><strong>{title}</strong><p>{text}</p>{action && <button className="primary" onClick={action}><Plus size={15} />添加账号</button>}</div>
}
