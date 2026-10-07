import { env } from '../env.ts'

/**
 * What differs between one calendar provider and the next.
 *
 * Which is less than it looks. The round trip is the same everywhere —
 * redirect, consent, code, token, refresh — so the parts that genuinely vary
 * are gathered here and the flow itself is written once.
 */

export const PROVIDERS = ['google', 'microsoft'] as const
export type Provider = (typeof PROVIDERS)[number]

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value)
}

export interface ProviderConfig {
  /** How to name it on screen. */
  label: string
  authEndpoint: string
  tokenEndpoint: string
  /**
   * Where to hand the grant back. Null where the provider has none — Microsoft
   * offers no token revocation endpoint, so disconnecting there removes our
   * copy and the person withdraws the rest at myapps.microsoft.com.
   */
  revokeEndpoint: string | null
  scopes: string[]
  /** The one scope without which there is nothing to read. */
  calendarScope: string
  /** Provider-specific authorisation parameters. */
  extraAuthParams: Record<string, string>
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Where the person manages what they have granted, for error messages. */
  permissionsUrl: string
}

const MS_TENANT = env.microsoftTenant || 'common'

export function configFor(provider: Provider): ProviderConfig {
  if (provider === 'microsoft') {
    return {
      label: 'Microsoft',
      authEndpoint: `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize`,
      tokenEndpoint: `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`,
      // Microsoft has no OAuth2 revocation endpoint. Saying so here is better
      // than pretending the disconnect reached them.
      revokeEndpoint: null,
      // offline_access is how Microsoft grants a refresh token — there is no
      // access_type parameter. Without it the connection dies after an hour.
      scopes: ['openid', 'email', 'offline_access', 'https://graph.microsoft.com/Calendars.Read'],
      calendarScope: 'https://graph.microsoft.com/Calendars.Read',
      // Asking every time is the only way to be sure of a refresh token on a
      // reconnect, exactly as with Google.
      extraAuthParams: { prompt: 'consent', response_mode: 'query' },
      clientId: env.microsoftClientId,
      clientSecret: env.microsoftClientSecret,
      redirectUri: env.microsoftRedirectUri,
      permissionsUrl: 'myapps.microsoft.com',
    }
  }

  return {
    label: 'Google',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'],
    calendarScope: 'https://www.googleapis.com/auth/calendar.readonly',
    // offline + consent together are what actually yield a refresh token.
    // Google returns one only on a fresh grant, so somebody reconnecting after
    // a revoke would otherwise get an account that works for an hour and then
    // silently stops.
    extraAuthParams: {
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: env.googleRedirectUri,
    permissionsUrl: 'myaccount.google.com/permissions',
  }
}

/** Both halves and somewhere to put the tokens. Any missing and Connect is off. */
export function providerConfigured(provider: Provider): boolean {
  const config = configFor(provider)
  return Boolean(config.clientId && config.clientSecret && env.encryptionKey)
}
