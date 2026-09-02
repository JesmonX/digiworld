import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const version = process.env.DIGIWORLD_RELEASE_VERSION
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('DIGIWORLD_RELEASE_VERSION must be a SemVer version without a v prefix')
}
const configuredVersion = JSON.parse(await readFile(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')).version
if (configuredVersion !== version) {
  throw new Error(`Release input ${version} does not match tauri.conf.json version ${configuredVersion}`)
}

const bundleDir = path.join(root, 'target/release/bundle/nsis')
const installer = (await readdir(bundleDir)).find(name => name.endsWith('.exe'))
if (!installer) throw new Error('No NSIS installer found')
const signature = (await readFile(path.join(bundleDir, `${installer}.sig`), 'utf8')).trim()
const repository = process.env.GITHUB_REPOSITORY ?? 'JesmonX/digiworld'
const manifest = {
  version,
  notes: `Digiworld ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/${repository}/releases/download/v${version}/${installer}`,
    },
  },
}
await writeFile(path.join(bundleDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`${path.join(bundleDir, 'latest.json')}\n`)
