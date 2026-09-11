import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildUpdateManifest } from './build-update-manifest.mjs'

test('builds one updater manifest for Windows and both macOS architectures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digiworld-update-manifest-'))
  try {
    const artifacts = {
      'windows-x86_64': 'Digiworld_1.2.3_x64-setup.exe',
      'darwin-aarch64': 'Digiworld_1.2.3_darwin-aarch64.app.tar.gz',
      'darwin-x86_64': 'Digiworld_1.2.3_darwin-x86_64.app.tar.gz',
    }
    for (const [target, filename] of Object.entries(artifacts)) {
      const appDir = path.join(root, target, 'app')
      await mkdir(appDir, { recursive: true })
      await writeFile(path.join(appDir, filename), target)
      await writeFile(path.join(appDir, `${filename}.sig`), `signature-${target}\n`)
    }

    const manifest = await buildUpdateManifest({
      artifactRoot: root,
      repository: 'example/digiworld',
      version: '1.2.3',
      pubDate: '2026-09-11T00:00:00.000Z',
    })

    assert.deepEqual(Object.keys(manifest.platforms), [
      'windows-x86_64',
      'darwin-aarch64',
      'darwin-x86_64',
    ])
    assert.equal(
      manifest.platforms['darwin-aarch64'].url,
      'https://github.com/example/digiworld/releases/download/v1.2.3/Digiworld_1.2.3_darwin-aarch64.app.tar.gz',
    )
    assert.equal(manifest.platforms['darwin-x86_64'].signature, 'signature-darwin-x86_64')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a platform artifact without its updater signature', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digiworld-update-manifest-'))
  try {
    const appDir = path.join(root, 'darwin-aarch64', 'app')
    await mkdir(appDir, { recursive: true })
    await writeFile(path.join(appDir, 'Digiworld.app.tar.gz'), 'unsigned')
    await assert.rejects(
      buildUpdateManifest({ artifactRoot: root, repository: 'example/digiworld', version: '1.2.3' }),
      /No signed updater artifact found for darwin-aarch64/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
