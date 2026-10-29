import { useCallback, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { checkForUpdate, installedVersion } from '@/src/core/updates';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatListeningTime, formatRelativeTime, pluralize } from '@/src/core/format';
import { getFollowedArtists, getLibraryCounts } from '@/src/db/repos/library';
import { getStatsSummary, getTopArtists, getTopGenres } from '@/src/db/repos/history';
import { listActivity, listFriends, saveProfile, type ActivityItem, type Friend } from '@/src/db/repos/social';
import { listPlaylists } from '@/src/db/repos/playlists';
import {
  followUser,
  isSocialAvailable,
  searchUsers,
  syncFriendActivity,
  syncFriends,
  unfollowUser,
  pushProfile,
  type PublicUser,
} from '@/src/social/sync';
import { useAuth } from '@/src/auth/auth';
import { useAsync, useDebounced } from '@/src/hooks/use-async';
import { useFocusReload } from '@/src/hooks/use-focus-reload';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useShareSheet } from '@/src/ui/share-sheet';
import { useToast } from '@/src/ui/toast';
import { statsShare } from '@/src/share/share';
import { Screen, useBottomInset } from '@/src/ui/screen';
import { Artwork } from '@/src/ui/artwork';
import { ProfileAvatar } from '@/src/ui/profile-avatar';
import { Txt } from '@/src/ui/text';
import { Button, Chip, IconButton, SegmentedControl } from '@/src/ui/buttons';
import { ArtistCard } from '@/src/ui/cards';
import { SectionHeader, Shelf } from '@/src/ui/section';
import { Sheet } from '@/src/ui/sheet';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import {
  useTheme,
  useThemedStyles,
  type ThemeColors,
  type ThemePreference,
} from '@/src/theme/theme';

type Tab = 'activity' | 'following' | 'friends';

/** The user's profile: who they are, what they listen to, and who they follow. */
export function ProfileScreen() {
  const { colors, preference, setPreference } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { profile, refreshProfile, signOut, session, changePassword } = useAuth();
  const { gutter, shelfCardWidth } = useResponsive();
  const bottomInset = useBottomInset();
  const share = useShareSheet();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('activity');
  const [editing, setEditing] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const closePassword = () => {
    setPasswordOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setRepeatPassword('');
    setPasswordError(null);
  };

  const savePassword = async () => {
    if (newPassword !== repeatPassword) {
      setPasswordError('The two new passwords do not match.');
      return;
    }
    setSavingPassword(true);
    setPasswordError(null);
    try {
      await changePassword(currentPassword, newPassword);
      closePassword();
      toast('Password changed', 'success');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Could not change your password.');
    } finally {
      setSavingPassword(false);
    }
  };
  const [findOpen, setFindOpen] = useState(false);
  const [name, setName] = useState(profile?.displayName ?? '');
  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [userQuery, setUserQuery] = useState('');
  const debouncedUser = useDebounced(userQuery.trim(), 400);

  const social = isSocialAvailable();

  const state = useAsync(async () => {
    const [counts, playlists, followedArtists, summary, topArtists, genres] = await Promise.all([
      getLibraryCounts(),
      listPlaylists(),
      getFollowedArtists(),
      getStatsSummary('all'),
      getTopArtists('all', 10),
      getTopGenres('all', 6),
    ]);

    let activity: ActivityItem[] = [];
    let friends: Friend[] = [];
    if (social) {
      activity = await syncFriendActivity().catch(() => listActivity(40));
      friends = await syncFriends().catch(() => listFriends());
    } else {
      activity = await listActivity(40);
      friends = await listFriends();
    }

    return { counts, playlists, followedArtists, summary, topArtists, genres, activity, friends };
  }, [social]);

  useFocusReload(state.reload);

  const userResults = useAsync<PublicUser[]>(async () => {
    if (!social || debouncedUser.length < 2) return [];
    return searchUsers(debouncedUser).catch(() => []);
  }, [debouncedUser, social]);

  const saveEdits = useCallback(async () => {
    await saveProfile({
      displayName: name.trim() || null,
      handle: handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, '') || null,
      bio: bio.trim().slice(0, 200) || null,
    });
    await refreshProfile();
    await pushProfile().catch(() => {});
    setEditing(false);
    state.reload();
    toast('Profile updated', 'success');
  }, [name, handle, bio, refreshProfile, state, toast]);

  const data = state.data;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[styles.header, { paddingHorizontal: gutter }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change your profile picture"
            onPress={() => router.push('/settings/picture')}
          >
            <ProfileAvatar size={64} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Txt variant="title2" numberOfLines={1}>
              {profile?.displayName ?? 'Your profile'}
            </Txt>
            <Txt variant="caption" tone="muted">
              {profile?.handle ? `@${profile.handle}` : 'Set a handle'}
            </Txt>
          </View>
          <IconButton
            name="settings-outline"
            label="Privacy settings"
            onPress={() => router.push('/settings/privacy')}
          />
        </View>

        {profile?.bio ? (
          <Txt variant="body" tone="secondary" style={{ paddingHorizontal: gutter, marginBottom: spacing.md }}>
            {profile.bio}
          </Txt>
        ) : null}

        <View style={[styles.actions, { paddingHorizontal: gutter }]}>
          <Button
            label="Edit profile"
            variant="secondary"
            size="sm"
            onPress={() => {
              setName(profile?.displayName ?? '');
              setHandle(profile?.handle ?? '');
              setBio(profile?.bio ?? '');
              setEditing(true);
            }}
          />
          <Button
            label="Picture"
            variant="secondary"
            size="sm"
            icon="happy-outline"
            onPress={() => router.push('/settings/picture')}
          />
          {social && (
            <Button
              label="Find friends"
              variant="secondary"
              size="sm"
              icon="person-add-outline"
              onPress={() => setFindOpen(true)}
            />
          )}
          {data && data.summary.totalMs > 0 && (
            <Button
              label="Share stats"
              variant="secondary"
              size="sm"
              icon="share-outline"
              onPress={() =>
                share(
                  statsShare({
                    periodLabel: 'listening',
                    totalMs: data.summary.totalMs,
                    artistCount: data.summary.artistCount,
                    trackCount: data.summary.trackCount,
                    topArtist: data.topArtists[0]?.name ?? null,
                    artworkUrl: data.topArtists[0]?.imageUrl,
                  }),
                )
              }
            />
          )}
        </View>

        {/* Counts */}
        {data && (
          <View style={[styles.counts, { paddingHorizontal: gutter }]}>
            <Count value={data.followedArtists.length} label="Artists followed" />
            <Count value={data.friends.length} label="Friends" />
            <Count value={data.playlists.length} label="Playlists" />
            <Count value={data.counts.tracks} label="Songs saved" />
          </View>
        )}

        {/* Listening summary */}
        {data && data.summary.totalMs > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open your listening statistics"
            onPress={() => router.push('/stats')}
            style={({ pressed }) => [
              styles.statsCard,
              { marginHorizontal: gutter },
              pressed && { opacity: 0.85 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Txt variant="micro" tone="muted" uppercase>
                All time
              </Txt>
              <Txt variant="title2" style={{ marginTop: 4 }}>
                {formatListeningTime(data.summary.totalMs)}
              </Txt>
              <Txt variant="caption" tone="muted">
                {pluralize(data.summary.artistCount, 'artist')} · {pluralize(data.summary.trackCount, 'song')}
              </Txt>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        )}

        {state.loading && !data ? (
          <View style={{ paddingHorizontal: gutter, marginTop: spacing.xl }}>
            <SkeletonRows count={4} />
          </View>
        ) : state.error ? (
          <ErrorState error={state.error} onRetry={state.reload} />
        ) : data ? (
          <>
            {/* Favourite artists */}
            {data.topArtists.length > 0 && (
              <View style={{ marginTop: spacing.xxl }}>
                <SectionHeader
                  title="Favourite artists"
                  subtitle="By time listened"
                  style={{ paddingHorizontal: gutter }}
                />
                <Shelf
                  data={data.topArtists}
                  gutter={gutter}
                  keyExtractor={(item) => item.name}
                  renderItem={(item) => (
                    <ArtistCard
                      artist={{
                        id: item.artistId ?? item.name,
                        provider: 'local',
                        providerArtistId: item.name,
                        name: item.name,
                        imageUrl: item.imageUrl,
                        genre: null,
                        externalUrl: null,
                      }}
                      detail={formatListeningTime(item.msPlayed)}
                      width={shelfCardWidth * 0.8}
                      onPress={() =>
                        item.artistId
                          ? router.push(`/artist/${encodeURIComponent(item.artistId)}`)
                          : router.push({ pathname: '/discover', params: { q: item.name } })
                      }
                    />
                  )}
                />
              </View>
            )}

            {/* Genres */}
            {data.genres.length > 0 && (
              <View style={{ marginTop: spacing.xxl, paddingHorizontal: gutter }}>
                <SectionHeader title="Favourite genres" />
                <View style={styles.genreRow}>
                  {data.genres.map((genre) => (
                    <Chip key={genre.genre} label={genre.genre} />
                  ))}
                </View>
              </View>
            )}

            {/* Social tabs */}
            <View style={{ marginTop: spacing.xxl, paddingHorizontal: gutter }}>
              <View style={styles.tabRow}>
                {(['activity', 'following', 'friends'] as Tab[]).map((value) => (
                  <Chip
                    key={value}
                    label={
                      value === 'activity'
                        ? 'Activity'
                        : value === 'following'
                          ? 'Artists'
                          : 'People'
                    }
                    active={tab === value}
                    onPress={() => setTab(value)}
                  />
                ))}
              </View>

              {tab === 'activity' &&
                (data.activity.length === 0 ? (
                  <EmptyState
                    icon="people-outline"
                    title={social ? 'No friend activity yet' : 'Friend activity needs an account'}
                    message={
                      social
                        ? 'Follow someone and what they play shows up here, if they share it.'
                        : 'Connect a Pulse backend to follow friends and see what they are listening to. Your own library and statistics work without one.'
                    }
                    compact
                  />
                ) : (
                  data.activity.map((item) => (
                    <View key={item.id} style={styles.activityRow}>
                      <Artwork uri={item.artworkUrl} size={44} radius={radii.sm} />
                      <View style={{ flex: 1 }}>
                        <Txt variant="callout" numberOfLines={1}>
                          {item.actorName ?? `@${item.actorHandle}`} {verbLabel(item.verb)}
                        </Txt>
                        <Txt variant="caption" tone="muted" numberOfLines={1}>
                          {[item.entityTitle, item.entitySubtitle].filter(Boolean).join(' · ')}
                        </Txt>
                        <Txt variant="caption" tone="faint">
                          {formatRelativeTime(item.createdAt)}
                        </Txt>
                      </View>
                    </View>
                  ))
                ))}

              {tab === 'following' &&
                (data.followedArtists.length === 0 ? (
                  <EmptyState
                    icon="person-outline"
                    title="You are not following any artists"
                    message="Follow an artist and Pulse will tell you when they release something."
                    actionLabel="Find artists"
                    onAction={() => router.push('/discover')}
                    compact
                  />
                ) : (
                  data.followedArtists.map((artist) => (
                    <Pressable
                      key={artist.id}
                      accessibilityRole="button"
                      onPress={() => router.push(`/artist/${encodeURIComponent(artist.id)}`)}
                      style={({ pressed }) => [styles.activityRow, pressed && { opacity: 0.7 }]}
                    >
                      <Artwork uri={artist.imageUrl} size={44} rounded />
                      <View style={{ flex: 1 }}>
                        <Txt variant="bodyStrong" numberOfLines={1}>
                          {artist.name}
                        </Txt>
                        <Txt variant="caption" tone="muted">
                          {artist.genre ?? 'Artist'}
                        </Txt>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                    </Pressable>
                  ))
                ))}

              {tab === 'friends' &&
                (data.friends.length === 0 ? (
                  <EmptyState
                    icon="person-add-outline"
                    title={social ? 'No friends yet' : 'Friends need an account'}
                    message={
                      social
                        ? 'Search for someone by their handle to follow them.'
                        : 'Connect a Pulse backend to follow people.'
                    }
                    actionLabel={social ? 'Find friends' : undefined}
                    onAction={social ? () => setFindOpen(true) : undefined}
                    compact
                  />
                ) : (
                  data.friends.map((friend) => (
                    <View key={friend.userId} style={styles.activityRow}>
                      <Artwork uri={friend.avatarUrl} size={44} rounded />
                      <View style={{ flex: 1 }}>
                        <Txt variant="bodyStrong" numberOfLines={1}>
                          {friend.displayName ?? `@${friend.handle}`}
                        </Txt>
                        <Txt variant="caption" tone="muted">
                          @{friend.handle} · {friend.relation}
                        </Txt>
                      </View>
                      <Button
                        label="Unfollow"
                        variant="secondary"
                        size="sm"
                        onPress={async () => {
                          await unfollowUser(friend.userId);
                          state.reload();
                        }}
                      />
                    </View>
                  ))
                ))}
            </View>

            {/* Appearance */}
            <View style={{ paddingHorizontal: gutter, marginTop: spacing.xxxl }}>
              <SectionHeader
                title="Appearance"
                subtitle="Light unless you choose otherwise"
              />
              <SegmentedControl<ThemePreference>
                value={preference}
                onChange={setPreference}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </View>

            {/* Account */}
            <View style={{ paddingHorizontal: gutter, marginTop: spacing.xxxl, gap: spacing.md }}>
              <Button
                label="Privacy and sharing"
                variant="secondary"
                icon="lock-closed-outline"
                full
                onPress={() => router.push('/settings/privacy')}
              />
              <Button
                label="Notification settings"
                variant="secondary"
                icon="notifications-outline"
                full
                onPress={() => router.push('/settings/notifications')}
              />
              <Button
                label="Playback"
                variant="secondary"
                icon="musical-notes-outline"
                full
                onPress={() => router.push('/settings/playback')}
              />
              {!!session && (
                <Button
                  label="Change password"
                  variant="secondary"
                  icon="key-outline"
                  full
                  onPress={() => setPasswordOpen(true)}
                />
              )}
              {Platform.OS === 'android' && (
                <Button
                  label={checkingUpdate ? 'Checking…' : `Check for updates · version ${installedVersion()}`}
                  variant="secondary"
                  icon="arrow-down-circle-outline"
                  full
                  loading={checkingUpdate}
                  onPress={async () => {
                    setCheckingUpdate(true);
                    const found = await checkForUpdate().catch(() => null);
                    setCheckingUpdate(false);
                    if (found) void Linking.openURL(found.url);
                    else toast("You're on the newest version", 'success');
                  }}
                />
              )}
              {!!session && (
                <Button label="Sign out" variant="danger" full onPress={() => void signOut()} />
              )}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* Edit profile */}
      <Sheet visible={editing} onClose={() => setEditing(false)} title="Edit profile">
        <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
          <Field label="Display name" value={name} onChangeText={setName} placeholder="Your name" />
          <Field
            label="Handle"
            value={handle}
            onChangeText={setHandle}
            placeholder="handle"
            autoCapitalize="none"
          />
          <Field
            label="Bio"
            value={bio}
            onChangeText={setBio}
            placeholder="Say something about your taste"
            multiline
          />
          <Button label="Save" full onPress={saveEdits} />
        </View>
      </Sheet>

      {/* Change password */}
      <Sheet visible={passwordOpen} onClose={closePassword} title="Change password">
        <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
          <Field
            label="Current password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
          />
          <Field
            label="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="At least 8 characters, letters and numbers"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
          />
          <Field
            label="New password again"
            value={repeatPassword}
            onChangeText={setRepeatPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
          />
          {passwordError && (
            <Txt variant="caption" tone="danger">
              {passwordError}
            </Txt>
          )}
          <Button label="Change password" full loading={savingPassword} onPress={() => void savePassword()} />
        </View>
      </Sheet>

      {/* Find friends */}
      <Sheet visible={findOpen} onClose={() => setFindOpen(false)} title="Find friends">
        <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
          <Field
            label="Search by handle"
            value={userQuery}
            onChangeText={setUserQuery}
            placeholder="handle"
            autoCapitalize="none"
          />
          {userResults.loading && <Txt variant="caption" tone="muted">Searching…</Txt>}
          {(userResults.data ?? []).map((user) => (
            <View key={user.userId} style={styles.activityRow}>
              <Artwork uri={user.avatarUrl} size={40} rounded />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{user.displayName ?? `@${user.handle}`}</Txt>
                <Txt variant="caption" tone="muted">
                  @{user.handle}
                </Txt>
              </View>
              <Button
                label="Follow"
                size="sm"
                onPress={async () => {
                  try {
                    await followUser(user);
                    toast(`Following @${user.handle}`, 'success');
                    state.reload();
                  } catch (error) {
                    toast(error instanceof Error ? error.message : 'Could not follow', 'error');
                  }
                }}
              />
            </View>
          ))}
          {debouncedUser.length >= 2 && !userResults.loading && (userResults.data ?? []).length === 0 && (
            <Txt variant="caption" tone="muted">
              Nobody matches that handle.
            </Txt>
          )}
        </View>
      </Sheet>
    </Screen>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1, gap: 2 }}>
      <Txt variant="title3">{value}</Txt>
      <Txt variant="caption" tone="muted" align="center">
        {label}
      </Txt>
    </View>
  );
}

function Field({
  label,
  multiline,
  secureTextEntry,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Passwords start hidden; the eye shows what was typed, to catch a typo.
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
      <View>
        <TextInput
          {...props}
          multiline={multiline}
          secureTextEntry={secureTextEntry && !shown}
          placeholderTextColor={colors.textFaint}
          style={[styles.input, multiline && { height: 88, textAlignVertical: 'top' }, secureTextEntry && { paddingRight: 52 }]}
          accessibilityLabel={label}
        />
        {secureTextEntry && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
            onPress={() => setShown((value) => !value)}
            hitSlop={6}
            style={styles.eye}
          >
            <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function verbLabel(verb: ActivityItem['verb']): string {
  switch (verb) {
    case 'played':
      return 'is listening to';
    case 'liked':
      return 'liked';
    case 'added_playlist':
      return 'added a playlist';
    case 'followed':
      return 'followed';
    case 'downloaded':
      return 'downloaded';
    default:
      return 'shared';
  }
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      paddingVertical: spacing.xl,
    },
    actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    counts: {
      flexDirection: 'row',
      marginTop: spacing.xl,
      paddingVertical: spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
    statsCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginTop: spacing.xl,
      padding: spacing.xl,
      borderRadius: radii.lg,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSoft,
    },
    tabRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
    genreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    activityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: 8,
    },
    eye: {
      position: 'absolute',
      right: 4,
      top: 0,
      bottom: 0,
      width: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    input: {
      backgroundColor: colors.card,
      borderRadius: radii.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: 14,
      color: colors.text,
      fontSize: 15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
  });
