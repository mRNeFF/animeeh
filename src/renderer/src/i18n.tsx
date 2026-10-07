import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import type { ServiceName } from '../../shared/errors'

export type Language = 'en' | 'fr'

export const LANGUAGES: { key: Language; label: string }[] = [
  { key: 'en', label: 'English' },
  { key: 'fr', label: 'Français' }
]

/**
 * Every user-facing string, keyed. `en` is the source of truth: the `Messages`
 * type is derived from it, so a key missing from `fr` is a compile error rather
 * than a blank label at runtime.
 */
const en = {
  'nav.library': 'Anime',
  'nav.films': 'Films & OVA',
  'nav.leaderboard': 'Leaderboard',
  'nav.criteria': 'By Criteria',
  'nav.settings': 'Settings',

  'nav.schedule': 'Calendar',
  'title.schedule': 'Release calendar',
  'subtitle.schedule': 'What is coming for the anime you follow',
  'schedule.loading': 'Loading the calendar…',
  'schedule.refreshing': 'Refreshing…',
  'schedule.refresh': 'Refresh',
  'schedule.fetched': 'Updated {when} · covering the next {days} days',
  'schedule.empty.title': 'Nothing to track yet',
  'schedule.empty.body': 'Add some anime first, and their upcoming episodes will appear here.',
  'schedule.episodes': 'Upcoming episodes',
  'schedule.episodesSub': 'Your anime that are airing right now. {count} qualify, and their upcoming episodes are listed below.',
  'schedule.noEpisodes': 'None of your anime is airing at the moment, so there is no episode to show. Announced continuations are listed below.',
  'schedule.episode': 'Ep {number}',
  'schedule.seasons': 'Announced continuations',
  'schedule.seasonsSub': 'Next seasons of the anime you already have. AniList often knows only the broadcast season, so a date marked approximate really is approximate.',
  'schedule.noSeasons': 'No continuation is announced for the anime you have.',
  'schedule.after': 'after {title}',
  'schedule.dateUnknown': 'No date announced',
  'schedule.approximate': 'approx.',
  'schedule.imprecise': 'AniList knows only the broadcast season, not the exact day.',
  'schedule.airing': 'airing',
  'schedule.discovery': 'New this season',
  'schedule.discoverySub': 'Shows that started this season and are not in your list. Kept separate so your own tracking stays readable.',
  'schedule.showDiscovery': 'Show new shows',
  'schedule.hideDiscovery': 'Hide',
  'schedule.discoveryCount': '{count} found',
  'schedule.noDiscovery': 'Nothing new found for this season.',
  'schedule.nothingAtAll': 'The calendar is empty for the moment.',
  'nav.stats': 'Statistics',
  'title.stats': 'Statistics',
  'subtitle.stats': 'What your library adds up to',
  'stats.empty.title': 'Nothing to measure yet',
  'stats.empty.body': 'Add and rate some anime, and your statistics will appear here.',
  'stats.series': 'Series',
  'stats.films': 'Films & OVA',
  'stats.watchTimeDetail': 'How the watch time is built',
  'stats.watchTimeSub':
    'Only episodes you have rated count as watched. The listed figure is the upper bound, for the case where you watched everything in your list.',
  'stats.ratedOnly': 'Rated episodes only',
  'stats.listedUpper': 'Every listed episode',
  'stats.ratedEpisodesShort': 'Rated episodes',
  'stats.listedEpisodesShort': 'Listed episodes',
  'stats.minutes': '{count} min',
  'stats.partialDuration':
    '{count} entries have no duration from AniList, so an episode was counted as {episode} minutes for them.',
  'stats.fullDuration': 'Every entry used its real duration from AniList.',
  'stats.watchTime': 'Estimated watch time',
  'stats.averageScore': 'Average score',
  'stats.episodesRatedSub': '{rated} of {listed} episodes rated',
  'stats.episodes': 'Rated episodes',
  'stats.episodesSub':
    '{rated} episodes carry a rating out of {listed} listed. Only rated episodes count as watched, so this is the real figure rather than the number of rows.',
  'stats.coverage': '{percent}% of listed episodes rated',
  'stats.named': '{count} of {total} series have episode names',
  'stats.grades': 'Grade distribution',
  'stats.gradesSub': 'Every rated entry, by letter grade.',
  'stats.criteria': 'Average per criterion',
  'stats.criteriaSub': 'Where your ratings sit on average, across everything you have rated.',
  'stats.topGenres': 'Top genres',
  'stats.topStudios': 'Most watched studios',
  'stats.highlights': 'Highlights',
  'stats.best': 'Highest rated',
  'stats.worst': 'Lowest rated',
  'stats.longest': 'Longest series',
  'stats.favourites': 'Favourites',
  'stats.yearSpan': 'Years covered',
  'stats.averages': 'Average episode score',
  'stats.episodeUnit': '{count} episodes',
  'stats.estimateNote':
    'Watch time is estimated: unrated episodes are not counted, and entries with no duration from AniList are assumed to be {episode} minutes per episode or {film} minutes for a film.',

  'brand.tagline': 'rate · rank · repeat',
  'shell.loading': 'Loading your list…',
  'shell.saved': 'Saved locally',
  'shell.saving': 'Saving…',
  'shell.summary': '{anime} anime · {episodes} episodes',
  'shell.films': '{count} in Films & OVA',

  'title.library': 'Anime',
  'subtitle.library': 'Everything you have watched and scored',
  'title.leaderboard': 'Global Leaderboard',
  'subtitle.leaderboard': 'Your anime ranked by weighted score',
  'title.criteria': 'Rankings by Criteria',
  'subtitle.criteria': 'Compare shows on a single aspect',
  'title.settings': 'Settings',
  'subtitle.settings': 'Language, weights, updates and data',
  'title.films': 'Films & OVA',
  'subtitle.films': 'Films and OVAs you have watched and scored',
  'title.detail': 'Anime detail',
  'subtitle.detail': 'Score episodes and rate every criterion',

  'action.addAnime': 'Add anime',
  'action.cancel': 'Cancel',
  'action.save': 'Save',
  'action.delete': 'Delete',
  'action.editDetails': 'Edit details',
  'action.backToLibrary': 'Library',
  'action.saveChanges': 'Save changes',
  'action.remove': 'Remove',
  'action.expandAll': 'Expand all',
  'action.collapseAll': 'Collapse all',
  'action.clearRating': 'Clear rating',

  'field.year': 'Year',
  'field.studio': 'Studio',
  'field.status': 'Status',
  'field.episodes': 'Episodes',
  'field.title': 'Title',
  'field.englishTitle': 'English title',
  'field.notes': 'Notes',
  'field.optional': 'optional',
  'field.favourite': 'Favourite',

  'detail.openOnAniList': 'Open on AniList',
  'detail.openOnMal': 'Open on MyAnimeList',
  'detail.notesPlaceholder': 'Anything you want to remember about this show…',
  'detail.deleteWord': 'delete',

  'empty.noFilms.title': 'No films yet',
  'empty.noFilms.body':
    'Add the first anime film you have watched, then rate it on every criterion. Films live here and stay out of your series list.',
  'empty.noFilms.cta': 'Add your first film',
  'form.addFilm': 'Add film or OVA',
  'board.tab.global': 'Global',
  'board.tab.series': 'Series only',
  'board.tab.films': 'Films only',
  'board.tabHint': 'Rankings are computed separately: a film is never ranked against a series.',

  'empty.noAnime.title': 'No anime yet',
  'empty.noAnime.body':
    "Add the first show you've watched, then score its episodes from 0–100 and rate it on every criterion. ANIMEEH builds your global ranking automatically.",
  'empty.noAnime.cta': 'Add your first anime',
  'empty.nothingMatches': 'Nothing matches',
  'empty.nothingMatchesBody': 'No anime match the current search or filters.',
  'empty.noEpisodes.title': 'No episodes yet',
  'empty.noEpisodes.body':
    'Add episodes and score each one from 0 to 100. Unrated episodes are ignored by the average, so you can add a whole season first and rate as you watch.',
  'empty.notFound': 'Anime not found',
  'empty.leaderboard': 'Your leaderboard is empty',
  'empty.leaderboardBody': 'Add anime and rate them to build a ranking.',
  'empty.criteria': 'Nothing to rank yet',
  'empty.criteriaBody': 'Add anime and rate the criteria to see per-category rankings.',

  'library.search': 'Search title, studio…',
  'library.all': 'All',
  'library.sort': 'Sort: {label}',
  'library.count': '{shown} of {total} anime',
  'library.countFilms': '{shown} of {total} in Films & OVA',
  'library.episodeCount': '{count} eps',
  'library.genre': 'Genre',
  'library.allGenres': 'All genres',

  'sort.score': 'Global score',
  'sort.title': 'Title (A–Z)',
  'sort.year': 'Newest first',
  'sort.episodes': 'Most episodes',
  'sort.recent': 'Recently updated',

  'status.completed': 'Completed',
  'status.watching': 'Watching',
  'status.planned': 'Plan to watch',
  'status.on_hold': 'On hold',
  'status.dropped': 'Dropped',

  'criteria.characters': 'Characters',
  'criteria.story': 'Story',
  'criteria.animation': 'Animation',
  'criteria.ost': 'OST',
  'criteria.opening': 'Opening',
  'criteria.keyFactor': 'Key Factor',
  'criteria.originality': 'Originality',
  'criteria.episodeAverage': 'Episode average',

  'score.global': 'Global ({grade})',
  'score.notRated': 'Not rated yet',
  'score.autoAverage': '{value} auto',
  'score.noEpisodes': 'no episodes',
  'score.ratedOf': '{rated} rated / {listed} listed',
  'score.ofTotal': ' / {total} total',
  'score.avg': ' · avg {value}',
  'score.noRatingYet': ' · no rating yet',

  'detail.section.weights': 'How the global score is built',
  'detail.section.weightsSub':
    'Weighted average of every rated component. Change weights in Settings.',
  'detail.section.episodes': 'Episodes',
  'detail.section.notes': 'Notes',

  'diff.hint':
    'Rate each criterion from 0–100. The episode average is added as its own component.',
  'diff.noEpisodesYet': 'no episodes yet',
  'diff.epHeader': 'EP',
  'diff.titleHeader': 'TITLE (optional)',
  'diff.scoreHeader': 'SCORE',
  'diff.favourite': 'Personal favourite',
  'diff.lastUpdated': 'Status: {status} · Last updated {date}',
  'diff.addEpisode': 'Episode',
  'diff.addBatch': 'Add batch',
  'diff.fillMissing': 'Fill {count} missing',
  'diff.favouriteEpisodeOf': 'Episode {number}',
  'diff.loadNames': 'Load episode names',
  'diff.loadingNames': 'Loading…',
  'diff.loadNamesHint':
    'Episode names come from Kitsu, with AniList as a fallback. Existing ratings and titles you edited yourself are never overwritten.',
  'diff.namesLoaded': 'Loaded {count} episode names.',
  'diff.namesPartial': 'Loaded {count} episode names; nothing found for season(s) {seasons}.',
  'diff.namesFailed': 'Could not load episode names: {error}',
  'diff.noReference': 'Add this anime from the AniList search to be able to load episode names.',

  'form.addTitle': 'Add anime',
  'form.addSubtitle':
    'Search AniList to pre-fill, or type everything manually. Seasons of the same series are merged into one entry.',
  'form.editTitle': 'Edit anime',
  'form.editSubtitle': 'Update the details for this entry.',
  'form.search': 'Search AniList (e.g. frieren)…',
  'form.searchFilm': 'Search films and OVAs (e.g. re:zero)…',
  'form.searching': 'Searching AniList…',
  'form.unreachable': 'AniList unreachable: {error}',
  'form.manualFallback': 'You can still fill in the details manually below.',
  'form.noResults': 'No results for “{query}”.',
  'form.seasons': '{count} seasons',
  'form.oneSeason': '1 season',
  'form.noMalId': 'no MAL id',
  'form.assembling': ' · assembling seasons…',
  'form.createAll': 'Create all {count} episodes automatically',
  'form.withTitles': ' ({count} with titles)',
  'form.acrossSeasons': ', numbered continuously across seasons',
  'form.willBeCreated': '{count} episode(s) will be created',
  'form.title': 'Title *',
  'form.englishTitle': 'English title',
  'form.optional': 'optional',
  'form.year': 'Year',
  'form.studio': 'Studio',
  'form.status': 'Status',
  'form.notes': 'Notes',
  'form.notesPlaceholder': 'Thoughts, favourite arc, where you watched it…',
  'form.episodePlaceholder': 'Episode {number}',
  'form.film': 'Film',
  'form.ova': 'OVA',
  'form.filmTitlePlaceholder': 'e.g. Your Name',
  'form.titlePlaceholder': "e.g. Frieren: Beyond Journey's End",
  'form.favourite': 'Mark as a personal favourite',
  'form.studioPlaceholder': 'e.g. Madhouse',
  'form.episodeCount': '{count} eps',
  'form.episodesUnknown': 'eps unknown',
  'form.partsMerged': '{count} parts merged',

  'delete.confirm': 'Delete “{title}”?',
  'delete.body':
    'This permanently removes the anime, all its episode scores and criteria. Type {word} to confirm.',

  'criteria.rankingBy': 'Ranking by',
  'criteria.scoredHint': '— scored 0–100. Unrated entries are listed last.',

  'board.hint':
    'Ranked by weighted global score. Click any column header to re-sort; click a row to open it. Unrated components are excluded from the average.',
  'board.avg': 'Avg',
  'board.global': 'Global',
  'board.grade': 'Grade',
  'board.title': 'Title',
  'board.eps': 'Eps',
  'board.summary': '{count} anime · global score = weighted mean of rated criteria + episode average.',
  'board.average': 'Average of your rated shows: {value}.',
  'board.noDetails': 'No details',
  'board.find': 'Find a title…',
  'board.findCount': '{current} / {total}',
  'board.findNone': 'No match',
  'board.findPrev': 'Previous match',
  'board.findNext': 'Next match',
  'board.findClear': 'Clear the search',
  'board.findShortcut': 'Press / to search',

  'settings.language': 'Language',
  'settings.languageSub': 'Language used across the interface.',
  'settings.startup': 'Startup',
  'settings.startupSub': 'Behaviour when the app launches.',
  'settings.checkOnStartup': 'Check for updates on startup',
  'settings.checkOnStartupSub':
    'Looks for a new release a few seconds after launch and shows a badge if one is found.',
  'settings.weights': 'Criteria weights',
  'settings.weightsSub':
    'Each component is scored 0–100. The global score is the weighted mean of the components you have rated. Weight 0 removes a component from the calculation.',
  'settings.resetWeights': 'Reset to equal weights',
  'settings.totalWeight': 'Total weight: {value}',
  'settings.backups': 'Backups & data',
  'settings.backupsSub':
    "Your list is stored locally as JSON in the app's data folder. Export a copy to move it between machines.",
  'settings.export': 'Export backup',
  'settings.import': 'Import backup',
  'settings.reveal': 'Show data file',
  'settings.genres': 'Genres',
  'settings.genresSub': 'Genres present in your library, from the reference source.',

  'settings.episodes': 'Episode names',
  'settings.episodesSub':
    'Episode names come from Kitsu, with AniList as a fallback. This fills every anime that has a reference and no names yet, creating the episode rows as it goes. Titles you wrote yourself and all your ratings are left untouched.',
  'settings.episodesLoad': 'Load all episode names',
  'settings.episodesRunningShort': 'Loading…',
  'settings.episodesRunning': 'Loading {done}/{total}…',
  'settings.episodesStopped': 'Stopped at {done}/{total}.',
  'settings.episodesStop': 'Stop',
  'settings.episodesCount': '{count} anime can be filled.',
  'settings.episodesReplace': 'Replace existing titles',
  'settings.episodesReplaceSub':
    'Overwrites titles that are already there. Use this once to repair names written at the wrong episode by an earlier version.',
  'settings.episodesNothing': 'Nothing to do — every anime already has its episode names.',
  'settings.episodesDone': '{count} anime filled',
  'settings.episodesEmpty': '{count} with no names available',
  'settings.episodesFailed': '{count} failed',
  'settings.episodesSkipped': '{count} already had names',

  'season.count': '{count} seasons',
  'season.expandAll': 'Expand all',
  'season.collapseAll': 'Collapse all',
  'season.label': 'Season {number}',
  'season.declared': '{count} eps',
  'season.rated': '{rated}/{total} rated',
  'season.avg': 'avg {value}',
  'season.noEpisodes': 'No episodes in this season yet.',

  'settings.danger': 'Danger zone',  'settings.dangerSub': 'Irreversible actions. Export a backup first if you might change your mind.',
  'settings.clear': 'Clear the entire ranking',
  'settings.clearHint':
    'Removes every anime, episode score and criterion rating. Your language and weights are kept.',
  'settings.clearConfirmTitle': 'Clear the entire ranking?',
  'settings.clearConfirmBody':
    'This permanently deletes all {count} anime, with every episode score and criterion rating. This cannot be undone. Type {word} to confirm.',
  'settings.clearWord': 'clear all',
  'settings.clearDone': 'Ranking cleared.',

  'service.anilist': 'AniList',
  'service.kitsu': 'Kitsu',
  'service.animethemes': 'AnimeThemes',

  'nav.tierlist': 'TierList',
  'title.tierlist': 'TierList',
  'subtitle.tierlist': 'Your rankings by universe',
  'empty.tierlist.title': 'No tier list yet',
  'empty.tierlist.body':
    'Create your first ranking: choose what to rank, drag the elements in, then export a picture of it.',
  'empty.tierlist.cta': 'Create a tierlist',

  'tierlist.new': 'Create a tierlist',
  'tierlist.defaultName': 'Tier list',
  'tierlist.count': '{count} tier list(s)',
  'tierlist.items': '{count} elements',
  'tierlist.rename': 'Rename',
  'tierlist.delete': 'Delete',
  'tierlist.confirmDelete': 'Delete this tier list?',
  'tierlist.confirmDeleteBody': 'Its {count} elements and their placements are lost. Data files are not affected.',
  'tierlist.namePlaceholder': 'Tier list name',

  'tierlist.filter.all': 'Everything',
  'tierlist.filter.anime': 'Anime',
  'tierlist.filter.character': 'Characters',
  'tierlist.filter.season': 'Seasons',
  'tierlist.filter.theme': 'Openings & endings',
  'tierlist.filter.ost': 'Soundtracks',

  'tierlist.pool': 'Unranked',
  'tierlist.poolEmpty': 'Everything is placed.',
  'tierlist.addItems': 'Add elements',
  'tierlist.noScores': 'Rate some anime first, so there is something to sort.',
  'tierlist.sortByScore': 'Sort by score',
  'tierlist.sortByScoreHint':
    'Places your anime in the rows matching the scores you already gave them, so you only adjust.',
  'tierlist.clearPlacements': 'Clear the board',
  'tierlist.export': 'Export as image',
  'tierlist.exportDone': 'Saved to {path}',
  'tierlist.back': 'All tier lists',
  'tierlist.orphan': 'No longer in your library',
  'tierlist.helpDrag': 'Drag an element onto a row, or select some and press S, A, B…',
  'tierlist.selected': '{count} selected',

  'tierlist.style.title': 'Row options',
  'tierlist.style.open': 'Row options: text, font and colours',
  'tierlist.style.text': 'Text',
  'tierlist.style.font': 'Font',
  'tierlist.style.background': 'Background',
  'tierlist.style.textColor': 'Text colour',
  'tierlist.style.size': 'Text size',
  'tierlist.style.custom': 'Custom colour',
  'tierlist.style.onLight': 'Light text',
  'tierlist.style.onDark': 'Dark text',
  'tierlist.style.reset': 'Palette',
  'tierlist.style.done': 'Done',
  'tierlist.style.row': 'This row',
  'tierlist.style.moveUp': 'Move up',
  'tierlist.style.moveDown': 'Move down',
  'tierlist.style.deleteRow': 'Delete the row',
  'tierlist.style.lastRow': 'A tier list needs at least one row.',
  'tierlist.addRow': 'Add a row',

  'tierlist.menu.anilistAnime': 'Open on AniList',
  'tierlist.menu.anilistCharacter': 'Open on AniList',
  'tierlist.menu.web': 'Search the web',
  'tierlist.menu.remove': 'Remove',

  'tierlist.picker.title': 'Add elements',
  'tierlist.picker.search': 'Search an anime, a character, a song…',
  'tierlist.picker.tracked': 'in your list',
  'tierlist.picker.typeToSearch': 'Type at least two letters.',
  'tierlist.picker.alreadyAdded': 'Already in the tier list',
  'tierlist.picker.themes': 'Openings and endings',
  'tierlist.picker.noThemes': 'No opening or ending found for this anime.',
  'tierlist.picker.all': 'Add all {count}',
  'tierlist.picker.added': '{count} added',
  'tierlist.picker.none': 'Nothing found.',
  'tierlist.picker.close': 'Close',
  'tierlist.picker.loading': 'Loading…',
  'tierlist.picker.ostWhy':
    'No source lists soundtrack tracks. Neither AniList, Kitsu, AniDB nor AnimeThemes covers them — they are catalogues, not music databases.',
  'tierlist.picker.ostLabel': 'Track title',
  'tierlist.picker.ostAdd': 'Add the track',

  'error.unreachable': 'Could not reach {service}. Check your connection.',
  'error.timeout': '{service} did not respond in time.',
  'error.rateLimit': 'Too many requests to {service}. Wait a moment and try again.',
  'error.http': '{service} replied with an error{status}.',
  'error.empty': '{service} returned an empty response.',
  'error.noReference': 'This entry has no AniList reference to look episodes up by.',
  'error.noEpisodeNames': 'The sources have no episode names for this anime.',
  'error.noFeed': 'No update feed is configured for this build.',
  'error.noUpdateToDownload': 'No update available to download.',
  'error.unknown': 'Something went wrong: {detail}',

  'update.title': 'Updates',
  'update.reading': 'Reading update status…',
  'update.version': 'Version',
  'update.noFeed': 'no feed configured',
  'update.stage.idle': 'Ready',
  'update.stage.checking': 'Checking…',
  'update.stage.available': 'Update available',
  'update.stage.not-available': 'Up to date',
  'update.stage.downloading': 'Downloading…',
  'update.stage.downloaded': 'Ready to install',
  'update.stage.error': 'Error',
  'update.available': 'Version {version} is available.',
  'update.downloaded': 'Version {version} downloaded. Restart to apply it.',
  'update.check': 'Check for updates',
  'update.checking': 'Checking…',
  'update.download': 'Download update',
  'update.starting': 'Starting…',
  'update.install': 'Restart and install',
  'update.notAvailable':
    'Updates are only available in the installed build, once a release feed is configured.',
  'update.badge': 'Update {version}',
  'update.badgeReady': 'Update ready',
  'update.badgeTitleReady': 'Update downloaded — open Settings to install',
  'update.badgeTitle': 'Version {version} is available'
} as const

export type MessageKey = keyof typeof en

const fr: Record<MessageKey, string> = {
  'nav.library': 'Animé',
  'nav.films': 'Films & OVA',
  'nav.leaderboard': 'Classement',
  'nav.criteria': 'Par critère',
  'nav.settings': 'Réglages',

  'nav.schedule': 'Calendrier',
  'title.schedule': 'Calendrier des sorties',
  'subtitle.schedule': 'Ce qui arrive pour les animés que vous suivez',
  'schedule.loading': 'Chargement du calendrier…',
  'schedule.refreshing': 'Actualisation…',
  'schedule.refresh': 'Actualiser',
  'schedule.fetched': 'Mis à jour le {when} · {days} jours à venir',
  'schedule.empty.title': 'Rien à suivre pour le moment',
  'schedule.empty.body': 'Ajoutez d’abord des animés, et leurs prochains épisodes apparaîtront ici.',
  'schedule.episodes': 'Prochains épisodes',
  'schedule.episodesSub': 'Vos animés actuellement en diffusion. {count} sont concernés ; leurs épisodes à venir sont listés ci-dessous.',
  'schedule.noEpisodes': 'Aucun de vos animés n’est en diffusion en ce moment, il n’y a donc pas d’épisode à afficher. Les suites annoncées sont plus bas.',
  'schedule.episode': 'Ép. {number}',
  'schedule.seasons': 'Suites annoncées',
  'schedule.seasonsSub': 'Les prochaines saisons des animés que vous avez déjà. AniList ne connaît souvent que la saison de diffusion : une date marquée « approx. » l’est vraiment.',
  'schedule.noSeasons': 'Aucune suite n’est annoncée pour vos animés.',
  'schedule.after': 'après {title}',
  'schedule.dateUnknown': 'Date non annoncée',
  'schedule.approximate': 'approx.',
  'schedule.imprecise': 'AniList ne connaît que la saison de diffusion, pas le jour exact.',
  'schedule.airing': 'en diffusion',
  'schedule.discovery': 'Nouveautés de la saison',
  'schedule.discoverySub': 'Des animés lancés cette saison et absents de votre liste. Cette section est séparée pour que votre suivi reste lisible.',
  'schedule.showDiscovery': 'Voir les nouveautés',
  'schedule.hideDiscovery': 'Masquer',
  'schedule.discoveryCount': '{count} trouvés',
  'schedule.noDiscovery': 'Aucune nouveauté trouvée pour cette saison.',
  'schedule.nothingAtAll': 'Le calendrier est vide pour le moment.',

  'nav.stats': 'Statistiques',
  'title.stats': 'Statistiques',
  'subtitle.stats': 'Ce que votre liste représente',
  'stats.empty.title': 'Rien à mesurer pour le moment',
  'stats.empty.body': 'Ajoutez et notez des animés, vos statistiques apparaîtront ici.',
  'stats.series': 'Séries',
  'stats.films': 'Films & OVA',
  'stats.watchTime': 'Temps de visionnage estimé',
  'stats.watchTimeDetail': 'Comment le temps est calculé',
  'stats.watchTimeSub':
    'Seuls les épisodes que vous avez notés comptent comme vus. Le chiffre « tous les épisodes » est la borne haute, dans le cas où vous auriez tout regardé.',
  'stats.ratedOnly': 'Épisodes notés seulement',
  'stats.listedUpper': 'Tous les épisodes listés',
  'stats.ratedEpisodesShort': 'Épisodes notés',
  'stats.listedEpisodesShort': 'Épisodes listés',
  'stats.minutes': '{count} min',
  'stats.partialDuration':
    '{count} fiches n’ont pas de durée fournie par AniList : un épisode a donc été compté {episode} minutes pour elles.',
  'stats.fullDuration': 'Chaque fiche a utilisé sa durée réelle fournie par AniList.',
  'stats.averageScore': 'Score moyen',
  'stats.episodesRatedSub': '{rated} épisodes notés sur {listed}',
  'stats.episodes': 'Épisodes notés',
  'stats.episodesSub':
    '{rated} épisodes portent une note sur {listed} listés. Seuls les épisodes notés comptent comme vus : c’est donc le chiffre réel, et non le nombre de lignes.',
  'stats.coverage': '{percent}% des épisodes listés sont notés',
  'stats.named': '{count} séries sur {total} ont leurs noms d’épisodes',
  'stats.grades': 'Répartition des notes',
  'stats.gradesSub': 'Toutes vos fiches notées, par lettre.',
  'stats.criteria': 'Moyenne par critère',
  'stats.criteriaSub':
    'Où se situent vos notes en moyenne, sur tout ce que vous avez noté.',
  'stats.topGenres': 'Genres principaux',
  'stats.topStudios': 'Studios les plus vus',
  'stats.highlights': 'Points marquants',
  'stats.best': 'Mieux noté',
  'stats.worst': 'Moins bien noté',
  'stats.longest': 'Série la plus longue',
  'stats.favourites': 'Favoris',
  'stats.yearSpan': 'Années couvertes',
  'stats.averages': 'Note moyenne des épisodes',
  'stats.episodeUnit': '{count} épisodes',
  'stats.estimateNote':
    'Le temps de visionnage est une estimation : les épisodes non notés ne sont pas comptés, et les fiches sans durée AniList sont supposées durer {episode} minutes par épisode ou {film} minutes pour un film.',

  'brand.tagline': 'noter · classer · répéter',
  'shell.loading': 'Chargement de votre liste…',
  'shell.saved': 'Enregistré localement',
  'shell.saving': 'Enregistrement…',
  'shell.summary': '{anime} animés · {episodes} épisodes',
  'shell.films': '{count} en Films & OVA',

  'title.library': 'Animé',
  'subtitle.library': 'Tout ce que vous avez vu et noté',
  'title.leaderboard': 'Classement global',
  'subtitle.leaderboard': 'Vos animés classés par score pondéré',
  'title.criteria': 'Classement par critère',
  'subtitle.criteria': 'Comparez les animés sur un seul aspect',
  'title.settings': 'Réglages',
  'subtitle.settings': 'Langue, pondérations, mises à jour et données',
  'title.films': 'Films & OVA',
  'subtitle.films': 'Les films et OVA que vous avez vus et notés',
  'title.detail': "Fiche de l'animé",
  'subtitle.detail': 'Notez les épisodes et chaque critère',

  'action.addAnime': 'Ajouter un animé',
  'action.cancel': 'Annuler',
  'action.save': 'Enregistrer',
  'action.delete': 'Supprimer',
  'action.editDetails': 'Modifier la fiche',
  'action.backToLibrary': 'Bibliothèque',
  'action.saveChanges': 'Enregistrer',
  'action.remove': 'Retirer',
  'action.expandAll': 'Tout déplier',
  'action.collapseAll': 'Tout replier',
  'action.clearRating': 'Effacer la note',

  'field.year': 'Année',
  'field.studio': 'Studio',
  'field.status': 'Statut',
  'field.episodes': 'Épisodes',
  'field.title': 'Titre',
  'field.englishTitle': 'Titre anglais',
  'field.notes': 'Notes',
  'field.optional': 'optionnel',
  'field.favourite': 'Favori',

  'detail.openOnAniList': 'Ouvrir sur AniList',
  'detail.openOnMal': 'Ouvrir sur MyAnimeList',
  'detail.notesPlaceholder': 'Ce que vous voulez retenir de cet animé…',
  'detail.deleteWord': 'supprimer',

  'empty.noFilms.title': 'Aucun film',
  'empty.noFilms.body':
    'Ajoutez le premier film d’animation que vous avez vu, puis notez chaque critère. Les films vivent ici et ne polluent pas votre liste de séries.',
  'empty.noFilms.cta': 'Ajouter votre premier film',
  'form.addFilm': 'Ajouter un film ou un OVA',
  'board.tab.global': 'Global',
  'board.tab.series': 'Séries uniquement',
  'board.tab.films': 'Films uniquement',
  'board.tabHint':
    'Les classements sont calculés séparément : un film n’est jamais classé face à une série.',

  'empty.noAnime.title': 'Aucun animé',
  'empty.noAnime.body':
    'Ajoutez la première série que vous avez vue, notez ses épisodes de 0 à 100 puis chaque critère. ANIMEEH construit votre classement automatiquement.',
  'empty.noAnime.cta': 'Ajouter votre premier animé',
  'empty.nothingMatches': 'Aucun résultat',
  'empty.nothingMatchesBody': 'Aucun animé ne correspond à la recherche ou aux filtres.',
  'empty.noEpisodes.title': 'Aucun épisode',
  'empty.noEpisodes.body':
    'Ajoutez des épisodes et notez-les de 0 à 100. Les épisodes non notés sont ignorés dans la moyenne : vous pouvez donc créer une saison entière puis noter au fil du visionnage.',
  'empty.notFound': 'Animé introuvable',
  'empty.leaderboard': 'Votre classement est vide',
  'empty.leaderboardBody': 'Ajoutez et notez des animés pour construire un classement.',
  'empty.criteria': 'Rien à classer',
  'empty.criteriaBody': 'Ajoutez des animés et notez les critères pour voir les classements.',

  'library.search': 'Rechercher un titre, un studio…',
  'library.all': 'Tous',
  'library.sort': 'Tri : {label}',
  'library.count': '{shown} sur {total} animés',
  'library.countFilms': '{shown} sur {total} en Films & OVA',
  'library.episodeCount': '{count} ép.',
  'library.genre': 'Genre',
  'library.allGenres': 'Tous les genres',

  'sort.score': 'Score global',
  'sort.title': 'Titre (A–Z)',
  'sort.year': 'Plus récents',
  'sort.episodes': "Plus d'épisodes",
  'sort.recent': 'Modifiés récemment',

  'status.completed': 'Terminé',
  'status.watching': 'En cours',
  'status.planned': 'À voir',
  'status.on_hold': 'En pause',
  'status.dropped': 'Abandonné',

  'criteria.characters': 'Personnages',
  'criteria.story': 'Histoire',
  'criteria.animation': 'Animation',
  'criteria.ost': 'OST',
  'criteria.opening': 'Opening',
  'criteria.keyFactor': 'Facteur clé',
  'criteria.originality': 'Originalité',
  'criteria.episodeAverage': 'Moyenne des épisodes',

  'score.global': 'Global ({grade})',
  'score.notRated': 'Pas encore noté',
  'score.autoAverage': '{value} auto',
  'score.noEpisodes': 'aucun épisode',
  'score.ratedOf': '{rated} notés / {listed} listés',
  'score.ofTotal': ' / {total} au total',
  'score.avg': ' · moy. {value}',
  'score.noRatingYet': ' · pas encore noté',

  'detail.section.weights': 'Comment le score global est calculé',
  'detail.section.weightsSub':
    'Moyenne pondérée de chaque composante notée. Modifiez les poids dans les Réglages.',
  'detail.section.episodes': 'Épisodes',
  'detail.section.notes': 'Notes',

  'diff.hint':
    'Notez chaque critère de 0 à 100. La moyenne des épisodes est ajoutée comme composante.',
  'diff.noEpisodesYet': 'aucun épisode',
  'diff.epHeader': 'ÉP',
  'diff.titleHeader': 'TITRE (optionnel)',
  'diff.scoreHeader': 'NOTE',
  'diff.favourite': 'Favori personnel',
  'diff.lastUpdated': 'Statut : {status} · Modifié {date}',
  'diff.addEpisode': 'Épisode',
  'diff.addBatch': 'Ajouter par lot',
  'diff.fillMissing': 'Compléter {count} manquants',
  'diff.favouriteEpisodeOf': 'Épisode {number}',
  'diff.loadNames': 'Charger les noms des épisodes',
  'diff.loadingNames': 'Chargement…',
  'diff.loadNamesHint':
    'Les noms viennent de Kitsu, avec AniList en secours. Vos notes existantes et les titres que vous avez saisis ne sont jamais écrasés.',
  'diff.namesLoaded': '{count} noms d’épisodes chargés.',
  'diff.namesPartial': '{count} noms chargés ; rien trouvé pour la/les saison(s) {seasons}.',
  'diff.namesFailed': 'Impossible de charger les noms : {error}',
  'diff.noReference':
    'Ajoutez cet animé via la recherche AniList pour pouvoir charger les noms d’épisodes.',

  'form.addTitle': 'Ajouter un animé',
  'form.addSubtitle':
    "Cherchez sur AniList pour pré-remplir, ou saisissez tout à la main. Les saisons d'une même série sont regroupées en une seule fiche.",
  'form.editTitle': "Modifier l'animé",
  'form.editSubtitle': 'Mettez à jour les informations de cette fiche.',
  'form.search': 'Rechercher sur AniList (ex. frieren)…',
  'form.searchFilm': 'Rechercher un film ou un OVA (ex. re:zero)…',
  'form.searching': 'Recherche sur AniList…',
  'form.unreachable': 'AniList injoignable : {error}',
  'form.manualFallback': 'Vous pouvez saisir les informations manuellement ci-dessous.',
  'form.noResults': 'Aucun résultat pour « {query} ».',
  'form.seasons': '{count} saisons',
  'form.oneSeason': '1 saison',
  'form.noMalId': 'pas d’ID MAL',
  'form.assembling': ' · assemblage des saisons…',
  'form.createAll': 'Créer les {count} épisodes automatiquement',
  'form.withTitles': ' ({count} avec titres)',
  'form.acrossSeasons': ', numérotés en continu sur toutes les saisons',
  'form.willBeCreated': '{count} épisode(s) seront créés',
  'form.title': 'Titre *',
  'form.englishTitle': 'Titre anglais',
  'form.optional': 'optionnel',
  'form.year': 'Année',
  'form.studio': 'Studio',
  'form.status': 'Statut',
  'form.notes': 'Notes',
  'form.notesPlaceholder': 'Impressions, arc préféré, où vous l’avez vu…',
  'form.episodePlaceholder': 'Épisode {number}',
  'form.film': 'Film',
  'form.ova': 'OVA',
  'form.filmTitlePlaceholder': 'ex. Your Name',
  'form.titlePlaceholder': "ex. Frieren: Beyond Journey's End",
  'form.favourite': 'Marquer comme favori personnel',
  'form.studioPlaceholder': 'ex. Madhouse',
  'form.episodeCount': '{count} ép.',
  'form.episodesUnknown': 'ép. inconnus',
  'form.partsMerged': '{count} parties fusionnées',

  'delete.confirm': 'Supprimer « {title} » ?',
  'delete.body':
    'Cela supprime définitivement l’animé, toutes ses notes d’épisodes et ses critères. Tapez {word} pour confirmer.',

  'criteria.rankingBy': 'Classement par',
  'criteria.scoredHint': '— noté de 0 à 100. Les fiches non notées sont en dernier.',

  'board.hint':
    'Classé par score global pondéré. Cliquez un en-tête de colonne pour retrier, une ligne pour l’ouvrir. Les composantes non notées sont exclues de la moyenne.',
  'board.avg': 'Moy.',
  'board.global': 'Global',
  'board.grade': 'Note',
  'board.title': 'Titre',
  'board.eps': 'Ép.',
  'board.summary':
    '{count} animés · score global = moyenne pondérée des critères notés + moyenne des épisodes.',
  'board.average': 'Moyenne de vos animés notés : {value}.',
  'board.noDetails': 'Aucun détail',
  'board.find': 'Rechercher un titre…',
  'board.findCount': '{current} / {total}',
  'board.findNone': 'Aucun résultat',
  'board.findPrev': 'Résultat précédent',
  'board.findNext': 'Résultat suivant',
  'board.findClear': 'Effacer la recherche',
  'board.findShortcut': 'Appuyez sur / pour rechercher',

  'settings.language': 'Langue',
  'settings.languageSub': 'Langue utilisée dans toute l’interface.',
  'settings.startup': 'Démarrage',
  'settings.startupSub': 'Comportement au lancement de l’application.',
  'settings.checkOnStartup': 'Vérifier les mises à jour au démarrage',
  'settings.checkOnStartupSub':
    'Cherche une nouvelle version quelques secondes après le lancement et affiche un badge le cas échéant.',
  'settings.weights': 'Pondération des critères',
  'settings.weightsSub':
    'Chaque composante est notée de 0 à 100. Le score global est la moyenne pondérée des composantes notées. Un poids de 0 retire la composante du calcul.',
  'settings.resetWeights': 'Réinitialiser à poids égaux',
  'settings.totalWeight': 'Poids total : {value}',
  'settings.backups': 'Sauvegardes et données',
  'settings.backupsSub':
    'Votre liste est stockée localement en JSON dans le dossier de données de l’application. Exportez une copie pour la transférer.',
  'settings.export': 'Exporter une sauvegarde',
  'settings.import': 'Importer une sauvegarde',
  'settings.reveal': 'Afficher le fichier de données',
  'settings.genres': 'Genres',
  'settings.genresSub': 'Genres présents dans votre liste, issus de la source de référence.',

  'season.count': '{count} saisons',
  'season.expandAll': 'Tout déplier',
  'season.collapseAll': 'Tout replier',
  'season.label': 'Saison {number}',
  'season.declared': '{count} ép.',
  'season.rated': '{rated}/{total} notés',
  'season.avg': 'moy. {value}',
  'season.noEpisodes': 'Aucun épisode dans cette saison pour le moment.',

  'settings.episodes': 'Noms des épisodes',
  'settings.episodesSub':
    'Les noms viennent de Kitsu, avec AniList en secours. Ceci remplit tous les animés ayant une référence mais pas encore de noms, en créant les épisodes au passage. Vos titres saisis et toutes vos notes sont préservés.',
  'settings.episodesLoad': 'Charger tous les noms d’épisodes',
  'settings.episodesRunningShort': 'Chargement…',
  'settings.episodesRunning': 'Chargement {done}/{total}…',
  'settings.episodesStopped': 'Arrêté à {done}/{total}.',
  'settings.episodesStop': 'Arrêter',
  'settings.episodesCount': '{count} animés peuvent être remplis.',
  'settings.episodesReplace': 'Remplacer les titres existants',
  'settings.episodesReplaceSub':
    'Écrase les titres déjà présents. À utiliser une fois pour réparer les noms placés sur le mauvais épisode par une version précédente.',
  'settings.episodesNothing': 'Rien à faire — tous les animés ont déjà leurs noms d’épisodes.',
  'settings.episodesDone': '{count} animés remplis',
  'settings.episodesEmpty': '{count} sans noms disponibles',
  'settings.episodesFailed': '{count} en échec',
  'settings.episodesSkipped': '{count} avaient déjà des noms',

  'settings.danger': 'Zone de danger',  'settings.dangerSub':
    'Actions irréversibles. Exportez une sauvegarde avant, au cas où vous changeriez d’avis.',
  'settings.clear': 'Vider tout le classement',
  'settings.clearHint':
    'Supprime tous les animés, leurs notes d’épisodes et leurs critères. Votre langue et vos pondérations sont conservées.',
  'settings.clearConfirmTitle': 'Vider tout le classement ?',
  'settings.clearConfirmBody':
    'Cela supprime définitivement les {count} animés, avec chaque note d’épisode et chaque critère. C’est irréversible. Tapez {word} pour confirmer.',
  'settings.clearWord': 'tout effacer',
  'settings.clearDone': 'Classement vidé.',

  'nav.tierlist': 'TierList',
  'title.tierlist': 'TierList',
  'subtitle.tierlist': 'Vos classements par univers',
  'empty.tierlist.title': 'Aucune tier list pour le moment',
  'empty.tierlist.body':
    'Créez votre premier classement : choisissez ce que vous classez, faites glisser les éléments, puis exportez-en une image.',
  'empty.tierlist.cta': 'Créer une tierlist',

  'tierlist.new': 'Créer une tierlist',
  'tierlist.defaultName': 'Tier list',
  'tierlist.count': '{count} tier list(s)',
  'tierlist.items': '{count} éléments',
  'tierlist.rename': 'Renommer',
  'tierlist.delete': 'Supprimer',
  'tierlist.confirmDelete': 'Supprimer cette tier list ?',
  'tierlist.confirmDeleteBody': 'Ses {count} éléments et leur placement sont perdus. Vos fiches ne sont pas touchées.',
  'tierlist.namePlaceholder': 'Nom de la tier list',

  'tierlist.filter.all': 'Tout',
  'tierlist.filter.anime': 'Animés',
  'tierlist.filter.character': 'Personnages',
  'tierlist.filter.season': 'Saisons',
  'tierlist.filter.theme': 'Openings & endings',
  'tierlist.filter.ost': 'Bandes originales',

  'tierlist.pool': 'Non classés',
  'tierlist.poolEmpty': 'Tout est classé.',
  'tierlist.addItems': 'Ajouter des éléments',
  'tierlist.noScores': 'Notez d’abord quelques animés, pour avoir de quoi trier.',
  'tierlist.sortByScore': 'Trier par score',
  'tierlist.sortByScoreHint':
    'Place vos animés dans les rangées correspondant aux notes que vous leur avez déjà données : vous n’avez plus qu’à ajuster.',
  'tierlist.clearPlacements': 'Vider le tableau',
  'tierlist.export': 'Exporter en image',
  'tierlist.exportDone': 'Enregistré dans {path}',
  'tierlist.back': 'Toutes les tier lists',
  'tierlist.orphan': 'Plus dans votre liste',
  'tierlist.helpDrag': 'Faites glisser un élément sur une rangée, ou sélectionnez-en puis tapez S, A, B…',
  'tierlist.selected': '{count} sélectionnés',

  'tierlist.style.title': 'Options de la rangée',
  'tierlist.style.open': 'Options : texte, police et couleurs',
  'tierlist.style.text': 'Texte',
  'tierlist.style.font': 'Police',
  'tierlist.style.background': 'Fond',
  'tierlist.style.textColor': 'Couleur du texte',
  'tierlist.style.size': 'Taille du texte',
  'tierlist.style.custom': 'Couleur personnalisée',
  'tierlist.style.onLight': 'Texte clair',
  'tierlist.style.onDark': 'Texte sombre',
  'tierlist.style.reset': 'Palette',
  'tierlist.style.done': 'Terminé',
  'tierlist.style.row': 'Cette rangée',
  'tierlist.style.moveUp': 'Monter',
  'tierlist.style.moveDown': 'Descendre',
  'tierlist.style.deleteRow': 'Supprimer la rangée',
  'tierlist.style.lastRow': 'Une tier list a besoin d’au moins une rangée.',
  'tierlist.addRow': 'Ajouter une rangée',

  'tierlist.menu.anilistAnime': 'Ouvrir sur AniList',
  'tierlist.menu.anilistCharacter': 'Ouvrir sur AniList',
  'tierlist.menu.web': 'Rechercher sur le web',
  'tierlist.menu.remove': 'Retirer',

  'tierlist.picker.title': 'Ajouter des éléments',
  'tierlist.picker.search': 'Chercher un animé, un personnage, une chanson…',
  'tierlist.picker.tracked': 'dans votre liste',
  'tierlist.picker.typeToSearch': 'Tapez au moins deux lettres.',
  'tierlist.picker.alreadyAdded': 'Déjà dans la tier list',
  'tierlist.picker.themes': 'Openings et endings',
  'tierlist.picker.noThemes': 'Aucun opening ni ending trouvé pour cet animé.',
  'tierlist.picker.all': 'Tout ajouter ({count})',
  'tierlist.picker.added': '{count} ajoutés',
  'tierlist.picker.none': 'Rien trouvé.',
  'tierlist.picker.close': 'Fermer',
  'tierlist.picker.loading': 'Chargement…',
  'tierlist.picker.ostWhy':
    'Aucune source ne liste les pistes d’une bande originale. Ni AniList, ni Kitsu, ni AniDB, ni AnimeThemes ne les couvrent : ce sont des catalogues, pas des bases musicales.',
  'tierlist.picker.ostLabel': 'Titre de la piste',
  'tierlist.picker.ostAdd': 'Ajouter la piste',

  'service.anilist': 'AniList',
  'service.kitsu': 'Kitsu',
  'service.animethemes': 'AnimeThemes',
  'error.unreachable': 'Impossible de joindre {service}. Vérifiez votre connexion.',
  'error.timeout': '{service} n’a pas répondu à temps.',
  'error.rateLimit': 'Trop de requêtes vers {service}. Patientez un instant puis réessayez.',
  'error.http': '{service} a renvoyé une erreur{status}.',
  'error.empty': '{service} a renvoyé une réponse vide.',
  'error.noReference': 'Cette fiche n’a pas de référence AniList pour récupérer les épisodes.',
  'error.noEpisodeNames': 'Les sources n’ont pas les noms d’épisodes de cet animé.',
  'error.noFeed': 'Aucun flux de mise à jour n’est configuré pour ce build.',
  'error.noUpdateToDownload': 'Aucune mise à jour à télécharger.',
  'error.unknown': 'Une erreur est survenue : {detail}',

  'update.title': 'Mises à jour',
  'update.reading': 'Lecture de l’état de mise à jour…',
  'update.version': 'Version',
  'update.noFeed': 'aucun flux configuré',
  'update.stage.idle': 'Prêt',
  'update.stage.checking': 'Recherche…',
  'update.stage.available': 'Mise à jour disponible',
  'update.stage.not-available': 'À jour',
  'update.stage.downloading': 'Téléchargement…',
  'update.stage.downloaded': 'Prête à installer',
  'update.stage.error': 'Erreur',
  'update.available': 'La version {version} est disponible.',
  'update.downloaded': 'Version {version} téléchargée. Redémarrez pour l’appliquer.',
  'update.check': 'Rechercher une mise à jour',
  'update.checking': 'Recherche…',
  'update.download': 'Télécharger la mise à jour',
  'update.starting': 'Démarrage…',
  'update.install': 'Redémarrer et installer',
  'update.notAvailable':
    'Les mises à jour ne sont disponibles que dans la version installée, une fois un flux configuré.',
  'update.badge': 'Mise à jour {version}',
  'update.badgeReady': 'Mise à jour prête',
  'update.badgeTitleReady': 'Mise à jour téléchargée — ouvrez les Réglages pour l’installer',
  'update.badgeTitle': 'La version {version} est disponible'
}

const dictionaries: Record<Language, Record<MessageKey, string>> = { en, fr }

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  )
}

export function translate(
  language: Language,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const table = dictionaries[language] ?? en
  return interpolate(table[key] ?? en[key] ?? key, vars)
}

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'fr'
}

/** Picks the best default from the OS locale, French only for fr-*. */
export function detectLanguage(locale: string | undefined): Language {
  return locale && /^fr\b/i.test(locale) ? 'fr' : 'en'
}

/* ------------------------------------------------------------------ */

const I18nContext = createContext<{ language: Language; t: Translate } | null>(null)

export function I18nProvider({
  language,
  children
}: {
  language: Language
  children: ReactNode
}): ReactNode {
  const value = useMemo(() => {
    const t: Translate = (key, vars) => translate(language, key, vars)
    const bound = ((key: MessageKey, vars?: Record<string, string | number>) =>
      t(key, vars)) as Translate
    return { language, t: bound }
  }, [language])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): { language: Language; t: Translate } {
  const ctx = useContext(I18nContext)
  const fallback = useCallback<Translate>((key, vars) => translate('en', key, vars), [])
  return ctx ?? { language: 'en', t: fallback }
}

/** Map a status key to its translation key. */
export function statusKey(status: string): MessageKey {
  return `status.${status}` as MessageKey
}

/** Map a criterion key to its translation key. */
export function criterionKey(key: string): MessageKey {
  return `criteria.${key}` as MessageKey
}

/** A Failure coming back from the main process. */
export interface FailureLike {
  code?: string
  detail?: string
  status?: number
  service?: ServiceName
  error?: string
}

/**
 * Turn a failure from the main process into localised text.
 *
 * The main process cannot translate, so it sends a code plus an English detail.
 * Known codes become a proper sentence; anything else falls back to the raw
 * message rather than showing nothing.
 */
export function describeFailure(
  t: Translate,
  failure: FailureLike | string | null | undefined
): string {
  if (!failure) return ''
  const f: FailureLike = typeof failure === 'string' ? { error: failure } : failure
  const code = f.code
  // A failure from AnimeThemes must name AnimeThemes, not the service it happens
  // to sit beside in the switch below.
  const service =
    f.service === 'kitsu'
      ? t('service.kitsu')
      : f.service === 'animethemes'
        ? t('service.animethemes')
        : t('service.anilist')

  switch (code) {
    case 'unreachable':
      return t('error.unreachable', { service })
    case 'timeout':
      return t('error.timeout', { service })
    case 'rateLimit':
      return t('error.rateLimit', { service })
    case 'http':
      return t('error.http', { service, status: f.status ? ` ${f.status}` : '' })
    case 'empty':
      return t('error.empty', { service })
    case 'noReference':
      return t('error.noReference')
    case 'noEpisodeNames':
      return t('error.noEpisodeNames')
    default:
      return t('error.unknown', { detail: f.detail ?? f.error ?? '' })
  }
}
