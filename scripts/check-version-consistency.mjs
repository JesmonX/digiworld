import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const packagePaths = [
  'package.json',
  'apps/desktop/package.json',
  'packages/design-system/package.json',
  'packages/plugin-sdk/package.json',
  'packages/typography/package.json',
]

const packages = await Promise.all(packagePaths.map(async relative => ({
  relative,
  value: JSON.parse(await readFile(path.join(root, relative), 'utf8')).version,
})))
const cargo = await readFile(path.join(root, 'Cargo.toml'), 'utf8')
const cargoVersion = cargo.match(/\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1]
const cargoLock = await readFile(path.join(root, 'Cargo.lock'), 'utf8')
const cargoLockVersion = cargoLock.match(/\[\[package\]\]\r?\nname = "digiworld"\r?\nversion = "([^"]+)"/)?.[1]
const tauriVersion = JSON.parse(
  await readFile(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
).version
const expected = packages[0].value
const versions = [...packages, { relative: 'Cargo.toml', value: cargoVersion }, {
  relative: 'Cargo.lock', value: cargoLockVersion,
}, {
  relative: 'apps/desktop/src-tauri/tauri.conf.json', value: tauriVersion,
}]
const mismatches = versions.filter(item => item.value !== expected)
if (mismatches.length > 0) {
  throw new Error(`Core version mismatch; expected ${expected}: ${mismatches.map(item => `${item.relative}=${item.value ?? 'missing'}`).join(', ')}`)
}
process.stdout.write(`Core versions are consistent at ${expected}\n`)
