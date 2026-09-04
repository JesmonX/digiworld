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
const cargoPath = path.join(root, 'Cargo.toml')
const cargoLockPath = path.join(root, 'Cargo.lock')
const configPath = path.join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json')
const packagePaths = [
  path.join(root, 'package.json'),
  path.join(root, 'apps', 'desktop', 'package.json'),
  path.join(root, 'packages', 'plugin-sdk', 'package.json'),
  path.join(root, 'packages', 'typography', 'package.json'),
]

const cargo = await readFile(cargoPath, 'utf8')
const nextCargo = cargo.replace(
  /(\[workspace\.package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/,
  `$1"${version}"`,
)
if (nextCargo === cargo) throw new Error('Could not update [workspace.package].version')
await writeFile(cargoPath, nextCargo)

const cargoLock = await readFile(cargoLockPath, 'utf8')
const nextCargoLock = cargoLock.replace(
  /(\[\[package\]\]\r?\nname = "digiworld"\r?\nversion = ")[^"]+"/,
  `$1${version}"`,
)
if (nextCargoLock === cargoLock) throw new Error('Could not update digiworld in Cargo.lock')
await writeFile(cargoLockPath, nextCargoLock)

for (const packagePath of packagePaths) {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
  packageJson.version = version
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

const config = JSON.parse(await readFile(configPath, 'utf8'))
config.version = version
config.plugins ??= {}
config.plugins.updater ??= {}
config.plugins.updater.pubkey = publicKey
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
process.stdout.write(`Configured Digiworld ${version} release metadata\n`)
