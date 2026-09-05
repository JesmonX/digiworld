export interface KeyDefinition {
  id: string
  label: string
  width?: number
  spacer?: number
  row?: number
  column?: number
  rowSpan?: number
  columnSpan?: number
}

export type KeyboardLayoutId = 'full' | 'tkl' | '75' | '65' | '60'

export interface KeyboardLayout {
  id: KeyboardLayoutId
  label: string
  keyCount: number
  description: string
  minWidth: number
  functionRow: KeyDefinition[]
  alphaRows: KeyDefinition[][]
  navRows: KeyDefinition[][]
  numpadKeys: KeyDefinition[]
  preview: number[][]
}

const k = (id: string, label: string, width = 1, spacer = 0): KeyDefinition => ({ id, label, width, spacer })

export const functionRow: KeyDefinition[] = [
  k('Escape', 'Esc'), k('F1', 'F1', 1, .6), k('F2', 'F2'), k('F3', 'F3'), k('F4', 'F4'),
  k('F5', 'F5', 1, .35), k('F6', 'F6'), k('F7', 'F7'), k('F8', 'F8'),
  k('F9', 'F9', 1, .35), k('F10', 'F10'), k('F11', 'F11'), k('F12', 'F12'),
  k('PrintScreen', 'PrtSc', 1, .35), k('ScrollLock', 'ScrLk'), k('Pause', 'Pause'),
]

export const alphaRows: KeyDefinition[][] = [
  [k('Backquote', '`'), k('Digit1', '1'), k('Digit2', '2'), k('Digit3', '3'), k('Digit4', '4'), k('Digit5', '5'), k('Digit6', '6'), k('Digit7', '7'), k('Digit8', '8'), k('Digit9', '9'), k('Digit0', '0'), k('Minus', '-'), k('Equal', '='), k('Backspace', 'Backspace', 2)],
  [k('Tab', 'Tab', 1.5), k('KeyQ', 'Q'), k('KeyW', 'W'), k('KeyE', 'E'), k('KeyR', 'R'), k('KeyT', 'T'), k('KeyY', 'Y'), k('KeyU', 'U'), k('KeyI', 'I'), k('KeyO', 'O'), k('KeyP', 'P'), k('BracketLeft', '['), k('BracketRight', ']'), k('Backslash', '\\', 1.5)],
  [k('CapsLock', 'Caps', 1.8), k('KeyA', 'A'), k('KeyS', 'S'), k('KeyD', 'D'), k('KeyF', 'F'), k('KeyG', 'G'), k('KeyH', 'H'), k('KeyJ', 'J'), k('KeyK', 'K'), k('KeyL', 'L'), k('Semicolon', ';'), k('Quote', "'"), k('Enter', 'Enter', 2.2)],
  [k('ShiftLeft', 'Shift', 2.3), k('KeyZ', 'Z'), k('KeyX', 'X'), k('KeyC', 'C'), k('KeyV', 'V'), k('KeyB', 'B'), k('KeyN', 'N'), k('KeyM', 'M'), k('Comma', ','), k('Period', '.'), k('Slash', '/'), k('ShiftRight', 'Shift', 2.7)],
  [k('ControlLeft', 'Ctrl', 1.4), k('MetaLeft', 'Win', 1.2), k('AltLeft', 'Alt', 1.2), k('Space', '', 6.4), k('AltRight', 'Alt', 1.2), k('MetaRight', 'Win', 1.2), k('ContextMenu', 'Menu', 1.2), k('ControlRight', 'Ctrl', 1.4)],
]

export const navRows: KeyDefinition[][] = [
  [k('Insert', 'Ins'), k('Home', 'Home'), k('PageUp', 'PgUp')],
  [k('Delete', 'Del'), k('End', 'End'), k('PageDown', 'PgDn')],
  [],
  [k('ArrowUp', '↑')],
  [k('ArrowLeft', '←'), k('ArrowDown', '↓'), k('ArrowRight', '→')],
]

const nk = (id: string, label: string, row: number, column: number, rowSpan = 1, columnSpan = 1): KeyDefinition =>
  ({ id, label, row, column, rowSpan, columnSpan })

export const numpadKeys: KeyDefinition[] = [
  nk('NumLock', 'Num', 1, 1), nk('NumpadDivide', '/', 1, 2), nk('NumpadMultiply', '×', 1, 3), nk('NumpadSubtract', '−', 1, 4),
  nk('Numpad7', '7', 2, 1), nk('Numpad8', '8', 2, 2), nk('Numpad9', '9', 2, 3), nk('NumpadAdd', '+', 2, 4, 2),
  nk('Numpad4', '4', 3, 1), nk('Numpad5', '5', 3, 2), nk('Numpad6', '6', 3, 3),
  nk('Numpad1', '1', 4, 1), nk('Numpad2', '2', 4, 2), nk('Numpad3', '3', 4, 3), nk('NumpadEnter', 'Enter', 4, 4, 2),
  nk('Numpad0', '0', 5, 1, 1, 2), nk('NumpadDecimal', '.', 5, 3),
]

const compactFunctionRow = functionRow.slice(0, 13)
const compactNavRows: KeyDefinition[][] = [
  [k('Delete', 'Del'), k('PageUp', 'PgUp')],
  [k('PageDown', 'PgDn')],
  [],
  [k('ArrowUp', '↑')],
  [k('ArrowLeft', '←'), k('ArrowDown', '↓'), k('ArrowRight', '→')],
]

export const keyboardLayouts: KeyboardLayout[] = [
  {
    id: 'full', label: '104 键', keyCount: 104, description: '全尺寸 · 独立功能区与数字小键盘', minWidth: 900,
    functionRow, alphaRows, navRows, numpadKeys,
    preview: [[17, 4], [14, 3, 4], [14, 3, 4], [14, 3, 4]],
  },
  {
    id: 'tkl', label: '87 键', keyCount: 87, description: 'TKL · 保留功能键与导航区', minWidth: 740,
    functionRow, alphaRows, navRows, numpadKeys: [],
    preview: [[17], [14, 3], [14, 3], [14, 3]],
  },
  {
    id: '75', label: '84 键', keyCount: 84, description: '75% · 紧凑功能键与导航区', minWidth: 700,
    functionRow: compactFunctionRow, alphaRows, navRows, numpadKeys: [],
    preview: [[16], [14, 2], [14, 2], [14, 2]],
  },
  {
    id: '65', label: '68 键', keyCount: 68, description: '65% · 保留方向键与常用导航键', minWidth: 690,
    functionRow: [], alphaRows, navRows: compactNavRows, numpadKeys: [],
    preview: [[14, 2], [14, 2], [14, 2], [14, 2]],
  },
  {
    id: '60', label: '61 键', keyCount: 61, description: '60% · 仅保留主键区', minWidth: 610,
    functionRow: [], alphaRows, navRows: [], numpadKeys: [],
    preview: [[14], [14], [14], [14]],
  },
]

export function getKeyboardLayout(id: KeyboardLayoutId): KeyboardLayout {
  return keyboardLayouts.find(layout => layout.id === id) ?? keyboardLayouts[0]!
}

export function layoutKeys(layout: KeyboardLayout): KeyDefinition[] {
  return [...layout.functionRow, ...layout.alphaRows.flat(), ...layout.navRows.flat(), ...layout.numpadKeys]
}

const fullLayout = getKeyboardLayout('full')
const keyLabelMap = new Map(layoutKeys(fullLayout).map(key => [key.id, key.label]))

export function formatKeyLabel(keyId: string): string {
  if (keyId === 'Space') return '空格'
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

