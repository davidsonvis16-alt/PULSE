import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { libraryArtistNames } from '@/src/library/owned';
import { getAwardSeason, nominationsFor } from '@/src/news/awards';
import { getFreshReleases } from '@/src/news/fresh';
import { getHeadlines, type Story } from '@/src/news/headlines';
import { checkMusicWorld } from '@/src/news/notify';
import type { NewsTopic } from '@/src/news/rss';
import { AwardPoster, HeadlinePoster, ReleasePoster, StoryRow, TOPIC_LABELS } from '@/src/ui/posters';
import { SectionHeader, Shelf } from '@/src/ui/section';
import { Chip } from '@/src/ui/buttons';
import { EmptyState, ErrorState, SkeletonRows, SkeletonShelf } from '@/src/ui/states';
import { spacing } from '@/src/theme/tokens';

type TopicFilter = 'all' | NewsTopic;

const TOPIC_FILTERS: TopicFilter[] = ['all', 'new-music', 'awards', 'charts', 'tours', 'news', 'memoriam'];

function openStory(story: Story) {
  void WebBrowser.openBrowserAsync(story.url).catch(() => {});
}

/**
 * What is happening in music, as a page of Discover.
 *
 * In order: the lead story, award season, new music set as posters, your
 * artists in the news, then everything else. Opening it is also when Pulse
 * checks whether there is anything worth an alert.
 */
export function MusicNews() {
  const router = useRouter();
  const { gutter, width, contentWidth, isTabletUp } = useResponsive();
  const [topic, setTopic] = useState<TopicFilter>('all');

  const columnWidth = Math.min(contentWidth, width) - gutter * 2;
  const posterWidth = isTabletUp ? 230 : Math.round(Math.min(width * 0.58, 240));

  const artists = useAsync(() => libraryArtistNames(), []);
  const stories = useAsync(async () => {
    void checkMusicWorld().catch(() => {});
    return getHeadlines({ artistNames: artists.data ?? [] });
  }, [artists.data]);
  const awards = useAsync(() => getAwardSeason(), []);
  const fresh = useAsync(() => getFreshReleases(16), []);

  const all = stories.data ?? [];
  const lead = all.find((story) => story.imageUrl) ?? all[0];
  const yours = all.filter((story) => story.mentions.length && story !== lead).slice(0, 4);
  const rest = all.filter(
    (story) => story !== lead && !yours.includes(story) && (topic === 'all' || story.topic === topic),
  );
  const topicsPresent = TOPIC_FILTERS.filter((t) => t === 'all' || all.some((s) => s.topic === t));

  return (
    <View style={{ gap: spacing.xxl, paddingTop: spacing.sm }}>
      {/* Lead story */}
      <View style={{ paddingHorizontal: gutter }}>
        {stories.loading && !stories.data ? (
          <SkeletonRows count={1} height={Math.min(columnWidth, 420)} />
        ) : stories.error ? (
          <ErrorState error={stories.error} onRetry={stories.reload} compact />
        ) : lead ? (
          <HeadlinePoster story={lead} width={columnWidth} onPress={() => openStory(lead)} />
        ) : null}
      </View>

      {/* Award season */}
      {!!awards.data?.length && (
        <View>
          <SectionHeader
            title="Award season"
            subtitle="Nominees, dates and winners as they are announced"
            style={{ paddingHorizontal: gutter }}
          />
          <Shelf
            data={awards.data}
            gutter={gutter}
            keyExtractor={(edition) => edition.id}
            renderItem={(edition) => (
              <AwardPoster
                edition={edition}
                width={posterWidth}
                yourNominees={nominationsFor(edition, artists.data ?? []).length}
                onPress={() => router.push(`/awards/${encodeURIComponent(edition.id)}`)}
              />
            )}
          />
        </View>
      )}

      {/* New music */}
      <View>
        <SectionHeader
          title="New music"
          subtitle="Fresh releases from your artists and what is charting straight away"
          style={{ paddingHorizontal: gutter }}
        />
        {fresh.loading && !fresh.data ? (
          <SkeletonShelf cardWidth={posterWidth} count={3} />
        ) : fresh.data?.length ? (
          <Shelf
            data={fresh.data}
            gutter={gutter}
            keyExtractor={(release) => release.album.id}
            renderItem={(release) => (
              <ReleasePoster
                release={release}
                width={posterWidth}
                onPress={() => router.push(`/album/${encodeURIComponent(release.album.id)}`)}
              />
            )}
          />
        ) : (
          <EmptyState
            icon="disc-outline"
            title="No new releases this week"
            message="Import more of your music and Pulse will watch those artists for you."
            compact
          />
        )}
      </View>

      {/* Your artists in the news */}
      {yours.length > 0 && (
        <View style={{ paddingHorizontal: gutter }}>
          <SectionHeader title="Your artists in the news" subtitle="Stories about music you own" />
          {yours.map((story) => (
            <StoryRow key={story.id} story={story} onPress={() => openStory(story)} />
          ))}
        </View>
      )}

      {/* Everything else */}
      {all.length > 1 && (
        <View>
          <SectionHeader
            title="Latest"
            subtitle="From the music press, updated through the day"
            style={{ paddingHorizontal: gutter }}
          />
          <Shelf
            data={topicsPresent}
            gutter={gutter}
            gap={spacing.sm}
            keyExtractor={(item) => item}
            renderItem={(item) => (
              <Chip
                label={item === 'all' ? 'All' : TOPIC_LABELS[item]}
                active={topic === item}
                onPress={() => setTopic(item)}
              />
            )}
          />
          <View style={{ paddingHorizontal: gutter, marginTop: spacing.sm }}>
            {rest.map((story) => (
              <StoryRow key={story.id} story={story} onPress={() => openStory(story)} />
            ))}
            {rest.length === 0 && (
              <EmptyState icon="newspaper-outline" title="Nothing in this topic today" compact />
            )}
          </View>
        </View>
      )}
    </View>
  );
}
