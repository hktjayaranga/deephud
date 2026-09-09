# DeepHUD

**DeepHUD is a privacy-first, distraction-free focus timer for Windows, macOS, and Linux.**

Stay focused on deep work without accounts, cloud sync, telemetry, or tracking.

[Website](https://hktjayaranga.github.io/deephud/) ·
[Download](https://github.com/hktjayaranga/deephud/releases/latest) ·
[Privacy](docs/PRIVACY.md)

![DeepHUD Version 1.0](assets/deephud-v1.png)

## Features

- Floating transparent HUD with compact/full layouts and three sizes
- Stopwatch, countdown, Deep Work, Pomodoro, and custom work/break intervals
- Pause, resume, reset, skip, and ±5-minute adjustment
- Optional break activities: choose guided square breathing or continue with a normal break
- Themes, custom accent, opacity, always-on-top, snapping, and click-through
- Projects, tasks, editable history, daily/weekly statistics, goals, and streaks
- CSV/JSON export plus complete JSON backup and restore
- Configurable global shortcuts and system-tray controls
- Desktop notifications, completion sounds, warnings, and native idle handling
- Global focus audio with real rain, forest, and calm-waterfall recordings, local audio files, instant previews, and remembered volume
- Start on login, close to tray, and native installers for all three desktop platforms
- Offline-only SQLite storage with no tracking

## Install a release

Download the installer for your operating system from the
[latest GitHub release](https://github.com/hktjayaranga/deephud/releases/latest):

- Linux x64: `.deb` or AppImage
- Windows x64: NSIS setup `.exe` or `.msi`
- macOS Apple Silicon: `aarch64.dmg`
- macOS Intel: `x86_64.dmg`

Every release also contains `SHA256SUMS` for verifying the downloads.

Debian package:

```bash
sudo apt install './DeepHUD_1.0.0_amd64.deb'
```

AppImage:

```bash
chmod +x 'DeepHUD_1.0.0_amd64.AppImage'
./DeepHUD_1.0.0_amd64.AppImage
```

The `.deb` installs the application icon and desktop entry. On Windows, run
either installer and launch DeepHUD from the Start menu. On macOS, open the
matching DMG and drag DeepHUD into Applications.

## Build from source

Install the prerequisites for your OS from the
[Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/). On
Ubuntu/Debian, the native packages are:

```bash
sudo apt update
sudo apt install -y build-essential curl wget file libwebkit2gtk-4.1-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev pkg-config
```

Install Rust stable and Node.js 20 or newer, then:

```bash
npm ci
npm run tauri dev
```

Build the native packages for the current operating system:

```bash
npm run tauri build
```

Artifacts are written beneath `src-tauri/target/release/bundle/`.

## Usage

Use a quick-duration button on the HUD, or select the target button to prepare
a Deep Work/Pomodoro session with a project and task. The chart button opens
the productivity dashboard. The gear opens appearance, timer, integration,
alert, idle, goal, and shortcut settings.

Completed work intervals are recorded; breaks do not inflate focus totals. The
History page can search, filter, edit, delete, export, back up, and restore data.

### Focus audio

Open the Audio popover from the full HUD to control focus sound for any Deep
Work, Pomodoro, quick-start, custom, countdown, or stopwatch session. Focus
audio is off by default and plays entirely on the device.

- Choose the included Heavy rain, Forest, or Calm waterfall field recording,
  or add MP3, WAV, OGG, FLAC, M4A, or AAC files to an offline local library.
  User recordings are copied into DeepHUD's app-data folder and can be renamed
  or removed without changing the original files; built-in recordings remain
  protected.
- Select a recording while the timer is stopped to hear an eight-second
  preview. Choose another recording to switch previews, select the current one
  again to stop, or close the popover to end the preview.
- Change the active recording, volume, or mute state without stopping a running
  timer. Selecting Silence stops focus audio and remembers that choice.
- DeepHUD remembers the selected recording and volume, pauses audio with the
  timer, and stops it when the session ends or resets.

The Audio button is intentionally hidden in compact mode. Expand to the full
HUD to change focus-audio controls.

### Default shortcuts

| Action | Shortcut |
| --- | --- |
| Start / pause | `Ctrl+Alt+Space` |
| Reset | `Ctrl+Alt+R` |
| Show / hide HUD | `Ctrl+Alt+H` |
| Toggle click-through | `Ctrl+Alt+C` |
| Start default Deep Work | `Ctrl+Alt+S` |

Every shortcut can be changed in Settings. If a combination is already owned
by the desktop or another application, DeepHUD reports it as unavailable.

## Data and privacy

Focus history is stored locally in the operating system's application config
directory. Common locations are:

```text
Linux:   ~/.config/com.deepworkhud.app/deepwork-hud.db
Windows: %APPDATA%\com.deepworkhud.app\deepwork-hud.db
macOS:   ~/Library/Application Support/com.deepworkhud.desktop/deepwork-hud.db
```

There is no application network client, account, telemetry, cloud sync, or
automatic surveillance. See [the privacy document](docs/PRIVACY.md).

## Test

```bash
npm test
npm run build
cd src-tauri
cargo fmt --check
cargo check
```

See [desktop release testing](docs/TESTING.md), the
[release guide](docs/RELEASING.md), and [Ubuntu/Wayland notes](docs/UBUNTU.md).

## Project structure

```text
deepwork-hud/
├── .github/workflows/       # CI and tagged GitHub releases
├── docs/                    # privacy, compatibility, and testing
├── src/                     # React UI and application services
├── src-tauri/               # Tauri/Rust backend and package metadata
├── tests/                   # unit and integration tests
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── SECURITY.md
└── README.md
```

## Scope

Version 1.0 deliberately excludes accounts, cloud synchronization, mobile apps,
social/team features, website surveillance, and AI coaching. The application is
designed to help you focus—not become another service to manage.

Licensed under the [MIT License](LICENSE).
