# Releasing DeepHUD

The tagged release workflow builds native installers on each operating system:

| Runner | Target | Bundles |
| --- | --- | --- |
| Ubuntu 24.04 | x86_64 Linux | `.deb`, AppImage |
| Windows | x86_64 MSVC | NSIS `.exe`, `.msi` |
| macOS 15 | Apple Silicon | `.app`, `.dmg` |
| macOS 15 Intel | Intel | `.app`, `.dmg` |

It creates a draft GitHub release, uploads consistently named artifacts, and
adds `SHA256SUMS`. A draft prevents users from seeing a partially uploaded
release while matrix jobs are still running.

## Before tagging

1. Update the version in `package.json`, `src-tauri/tauri.conf.json`, and
   `src-tauri/Cargo.toml`.
2. Update `CHANGELOG.md` and complete the matrix in `docs/TESTING.md`.
3. Run `npm test`, `npm run build`, `cargo fmt --check --manifest-path
   src-tauri/Cargo.toml`, and `cargo check --locked --manifest-path
   src-tauri/Cargo.toml`.
4. Commit and push the release changes.
5. Create and push the matching tag, for example `git tag v1.0.0` followed by
   `git push origin v1.0.0`.
6. After all release jobs pass, inspect the draft assets and checksums, add the
   final release notes, and publish the draft.

The workflow rejects a tag when any of the three application version fields do
not match it.

The macOS build uses `com.deepworkhud.desktop` because Apple bundle identifiers
must not end in `.app`. Linux and Windows retain `com.deepworkhud.app` so users
upgrading from earlier versions keep their existing local database and settings.

## macOS signing and notarization

Without Apple credentials the workflow uses an ad-hoc signature so Apple
Silicon does not treat the downloaded app as structurally unsigned. This does
not remove Gatekeeper warnings. For a public release, add these GitHub Actions
secrets from an Apple Developer account:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`: export password for that certificate
- `APPLE_SIGNING_IDENTITY`: the certificate identity
- `APPLE_ID`: Apple ID used for notarization
- `APPLE_PASSWORD`: app-specific password
- `APPLE_TEAM_ID`: Apple Developer team ID

Tauri will then sign, notarize, and staple the macOS bundles during the native
build. Never commit certificate files or passwords.

## Windows signing

Unsigned installers build successfully but may trigger SmartScreen. A public
release should use an OV/EV code-signing certificate or a managed signing
service. Configure the certificate or custom signing command according to the
[Tauri Windows signing guide](https://v2.tauri.app/distribute/sign/windows/)
before publishing. Certificate material must stay in GitHub secrets or the
managed signing service, never in this repository.

## Automatic updates

Automatic updates are deliberately not enabled with placeholders. The Tauri
updater requires both a permanent public-key value and the final GitHub release
repository URL; update signature verification cannot be disabled. Once those
values exist, generate and securely back up the updater keypair, add only the
public key and endpoint to `tauri.conf.json`, add the updater plugin and UI, and
store the private key/password as `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub secrets.
