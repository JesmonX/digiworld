import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const version = process.env.DIGIWORLD_RELEASE_VERSION
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('DIGIWORLD_RELEASE_VERSION must be a SemVer version without a v prefix')
}

const publicKey = process.env.DIGIWORLD_UPDATER_PUBLIC_KEY?.trim()
if (!publicKey) throw new Error('DIGIWORLD_UPDATER_PUBLIC_KEY is required')

const root = path.resolve(import.meta.dirname, '..')
const configPath = path.join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json')
const config = JSON.parse(await readFile(configPath, 'utf8'))
config.version = version
config.plugins ??= {}
config.plugins.updater ??= {}
config.plugins.updater.pubkey = publicKey
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
process.stdout.write(`Configured Digiworld ${version} release metadata\n`)
