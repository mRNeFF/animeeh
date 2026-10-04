/**
 * Regression test for covers and genres.
 *
 * Two paths must both work:
 *   1. Adding an anime through the AniList search must save its cover and
 *      genres. It did not: covers only ever worked via the N.xlsx import, so
 *      anything added by hand had no artwork.
 *   2. An entry that already exists with a source but no artwork must be healed
 *      when it is opened.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const errors = []

/* ------------------------------------------------------------------ */
/* 1. Add through the search must store the cover and genres           */
/* ------------------------------------------------------------------ */

const profileA = mkdtempSync(join(tmpdir(), 'animeeh-cover-a-'))
const appA = await electron.launch({ args: [root, `--user-data-dir=${profileA}`], cwd: root })
const winA = await appA.firstWindow()
winA.on('pageerror', (e) => errors.push(`[A pageerror] ${e.message}`))

try {
  await winA.waitForLoadState('domcontentloaded')
  await winA.waitForTimeout(1600)

  await winA.getByRole('button', { name: /Add your first anime/i }).click()
  await winA.waitForTimeout(400)
  await winA.locator('.al-block input.input').fill('sousou no frieren')
  await winA.locator('.al-result').first().waitFor({ state: 'visible', timeout: 25000 })
  await winA.locator('.al-result').first().click()
  await winA.waitForTimeout(3500)
  await winA.locator('.modal button[type=submit]').click()
  await winA.waitForTimeout(1800)

  // The detail header must show real artwork, not the initials fallback.
  await winA.locator('.detail-cover.cover-img img').waitFor({ state: 'visible', timeout: 15000 })
  const detailCover = await winA.locator('.detail-cover.cover-img img').getAttribute('src')
  const pills = (await winA.locator('.genre-pill').allInnerTexts()).join(', ')
  console.log(`ADD: detail cover = ${detailCover?.slice(0, 60)}…`)
  console.log(`ADD: genre pills   = [${pills}]`)

  // Back to the library: the card must render an image too.
  await winA.getByRole('button', { name: /^(Library|Bibliothèque)$/ }).click()
  await winA.waitForTimeout(1600)

  const cards = await winA.locator('.card').count()
  const cardImg = await winA.locator('.card-cover.cover-img img').count()
  const fallbacks = await winA.locator('.card-cover:not(.cover-img)').count()
  const decoded = await winA.locator('.card-cover img').evaluateAll((els) =>
    els.filter((el) => el.complete && el.naturalWidth > 0).length
  )
  console.log(`ADD: ${cards} card(s), ${cardImg} with an image element, ${fallbacks} on the fallback`)
  console.log(`ADD: ${decoded} image(s) actually decoded`)
  await winA.screenshot({ path: join(root, 'smoke-cover-added.png') })

  if (cardImg !== 1 || decoded !== 1) {
    throw new Error(`expected 1 decoded cover in the library, got ${cardImg} element(s), ${decoded} decoded`)
  }
} catch (err) {
  errors.push(`[A script] ${err.message}`)
  try {
    await winA.screenshot({ path: join(root, 'smoke-cover-added-failure.png') })
  } catch {
    /* ignore */
  }
} finally {
  await appA.close().catch(() => {})
}

/* ------------------------------------------------------------------ */
/* 2. An existing entry without artwork must heal on open              */
/* ------------------------------------------------------------------ */

const profileB = mkdtempSync(join(tmpdir(), 'animeeh-cover-b-'))
// Seed a data file the way an older build would have left it: a source id but
// no coverImage and no genres.
writeFileSync(
  join(profileB, 'animeeh-data.json'),
  JSON.stringify(
    {
      version: 1,
      settings: {
        weights: {
          characters: 1,
          story: 1,
          animation: 1,
          ost: 1,
          opening: 1,
          keyFactor: 1,
          originality: 1,
          episodeAverage: 1
        },
        checkForUpdatesOnStartup: false,
        language: 'en'
      },
      anime: [
        {
          id: 'legacy-1',
          title: 'Re:Zero kara Hajimeru Isekai Seikatsu',
          status: 'completed',
          episodes: [],
          criteria: {
            characters: 95,
            story: 100,
            animation: 85,
            ost: 95,
            opening: 90,
            keyFactor: 95,
            originality: 90
          },
          source: {
            provider: 'anilist',
            anilistId: 21355,
            malId: 31240,
            siteUrl: 'https://anilist.co/anime/21355'
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    },
    null,
    2
  ),
  'utf-8'
)

const appB = await electron.launch({ args: [root, `--user-data-dir=${profileB}`], cwd: root })
const winB = await appB.firstWindow()
winB.on('pageerror', (e) => errors.push(`[B pageerror] ${e.message}`))

try {
  await winB.waitForLoadState('domcontentloaded')
  await winB.waitForTimeout(2000)

  const beforeFallback = await winB.locator('.card-cover:not(.cover-img)').count()
  console.log(`HEAL: library before = ${beforeFallback} card(s) on the fallback`)

  // The app-level backfill must repair the CARD without opening the entry,
  // because that is what the library view shows.
  await winB.locator('.card-cover.cover-img img').waitFor({ state: 'visible', timeout: 25000 })
  const cardHealed = await winB.locator('.card-cover.cover-img img').count()
  const decoded = await winB.locator('.card-cover img').evaluateAll((els) =>
    els.filter((el) => el.complete && el.naturalWidth > 0).length
  )
  console.log(`HEAL: card cover appeared without opening the entry = ${cardHealed === 1}`)
  console.log(`HEAL: card image decoded = ${decoded === 1}`)

  await winB.locator('.card').first().click()
  await winB.waitForTimeout(1500)

  // The detail view shows the same cover and the restored genres.
  await winB.locator('.detail-cover.cover-img img').waitFor({ state: 'visible', timeout: 20000 })
  const healedCover = await winB.locator('.detail-cover.cover-img img').getAttribute('src')
  const healedPills = (await winB.locator('.genre-pill').allInnerTexts()).join(', ')
  console.log(`HEAL: cover restored = ${healedCover?.slice(0, 60)}…`)
  console.log(`HEAL: genres restored = [${healedPills}]`)

  // And it must persist, since the patch goes through the normal save path.
  await winB.reload()
  await winB.waitForTimeout(2000)
  const persisted = await winB.locator('.card-cover.cover-img img').count()
  console.log(`HEAL: after reload, ${persisted} card(s) with a cover`)
  await winB.screenshot({ path: join(root, 'smoke-cover-healed.png') })

  if (persisted !== 1) throw new Error(`cover did not persist, got ${persisted}`)
  if (healedPills.trim() === '') throw new Error('genres were not restored')
} catch (err) {
  errors.push(`[B script] ${err.message}`)
  try {
    await winB.screenshot({ path: join(root, 'smoke-cover-healed-failure.png') })
  } catch {
    /* ignore */
  }
} finally {
  await appB.close().catch(() => {})
}

if (errors.length) console.log('--- ERRORS ---\n' + errors.join('\n'))
else console.log('COVER TEST OK')

process.exit(errors.length ? 1 : 0)
