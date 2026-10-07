import webpush from 'web-push'

/**
 * VAPID keys identify this server to the browser push services. Generate once,
 * paste into .env, and keep the private key out of version control.
 */
const keys = webpush.generateVAPIDKeys()

console.log('\nAdd these to your .env file:\n')
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
console.log('\nChanging them later invalidates every existing subscription.\n')
