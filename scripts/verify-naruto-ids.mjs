/**
 * Confirms the AniList ids and exact titles for the Naruto split.
 *
 * Guessing an id would silently do nothing: FRANCHISE_SPLITS is keyed by id, so a
 * wrong key is simply never looked up. This asks AniList for the entries and
 * prints what it returns, with backoff so a rate limit is waited out rather than
 * reported as a failure.
 *
 * Usage: node scripts/verify-naruto-ids.mjs
 */
const ENDPOINT = 'https://graphql.anilist.co'

/** The ids the split is keyed on, and what each is expected to be. */
const EXPECTED = [
  { id: 20, title: 'Naruto', episodes: 220, group: 'naruto' },
  { id: 1735, title: 'Naruto: Shippuuden', episodes: 500, group: 'naruto-shippuden' }
]

const FIELDS = 'id format episodes title { romaji english } startDate { year }'

async function ask(query, attempt = 1) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })
  if (response.status === 429) {
    const wait = Math.min(60, 10 * attempt)
    console.log(`     429, waiting ${wait}s (attempt ${attempt})`)
    await new Promise((r) => setTimeout(r, wait * 1000))
    return ask(query, attempt + 1)
  }
  const json = await response.json()
  if (json.errors) throw new Error(json.errors[0].message)
  return json.data
}

const aliases = EXPECTED.map((e) => `m${e.id}: Media(id: ${e.id}) { ${FIELDS} }`).join('\n')
const data = await ask(`query {\n${aliases}\n}`)

let failures = 0
console.log('the entries FRANCHISE_SPLITS is keyed on:\n')

for (const expected of EXPECTED) {
  const media = data[`m${expected.id}`]
  if (!media) {
    failures += 1
    console.log(`  FAIL ${expected.id} returned nothing`)
    continue
  }
  const romaji = media.title.romaji
  const year = media.startDate?.year ?? '?'
  // AniList writes these two in capitals, "NARUTO" and "NARUTO: Shippuuden", so
  // the comparison is case-insensitive. The id is the part that must be right:
  // FRANCHISE_SPLITS is keyed by it, and a wrong key would simply never be read.
  const same = romaji.toLowerCase() === expected.title.toLowerCase()
  const countOk = media.episodes === expected.episodes
  if (!same || !countOk) failures += 1
  console.log(
    `  ${same && countOk ? 'OK  ' : 'NOTE'} id ${String(expected.id).padEnd(6)} ${media.format.padEnd(5)} ` +
      `${year}  ${String(media.episodes).padStart(4)} eps  ${JSON.stringify(romaji)}`
  )
  console.log(`        group ${expected.group}${countOk ? '' : `   expected ${expected.episodes} episodes`}`)
}

/* ---- And the pair is genuinely chained as sequels on AniList ---- */
console.log('\nis the pair chained by a sequel relation?\n')
const relations = await ask(
  `query { Media(id: 20) { relations { edges { relationType node { id title { romaji } format } } } } }`
)
const sequelToShippuden = relations.Media.relations.edges.find(
  (edge) => edge.node?.id === 1735
)
if (sequelToShippuden) {
  console.log(
    `  yes: Naruto --${sequelToShippuden.relationType}--> ${sequelToShippuden.node.title.romaji}`
  )
  console.log('  so without the curated split they would be chained into one entry')
} else {
  console.log('  no direct relation found from Naruto to 1735')
  const near = relations.Media.relations.edges
    .filter((e) => /naruto/i.test(e.node?.title?.romaji ?? ''))
    .map((e) => `${e.relationType} -> ${e.node.id} ${e.node.title.romaji}`)
  console.log(`  naruto-adjacent relations: ${near.length ? near.join(' | ') : 'none'}`)
  failures += 1
}

console.log(`\n${failures === 0 ? 'IDS CONFIRMED' : `${failures} to look at`}`)
process.exit(0)
