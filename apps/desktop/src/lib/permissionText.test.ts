import { describe, expect, it } from 'vitest'
import { permissionText } from './permissionText'

describe('permission explanations', () => {
  it('localizes known reasons and preserves changed or external reasons verbatim', () => {
    const original = '将随笔内容和记录日期保存在本地。'
    expect(permissionText(original, 'en')).toBe('Store note content and dates locally.')
    const changed = original + '并上传到服务器。'
    expect(permissionText(changed, 'en')).toBe(changed)
    expect(permissionText('Read CustomToken and ShellConfig', 'zh')).toBe('Read CustomToken and ShellConfig')
  })
})
