/**
 * Finds the query that returns the episodes which aired earlier today.
 *
 * `media.airingSchedule(notYetAired: false)` looks like the answer but is not: it
 * returns the oldest schedule nodes a show has, not the recent ones, and it
 * rejects `airingAt_greater` outright. If already-aired episodes are fetchable at
 * all, it is through the top-level `Page.airingSchedules`, so that is what this
 * probes — against a show that is airing right now, and with a window wide enough
 * that an empty answer means the query is wrong rather than the schedule empty.
 *
 * Usage: node scripts/probe-airing-args.mjs
 */
const ENDPOINT = 'https://graphql.anilist.co'

async function ask(query) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query })
  })
  const payload = await response.json()
  if (payload.errors?.length) return { error: payload.errors[0].message }
  return { data: payload.data }
}

const now = Math.floor(Date.now() / 1000)
const DAY = 86_400

function line(label, result, pick) {
  if (result.error) {
    console.log(`\n${label}\n  REJECTED: ${result.error}`)
    return
  }
  const value = pick(result.data)
  console.log(`\n${label}\n  ${JSON.stringify(value)}`)
}

// A show airing right now, so the window is guaranteed to contain something.
const trending = await ask(`query {
  Page(page: 1, perPage: 5) {
    media(type: ANIME, status: RELEASING, sort: TRENDING_DESC) {
      id
      title { romaji }
      nextAiringEpisode { episode airingAt }
    }
  }
}`)
const shows = trending.data?.Page?.media ?? []
console.log('airing now:')
for (const m of shows) {
  const when = m.nextAiringEpisode?.airingAt
  console.log(
    `  id ${m.id}  ${m.title?.romaji}  next ep ${m.nextAiringEpisode?.episode} at ${
      when ? new Date(when * 1000).toISOString() : 'n/a'
    }`
  )
}

const ids = shows.map((m) => m.id)
if (ids.length === 0) {
  console.log('\nno airing show found; cannot probe')
  process.exit(1)
}

// The exact shape the calendar would use: every library id in one request, over a
// window that starts at the beginning of the day and runs to the horizon.
line(
  `A) Page.airingSchedules(mediaId_in, airingAt_greater: startOfToday, airingAt_lesser: horizon)`,
  await ask(`query {
    Page(page: 1, perPage: 50) {
      airingSchedules(
        mediaId_in: ${JSON.stringify(ids)}
        airingAt_greater: ${now - DAY}
        airingAt_lesser: ${now + 2 * DAY}
      ) {
        episode
        airingAt
        media { id title { romaji } }
      }
    }
  }`),
  (d) => d.Page?.airingSchedules
)

// Whether the connection paginates, since a whole library could exceed one page.
line(
  `B) same query, asking for pageInfo`,
  await ask(`query {
    Page(page: 1, perPage: 50) {
      pageInfo { total currentPage lastPage hasNextPage }
      airingSchedules(mediaId_in: ${JSON.stringify(ids)}, airingAt_greater: ${now - DAY}, airingAt_lesser: ${now + 7 * DAY}) {
        episode
        airingAt
      }
    }
  }`),
  (d) => ({ pageInfo: d.Page?.pageInfo, count: d.Page?.airingSchedules?.length })
)

// Sorting matters: the renderer groups by day, so a stable chronological order
// keeps the batches from interleaving when they are merged.
line(
  `C) sort: TIME_DESC accepted`,
  await ask(`query {
    Page(page: 1, perPage: 5) {
      airingSchedules(mediaId_in: ${JSON.stringify(ids)}, airingAt_greater: ${now - 7 * DAY}, airingAt_lesser: ${now + 7 * DAY}, sort: TIME) {
        airingAt
      }
    }
  }`),
  (d) => d.Page?.airingSchedules?.map((s) => new Date(s.airingAt * 1000).toISOString())
)
