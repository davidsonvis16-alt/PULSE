import { genreEnergy } from '@/src/core/moods';
import {
  getClusterInput,
  replaceGrooves,
  type GrooveDraft,
} from '@/src/db/repos/grooves';
import { familyForGenre, OTHER_FAMILY, type GenreFamily } from '@/src/grooves/genres';

/**
 * GrooveEngine.
 *
 * A Groove is a cluster Pulse found in the user's own collection, named after
 * what is actually in it. Nothing is hardcoded as a fixed set of categories:
 * a library of nothing but jazz produces jazz Grooves, and a library with four
 * Afrobeats tracks produces no Afro Groove at all, because four is not a shelf.
 *
 * What the clustering can honestly use:
 *
 *   - genre, folded into families, because tag vocabularies disagree
 *   - an energy estimate derived from that genre
 *   - release era
 *   - how concentrated the cluster is around a few artists
 *
 * What it does not use: tempo, key or loudness. Measuring those means decoding
 * the audio, which Pulse does not do, so it does not claim to know them.
 */

export interface TrackFeature {
  trackId: string;
  artistName: string;
  genre: string | null;
  family: GenreFamily;
  energy: number;
  decade: number | null;
}

/** A Groove has to be worth opening. Below this, tracks go somewhere broader. */
const MIN_GROOVE_SIZE = 4;
/** Above this, a family is split by energy instead of staying one big pile. */
const SPLIT_THRESHOLD = 12;
/** Without at least this much range, splitting a library by energy is noise. */
const MIN_ENERGY_SPREAD = 0.12;

/**
 * "Calm" and "high energy" are relative to the person's own collection, not to
 * music in general. Someone whose library is entirely ambient still has a
 * livelier third of it, and that is the third they want on a Monday morning.
 */
export interface EnergyBands {
  low: number;
  high: number;
  /** False when the collection is too uniform for the split to mean anything. */
  usable: boolean;
}

export function energyBands(features: TrackFeature[]): EnergyBands {
  const values = features.map((feature) => feature.energy).sort((a, b) => a - b);
  if (values.length === 0) return { low: 0.42, high: 0.68, usable: false };
  const low = values[Math.floor(values.length * 0.33)];
  const high = values[Math.floor(values.length * 0.67)];
  return { low, high, usable: high - low >= MIN_ENERGY_SPREAD || values[values.length - 1] - values[0] >= 0.25 };
}

export function buildFeatures(
  rows: { trackId: string; artistName: string; genre: string | null; releaseDate: string | null }[],
): TrackFeature[] {
  return rows.map((row) => {
    const family = familyForGenre(row.genre);
    // The genre's own energy is more specific than the family's average, so it
    // wins when the tag was precise enough to place.
    const energy = row.genre ? genreEnergy(row.genre) : family.energy;
    const year = row.releaseDate ? Number(row.releaseDate.slice(0, 4)) : NaN;
    return {
      trackId: row.trackId,
      artistName: row.artistName,
      genre: row.genre,
      family,
      energy,
      decade: Number.isFinite(year) && year > 1900 ? Math.floor(year / 10) * 10 : null,
    };
  });
}

export function clusterTracks(features: TrackFeature[]): GrooveDraft[] {
  if (features.length < MIN_GROOVE_SIZE) return [];

  const bands = energyBands(features);
  const drafts: GrooveDraft[] = [];

  // 1. Primary clusters: by genre family, split by energy when big enough.
  const byFamily = groupBy(features, (feature) => feature.family.id);
  const leftovers: TrackFeature[] = [];

  for (const [familyId, members] of byFamily) {
    if (familyId === OTHER_FAMILY.id || members.length < MIN_GROOVE_SIZE) {
      leftovers.push(...members);
      continue;
    }

    const family = members[0].family;
    const groups =
      members.length >= SPLIT_THRESHOLD && energySpread(members) > 0.25
        ? splitByEnergy(members, bands)
        : [{ band: 'all' as const, members }];

    for (const { band, members: bandMembers } of groups) {
      if (bandMembers.length < MIN_GROOVE_SIZE) {
        leftovers.push(...bandMembers);
        continue;
      }
      drafts.push(makeDraft(family, band, bandMembers, true));
    }
  }

  // 2. Cross-cutting clusters. A song can sit in more than one Groove, so these
  //    reuse tracks that already have a primary home.
  const calm = bands.usable ? features.filter((feature) => feature.energy <= bands.low) : [];
  if (calm.length >= MIN_GROOVE_SIZE && spansFamilies(calm) >= 2) {
    drafts.push({
      id: 'groove-late-night',
      name: 'Late Night',
      description: 'The calmest corner of your library, whatever genre it came from.',
      energy: average(calm.map((f) => f.energy)),
      era: null,
      genreFamily: null,
      accent: '#5B7CFA',
      members: calm.map((feature) => ({
        trackId: feature.trackId,
        score: 1 - feature.energy,
        isPrimary: false,
      })),
    });
  }

  const energetic = bands.usable ? features.filter((feature) => feature.energy >= bands.high) : [];
  if (energetic.length >= MIN_GROOVE_SIZE && spansFamilies(energetic) >= 2) {
    drafts.push({
      id: 'groove-high-energy',
      name: 'High Energy',
      description: 'The liveliest end of your collection, across every genre in it.',
      energy: average(energetic.map((f) => f.energy)),
      era: null,
      genreFamily: null,
      accent: '#FF5C8A',
      members: energetic.map((feature) => ({
        trackId: feature.trackId,
        score: feature.energy,
        isPrimary: false,
      })),
    });
  }

  // 3. An era Groove, but only when one decade genuinely stands out.
  const byDecade = groupBy(
    features.filter((feature) => feature.decade !== null),
    (feature) => String(feature.decade),
  );
  for (const [decade, members] of byDecade) {
    const share = members.length / features.length;
    const isCurrentDecade = Number(decade) >= Math.floor(new Date().getFullYear() / 10) * 10;
    if (members.length < MIN_GROOVE_SIZE * 2 || share < 0.18 || isCurrentDecade) continue;
    drafts.push({
      id: `groove-era-${decade}`,
      name: `${decade}s Rewind`,
      description: `${members.length} tracks in your library from the ${decade}s.`,
      energy: average(members.map((f) => f.energy)),
      era: Number(decade),
      genreFamily: null,
      accent: '#C08457',
      members: members.map((feature) => ({
        trackId: feature.trackId,
        score: 0.6,
        isPrimary: false,
      })),
    });
  }

  // 4. Anything that never landed anywhere, if there is enough of it to matter.
  const homeless = leftovers.filter(
    (feature) => !drafts.some((draft) => draft.members.some((m) => m.trackId === feature.trackId)),
  );
  if (homeless.length >= MIN_GROOVE_SIZE) {
    drafts.push({
      id: 'groove-everything-else',
      name: 'The Rest of You',
      description: 'Tracks that do not sit with any one group — and that is the point.',
      energy: average(homeless.map((f) => f.energy)),
      era: null,
      genreFamily: null,
      accent: '#8C93A1',
      members: homeless.map((feature) => ({
        trackId: feature.trackId,
        score: 0.4,
        isPrimary: true,
      })),
    });
  }

  return drafts.sort((a, b) => b.members.length - a.members.length);
}

type EnergyBand = 'calm' | 'mid' | 'high' | 'all';

function splitByEnergy(
  members: TrackFeature[],
  bands: EnergyBands,
): { band: EnergyBand; members: TrackFeature[] }[] {
  return [
    { band: 'calm' as const, members: members.filter((f) => f.energy <= bands.low) },
    {
      band: 'mid' as const,
      members: members.filter((f) => f.energy > bands.low && f.energy < bands.high),
    },
    { band: 'high' as const, members: members.filter((f) => f.energy >= bands.high) },
  ].filter((group) => group.members.length > 0);
}

/**
 * Names come from the cluster, not a list. The family says what it is, the
 * energy band says how it feels, and a dominant artist or sub-genre is used
 * when the cluster is really about one thing.
 */
function makeDraft(
  family: GenreFamily,
  band: EnergyBand,
  members: TrackFeature[],
  isPrimary: boolean,
): GrooveDraft {
  const energy = average(members.map((feature) => feature.energy));
  const dominantGenre = mostCommon(
    members.map((feature) => feature.genre).filter((genre): genre is string => !!genre),
  );
  const artistCount = new Set(members.map((feature) => feature.artistName)).size;

  // A sub-genre label is only better than the family name when it is specific
  // and most of the cluster actually carries it.
  const specific =
    dominantGenre &&
    dominantGenre.length <= 24 &&
    dominantGenre.toLowerCase() !== family.label.toLowerCase() &&
    countOf(members, (f) => f.genre === dominantGenre) / members.length >= 0.6
      ? dominantGenre
      : family.label;

  const name = nameFor(specific, band);
  const description = describe(specific, band, members.length, artistCount);

  return {
    id: `groove-${slug(family.id)}-${band}`,
    name,
    description,
    energy,
    era: null,
    genreFamily: family.id,
    accent: family.accent,
    members: members.map((feature) => ({
      trackId: feature.trackId,
      // Closeness to the cluster's centre, so the best fits lead the list.
      score: 1 - Math.abs(feature.energy - energy),
      isPrimary,
    })),
  };
}

function nameFor(label: string, band: EnergyBand): string {
  switch (band) {
    case 'calm':
      return `Late Night ${label}`;
    case 'high':
      return `${label} Energy`;
    case 'mid':
      return `${label} Essentials`;
    default:
      return `${label} Mode`;
  }
}

function describe(label: string, band: EnergyBand, count: number, artists: number): string {
  const shape =
    band === 'calm'
      ? 'Smooth, atmospheric'
      : band === 'high'
        ? 'The fastest, loudest'
        : band === 'mid'
          ? 'The middle of your'
          : 'Your';
  const who = artists === 1 ? 'one artist' : `${artists} artists`;
  return `${shape} ${label.toLowerCase()} in your library — ${count} tracks from ${who}.`;
}

/* ------------------------------------------------------------------- entry */

export async function analyzeTracks(): Promise<TrackFeature[]> {
  const rows = await getClusterInput();
  return buildFeatures(rows);
}

export async function generateGrooves(): Promise<GrooveDraft[]> {
  return clusterTracks(await analyzeTracks());
}

/** Rebuilds every Groove from the current collection. */
export async function rebuildGrooves(): Promise<GrooveDraft[]> {
  const drafts = await generateGrooves();
  await replaceGrooves(drafts);
  return drafts;
}

/**
 * Places newly imported tracks without disturbing the existing Grooves.
 * A full rebuild is cheap enough that this is what it does today; the
 * separation is here so incremental placement can replace it later.
 */
export async function updateGrooves(): Promise<GrooveDraft[]> {
  return rebuildGrooves();
}

/* ------------------------------------------------------------------ helpers */

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const group = key(item);
    const bucket = map.get(group);
    if (bucket) bucket.push(item);
    else map.set(group, [item]);
  }
  return map;
}

function average(values: number[]): number {
  if (values.length === 0) return 0.5;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function energySpread(members: TrackFeature[]): number {
  const values = members.map((feature) => feature.energy);
  return Math.max(...values) - Math.min(...values);
}

function spansFamilies(members: TrackFeature[]): number {
  return new Set(members.map((feature) => feature.family.id)).size;
}

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function countOf<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.reduce((total, item) => total + (predicate(item) ? 1 : 0), 0);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
