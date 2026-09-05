import { sign } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { loadPluginSigningKey } from './plugin-signing-key.mjs'

const root = path.resolve(import.meta.dirname, '..')
const metadataDir = path.join(root, 'dist', 'plugins')
const files = (await readdir(metadataDir)).filter(file => file.endsWith('.metadata.json')).sort()
if (files.length === 0) throw new Error('No packaged plugin metadata found')
const metadata = await Promise.all(files.map(file => readFile(path.join(metadataDir, file), 'utf8').then(JSON.parse)))
const grouped = new Map()
for (const item of metadata) {
  if (item.plugin.uiDesignVersion !== 1 || item.designValidation?.archiveSha256 !== item.artifact.sha256 || item.designValidation?.visual !== 'passed') throw new Error(`Missing artifact-bound design validation: ${item.plugin.id}`)
  const existing = grouped.get(item.plugin.id) ?? { ...item.plugin, artifacts: [] }
  existing.artifacts.push({
    target: item.artifact.target,
    url: process.env.DIGIWORLD_DEV_CATALOG === '1' ? item.artifact.developmentUrl : item.artifact.url,
    sha256: item.artifact.sha256,
    signature: item.artifact.signature,
    size: item.artifact.size,
  })
  grouped.set(item.plugin.id, existing)
}
const output = {
  schemaVersion: 1,
  sequence: Number(process.env.DIGIWORLD_CATALOG_SEQUENCE ?? Math.floor(Date.now() / 1000)),
  generatedAt: new Date().toISOString(),
  plugins: [...grouped.values()].map(({ id, version, name, description, author, icon, minCoreVersion, permissions, artifacts, uiDesignVersion }) => ({
    id, version, name, description, author, icon, minCoreVersion, permissions, uiDesignVersion,
    artifacts: artifacts.sort((left, right) => left.target.localeCompare(right.target)),
  })).sort((left, right) => left.id.localeCompare(right.id)),
}
const bytes = Buffer.from(`${JSON.stringify(output, null, 2)}\n`)
const outputDir = path.join(root, 'catalog', 'v1')
await mkdir(outputDir, { recursive: true })
const indexName = process.env.DIGIWORLD_DEV_CATALOG === '1' ? 'index.dev.json' : 'index.json'
await writeFile(path.join(outputDir, indexName), bytes)
if (process.env.DIGIWORLD_PLUGIN_SIGNING_KEY_B64) {
  const key = loadPluginSigningKey(process.env.DIGIWORLD_PLUGIN_SIGNING_KEY_B64)
  await writeFile(path.join(outputDir, 'index.json.sig'), `${sign(null, bytes, key).toString('base64')}\n`)
} else if (process.env.DIGIWORLD_DEV_CATALOG !== '1') {
  throw new Error('DIGIWORLD_PLUGIN_SIGNING_KEY_B64 is required for a production catalog')
}
process.stdout.write(`${path.join(outputDir, indexName)}\n`)
