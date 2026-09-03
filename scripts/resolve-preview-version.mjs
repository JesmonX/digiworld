import { execFile } from 'node:child_process'
import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const stableVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/

export function parseStableVersion(value) {
  const match = stableVersionPattern.exec(value)
  if (!match) throw new Error(`Expected a stable SemVer version, got: ${value}`)
  return match.slice(1).map(Number)
}

export function nextPreviewVersion(sourceVersion, refs) {
  const versions = [parseStableVersion(sourceVersion)]
  for (const ref of refs) {
    const match = /^refs\/tags\/v(\d+\.\d+\.\d+)$/.exec(ref)
    if (match) versions.push(parseStableVersion(match[1]))
  }
  versions.sort((left, right) => right[0] - left[0] || right[1] - left[1] || right[2] - left[2])
  const [major, minor, patch] = versions[0]
  return `${major}.${minor}.${patch + 1}`
}

export function releaseMetadata(version) {
  return {
    version,
    tag: `v${version}`,
    name: `Digiworld v${version} Preview`,
    prerelease: 'true',
    make_latest: 'false',
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const sourceVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
  const { stdout } = await execFileAsync('git', ['ls-remote', '--tags', 'origin', 'refs/tags/v*'], { cwd: root })
  const refs = stdout.split(/\r?\n/).flatMap(line => {
    const [, ref] = line.split(/\s+/, 2)
    return ref ? [ref] : []
  })
  const metadata = releaseMetadata(nextPreviewVersion(sourceVersion, refs))

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `${Object.entries(metadata).map(([key, value]) => `${key}=${value}`).join('\n')}\n`)
  }
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `DIGIWORLD_RELEASE_VERSION=${metadata.version}\n`)
  }
  process.stdout.write(`${JSON.stringify(metadata)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
