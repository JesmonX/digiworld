import process from 'node:process'
import { loadPluginSigningKey } from './plugin-signing-key.mjs'

const key = loadPluginSigningKey(process.env.DIGIWORLD_PLUGIN_SIGNING_KEY_B64)
process.stdout.write(`Validated ${key.asymmetricKeyType} plugin signing key\n`)
