import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import type { MusicEvent, PlaceRef } from '@/src/core/types';
import { formatEventDate, formatPriceRange } from '@/src/core/format';
import { eventProvider } from '@/src/providers/events';
import { cacheEvents, getCachedEvents } from '@/src/db/repos/events';
import { getFollowedArtists } from '@/src/db/repos/library';
import { getSavedPlace, requestCurrentPlace, resolveCity, savePlace } from '@/src/location/location';
import { useAsync, useDebounced } from '@/src/hooks/use-async';
import { useResponsive } from '@/src/hooks/use-responsive';
import { useShareSheet } from '@/src/ui/share-sheet';
import { useToast } from '@/src/ui/toast';
import { eventShare } from '@/src/share/share';
import { Screen, useBottomInset } from '@/src/ui/screen';
import { Txt } from '@/src/ui/text';
import { Button, Chip } from '@/src/ui/buttons';
import { EventCard } from '@/src/ui/cards';
import { Sheet } from '@/src/ui/sheet';
import { EmptyState, ErrorState, SkeletonRows } from '@/src/ui/states';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

type Filter = 'all' | 'concerts' | 'festivals' | 'following';

const GENRES = ['Pop', 'Rock', 'Hip-Hop', 'Electronic', 'R&B', 'Country', 'Latin', 'Jazz'];
const DATE_RANGES = [
  { id: 'any', label: 'Any date', days: null },
  { id: 'week', label: 'This week', days: 7 },
  { id: 'month', label: 'This month', days: 30 },
  { id: 'quarter', label: 'Next 3 months', days: 90 },
] as const;

/**
 * Events.
 *
 * Every listing, price and ticket link comes from the configured event
 * provider. With no provider configured Pulse says so and offers the setup
 * step, rather than showing invented concerts.
 */
export function EventsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ q?: string }>();
  const { gutter, isTabletUp, width } = useResponsive();
  const bottomInset = useBottomInset();
  const share = useShareSheet();
  const toast = useToast();

  const provider = eventProvider();
  const configured = provider.isConfigured();

  const [place, setPlace] = useState<PlaceRef | null>(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [cityInput, setCityInput] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [genre, setGenre] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<(typeof DATE_RANGES)[number]['id']>('any');
  const [query, setQuery] = useState(params.q ?? '');
  const debounced = useDebounced(query.trim(), 400);
  const [locating, setLocating] = useState(false);
  const [detail, setDetail] = useState<MusicEvent | null>(null);

  useEffect(() => {
    void getSavedPlace().then(setPlace);
  }, []);

  const state = useAsync<{ events: MusicEvent[]; fromCache: boolean }>(
    async (signal) => {
      if (!configured) return { events: [], fromCache: false };

      const range = DATE_RANGES.find((r) => r.id === dateRange);
      const startDate = new Date().toISOString().slice(0, 10);
      const endDate = range?.days
        ? new Date(Date.now() + range.days * 86400_000).toISOString().slice(0, 10)
        : null;

      const base = {
        genre,
        startDate,
        endDate,
        limit: 40,
        signal,
      };

      try {
        let events: MusicEvent[] = [];

        if (filter === 'following') {
          const artists = await getFollowedArtists();
          if (artists.length === 0) return { events: [], fromCache: false };
          const batches = await Promise.all(
            artists.slice(0, 8).map((artist) =>
              provider.searchEvents({ ...base, artistName: artist.name, limit: 5 }).catch(() => []),
            ),
          );
          events = dedupe(batches.flat());
        } else if (debounced.length >= 2) {
          events = await provider.searchEvents({
            ...base,
            term: debounced,
            city: place?.city ?? undefined,
          });
        } else if (place?.latitude != null && place?.longitude != null) {
          events = await provider.nearbyEvents(
            { latitude: place.latitude, longitude: place.longitude },
            { ...base, radiusKm: 120 },
          );
        } else if (place?.city) {
          events = await provider.searchEvents({ ...base, city: place.city });
        } else {
          return { events: [], fromCache: false };
        }

        if (filter === 'festivals') {
          events = events.filter((e) => /festival|fest\b/i.test(e.name));
        } else if (filter === 'concerts') {
          events = events.filter((e) => !/festival|fest\b/i.test(e.name));
        }

        void cacheEvents(events);
        return { events, fromCache: false };
      } catch (error) {
        // Offline or provider down: show the last known listings, clearly labelled.
        const cached = await getCachedEvents({ city: place?.city ?? null, limit: 40 });
        if (cached.length > 0) return { events: cached, fromCache: true };
        throw error;
      }
    },
    [configured, filter, genre, dateRange, debounced, place?.city, place?.latitude],
  );

  const useMyLocation = useCallback(async () => {
    setLocating(true);
    const outcome = await requestCurrentPlace();
    setLocating(false);
    if (outcome.status === 'granted') {
      setPlace(outcome.place);
      setPlaceOpen(false);
      state.reload();
      return;
    }
    toast(
      outcome.status === 'denied'
        ? 'Location is off, so pick a city instead.'
        : outcome.reason,
      'error',
    );
  }, [state, toast]);

  const applyCity = useCallback(async () => {
    const resolved = await resolveCity(cityInput);
    if (!resolved) {
      toast('Enter a city name', 'error');
      return;
    }
    await savePlace(resolved);
    setPlace(resolved);
    setPlaceOpen(false);
    state.reload();
  }, [cityInput, state, toast]);

  const events = state.data?.events ?? [];

  return (
    <Screen>
      <View style={[styles.header, { paddingHorizontal: gutter }]}>
        <Txt variant="title1">Events</Txt>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change location"
          onPress={() => setPlaceOpen(true)}
          style={({ pressed }) => [styles.place, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="location-outline" size={14} color={colors.accent} />
          <Txt variant="caption" numberOfLines={1} style={{ maxWidth: 140 }}>
            {place?.label ?? 'Set location'}
          </Txt>
          <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
        </Pressable>
      </View>

      {configured && (
        <>
          <View style={[styles.field, { marginHorizontal: gutter }]}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Artist, festival or venue"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              accessibilityLabel="Search events"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear">
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </Pressable>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm, paddingVertical: spacing.md }}
          >
            {(['all', 'concerts', 'festivals', 'following'] as Filter[]).map((value) => (
              <Chip
                key={value}
                label={
                  value === 'all'
                    ? 'All'
                    : value === 'following'
                      ? 'Artists you follow'
                      : value[0].toUpperCase() + value.slice(1)
                }
                active={filter === value}
                onPress={() => setFilter(value)}
              />
            ))}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: gutter, gap: spacing.sm, paddingBottom: spacing.md }}
          >
            {DATE_RANGES.map((range) => (
              <Chip
                key={range.id}
                label={range.label}
                active={dateRange === range.id}
                onPress={() => setDateRange(range.id)}
              />
            ))}
            <View style={{ width: spacing.md }} />
            {GENRES.map((value) => (
              <Chip
                key={value}
                label={value}
                active={genre === value}
                onPress={() => setGenre(genre === value ? null : value)}
              />
            ))}
          </ScrollView>
        </>
      )}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: bottomInset, gap: spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        {!configured ? (
          <EmptyState
            icon="ticket-outline"
            title="No events source connected"
            message={`${provider.setupHint()} Pulse will not show concerts it cannot verify.`}
          />
        ) : !place ? (
          <EmptyState
            icon="location-outline"
            title="Where are you looking?"
            message="Pulse needs a location to find concerts near you. Use your current location, or type a city."
            actionLabel="Choose a location"
            onAction={() => setPlaceOpen(true)}
          />
        ) : state.loading ? (
          <SkeletonRows count={6} height={74} />
        ) : state.error ? (
          <ErrorState error={state.error} onRetry={state.reload} />
        ) : events.length === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title="No events found"
            message={
              filter === 'following'
                ? 'None of the artists you follow have dates listed for this filter.'
                : 'Nothing matches that search in this area and date range.'
            }
          />
        ) : (
          <>
            {state.data?.fromCache && (
              <View style={styles.cacheNote}>
                <Ionicons name="cloud-offline-outline" size={14} color={colors.warning} />
                <Txt variant="caption" tone="muted">
                  Showing the last listings Pulse downloaded. Reconnect for current dates.
                </Txt>
              </View>
            )}
            <View style={isTabletUp ? styles.grid : undefined}>
              {events.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  width={isTabletUp ? (width - gutter * 2 - spacing.md) / 2 : undefined}
                  onPress={() => setDetail(event)}
                  onTickets={
                    event.ticket
                      ? () => void WebBrowser.openBrowserAsync(event.ticket!.url)
                      : undefined
                  }
                />
              ))}
            </View>
            <Txt variant="caption" tone="faint" style={{ marginTop: spacing.md }}>
              {provider.attribution}.
            </Txt>
          </>
        )}
      </ScrollView>

      {/* Event detail */}
      <Sheet visible={!!detail} onClose={() => setDetail(null)} title={detail?.name}>
        {detail && (
          <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
            <Fact label="When" value={`${formatEventDate(detail.startsAt)}${detail.localTimeLabel ? ` · ${detail.localTimeLabel}` : ''}`} />
            <Fact
              label="Where"
              value={[detail.venueName, detail.city, detail.region, detail.country]
                .filter(Boolean)
                .join(', ') || 'To be announced'}
            />
            {detail.artistNames.length > 0 && (
              <Fact label="Line-up" value={detail.artistNames.join(', ')} />
            )}
            {detail.genre && <Fact label="Genre" value={detail.genre} />}
            {detail.ticket ? (
              <>
                <Fact label="Tickets" value={detail.ticket.sellerName} />
                {formatPriceRange(detail.ticket.priceMin, detail.ticket.priceMax, detail.ticket.currency) && (
                  <Fact
                    label="Price"
                    value={
                      formatPriceRange(
                        detail.ticket.priceMin,
                        detail.ticket.priceMax,
                        detail.ticket.currency,
                      )!
                    }
                  />
                )}
                {detail.ticket.status && <Fact label="Status" value={detail.ticket.status} />}
                <Button
                  label={`Get tickets on ${detail.ticket.sellerName}`}
                  icon="open-outline"
                  full
                  onPress={() => void WebBrowser.openBrowserAsync(detail.ticket!.url)}
                />
              </>
            ) : (
              <Txt variant="caption" tone="muted">
                No ticket information has been published for this event yet.
              </Txt>
            )}
            <Button
              label="Share this event"
              variant="secondary"
              icon="share-outline"
              full
              onPress={() => {
                const payload = eventShare(detail);
                setDetail(null);
                setTimeout(() => share(payload), 220);
              }}
            />
            <Txt variant="caption" tone="faint">
              {provider.attribution}. Pulse links to the official seller and never resells tickets.
            </Txt>
          </View>
        )}
      </Sheet>

      {/* Location picker */}
      <Sheet visible={placeOpen} onClose={() => setPlaceOpen(false)} title="Location">
        <View style={{ gap: spacing.lg, paddingTop: spacing.sm }}>
          <Button
            label="Use my current location"
            icon="navigate"
            full
            loading={locating}
            onPress={useMyLocation}
          />
          <Txt variant="caption" tone="muted">
            Pulse reads your position once, only for this search. It is never tracked in the
            background and never leaves the device except as a search radius.
          </Txt>
          <View style={styles.field}>
            <Ionicons name="business-outline" size={16} color={colors.textMuted} />
            <TextInput
              value={cityInput}
              onChangeText={setCityInput}
              placeholder="Or type a city"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={applyCity}
              accessibilityLabel="City"
            />
          </View>
          <Button
            label="Search this city"
            variant="secondary"
            full
            disabled={cityInput.trim().length < 2}
            onPress={applyCity}
          />
          {place && (
            <Button
              label="Clear location"
              variant="ghost"
              full
              onPress={async () => {
                await savePlace(null);
                setPlace(null);
                setPlaceOpen(false);
              }}
            />
          )}
        </View>
      </Sheet>
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      <Txt variant="caption" tone="muted" style={{ width: 84 }}>
        {label}
      </Txt>
      <Txt variant="callout" style={{ flex: 1 }}>
        {value}
      </Txt>
    </View>
  );
}

function dedupe(events: MusicEvent[]): MusicEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    place: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      height: 32,
      borderRadius: radii.pill,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      height: 42,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    input: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    cacheNote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.card,
    },
  });
