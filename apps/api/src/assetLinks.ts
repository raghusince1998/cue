/**
 * What the site says about the Android apps that open it full-screen: each
 * Play Store app — Cue, and Cue Exams — whose signing keys are known. An app
 * without its keys is left out: a wrong statement is worse than none.
 */
export function assetLinks(apps: { package: string; fingerprints: string[] }[]) {
  return apps
    .filter((a) => a.fingerprints.length > 0)
    .map((a) => ({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: a.package, sha256_cert_fingerprints: a.fingerprints },
    }))
}
