import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const supportedArtifacts = {
  'windows-x86_64': name => name.endsWith('.exe'),
  'darwin-aarch64': name => name.endsWith('.app.tar.gz'),
  'darwin-x86_64': name => name.endsWith('.app.tar.gz'),
}

export async function buildUpdateManifest({ artifactRoot, repository, version, pubDate = new Date().toISOString() }) {
  const platforms = {}
  for (const [target, matchesUpdater] of Object.entries(supportedArtifacts)) {
    const appDir = path.join(artifactRoot, target, 'app')
    let files
    try {
      files = await readdir(appDir)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    const updater = files.find(name => matchesUpdater(name) && files.includes(`${name}.sig`))
    if (!updater) throw new Error(`No signed updater artifact found for ${target}`)
    const signature = (await readFile(path.join(appDir, `${updater}.sig`), 'utf8')).trim()
    if (!signature) throw new Error(`Updater signature is empty for ${target}`)
    platforms[target] = {
      signature,
      url: `https://github.com/${repository}/releases/download/v${version}/${updater}`,
    }
  }
  if (!platforms['windows-x86_64']) throw new Error('Windows updater artifact is required')
  if (!platforms['darwin-aarch64']) throw new Error('Apple Silicon updater artifact is required')
  if (!platforms['darwin-x86_64']) throw new Error('Intel macOS updater artifact is required')
  return {
    version,
    notes: `Digiworld ${version}`,
    pub_date: pubDate,
    platforms,
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const version = process.env.DIGIWORLD_RELEASE_VERSION
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('DIGIWORLD_RELEASE_VERSION must be a SemVer version without a v prefix')
  }
  const configuredVersion = JSON.parse(await readFile(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')).version
  if (configuredVersion !== version) {
    throw new Error(`Release input ${version} does not match tauri.conf.json version ${configuredVersion}`)
  }
  const artifactRoot = path.resolve(process.env.DIGIWORLD_RELEASE_ARTIFACTS_DIR ?? path.join(root, 'dist/release'))
  const outputPath = path.resolve(process.env.DIGIWORLD_UPDATE_MANIFEST_PATH ?? path.join(root, 'updates/latest.json'))
  const manifest = await buildUpdateManifest({
    artifactRoot,
    repository: process.env.GITHUB_REPOSITORY ?? 'JesmonX/digiworld',
    version,
  })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
  process.stdout.write(`${outputPath}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
