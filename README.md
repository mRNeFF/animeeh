# ANIMEEH

A desktop app to **rate and rank every anime you watch** — episode by episode, across seven criteria, with a weighted global score.

[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)

![Library](docs/screenshots/library.png)

---

## Contents

- [What it does](#what-it-does)
- [The scoring model](#the-scoring-model)
- [Install](#install)
- [Where your data lives](#where-your-data-lives)
- [Available scripts](#available-scripts)
- [Architecture](#architecture)
- [Releasing a new version](#releasing-a-new-version)
- [Known limitations](#known-limitations)

---

## What it does

- **Rate every episode from 0 to 100.** An unrated episode is simply ignored, so you can create a whole season up front and score it as you watch, without skewing your average.
- **Seven criteria per anime** — Characters, Story, Animation, OST, Opening, Key Factor, Originality.
- **Weighted global score**, with the episode average as a first-class component.
- **Four views**: Library, Global leaderboard, Rankings by criteria, Settings.
- **AniList lookup**: type a title and the app pre-fills the year, studio, episode count **and the individual episode titles**, all of which you can still edit by hand.
- **In-app updates** via GitHub Releases.
- **Entirely local**: your ratings live in a single JSON file on your machine. No account, no server.

| Library | Detail |
|---|---|
| ![Library](docs/screenshots/library.png) | ![Detail](docs/screenshots/detail.png) |

| Global leaderboard | Rankings by criteria |
|---|---|
| ![Leaderboard](docs/screenshots/leaderboard.png) | ![Criteria](docs/screenshots/criteria.png) |

| AniList lookup | Settings |
|---|---|
| ![AniList](docs/screenshots/anilist-search.png) | ![Settings](docs/screenshots/settings.png) |

---

## The scoring model

This is the heart of the app, so here is exactly how the global score is computed.

### The eight components

Seven criteria you rate yourself, plus one derived component:

| Component | Source |
|---|---|
| Characters, Story, Animation, OST, Opening, Key Factor, Originality | Your rating, 0 to 100 |
| **Episode average** | Computed automatically from your rated episodes |

### The formula

```
global score = Σ (value × weight) / Σ (weight)
```

The sum only covers components that are **actually rated** and whose **weight is greater than zero**.

Two deliberate consequences:

- A criterion you have not rated yet is **excluded** from the calculation instead of counting as a zero, so a half-filled entry is not penalised.
- Setting a weight to `0` removes that component from the ranking entirely without erasing the rating.

Weights are adjustable in **Settings → Criteria weights** (from `0` to `3`, in steps of `0.25`) and default to `1`.

### A worked example

This is a real result from the test suite for *Sousou no Frieren*, with every weight at `1`:

| Characters | Story | Animation | OST | Opening | Key Factor | Originality | Episode average |
|---|---|---|---|---|---|---|---|
| 95 | 96 | 92 | 88 | 90 | 85 | 89 | 95.6 |

```
(95 + 96 + 92 + 88 + 90 + 85 + 89 + 95.6) / 8 = 91.3
```

→ **91.3**, a grade of **S**.

### Letter grades

| Grade | Threshold |
|---|---|
| **S** | 90 and above |
| **A** | 80 – 89.9 |
| **B** | 70 – 79.9 |
| **C** | 60 – 69.9 |
| **D** | 50 – 59.9 |
| **E** | below 50 |

### The episode average

It only covers episodes that actually carry a rating:

```
average = sum of rated episode scores / number of rated episodes
```

When no episode is rated the component is `null` and drops out of the calculation, leaving the global score defined by the criteria alone.

---

## Install

### From the releases

1. Download `ANIMEEH-x.y.z-setup.exe` from the [Releases](https://github.com/mRNeFF/animeeh/releases) page.
2. Run the installer and pick an install folder.
3. Shortcuts are created on the Desktop and in the Start menu.

The app updates itself from then on: **Settings → Check for updates**.

### From source

Requires **Node.js 22.12 or newer** (Electron 44's minimum) and **Git**.

```powershell
git clone https://github.com/mRNeFF/animeeh.git
cd animeeh
npm install
npm run dev
```

To produce a Windows installer:

```powershell
npm run dist        # NSIS installer in release/
npm run dist:dir    # unpacked build, no installer (faster)
```

---

## Where your data lives

Your ratings are stored in a single JSON file:

```
%APPDATA%\ANIMEEH\animeeh-data.json
```

> **Worth knowing:** when run from source (`npm run dev`) the app uses a separate folder, `%APPDATA%\animeeh`. The two builds therefore do **not** share a list. Copy the file between them if you need to.

To back up or move your list: **Settings → Export backup** (and **Import backup** in the other direction). The **Show data file** button opens the folder directly.

If something goes wrong, **Settings** shows the current version and the data folder, and startup logs are written alongside it.

---

## Available scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development mode with hot reload |
| `npm run build` | Compile all three processes into `out/` |
| `npm run typecheck` | TypeScript check, no emit |
| `npm run start` | Run the compiled build |
| `npm run dist` | Windows installer (NSIS) into `release/` |
| `npm run dist:dir` | Packaged, non-installable app into `release/win-unpacked/` |
| `npm run icon` | Regenerate `build/icon.ico` and the PNGs |
| `npm run release` | Build **and publish** a GitHub release |
| `npm run smoke` | End-to-end test: full user journey plus screenshots |
| `npm run smoke:offline` | Checks behaviour when AniList is unreachable |
| `npm run smoke:update` | Tests updating against a fake local feed |
| `npm run smoke:update:live` | Tests updating against the real GitHub releases |

---

## Architecture

Three Electron processes plus shared types. **All network access lives in the main process**; the UI never talks to the network directly.

```
src/
├── main/                  Main process (Node)
│   ├── index.ts           Window, persistence, IPC
│   ├── anilist.ts         AniList GraphQL client, with cache and timeouts
│   └── updater.ts         electron-updater: check, download, install
├── preload/               Secure IPC bridge (contextBridge)
│   └── index.ts           The API exposed to the UI, nothing more
├── renderer/              UI (React)
│   ├── index.html
│   └── src/
│       ├── components/    Views and reusable components
│       ├── App.tsx        Navigation between the four views
│       ├── scoring.ts     ★ The scoring model (exercised by the smoke tests)
│       ├── store.tsx      Global state plus debounced persistence
│       ├── types.ts       Data model
│       └── useUpdate.ts   Update state on the UI side
└── shared/                Types shared between main and renderer
```

**Stack:** Electron 44 · React 19 · TypeScript 7 · Vite 7 (via `electron-vite`) · `electron-updater`.

### Implementation notes

- **Context isolation, no `nodeIntegration`.** The UI goes through `window.animeeh`, an explicit API exposed by the preload script.
- **Episode scores are nullable.** `null` means unrated, which is what lets the app pre-create episodes without dragging the average to zero.
- **Disk writes are debounced** (350 ms) and skipped when nothing changed.
- **Updates are user-driven** (`autoDownload = false`), and a background check can never clobber an in-flight or finished download.
- **AniList** is the reference source: its API needs no registration and every entry carries `idMal`, the official MyAnimeList identifier.

---

## Releasing a new version

MyAnimeList's own API requires OAuth2, and `electron-updater` needs a `latest.yml` file that `electron-builder` does not generate for the GitHub provider, so `scripts/release.mjs` handles it.

```powershell
# 1. Bump the version
npm version patch     # or minor / major

# 2. Build and publish
npm run release
```

The script builds, creates the GitHub tag and release, generates `latest.yml` (name, size, sha512), then verifies the files are live.

> The repository **must stay public**: `electron-updater` queries GitHub with no authentication, so a private repo would mean shipping a token inside the app.

This requires an authenticated [GitHub CLI](https://cli.github.com/) (`gh auth login`).

---

## Known limitations

- **The installer is not code-signed.** Windows SmartScreen will show "Unknown publisher" on first run for anyone other than you. Fixing that needs a paid code-signing certificate.
- **Windows only for now.** `electron-builder.yml` contains Linux and macOS targets, but neither has been tested.
- **AniList rate-limits to roughly 30 requests per minute.** The app applies a 450 ms debounce and a 30-minute cache, so you will not notice it in normal use.
- **AniList is not MyAnimeList.** They are separate databases linked by `idMal`. Data is very close for well-known series but can diverge (episode counts, studios).
- **The interface is in English**, as are all in-app messages.
