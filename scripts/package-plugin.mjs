import { createHash, sign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { zipSync } from 'fflate'
import { loadPluginSigningKey } from './plugin-signing-key.mjs'

const root = path.resolve(import.meta.dirname, '..')
const pluginName = process.argv[2]
if (pluginName !== 'keyboard-heatmap') throw new Error('Usage: package-plugin.mjs keyboard-heatmap')

const source = JSON.parse(await readFile(path.join(root, 'plugins', pluginName, 'plugin.json'), 'utf8'))
const target = process.env.DIGIWORLD_TARGET ?? ({ win32: 'windows-x86_64', linux: 'linux-x86_64', darwin: 'darwin-x86_64' })[process.platform]
if (!target) throw new Error(`Unsupported host platform: ${process.platform}`)

const executableName = process.platform === 'win32' || target.startsWith('windows')
  ? 'digiworld-keyboard-heatmap.exe'
  : 'digiworld-keyboard-heatmap'
const backendPath = process.env.DIGIWORLD_PLUGIN_BACKEND
  ? path.resolve(process.env.DIGIWORLD_PLUGIN_BACKEND)
  : path.join(root, 'target', 'release', executableName)
const uiPath = path.join(root, 'plugins', pluginName, 'ui', 'dist', 'index.html')
const [backend, ui] = await Promise.all([readFile(backendPath), readFile(uiPath)])
const backendArchivePath = `bin/${target}/${executableName}`
const sha256 = value => createHash('sha256').update(value).digest('hex')

const manifest = {
  schemaVersion: 1,
  protocolVersion: 1,
  ...source,
  platforms: {
    [target]: { backend: backendArchivePath, sha256: sha256(backend) },
  },
}
const archive = Buffer.from(zipSync({
  'manifest.json': Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  'ui/index.html': ui,
  [backendArchivePath]: backend,
}, { level: 9 }))

const outputDir = path.join(root, 'dist', 'plugins')
await mkdir(outputDir, { recursive: true })
const baseName = `${pluginName}-v${source.version}-${target}.dwpkg`
const outputPath = path.join(outputDir, baseName)
await writeFile(outputPath, archive)

let signature = 'development-unsigned'
if (process.env.DIGIWORLD_PLUGIN_SIGNING_KEY_B64) {
  const key = loadPluginSigningKey(process.env.DIGIWORLD_PLUGIN_SIGNING_KEY_B64)
  signature = sign(null, archive, key).toString('base64')
  await writeFile(`${outputPath}.sig`, `${signature}\n`)
}

const repository = process.env.GITHUB_REPOSITORY ?? 'JesmonX/digiworld'
const tag = process.env.DIGIWORLD_RELEASE_TAG ?? `plugin-${pluginName}-v${source.version}`
const metadata = {
  plugin: source,
  artifact: {
    target,
    url: process.env.DIGIWORLD_ARTIFACT_BASE_URL
      ? `${process.env.DIGIWORLD_ARTIFACT_BASE_URL.replace(/\/$/, '')}/${baseName}`
      : `https://github.com/${repository}/releases/download/${tag}/${baseName}`,
    developmentUrl: `file://${outputPath}`,
    sha256: sha256(archive),
    signature,
    size: archive.length,
    filename: baseName,
  },
}
await writeFile(path.join(outputDir, `${pluginName}-${target}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`)
process.stdout.write(`${outputPath}\n`)
