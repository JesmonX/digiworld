import {  PluginPage, PageToolbar, MasterDetail, EmptyState, FormField, Button, Input, Select, Card, Dialog, Status } from '@digiworld/design-system/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, ChevronDown, Inbox, LoaderCircle, Mail, MailCheck, Paperclip, Plus, RefreshCw,
  Search, Settings, Trash2, X,
} from 'lucide-react'
import { createPluginBridge } from '@digiworld/plugin-sdk'
import { t, type Locale } from './i18n'
import './styles.css'

const PLUGIN_ID = 'io.github.jesmonx.digiworld.mail-assistant'
const bridge = createPluginBridge(PLUGIN_ID)

type Provider = 'gmail' | 'qq' | '163' | 'custom'
interface Account {
  id: string; provider: Provider; label: string; email: string; username: string; host: string; port: number
  useProxy: boolean
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
  id?: string; provider: Provider; label: string; email: string; username: string; host: string; port: number; useProxy: boolean; secret: string
}

const providers: Record<Provider, { label: { en: string; zh: string }; host: string; port: number }> = {
  gmail: { label: { en: 'Gmail', zh: 'Gmail' }, host: 'imap.gmail.com', port: 993 },
  qq: { label: { en: 'QQ Mail', zh: 'QQ 邮箱' }, host: 'imap.qq.com', port: 993 },
  '163': { label: { en: '163 Mail', zh: '163 邮箱' }, host: 'imap.163.com', port: 993 },
  custom: { label: { en: 'Custom IMAP', zh: '自定义 IMAP' }, host: '', port: 993 },
}

const emptyDraft = (locale: Locale = 'en'): AccountDraft => ({ provider: 'gmail', label: providers.gmail.label[locale], email: '', username: '', host: 'imap.gmail.com', port: 993, useProxy: true, secret: '' })
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const fmtDate = (value?: string, locale: Locale = 'en') =>
  value
    ? new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : ''
const fmtSize = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    return (document.documentElement.lang?.startsWith('zh') ? 'zh' : 'en') as Locale
  })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [syncing, setSyncing] = useState<string[]>([])
  const [accountId, setAccountId] = useState('')
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<MailSummary[]>([])
  const [nextCursor, setNextCursor] = useState<number | undefined>()
  const [selected, setSelected] = useState<MailDetail | null>(null)
  const [viewMode, setViewMode] = useState<'html' | 'text'>('html')
  const [pollMinutes, setPollMinutes] = useState(10)
  const [draft, setDraft] = useState<AccountDraft | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [listBusy, setListBusy] = useState(false)
  const [detailBusy, setDetailBusy] = useState<number | null>(null)
  const messageRequest = useRef(0)
  const detailRequest = useRef(0)

  const refreshStatus = useCallback(async () => {
    const status = await bridge.request<SyncStatus>('mail.sync.status')
    setAccounts(status.accounts)
    setSyncing(status.syncingAccountIds)
  }, [])

  const loadMessages = useCallback(async (append = false, cursor = 0) => {
    const request = ++messageRequest.current
    setListBusy(true)
    try {
      const page = await bridge.request<MailPage>('mail.messages.list', {
        accountId: accountId || undefined, query: query.trim(), cursor,
      })
      if (request !== messageRequest.current) return
      setMessages(current => append ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
    } finally {
      if (request === messageRequest.current) setListBusy(false)
    }
  }, [accountId, query])

  useEffect(() => {
    Promise.all([
      refreshStatus(),
      bridge.request<{ pollMinutes: number }>('mail.settings.get').then(value => setPollMinutes(value.pollMinutes)),
    ]).catch(reason => setError(errorText(reason)))
    bridge.ready()

    const unlistenLocale = bridge.on('locale', (payload: unknown) => {
      const nextLocale = typeof payload === 'string' ? payload : (payload as { locale?: Locale })?.locale
      if (nextLocale === 'en' || nextLocale === 'zh') {
        setLocale(nextLocale)
      }
    })

    return () => {
      if (typeof unlistenLocale === 'function') {
        unlistenLocale()
      }
    }
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

  useEffect(() => {
    detailRequest.current += 1
    setDetailBusy(null)
    setSelected(null)
  }, [accountId, query])

  const currentAccount = useMemo(() => accounts.find(account => account.id === accountId), [accountId, accounts])

  const syncNow = async () => {
    setBusy('sync'); setError('')
    try {
      await bridge.request('mail.sync.start', { accountId: accountId || undefined })
      await refreshStatus()
    } catch (reason) { setError(errorText(reason)) } finally { setBusy('') }
  }

  const openMessage = async (message: MailSummary) => {
    const request = ++detailRequest.current
    setDetailBusy(message.id)
    setViewMode('html')
    setError('')
    try {
      const detail = await bridge.request<MailDetail>('mail.messages.get', { id: message.id })
      if (request !== detailRequest.current) return
      setSelected(detail)
      setMessages(items => items.map(item => item.id === message.id ? { ...item, locallyViewed: true } : item))
    } catch (reason) {
      if (request === detailRequest.current) setError(errorText(reason))
    } finally {
      if (request === detailRequest.current) setDetailBusy(null)
    }
  }

  const markAllRead = async () => {
    const confirmMsg = t('confirmMarkAllRead', locale).replace('{label}', currentAccount?.label ?? '')
    if (!currentAccount || !window.confirm(confirmMsg)) return
    const id = currentAccount.id
    setBusy('mark-all-read'); setError(''); setActionNotice(t('noticeMarking', locale))
    setMessages(items => items.map(item => item.accountId === id ? { ...item, locallyViewed: true } : item))
    setSelected(current => current && current.accountId === id ? { ...current, locallyViewed: true } : current)
    try {
      const result = await bridge.request<{ ok: boolean; updated: number }>('mail.messages.mark_all_read', { accountId: id })
      setActionNotice(result.updated > 0
        ? t('noticeMarkedCount', locale).replace('{label}', currentAccount.label).replace('{count}', String(result.updated))
        : t('noticeMarkedAll', locale).replace('{label}', currentAccount.label))
      await refreshStatus()
    } catch (reason) {
      setError(errorText(reason))
      await loadMessages().catch(() => undefined)
    } finally { setBusy('') }
  }

  const changePoll = async (minutes: number) => {
    setPollMinutes(minutes)
    try { await bridge.request('mail.settings.save', { settings: { pollMinutes: minutes } }) }
    catch (reason) { setError(errorText(reason)) }
  }

  const editAccount = (account?: Account) => setDraft(account ? {
    id: account.id, provider: account.provider, label: account.label, email: account.email,
    username: account.username, host: account.host, port: account.port, useProxy: account.useProxy ?? true, secret: '',
  } : emptyDraft(locale))

  const applyProvider = (provider: Provider) => {
    const preset = providers[provider]
    setDraft(current => current ? { ...current, provider, label: provider === 'custom' ? current.label : preset.label[locale], host: preset.host, port: preset.port } : current)
  }

  const saveAccount = async (testOnly = false) => {
    if (!draft) return
    const account = { ...draft, username: draft.username || draft.email, secret: draft.secret || undefined }
    setBusy(testOnly ? 'test' : 'save'); setError(''); setNotice('')
    try {
      if (testOnly) {
        await bridge.request('mail.accounts.test', { account })
        setNotice(t('testSuccess', locale))
      } else {
        await bridge.request('mail.accounts.save', { account })
        setDraft(null)
        await refreshStatus()
      }
    } catch (reason) { setError(errorText(reason)) } finally { setBusy('') }
  }

  const removeAccount = async () => {
    const confirmMsg = t('confirmDelete', locale).replace('{label}', draft?.label ?? '')
    if (!draft?.id || !window.confirm(confirmMsg)) return
    setBusy('remove'); setError('')
    try {
      await bridge.request('mail.accounts.remove', { id: draft.id })
      if (accountId === draft.id) setAccountId('')
      setDraft(null); setSelected(null)
      await refreshStatus(); await loadMessages()
    } catch (reason) { setError(errorText(reason)) } finally { setBusy('') }
  }

  return <PluginPage scroll="panes" className="mail-app">
    <PageToolbar className=" toolbar">
      <div className="search"><Search size={15} /><Input aria-label={t('searchAria', locale)} placeholder={t('searchPlaceholder', locale)} value={query} onChange={event => setQuery(event.target.value)} /></div>
      {currentAccount && <Button className="secondary mark-all" onClick={() => void markAllRead()} disabled={!!busy || syncing.includes(currentAccount.id)}><MailCheck size={15} />{busy === 'mark-all-read' ? t('marking', locale) : t('markAllRead', locale)}</Button>}
      <label className="poll"><Settings size={15} /><span>{t('pollEvery', locale)}</span><Select value={pollMinutes} onChange={event => void changePoll(Number(event.target.value))}>
        {[5, 10, 15, 30].map(value => <option key={value} value={value}>{t('pollMinutes', locale).replace('{minutes}', String(value))}</option>)}
      </Select></label>
      <Button className="secondary" onClick={() => void syncNow()} disabled={busy === 'sync'}>{busy === 'sync' ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{t('sync', locale)}</Button>
      <Button className="primary" onClick={() => editAccount()}><Plus size={16} />{t('addAccount', locale)}</Button>
    </PageToolbar>

    {error && <Status tone="error" className="error"><AlertCircle size={16} /><span>{error}</span><Button aria-label={locale === 'zh' ? '关闭错误提示' : 'Dismiss error'} onClick={() => setError('')}><X size={15} /></Button></Status>}
    {actionNotice && <div className="notice" role="status">{actionNotice}</div>}
    <section className={`workspace ${selected ? 'reading' : ''}`}>
      <aside className="dw-card accounts">
        <Button className={!accountId ? 'active' : ''} onClick={() => setAccountId('')}><Inbox size={17} /><span>{t('allInboxes', locale)}</span></Button>
        {accounts.map(account => <Button key={account.id} title={`${account.label} · ${account.email}${account.lastError ? ` · ${account.lastError}` : ''}`} className={accountId === account.id ? 'active' : ''} onClick={() => { setAccountId(account.id); setActionNotice('') }} onDoubleClick={() => editAccount(account)}>
          <Mail size={17} /><span><strong data-tooltip={account.label}>{account.label}</strong><small data-tooltip={account.lastError || account.email}>{syncing.includes(account.id) ? `${account.syncPhase === 'indexing' ? t('indexing', locale) : t('bodyPhase', locale)} ${account.indexed}/${account.total}` : account.lastError || account.email}</small></span>
          {syncing.includes(account.id) ? <LoaderCircle className="spin" size={14} /> : account.lastError ? <span aria-label={t('syncFailed', locale)} data-tooltip={account.lastError || account.email}><AlertCircle className="warn" size={14} /></span> : null}
        </Button>)}
        {currentAccount && <Button className="manage" onClick={() => editAccount(currentAccount)}><Settings size={15} />{t('accountSettings', locale)}</Button>}
      </aside>

      <MasterDetail selected={Boolean(selected)} onBack={() => setSelected(null)} backLabel={t('backToList', locale)} list={<section className="dw-card message-list" aria-label={t('messageListAria', locale)} aria-busy={listBusy}>
        {listBusy && messages.length === 0 ? <Empty icon={<LoaderCircle className="spin" />} title={t('loadingMessages', locale)} text={t('readingCache', locale)} /> : accounts.length === 0 ? <Empty icon={<Mail />} title={t('addEmailAccount', locale)} text={t('supportedProviders', locale)} action={() => editAccount()} actionLabel={t('addAccount', locale)} /> : messages.length === 0 ? <Empty icon={<Inbox />} title={syncing.length ? t('syncingInbox', locale) : t('noMessages', locale)} text={syncing.length ? t('syncBackgroundNotice', locale) : t('tryRefreshNotice', locale)} /> : <>
          {messages.map(message => <Button key={message.id} title={`${message.sender} · ${message.subject}`} className={`mail-row ${selected?.id === message.id ? 'selected' : ''} ${(!message.serverSeen && !message.locallyViewed) ? 'new' : ''}`} aria-busy={detailBusy === message.id} onClick={() => void openMessage(message)}>
            <span className="row-top"><strong data-tooltip={message.sender}>{message.sender || t('unknownSender', locale)}</strong><time>{fmtDate(message.receivedAt, locale)}</time></span>
            <span className="subject">{message.subject || t('noSubject', locale)}</span>
            <span className="snippet">{message.hasBody ? message.snippet : t('bodySyncing', locale)}</span>
            <small>{message.accountLabel}{message.size ? ` · ${fmtSize(message.size)}` : ''}</small>
          </Button>)}
          {nextCursor !== undefined && <Button className="load-more" onClick={() => void loadMessages(true, nextCursor)}>{t('loadMore', locale)}<ChevronDown size={15} /></Button>}
        </>}
      </section>} detail={<Card className="dw-card detail">
        {!selected ? <Empty icon={<Mail />} title={t('selectEmail', locale)}  /> : (() => {
          const hasHtml = isHtmlContent(selected.body)
          return <>
            <div className="detail-head">
              <div className="detail-title-row">
                <h2>{selected.subject || t('noSubject', locale)}</h2>
                {hasHtml && (
                  <div className="dw-segmented view-toggle">
                    <Button className={viewMode === 'html' ? 'active' : ''} onClick={() => setViewMode('html')}>{t('viewHtml', locale)}</Button>
                    <Button className={viewMode === 'text' ? 'active' : ''} onClick={() => setViewMode('text')}>{t('viewText', locale)}</Button>
                  </div>
                )}
              </div>
              <div><strong>{selected.sender || t('unknownSender', locale)}</strong><time>{fmtDate(selected.receivedAt, locale)}</time></div>
              <p>{t('to', locale).replace('{recipients}', selected.recipients || t('notProvided', locale))}</p>
            </div>
            {selected.attachments.length > 0 && <div className="attachments">{selected.attachments.map((attachment, index) => <span key={`${attachment.filename}-${index}`}><Paperclip size={13} />{attachment.filename}<small>{fmtSize(attachment.size)}</small></span>)}</div>}
            {hasHtml && viewMode === 'html' ? (
              <iframe
                className="mail-html-frame"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                srcDoc={buildEmailHtmlDoc(selected.body)}
                title={selected.subject || t('noSubject', locale)}
              />
            ) : (
              <pre className="mail-body-plain">
                {(hasHtml ? stripHtml(selected.body) : selected.body) || (selected.hasBody ? t('noPlainText', locale) : t('bodySyncing', locale))}
              </pre>
            )}
            {selected.bodyTruncated && <div className="mail-truncated-notice">{t('bodyTruncated', locale)}</div>}
          </>
        })()}
      </Card>} />
    </section>

    {draft && <Dialog open onClose={() => { if (!busy) setDraft(null) }} className="modal" aria-label={t('dialogAria', locale)}>
      <header><div><h2>{draft.id ? t('dialogTitleEdit', locale) : t('dialogTitleAdd', locale)}</h2><p>{t('dialogSubtitle', locale)}</p></div><Button className="icon" aria-label={locale === 'zh' ? '关闭' : 'Close'} onClick={() => setDraft(null)}><X size={18} /></Button></header>
      <div className="dw-segmented provider-tabs">{(Object.keys(providers) as Provider[]).map(provider => <Button key={provider} className={draft.provider === provider ? 'active' : ''} onClick={() => applyProvider(provider)}>{providers[provider].label[locale]}</Button>)}</div>
      <div className="form-grid">
        <FormField label={t('displayName', locale)}><Input value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} /></FormField>
        <label>{t('emailAddress', locale)}<Input type="email" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value, username: event.target.value })} /></label>
        <label>{t('imapHost', locale)}<Input disabled={draft.provider !== 'custom'} value={draft.host} onChange={event => setDraft({ ...draft, host: event.target.value })} /></label>
        <label>{t('port', locale)}<Input type="number" disabled={draft.provider !== 'custom'} value={draft.port} onChange={event => setDraft({ ...draft, port: Number(event.target.value) })} /></label>
        <label className="wide">{t('username', locale)}<Input value={draft.username} onChange={event => setDraft({ ...draft, username: event.target.value })} placeholder={t('usernamePlaceholder', locale)} /></label>
        <label className="wide">{draft.id ? t('secretLabelEdit', locale) : t('secretLabelAdd', locale)}<Input type="password" autoComplete="new-password" value={draft.secret} onChange={event => setDraft({ ...draft, secret: event.target.value })} /></label>
        <label className="proxy-option wide"><span><strong>{t('useProxy', locale)}</strong><small>{t('useProxyDesc', locale)}</small></span><Input type="checkbox" aria-label={t('useProxyAria', locale)} checked={draft.useProxy} onChange={event => setDraft({ ...draft, useProxy: event.target.checked })} /></label>
      </div>
      {notice && <Status tone="success" className="success">{notice}</Status>}
      <footer>{draft.id ? <Button className="danger" onClick={() => void removeAccount()} disabled={!!busy}><Trash2 size={15} />{t('deleteAccount', locale)}</Button> : <span />}
        <div><Button className="secondary" onClick={() => void saveAccount(true)} disabled={!!busy}>{busy === 'test' && <LoaderCircle className="spin" size={14} />}{busy === 'test' ? t('testing', locale) : t('testConnection', locale)}</Button><Button className="primary" onClick={() => void saveAccount(false)} disabled={!!busy}>{busy === 'save' && <LoaderCircle className="spin" size={14} />}{busy === 'save' ? t('saving', locale) : t('saveAndSync', locale)}</Button></div></footer>
    </Dialog>}
  </PluginPage>
}

function Empty({ icon, title, text, action, actionLabel }: { icon: React.ReactNode; title: string; text?: string; action?: () => void; actionLabel?: string }) {
  return <EmptyState icon={icon} title={title} description={text} action={action && <Button className="primary" onClick={action}><Plus size={15} />{actionLabel || 'Add Account'}</Button>} />
}

function isHtmlContent(content?: string): boolean {
  if (!content) return false
  return /<(?:!DOCTYPE|html|head|body|div|p|span|table|tr|td|ul|ol|li|br|h[1-6]|b|i|strong|em|a|section|article)\b/i.test(content)
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function buildEmailHtmlDoc(html: string): string {
  const baseTag = '<base target="_blank" rel="noopener noreferrer">'
  const defaultStyle = '<style>:root{color-scheme:light dark;}body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;word-break:break-word;}img{max-width:100%;height:auto;}pre,code{white-space:pre-wrap;word-break:break-word;}</style>'
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, `$&${baseTag}${defaultStyle}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, `$&<head>${baseTag}${defaultStyle}</head>`)
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${baseTag}${defaultStyle}</head><body>${html}</body></html>`
}

