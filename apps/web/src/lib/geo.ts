export interface Fix {
  lat: number
  lng: number
  accuracyM: number
}

/**
 * A browser only reports location while the page is open and visible. That is
 * the hard ceiling on the web build: it can answer "where am I now", never
 * "where was I twenty minutes ago". Automatic stop detection arrives with the
 * Capacitor Android build, which swaps this module for a native plugin.
 */
export async function getFix(timeoutMs = 15_000): Promise<Fix> {
  if (!('geolocation' in navigator)) {
    throw new Error('This device has no location support.')
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        }),
      (err) => {
        const messages: Record<number, string> = {
          1: 'Location permission was denied. Enable it for this site and try again.',
          2: 'Could not get a fix. Move somewhere with a clearer sky view.',
          3: 'Location timed out. Try again.',
        }
        reject(new Error(messages[err.code] ?? err.message))
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    )
  })
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(1)} km`
}
