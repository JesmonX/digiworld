import assert from 'node:assert/strict'
import test from 'node:test'
import { nextPreviewVersion, parseStableVersion, releaseMetadata } from './resolve-preview-version.mjs'

test('increments the source patch when it is newer than release tags', () => {
  assert.equal(nextPreviewVersion('0.2.6', [
    'refs/tags/v0.2.5',
    'refs/tags/v0.2.5-alpha.15',
  ]), '0.2.7')
})

test('increments the newest stable release tag on later runs', () => {
  assert.equal(nextPreviewVersion('0.2.6', [
    'refs/tags/v0.2.7',
    'refs/tags/v0.2.8-alpha.20',
    'refs/tags/v0.2.8',
  ]), '0.2.9')
})

test('rejects prerelease source versions and marks releases as preview', () => {
  assert.throws(() => parseStableVersion('0.2.6-alpha.1'), /stable SemVer/)
  assert.deepEqual(releaseMetadata('0.2.7'), {
    version: '0.2.7',
    tag: 'v0.2.7',
    name: 'Digiworld v0.2.7 Preview',
    prerelease: 'true',
    make_latest: 'false',
  })
})
