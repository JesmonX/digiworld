import { createPrivateKey } from 'node:crypto'

// RFC 8410: PKCS#8 PrivateKeyInfo wrapper for a raw Ed25519 seed.
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

function decodeBase64(value) {
  const compact = value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) return null
  const padded = compact.padEnd(compact.length + ((4 - compact.length % 4) % 4), '=')
  const decoded = Buffer.from(padded, 'base64')
  return decoded.length > 0 ? decoded : null
}

/**
 * Load an Ed25519 private key from a GitHub Actions environment value.
 * The value may be a PEM string, base64-encoded PEM/PKCS#8 DER, or a
 * base64-encoded 32-byte Ed25519 seed.
 */
export function loadPluginSigningKey(value, envName = 'DIGIWORLD_PLUGIN_SIGNING_KEY_B64') {
  let input = String(value ?? '').trim()
  if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) {
    input = input.slice(1, -1).trim()
  }
  if (!input) throw new Error(`${envName} is required`)

  const candidates = []
  if (input.includes('-----BEGIN')) candidates.push({ key: input, format: 'pem' })
  const decoded = decodeBase64(input)
  if (decoded) {
    const decodedText = decoded.toString('utf8').trim()
    if (decodedText.includes('-----BEGIN')) candidates.push({ key: decodedText, format: 'pem' })
    candidates.push({ key: decoded, format: 'der', type: 'pkcs8' })
    if (decoded.length === 32) {
      candidates.push({
        key: Buffer.concat([ED25519_PKCS8_PREFIX, decoded]),
        format: 'der',
        type: 'pkcs8',
      })
    }
  }

  for (const candidate of candidates) {
    try {
      const key = createPrivateKey(candidate)
      if (key.asymmetricKeyType === 'ed25519') return key
    } catch {
      // Try the next supported representation without exposing key material.
    }
  }

  const decodedLength = decoded?.length ?? 0
  throw new Error(
    `${envName} is not a supported Ed25519 private key. `
    + 'Use a base64-encoded PEM/PKCS#8 key or a base64-encoded 32-byte seed '
    + `(decoded length: ${decodedLength} bytes)`,
  )
}
