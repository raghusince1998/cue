import { env } from '../src/env.ts'
import { configFor, providerConfigured, PROVIDERS } from '../src/services/oauthProviders.ts'

/**
 * "Why does it still say not set up?"
 *
 * Calendar sign-in fails for boring reasons — a value in the wrong file, a
 * redirect URI off by one path segment, a server still running the `.env` it
 * read at boot. None of those say so out loud, and the consent screen's own
 * error does not know which end is wrong.
 *
 * So this prints what the server actually believes, right now, and never a
 * secret: lengths and presence only. Run it after editing `.env` and before
 * blaming the provider.
 */

const tick = (ok: boolean) => (ok ? 'yes' : 'NO ')

console.log('')
console.log('Encryption key (required to store tokens):', tick(Boolean(env.encryptionKey)))
if (!env.encryptionKey) {
  console.log('  -> Without it every provider stays switched off, whatever else is set.')
  console.log('     node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
}
console.log('')

for (const provider of PROVIDERS) {
  const config = configFor(provider)
  const ready = providerConfigured(provider)

  console.log(`${config.label}`)
  console.log(`  client id      ${tick(Boolean(config.clientId))} ${
    config.clientId ? `(${config.clientId.length} chars)` : ''
  }`)
  console.log(`  client secret  ${tick(Boolean(config.clientSecret))} ${
    config.clientSecret ? `(${config.clientSecret.length} chars)` : ''
  }`)
  console.log(`  connectable    ${tick(ready)}`)
  console.log('  register this redirect URI, character for character:')
  console.log(`    ${config.redirectUri}`)
  if (provider === 'microsoft') {
    console.log(`  tenant         ${env.microsoftTenant}`)
  }
  console.log('')
}

console.log('If a value is set here but the running app disagrees, the app is still')
console.log('using the .env it read at startup — tsx watch does not watch .env.')
console.log('Restart it, then check:  curl -s localhost:' + env.port + '/health')
console.log('')
