import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatRelativeTime } from '@/src/core/format';
import { useAsync } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import {
  createPost,
  deletePost,
  isNewsPublic,
  listPulseNews,
  REGIONS,
  setNewsPublic,
  setPostPublished,
  useIsAdmin,
  type NewsRegion,
} from '@/src/news/pulse-news';
import { useToast } from '@/src/ui/toast';
import { PageHeader, Screen, useBottomInset } from '@/src/ui/screen';
import { Button, Chip } from '@/src/ui/buttons';
import { Txt } from '@/src/ui/text';
import { EmptyState, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * The Pulse News desk. Only editors reach it (the side menu shows it to them
 * alone, and the server refuses everyone else). Write an update for Kenya,
 * the USA or the world, publish it, and — when the time comes — flip the one
 * switch that lets every listener see Pulse updates.
 */
export default function NewsDeskScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { gutter, isTabletUp } = useResponsive();
  const bottomInset = useBottomInset();
  const toast = useToast();
  const admin = useIsAdmin();

  const posts = useAsync(() => listPulseNews({ limit: 100 }), []);
  const isPublic = useAsync(() => isNewsPublic(), []);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [region, setRegion] = useState<NewsRegion>('kenya');
  const [link, setLink] = useState('');
  const [image, setImage] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      toast('Give it a title and some words first', 'error');
      return;
    }
    setSaving(true);
    try {
      await createPost({ title, body, region, linkUrl: link, imageUrl: image });
      setTitle('');
      setBody('');
      setLink('');
      setImage('');
      toast('Saved as a draft. Publish it when it reads right.', 'success');
      posts.reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!admin) {
    return (
      <Screen>
        <PageHeader title="Pulse News" />
        <EmptyState icon="newspaper-outline" title="Nothing here" message="This page is for the Pulse desk." />
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title="Pulse News desk" subtitle="Only you can see this page" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset, gap: spacing.xl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* The one switch that opens Pulse updates to everyone. */}
        <View style={styles.switchCard}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="bodyStrong">Everyone can see Pulse updates</Txt>
            <Txt variant="caption" tone="muted">
              {isPublic.data
                ? 'On: every listener sees the published posts at the top of Music news.'
                : 'Off: only you see Pulse updates. Turn it on when the desk is ready.'}
            </Txt>
          </View>
          <Switch
            value={!!isPublic.data}
            disabled={isPublic.loading}
            trackColor={{ true: colors.accent, false: colors.cardHigh }}
            onValueChange={async (value) => {
              try {
                await setNewsPublic(value);
                isPublic.reload();
                toast(value ? 'Pulse updates are now live for everyone' : 'Pulse updates hidden again', 'success');
              } catch (error) {
                toast(error instanceof Error ? error.message : 'Could not change that', 'error');
              }
            }}
          />
        </View>

        {/* Write */}
        <View style={styles.form}>
          <Txt variant="title3">New update</Txt>
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {REGIONS.map((r) => (
              <Chip key={r.value} label={r.label} active={region === r.value} onPress={() => setRegion(r.value)} />
            ))}
          </View>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Headline"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            maxLength={160}
            accessibilityLabel="Headline"
          />
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="What happened? Keep it short and clear."
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.multiline]}
            multiline
            maxLength={4000}
            accessibilityLabel="Story"
          />
          <View style={[{ gap: spacing.sm }, isTabletUp && { flexDirection: 'row' }]}>
            <TextInput
              value={link}
              onChangeText={setLink}
              placeholder="Link to read more (optional)"
              placeholderTextColor={colors.textFaint}
              style={[styles.input, { flex: 1 }]}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Link"
            />
            <TextInput
              value={image}
              onChangeText={setImage}
              placeholder="Picture address (optional)"
              placeholderTextColor={colors.textFaint}
              style={[styles.input, { flex: 1 }]}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Picture address"
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button label="Save draft" icon="save-outline" loading={saving} onPress={() => void submit()} />
          </View>
        </View>

        {/* Posts */}
        <View>
          <Txt variant="title3" style={{ marginBottom: spacing.md }}>
            Posts
          </Txt>
          {posts.loading && !posts.data ? (
            <SkeletonRows count={3} />
          ) : (posts.data ?? []).length === 0 ? (
            <Txt variant="caption" tone="muted">
              Nothing written yet.
            </Txt>
          ) : (
            (posts.data ?? []).map((post) => (
              <View key={post.id} style={styles.post}>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Txt variant="micro" tone="accent" uppercase>
                      {REGIONS.find((r) => r.value === post.region)?.label}
                    </Txt>
                    <Txt variant="micro" tone="faint">
                      · {formatRelativeTime(post.createdAt)}
                    </Txt>
                    <View style={[styles.state, post.published && { backgroundColor: colors.accentGlow }]}>
                      <Txt variant="micro" tone={post.published ? 'accent' : 'muted'}>
                        {post.published ? 'Published' : 'Draft'}
                      </Txt>
                    </View>
                  </View>
                  <Txt variant="bodyStrong" numberOfLines={2}>
                    {post.title}
                  </Txt>
                  <Txt variant="caption" tone="secondary" numberOfLines={3}>
                    {post.body}
                  </Txt>
                </View>
                <View style={{ gap: spacing.xs, alignItems: 'flex-end' }}>
                  <Button
                    label={post.published ? 'Unpublish' : 'Publish'}
                    size="sm"
                    variant={post.published ? 'secondary' : 'primary'}
                    onPress={async () => {
                      try {
                        await setPostPublished(post.id, !post.published);
                        posts.reload();
                      } catch (error) {
                        toast(error instanceof Error ? error.message : 'Could not change that', 'error');
                      }
                    }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Delete this post"
                    hitSlop={8}
                    onPress={async () => {
                      try {
                        await deletePost(post.id);
                        toast('Deleted');
                        posts.reload();
                      } catch (error) {
                        toast(error instanceof Error ? error.message : 'Could not delete', 'error');
                      }
                    }}
                    style={{ padding: 6 }}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    switchCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.md,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    form: {
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.md,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderSoft,
    },
    input: {
      minHeight: 44,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      borderRadius: radii.sm,
      backgroundColor: colors.backgroundElevated,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      fontSize: 15,
    },
    multiline: { minHeight: 120, textAlignVertical: 'top' },
    post: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSoft,
    },
    state: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: colors.cardHigh },
  });
