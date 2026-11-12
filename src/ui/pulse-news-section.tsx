import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { formatRelativeTime } from '@/src/core/format';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { listPulseNews, REGIONS, useIsAdmin, type NewsRegion, type PulseNewsPost } from '@/src/news/pulse-news';
import { brandShadeByName } from '@/src/theme/brand-shade';
import { Chip } from '@/src/ui/buttons';
import { SectionHeader } from '@/src/ui/section';
import { Txt } from '@/src/ui/text';
import { PulseLogo } from '@/src/ui/logo';
import { palette, radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Pulse's own updates at the top of the news: Kenya, the USA and the world,
 * written by the Pulse desk, each one a card — the picture on the left of one,
 * the right of the next; posts without a picture carry a band in a Pulse
 * shade instead. Hidden from everyone until the desk opens it; editors see it
 * (drafts included) the whole time.
 */
export function PulseNewsSection() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { gutter, contentWidth, isTabletUp } = useResponsive();
  const admin = useIsAdmin();
  const [region, setRegion] = useState<NewsRegion | 'all'>('all');
  // The server returns nothing to readers until the switch is on.
  const posts = useAsync(() => listPulseNews({ region, limit: 20 }).catch(() => [] as PulseNewsPost[]), [region]);

  const list = posts.data ?? [];
  if (!admin && list.length === 0) return null;
  const cardWidth = Math.min(contentWidth, 760);

  return (
    <View>
      <SectionHeader
        title="Pulse updates"
        subtitle="From the Pulse desk"
        actionLabel={admin ? 'Open the desk' : undefined}
        onAction={admin ? () => router.push('/admin/news' as never) : undefined}
        style={{ paddingHorizontal: gutter }}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm, paddingBottom: spacing.md }}
      >
        <Chip label="All" active={region === 'all'} onPress={() => setRegion('all')} />
        {REGIONS.map((r) => (
          <Chip key={r.value} label={r.label} active={region === r.value} onPress={() => setRegion(r.value)} />
        ))}
      </ScrollView>
      {list.length === 0 ? (
        <Txt variant="caption" tone="muted" style={{ paddingHorizontal: gutter }}>
          {admin ? 'No posts yet. Open the desk to write the first one.' : ''}
        </Txt>
      ) : (
        <View style={[styles.list, { paddingHorizontal: gutter }]}>
          {list.map((post, index) => (
            <NewsCard key={post.id} post={post} width={cardWidth} flip={index % 2 === 1} tall={isTabletUp} />
          ))}
        </View>
      )}
    </View>
  );
}

function NewsCard({ post, width, flip, tall }: { post: PulseNewsPost; width: number; flip: boolean; tall: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const shade = brandShadeByName(post.title);
  const height = tall ? 212 : 176;
  const picture = Math.round(Math.min(width * 0.42, height));
  const regionLabel = REGIONS.find((r) => r.value === post.region)?.label ?? post.region;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${regionLabel}. ${post.title}`}
      onPress={() => (post.linkUrl ? void WebBrowser.openBrowserAsync(post.linkUrl) : undefined)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.card,
        { width, minHeight: height, flexDirection: flip ? 'row-reverse' : 'row' },
        hovered && { transform: [{ translateY: -3 }] },
        pressed && { opacity: 0.92 },
      ]}
    >
      {post.imageUrl ? (
        <Image source={{ uri: post.imageUrl }} contentFit="cover" style={{ width: picture, alignSelf: 'stretch' }} />
      ) : (
        <View style={[styles.band, { backgroundColor: shade.top, width: Math.round(picture * 0.45) }]}>
          <PulseLogo size={34} />
        </View>
      )}
      <View style={[styles.text, { padding: tall ? spacing.xl : spacing.lg }]}>
        <View style={styles.meta}>
          <Txt variant="micro" uppercase style={{ color: palette.terracotta }}>
            {regionLabel}
          </Txt>
          <Txt variant="micro" tone="faint">
            · {formatRelativeTime(post.createdAt)}
          </Txt>
          {!post.published && (
            <View style={styles.draft}>
              <Txt variant="micro" tone="muted">
                Draft · only you see this
              </Txt>
            </View>
          )}
        </View>
        <Txt variant={tall ? 'title2' : 'title3'} numberOfLines={3}>
          {post.title}
        </Txt>
        <Txt variant={tall ? 'body' : 'caption'} tone="secondary" numberOfLines={tall ? 4 : 3} style={{ flexShrink: 1 }}>
          {post.body}
        </Txt>
        {post.linkUrl ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 'auto' }}>
            <Ionicons name="open-outline" size={13} color={colors.accentInk} />
            <Txt variant="caption" tone="accent">
              Read more
            </Txt>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    list: { gap: spacing.lg },
    card: {
      alignItems: 'stretch',
      borderRadius: radii.md,
      overflow: 'hidden',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    band: { alignItems: 'center', justifyContent: 'center' },
    text: { flex: 1, minWidth: 0, gap: 6 },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
    draft: { paddingHorizontal: 6, borderRadius: 4, backgroundColor: colors.cardHigh, marginLeft: 4 },
  });
