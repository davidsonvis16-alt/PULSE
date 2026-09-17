import { getNotificationPrefs, getSetting, setSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';
import { pushNotification } from '@/src/db/repos/notifications';
import { libraryArtistNames } from '@/src/library/owned';
import { daysUntil, getAwardSeason, nominationsFor, statusOf } from '@/src/news/awards';
import { getHeadlines } from '@/src/news/headlines';
import { getFreshReleases } from '@/src/news/fresh';

/**
 * Telling the listener what is happening.
 *
 * Only things that concern them, or that everyone will be talking about, make
 * it into the notification centre: an artist they play nominated or winning, a
 * ceremony happening today, winners just announced, their artists in the
 * headlines, and new releases from them. Every alert is keyed on what it is
 * about, so the same news is never announced twice, and a single check never
 * sends more than a handful.
 */

const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;
const MAX_PER_CHECK = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export async function checkMusicWorld(options: { force?: boolean } = {}): Promise<number> {
  const last = Number((await getSetting(SETTINGS_KEYS.lastNewsCheck).catch(() => null)) ?? 0);
  if (!options.force && Date.now() - last < CHECK_INTERVAL_MS) return 0;
  await setSetting(SETTINGS_KEYS.lastNewsCheck, String(Date.now())).catch(() => {});

  const prefs = await getNotificationPrefs();
  if (!prefs.musicNews && !prefs.newReleases) return 0;

  const artists = await libraryArtistNames().catch(() => [] as string[]);
  let sent = 0;
  const send = async (input: Parameters<typeof pushNotification>[0]) => {
    if (sent >= MAX_PER_CHECK) return;
    if (await pushNotification(input).catch(() => false)) sent += 1;
  };

  if (prefs.musicNews) {
    const season = await getAwardSeason().catch(() => []);
    for (const edition of season) {
      const status = statusOf(edition);
      const days = daysUntil(edition.info.date) ?? 0;
      const yours = nominationsFor(edition, artists);

      if (status === 'winners' && days >= -7) {
        for (const entry of yours) {
          const won = entry.categories.filter((c) => c.winner).map((c) => c.name);
          if (won.length === 0) continue;
          await send({
            type: 'award',
            title: `${entry.artist} won at the ${edition.shortName}`,
            body: list(won.slice(0, 3)) + (won.length > 3 ? ` and ${won.length - 3} more` : ''),
            entityType: 'award',
            entityId: `${edition.id}|won|${entry.artist}`,
          });
        }
        await send({
          type: 'award',
          title: `Winners are in from the ${edition.title}`,
          body: 'See who took home what, category by category.',
          entityType: 'award',
          entityId: `${edition.id}|winners`,
        });
      }

      if (status === 'today') {
        await send({
          type: 'award',
          title: `The ${edition.shortName} are on today`,
          body: yours.length
            ? `${list(yours.slice(0, 3).map((y) => y.artist))} ${yours.length === 1 ? 'is' : 'are'} nominated.`
            : 'Here is everyone nominated.',
          entityType: 'award',
          entityId: `${edition.id}|today`,
        });
      }

      if (status === 'nominees') {
        for (const entry of yours.slice(0, 3)) {
          const names = entry.categories.map((c) => c.name);
          await send({
            type: 'award',
            title: `${entry.artist} is nominated at the ${edition.shortName}`,
            body: list(names.slice(0, 2)) + (names.length > 2 ? ` and ${names.length - 2} more` : ''),
            entityType: 'award',
            entityId: `${edition.id}|nominated|${entry.artist}`,
          });
        }
        if (days <= 60) {
          await send({
            type: 'award',
            title: `Nominees are out for the ${edition.title}`,
            body: edition.info.mostNominations
              ? `Most nominated: ${edition.info.mostNominations}.`
              : `${edition.categories.length} categories.`,
            entityType: 'award',
            entityId: `${edition.id}|nominees`,
          });
        }
      }
    }

    const stories = await getHeadlines({ artistNames: artists }).catch(() => []);
    for (const story of stories.filter((s) => s.mentions.length && Date.now() - s.publishedAt < 2 * DAY_MS).slice(0, 3)) {
      await send({
        type: 'news',
        title: story.title,
        body: `${list(story.mentions)} in ${story.source}`,
        entityType: 'article',
        entityId: story.url,
        imageUrl: story.imageUrl,
      });
    }
  }

  if (prefs.newReleases) {
    const releases = await getFreshReleases(20).catch(() => []);
    for (const release of releases) {
      if (release.reason !== 'your-artist' || !release.album.releaseDate) continue;
      if (Date.now() - Date.parse(release.album.releaseDate) > 7 * DAY_MS) continue;
      await send({
        type: 'new_release',
        title: `New from ${release.album.artistName}`,
        body: `${release.album.title}${release.album.albumType === 'single' ? ' (single)' : ''}`,
        entityType: 'album',
        entityId: release.album.id,
        imageUrl: release.album.artworkUrl,
      });
    }
  }

  return sent;
}
