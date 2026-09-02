export interface KeyDefinition { id: string; label: string; width?: number; spacer?: number }

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
  [k('ArrowUp', '↑', 1, 1)],
  [k('ArrowLeft', '←'), k('ArrowDown', '↓'), k('ArrowRight', '→')],
]

export const numpadRows: KeyDefinition[][] = [
  [k('NumLock', 'Num'), k('NumpadDivide', '/'), k('NumpadMultiply', '×'), k('NumpadSubtract', '−')],
  [k('Numpad7', '7'), k('Numpad8', '8'), k('Numpad9', '9'), k('NumpadAdd', '+')],
  [k('Numpad4', '4'), k('Numpad5', '5'), k('Numpad6', '6'), k('NumpadAdd', '+')],
  [k('Numpad1', '1'), k('Numpad2', '2'), k('Numpad3', '3'), k('NumpadEnter', 'Enter')],
  [k('Numpad0', '0', 2.05), k('NumpadDecimal', '.'), k('NumpadEnter', 'Enter')],
]
