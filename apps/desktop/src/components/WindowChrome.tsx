import { useEffect, useMemo, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WindowControls } from '../layout/WindowControls'

export function WindowChrome() {
  const appWindow = useMemo(() => isTauri() ? getCurrentWindow() : null, [])
  const [, setMaximized] = useState(false)

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
    <header className="window-chrome" data-tauri-drag-region onDoubleClick={() => void toggleMaximize()}>
      <div className="window-drag-region" data-tauri-drag-region />
      <WindowControls />
    </header>
  )
}
