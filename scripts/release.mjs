/**
 * Publishes a release to GitHub.
 *
 * electron-builder's own `--publish always` creates the release before the tag
 * exists and can fail with "Published releases must have a valid tag". This
 * script builds locally, then lets `gh` create the tag and release, which is
 * reliable and keeps every upload explicit.
 *
 * Usage:
 *   node scripts/release.mjs                 # publish package.json version
 *   node scripts/release.mjs --notes "..."   # with custom release notes
 *   node scripts/release.mjs --dry-run       # build only, no upload
 *
 * The `publish` block in electron-builder.yml stays necessary: it is what makes
 * electron-builder write resources/app-update.yml into the build, without which
 * the download step fails.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const version = pkg.version
const repo = 'mRNeFF/animeeh'
const tag = `v${version}`

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const notesIndex = args.indexOf('--notes')
const notes = notesIndex >= 0 && args[notesIndex + 1] ? args[notesIndex + 1] : `ANIMEEH ${version}`

/**
 * Locate a real executable. Node's spawn with `shell: true` concatenates
 * arguments without quoting, which shreds strings containing spaces, so every
 * command except npm is spawned directly instead.
 */
function resolveBin(name, extraPaths = []) {
  const isWin = process.platform === 'win32'
  const candidates = isWin ? [`${name}.exe`, `${name}.cmd`, name] : [name]

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    if (!probe.error && probe.status === 0) return candidate
  }
  for (const full of extraPaths) {
    if (existsSync(full)) return full
  }
  return null
}

const ghBin = resolveBin('gh', ['C:\\Program Files\\GitHub CLI\\gh.exe'])
const gitBin = resolveBin('git')

if (!ghBin) throw new Error('gh not found — install GitHub CLI or add it to PATH')
if (!gitBin) throw new Error('git not found')

function run(command, commandArgs, { shell = false } = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    cwd: root,
    shell
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${commandArgs[0]} exited with ${result.status}`)
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf-8' })
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() }
}

/* 1. Build ---------------------------------------------------------- */
console.log(`\n=== ANIMEEH ${version} - build ===`)
// npm is a .cmd shim on Windows, so it needs the shell; its args are static.
run('npm', ['run', 'dist'], { shell: true })

const installer = join(root, 'release', `ANIMEEH-${version}-setup.exe`)
const blockmap = `${installer}.blockmap`

if (!existsSync(installer)) {
  throw new Error(`Installer not found: ${installer}`)
}

/**
 * electron-updater's GitHub provider downloads `latest.yml` as a release asset
 * (GitHubProvider.getLatestVersion -> getChannelFilename -> latest.yml) and
 * fails with ERR_UPDATER_CHANNEL_FILE_NOT_FOUND without it. electron-builder
 * only writes that file for generic-style providers, so generate it here.
 */
function writeLatestYml() {
  const sha512 = createHash('sha512').update(readFileSync(installer)).digest('base64')
  const size = statSync(installer).size

  const content = [
    `version: ${version}`,
    'files:',
    `  - url: ${basename(installer)}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${basename(installer)}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  ].join('\n')

  const target = join(root, 'release', 'latest.yml')
  writeFileSync(target, content, 'utf-8')
  return target
}

const latestYml = writeLatestYml()
console.log(`latest.yml: sha512 ${createHash('sha512').update(readFileSync(installer)).digest('base64').slice(0, 24)}...`)

// The installer is mandatory; latest.yml is what electron-updater reads to learn
// the file name and checksum; the blockmap only enables differential downloads.
const artifacts = [installer, latestYml, blockmap].filter((f) => existsSync(f))
console.log('artifacts:')
for (const file of artifacts) {
  console.log(`  ${file.replace(root, '.')}`)
}

if (dryRun) {
  console.log('\n--dry-run: built only, nothing published.')
  process.exit(0)
}

/* 2. Make sure the commit backing the tag is pushed ------------------ */
const branch = capture(gitBin, ['rev-parse', '--abbrev-ref', 'HEAD']).out || 'main'
const dirty = capture(gitBin, ['status', '--porcelain']).out
if (dirty) {
  console.warn('\n! Working tree is dirty; commit before releasing for a clean tag.')
}
const unpushed = capture(gitBin, ['log', `origin/${branch}..HEAD`, '--oneline'])
if (unpushed.ok && unpushed.out !== '') {
  console.warn(`\n! Unpushed commits on ${branch}:\n${unpushed.out}`)
  console.warn('  The tag would point at a commit GitHub does not have yet.')
}

/* 3. Create or update the release ----------------------------------- */
console.log(`\n=== publishing ${tag} to ${repo} ===`)

const exists = capture(ghBin, ['release', 'view', tag, '--repo', repo])
if (exists.ok) {
  console.log(`release ${tag} already exists - uploading artifacts`)
  run(ghBin, ['release', 'upload', tag, '--repo', repo, ...artifacts, '--clobber'])
} else {
  run(ghBin, [
    'release',
    'create',
    tag,
    '--repo',
    repo,
    '--title',
    version,
    '--notes',
    notes,
    ...artifacts
  ])
}

/* 4. Verify --------------------------------------------------------- */
console.log('\n=== verification ===')
const assets = capture(ghBin, [
  'release',
  'view',
  tag,
  '--repo',
  repo,
  '--json',
  'assets',
  '--template',
  '{{range .assets}}{{.name}} ({{.size}} bytes)\n{{end}}'
])
console.log(assets.out || '(no assets reported)')
console.log(`\nhttps://github.com/${repo}/releases/tag/${tag}`)
