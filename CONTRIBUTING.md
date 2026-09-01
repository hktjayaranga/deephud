# Contributing

Thank you for helping improve DeepHUD.

## Development setup

1. Install the Tauri prerequisites for your operating system listed in the README.
2. Install Rust stable and Node.js 20 or newer.
3. Run `npm ci`.
4. Run `npm run tauri dev`.

Before opening a pull request, run:

```bash
npm test
npm run build
cd src-tauri && cargo fmt --check && cargo check
```

Keep changes focused and privacy-preserving. New network services, telemetry,
accounts, or cloud synchronization are intentionally outside the project's
scope. Database changes must use a new forward-only migration; never modify a
migration that may already exist on a user's machine.

Bug reports should include the operating system/version, CPU architecture,
display server where relevant, install format, reproduction steps, and relevant
terminal output. Do not attach a personal database or backup unless it has been
sanitized.
