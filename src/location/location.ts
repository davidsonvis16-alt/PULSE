import * as Location from 'expo-location';
import type { PlaceRef } from '@/src/core/types';
import { getJsonSetting, setJsonSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';

/**
 * Location, used for one thing only: finding events near the user.
 *
 * Pulse asks once, when the user actually opens Events and taps to use their
 * location. It reads a single fix rather than watching position, and if
 * permission is refused the user types a city instead — the feature keeps
 * working either way.
 */

export type LocationOutcome =
  | { status: 'granted'; place: PlaceRef }
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string };

export async function getSavedPlace(): Promise<PlaceRef | null> {
  return getJsonSetting<PlaceRef | null>(SETTINGS_KEYS.location, null);
}

export async function savePlace(place: PlaceRef | null) {
  await setJsonSetting(SETTINGS_KEYS.location, place);
}

export async function requestCurrentPlace(): Promise<LocationOutcome> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) return { status: 'denied' };

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const place: PlaceRef = {
      label: 'Near you',
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };

    // Turn coordinates into a name so the UI can say where it is looking.
    try {
      const [address] = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      if (address) {
        place.city = address.city ?? address.subregion ?? null;
        place.countryCode = address.isoCountryCode ?? null;
        place.label = [address.city ?? address.subregion, address.region ?? address.isoCountryCode]
          .filter(Boolean)
          .join(', ') || 'Near you';
      }
    } catch {
      /* a name is a nicety; the coordinates are what the search needs */
    }

    await savePlace(place);
    return { status: 'granted', place };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'Location is unavailable on this device.',
    };
  }
}

/** Resolves a typed city name to coordinates so radius search still works. */
export async function resolveCity(query: string): Promise<PlaceRef | null> {
  const clean = query.trim();
  if (clean.length < 2) return null;
  try {
    const results = await Location.geocodeAsync(clean);
    const first = results[0];
    if (!first) return { label: clean, city: clean };
    return {
      label: clean,
      city: clean,
      latitude: first.latitude,
      longitude: first.longitude,
    };
  } catch {
    // Geocoding can be unavailable; the provider can still search by city name.
    return { label: clean, city: clean };
  }
}
