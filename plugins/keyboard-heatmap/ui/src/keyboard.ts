export interface KeyDefinition {
  id: string
  label: string
  row: number
  column: number
  rowSpan?: number
  columnSpan?: number
}

export type KeyboardLayoutId = '108' | 'full' | '96' | 'tkl' | '75' | '65' | '60'

export interface KeyboardLayout {
  id: KeyboardLayoutId
  label: string
  keyCount: number
  description: string
  minWidth: number
  /** Total grid tracks. Each 1u key spans four tracks. */
  tracks: number
  rows: number
  keys: KeyDefinition[]
  preview: number[][]
}

/** Grid resolution: four quarter-unit tracks per 1u key. */
const UNIT = 4

interface KeySpec {
  id: string
  label: string
  width: number
  height: number
}

/** A row item is either a key or a spacer measured in key units. */
type RowItem = KeySpec | number

const k = (id: string, label: string, width = 1, height = 1): KeySpec => ({ id, label, width, height })

function placeRows(rows: RowItem[][], startRow: number, startColumn: number): KeyDefinition[] {
  const keys: KeyDefinition[] = []
  rows.forEach((row, rowIndex) => {
    let cursor = Math.round(startColumn * UNIT)
    for (const item of row) {
      if (typeof item === 'number') {
        cursor += Math.round(item * UNIT)
        continue
      }
      const columnSpan = Math.round(item.width * UNIT)
      const definition: KeyDefinition = {
        id: item.id,
        label: item.label,
        row: startRow + rowIndex,
        column: cursor + 1,
        columnSpan,
      }
      if (item.height > 1) definition.rowSpan = item.height
      keys.push(definition)
      cursor += columnSpan
    }
  })
  return keys
}

// Standard ANSI main block: 15u wide, five rows, 61 keys.
const alphaRows: RowItem[][] = [
  [
    k('Backquote', '`'), k('Digit1', '1'), k('Digit2', '2'), k('Digit3', '3'), k('Digit4', '4'),
    k('Digit5', '5'), k('Digit6', '6'), k('Digit7', '7'), k('Digit8', '8'), k('Digit9', '9'),
    k('Digit0', '0'), k('Minus', '-'), k('Equal', '='), k('Backspace', 'Backspace', 2),
  ],
  [
    k('Tab', 'Tab', 1.5), k('KeyQ', 'Q'), k('KeyW', 'W'), k('KeyE', 'E'), k('KeyR', 'R'),
    k('KeyT', 'T'), k('KeyY', 'Y'), k('KeyU', 'U'), k('KeyI', 'I'), k('KeyO', 'O'), k('KeyP', 'P'),
    k('BracketLeft', '['), k('BracketRight', ']'), k('Backslash', '\\', 1.5),
  ],
  [
    k('CapsLock', 'Caps', 1.75), k('KeyA', 'A'), k('KeyS', 'S'), k('KeyD', 'D'), k('KeyF', 'F'),
    k('KeyG', 'G'), k('KeyH', 'H'), k('KeyJ', 'J'), k('KeyK', 'K'), k('KeyL', 'L'),
    k('Semicolon', ';'), k('Quote', "'"), k('Enter', 'Enter', 2.25),
  ],
  [
    k('ShiftLeft', 'Shift', 2.25), k('KeyZ', 'Z'), k('KeyX', 'X'), k('KeyC', 'C'), k('KeyV', 'V'),
    k('KeyB', 'B'), k('KeyN', 'N'), k('KeyM', 'M'), k('Comma', ','), k('Period', '.'),
    k('Slash', '/'), k('ShiftRight', 'Shift', 2.75),
  ],
  [
    k('ControlLeft', 'Ctrl', 1.25), k('MetaLeft', 'Win', 1.25), k('AltLeft', 'Alt', 1.25),
    k('Space', '', 6.25), k('AltRight', 'Alt', 1.25), k('MetaRight', 'Win', 1.25),
    k('ContextMenu', 'Menu', 1.25), k('ControlRight', 'Ctrl', 1.25),
  ],
]

// Compact function row for 75% / 96% boards: 13 keys across exactly 15u.
const functionRowCompact: RowItem[] = [
  k('Escape', 'Esc'), 0.5,
  k('F1', 'F1'), k('F2', 'F2'), k('F3', 'F3'), k('F4', 'F4'), 0.5,
  k('F5', 'F5'), k('F6', 'F6'), k('F7', 'F7'), k('F8', 'F8'), 0.5,
  k('F9', 'F9'), k('F10', 'F10'), k('F11', 'F11'), k('F12', 'F12'), 0.5,
]

// Full function row for TKL / full-size boards: 16 keys across 18.5u.
const functionRowFull: RowItem[] = [
  k('Escape', 'Esc'), 1,
  k('F1', 'F1'), k('F2', 'F2'), k('F3', 'F3'), k('F4', 'F4'), 0.5,
  k('F5', 'F5'), k('F6', 'F6'), k('F7', 'F7'), k('F8', 'F8'), 0.5,
  k('F9', 'F9'), k('F10', 'F10'), k('F11', 'F11'), k('F12', 'F12'), 0.5,
  k('PrintScreen', 'PrtSc'), k('ScrollLock', 'ScrLk'), k('Pause', 'Pause'),
]

// 108-key boards add four media keys above the numpad.
const functionRowMedia: RowItem[] = [
  ...functionRowFull, 0.5,
  k('VolumeMute', 'Mute'), k('VolumeDown', 'Vol-'), k('VolumeUp', 'Vol+'), k('MediaPlayPause', 'Play'),
]

// Full navigation cluster: 10 keys across 3u.
const navRows: RowItem[][] = [
  [k('Insert', 'Ins'), k('Home', 'Home'), k('PageUp', 'PgUp')],
  [k('Delete', 'Del'), k('End', 'End'), k('PageDown', 'PgDn')],
  [],
  [1, k('ArrowUp', '↑'), 1],
  [k('ArrowLeft', '←'), k('ArrowDown', '↓'), k('ArrowRight', '→')],
]

// 65% navigation cluster: Del/PgUp/PgDn plus arrows, 7 keys across 3u.
const compactNavRows: RowItem[][] = [
  [k('Delete', 'Del'), k('PageUp', 'PgUp')],
  [k('PageDown', 'PgDn')],
  [],
  [1, k('ArrowUp', '↑'), 1],
  [k('ArrowLeft', '←'), k('ArrowDown', '↓'), k('ArrowRight', '→')],
]

// 96% boards tuck Del/PgUp/PgDn into a centred column next to the numpad.
const compactNumpadNavRows: RowItem[][] = [
  [1.5, k('Delete', 'Del')],
  [1.5, k('PageUp', 'PgUp')],
  [1.5, k('PageDown', 'PgDn')],
  [1.5, k('ArrowUp', '↑')],
  [k('ArrowLeft', '←'), k('ArrowDown', '↓'), k('ArrowRight', '→')],
]

// Standard numeric keypad: 17 keys across 4u, with tall + and Enter.
const numpadRows: RowItem[][] = [
  [k('NumLock', 'Num'), k('NumpadDivide', '/'), k('NumpadMultiply', '×'), k('NumpadSubtract', '−')],
  [k('Numpad7', '7'), k('Numpad8', '8'), k('Numpad9', '9'), k('NumpadAdd', '+', 1, 2)],
  [k('Numpad4', '4'), k('Numpad5', '5'), k('Numpad6', '6')],
  [k('Numpad1', '1'), k('Numpad2', '2'), k('Numpad3', '3'), k('NumpadEnter', 'Enter', 1, 2)],
  [k('Numpad0', '0', 2), k('NumpadDecimal', '.')],
]

export const numpadKeys: KeyDefinition[] = placeRows(numpadRows, 1, 0)

interface LayoutSpec {
  id: KeyboardLayoutId
  label: string
  keyCount: number
  description: string
  minWidth: number
  tracks: number
  rows: number
  preview: number[][]
  functionRow?: RowItem[]
  alphaStartRow: number
  navColumn?: number
  navRows?: RowItem[][]
  numpadColumn?: number
  numpadRows?: RowItem[][]
}

function buildLayout(spec: LayoutSpec): KeyboardLayout {
  const keys: KeyDefinition[] = []
  if (spec.functionRow) keys.push(...placeRows([spec.functionRow], 1, 0))
  keys.push(...placeRows(alphaRows, spec.alphaStartRow, 0))
  if (spec.navRows && spec.navColumn !== undefined) {
    keys.push(...placeRows(spec.navRows, spec.alphaStartRow, spec.navColumn))
  }
  if (spec.numpadRows && spec.numpadColumn !== undefined) {
    keys.push(...placeRows(spec.numpadRows, spec.alphaStartRow, spec.numpadColumn))
  }
  return {
    id: spec.id,
    label: spec.label,
    keyCount: spec.keyCount,
    description: spec.description,
    minWidth: spec.minWidth,
    tracks: spec.tracks,
    rows: spec.rows,
    keys,
    preview: spec.preview,
  }
}

export const keyboardLayouts: KeyboardLayout[] = [
  buildLayout({
    id: '108', label: '108 键', keyCount: 108, minWidth: 920, tracks: 92, rows: 7,
    description: '全尺寸 · 独立功能区、数字小键盘与媒体键',
    functionRow: functionRowMedia, alphaStartRow: 3,
    navColumn: 15.5, navRows, numpadColumn: 19, numpadRows,
    preview: [[15, 3, 5], [15, 3, 4], [15, 3, 4], [15, 3, 4]],
  }),
  buildLayout({
    id: 'full', label: '104 键', keyCount: 104, minWidth: 900, tracks: 92, rows: 7,
    description: '全尺寸 · 独立功能区与数字小键盘',
    functionRow: functionRowFull, alphaStartRow: 3,
    navColumn: 15.5, navRows, numpadColumn: 19, numpadRows,
    preview: [[15, 3, 4], [15, 3, 4], [15, 3, 4], [15, 3, 4]],
  }),
  buildLayout({
    id: '96', label: '98 键', keyCount: 98, minWidth: 860, tracks: 90, rows: 7,
    description: '96% · 紧凑全尺寸，保留数字小键盘与方向键',
    functionRow: functionRowCompact, alphaStartRow: 3,
    navColumn: 15.5, navRows: compactNumpadNavRows, numpadColumn: 18.5, numpadRows,
    preview: [[15, 3, 4], [15, 3, 4], [15, 3, 4], [15, 3, 4]],
  }),
  buildLayout({
    id: 'tkl', label: '87 键', keyCount: 87, minWidth: 740, tracks: 74, rows: 7,
    description: 'TKL · 保留功能键与导航区',
    functionRow: functionRowFull, alphaStartRow: 3,
    navColumn: 15.5, navRows,
    preview: [[15, 3], [15, 3], [15, 3], [15, 3]],
  }),
  buildLayout({
    id: '75', label: '84 键', keyCount: 84, minWidth: 700, tracks: 74, rows: 7,
    description: '75% · 紧凑功能键与导航区',
    functionRow: functionRowCompact, alphaStartRow: 3,
    navColumn: 15.5, navRows,
    preview: [[15, 3], [15, 3], [15, 3], [15, 3]],
  }),
  buildLayout({
    id: '65', label: '68 键', keyCount: 68, minWidth: 690, tracks: 74, rows: 5,
    description: '65% · 保留方向键与常用导航键',
    alphaStartRow: 1, navColumn: 15.5, navRows: compactNavRows,
    preview: [[15, 3], [15, 3], [15, 3], [15, 3]],
  }),
  buildLayout({
    id: '60', label: '61 键', keyCount: 61, minWidth: 610, tracks: 60, rows: 5,
    description: '60% · 仅保留主键区',
    alphaStartRow: 1,
    preview: [[15], [15], [15], [15]],
  }),
]

export function getKeyboardLayout(id: KeyboardLayoutId): KeyboardLayout {
  return keyboardLayouts.find(layout => layout.id === id)
    ?? keyboardLayouts.find(layout => layout.id === 'full')!
}

export function layoutKeys(layout: KeyboardLayout): KeyDefinition[] {
  return layout.keys
}

const keyLabelMap = new Map(
  keyboardLayouts.flatMap(layout => layout.keys).map(key => [key.id, key.label]),
)

export function formatKeyLabel(keyId: string, locale: 'en' | 'zh' = 'zh'): string {
  if (keyId === 'Space') return locale === 'en' ? 'Space' : '空格'
  const label = keyLabelMap.get(keyId)
  if (label && label.length > 0) return label
  return keyId
}

export function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  const ratio = value / max
  if (ratio >= .5) return 5
  if (ratio >= .1) return 4
  if (ratio >= .01) return 3
  if (ratio >= .001) return 2
  return 1
}
