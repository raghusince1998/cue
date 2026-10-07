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

/**
 * A host that only exists on the machine running the browser.
 *
 * The distinction matters because a split between web and API ports is normal
 * in development and fatal in production: localhost:5173 talking to
 * localhost:3002 is the documented dev setup, while a public site pointing its
 * consent screen at localhost is always wrong.
 */
function isLocal(host: string): boolean {
  const name = host.split(':')[0]!
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name.endsWith('.localhost')
}

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

  // The failure this exists to catch: a redirect pointing somewhere this
  // server is not. The provider obeys what the app sends, so the consent
  // screen comes back to the wrong machine and looks like the provider's fault.
  try {
    const redirect = new URL(config.redirectUri)
    const site = new URL(env.webOrigin)
    if (!isLocal(site.host) && isLocal(redirect.host)) {
      console.log('')
      console.log(`  *** WRONG HOST: this points at ${redirect.host}, the site is ${site.host}.`)
      console.log('      Every consent screen comes back to a machine nobody is on.')
      console.log('      Set VITE_API_URL= (blank) in .env, then restart.')
    } else if (redirect.host !== site.host) {
      console.log(`  (api on ${redirect.host}, web on ${site.host} — normal in development)`)
    }
  } catch {
    console.log(`  *** Not a valid URL, and WEB_ORIGIN is "${env.webOrigin}".`)
  }
  if (provider === 'microsoft') {
    console.log(`  tenant         ${env.microsoftTenant}`)
  }
  console.log('')
}

console.log('If a value is set here but the running app disagrees, the app is still')
console.log('using the .env it read at startup — tsx watch does not watch .env.')
console.log('Restart it, then check:  curl -s localhost:' + env.port + '/health')
console.log('')
