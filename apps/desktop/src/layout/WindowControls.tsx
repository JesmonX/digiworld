import { useEffect, useMemo, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

export function WindowControls({ className = '' }: { className?: string }) {
  const appWindow = useMemo(() => isTauri() ? getCurrentWindow() : null, [])
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!appWindow) return
    let active = true
    let unlisten: (() => void) | undefined
    const refresh = async () => {
      const value = await appWindow.isMaximized()
      if (active) setMaximized(value)
    }
    void refresh().catch(() => {})
    void appWindow.onResized(() => void refresh().catch(() => {})).then(dispose => {
      if (active) unlisten = dispose
      else dispose()
    }).catch(() => {})
    return () => {
      active = false
      unlisten?.()
    }
  }, [appWindow])

  const toggleMaximize = async () => {
    if (!appWindow) return
    await appWindow.toggleMaximize()
    setMaximized(await appWindow.isMaximized())
  }

  return (
    <div className={`window-controls ${className}`} data-tauri-drag-region onDoubleClick={() => void toggleMaximize()}>
      <button
        aria-label="最小化"
        onDoubleClick={event => event.stopPropagation()}
        onClick={() => void appWindow?.minimize()}
      >
        <Minus />
      </button>
      <button
        aria-label={maximized ? '还原' : '最大化'}
        onDoubleClick={event => event.stopPropagation()}
        onClick={() => void toggleMaximize()}
      >
        {maximized ? <Copy /> : <Square />}
      </button>
      <button
        className="window-close"
        aria-label="关闭"
        onDoubleClick={event => event.stopPropagation()}
        onClick={() => void appWindow?.close()}
      >
        <X />
      </button>
    </div>
  )
}
