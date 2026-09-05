import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const literalColor = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab)\s*\(|\b(?:white|black|red|blue|green|purple|orange)\b/i
const controlled = /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|fill|stroke|font(?:-family|-size|-weight)?|box-shadow|text-shadow|border-radius)$/

export function inspectCss(css, file = 'style.css') {
  const errors = []
  postcss.parse(css, { from: file }).walkDecls(decl => {
    const value = decl.value
    if (controlled.test(decl.prop) && literalColor.test(value)) errors.push(`${file}:${decl.source.start.line}: literal color in ${decl.prop}`)
    if (/^font(?:-family|-size|-weight)?$/.test(decl.prop) && !/var\(--(?:dw-|type-|weight-|font-)|^(?:inherit|normal)$/.test(value)) errors.push(`${file}:${decl.source.start.line}: typography must use shared roles`)
    if (/^(?:box-shadow|text-shadow|border-radius)$/.test(decl.prop) && !/^(?:none|0|inherit|50%|99px|999px)$/.test(value) && !value.includes('var(--dw-')) errors.push(`${file}:${decl.source.start.line}: use shared geometry/elevation`)
    if (decl.prop.startsWith('--dw-')) errors.push(`${file}:${decl.source.start.line}: plugins may consume but not redefine host tokens`)
    if (decl.prop === 'color-scheme' && !value.includes('--dw-color-scheme')) errors.push(`${file}: hard-coded color scheme`)
  })
  if (/@font-face|data:font|\.(?:woff2?|ttf|otf)(?:["')?\s]|$)/i.test(css)) errors.push(`${file}: plugin font payload`)
  return errors
}

export function inspectCode(code, file = 'App.tsx') {
  const errors = []
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = node => {
    // A constant color can reach SVG, canvas, or an inline style through JS.
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/i.test(node.text)) errors.push(`${file}: literal UI color in code`)
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'style' && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isObjectLiteralExpression(node.initializer.expression)) {
      for (const item of node.initializer.expression.properties) {
        if (!ts.isPropertyAssignment(item)) continue
        const key = item.name.getText(source).replace(/['"]/g, '')
        if (/^(fontFamily|fontSize|fontWeight|boxShadow|borderRadius)$/.test(key) && !item.initializer.getText(source).includes('var(--dw-')) errors.push(`${file}: inline ${key} must use a shared role`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return errors
}

async function files(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(item => item.isDirectory() ? files(path.join(dir, item.name)) : path.join(dir, item.name)))).flat()
}
export async function checkPlugin(name) {
  const dir = path.join(root, 'plugins', name)
  const manifest = JSON.parse(await readFile(path.join(dir, 'plugin.json'), 'utf8'))
  const errors = manifest.uiDesignVersion === 1 ? [] : [`${name}: uiDesignVersion must be 1`]
  for (const file of await files(path.join(dir, 'ui', 'src'))) {
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) continue
    const content = await readFile(file, 'utf8')
    if (file.endsWith('.css')) errors.push(...inspectCss(content, path.relative(root, file)))
    else if (/\.[jt]sx?$/.test(file)) errors.push(...inspectCode(content, path.relative(root, file)))
    if (/\.(?:woff2?|ttf|otf)$/.test(file)) errors.push(`${file}: bundled font`)
  }
  const entry = await readFile(path.join(dir, 'ui', 'src', 'main.tsx'), 'utf8')
  if (!entry.includes('@digiworld/design-system/base.css')) errors.push(`${name}: missing shared baseline`)
  if (errors.length) throw new Error(errors.join('\n'))
  return { uiDesignVersion: 1, checks: ['source-css', 'source-jsx-svg', 'host-fonts', 'shared-baseline'] }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const names = process.argv.slice(2)
  for (const name of names.length ? names : await readdir(path.join(root, 'plugins'))) await checkPlugin(name)
  console.log('UI design contract checks passed')
}
