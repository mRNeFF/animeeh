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
 * downloads fail.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const version = pkg.version
const repo = 'mRNeFF/animeeh'
const tag = `v${version}`

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const notesIndex = args.indexOf('--notes')
const notes =
  notesIndex >= 0 && args[notesIndex + 1]
    ? args[notesIndex + 1]
    : `ANIMEEH ${version}`

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
    ...options
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf-8',
    shell: process.platform === 'win32'
  })
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() }
}

/* 1. Build ---------------------------------------------------------- */
console.log(`\n=== ANIMEEH ${version} — build ===`)
run('npm', ['run', 'dist'])

const installer = join(root, 'release', `ANIMEEH-${version}-setup.exe`)
const blockmap = `${installer}.blockmap`

if (!existsSync(installer)) {
  throw new Error(`Installer not found: ${installer}`)
}

// electron-updater on GitHub resolves files from the release assets, so the
// installer is mandatory. The blockmap only enables differential downloads.
const artifacts = [installer, blockmap].filter((f) => existsSync(f))
console.log('artifacts:')
for (const file of artifacts) {
  console.log(`  ${file.replace(root, '.')}`)
}

if (dryRun) {
  console.log('\n--dry-run: built only, nothing published.')
  process.exit(0)
}

/* 2. Make sure the commit backing the tag is pushed ------------------ */
const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
const status = capture('git', ['status', '--porcelain'])
if (status.out) {
  console.warn('\n! Working tree is dirty; commit before releasing for a clean tag.')
}
const unpushed = capture('git', ['log', `origin/${branch.out}..HEAD`, '--oneline'])
if (unpushed.ok && unpushed.out) {
  console.warn(`\n! Unpushed commits on ${branch.out}:\n${unpushed.out}`)
  console.warn('  The tag will point at a commit that is not on GitHub yet.')
}

/* 3. Create or update the release ----------------------------------- */
console.log(`\n=== publishing ${tag} to ${repo} ===`)

const exists = capture('gh', ['release', 'view', tag, '--repo', repo])
if (exists.ok) {
  console.log(`release ${tag} already exists — uploading artifacts`)
  run('gh', ['release', 'upload', tag, '--repo', repo, ...artifacts, '--clobber'])
} else {
  run('gh', [
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

console.log('\n=== done ===')
console.log(`https://github.com/${repo}/releases/tag/${tag}`)
