import type { Mood, MoodId } from '@/src/core/types';
import { palette } from '@/src/theme/tokens';

/**
 * Pulse's mood vocabulary.
 *
 * A mood is not a made-up playlist — it is a query shape. Each mood maps onto
 * real genres and search terms the configured provider understands, plus an
 * energy value the discovery engine uses as an extra ranking signal.
 */
export const MOODS: Mood[] = [
  {
    id: 'calm',
    name: 'Calm',
    tagline: 'Relax & unwind',
    seeds: ['Ambient', 'New Age', 'Classical', 'Piano', 'Sleep'],
    energy: 0.12,
    accent: palette.moodCalm,
  },
  {
    id: 'chill',
    name: 'Chill',
    tagline: 'Laid-back vibes',
    seeds: ['Chillout', 'Lo-Fi', 'Downtempo', 'Neo-Soul', 'Bedroom Pop'],
    energy: 0.34,
    accent: palette.moodChill,
  },
  {
    id: 'focus',
    name: 'Focus',
    tagline: 'Stay in the zone',
    seeds: ['Instrumental', 'Minimal', 'Study', 'Post-Rock', 'Modern Classical'],
    energy: 0.28,
    accent: palette.moodCalm,
  },
  {
    id: 'energetic',
    name: 'Energetic',
    tagline: 'Get moving',
    seeds: ['Dance', 'House', 'Afrobeats', 'Workout', 'Electronic'],
    energy: 0.86,
    accent: palette.moodEnergetic,
  },
  {
    id: 'party',
    name: 'Party',
    tagline: 'Turn it all the way up',
    seeds: ['Hip-Hop', 'Reggaeton', 'Dancehall', 'Club', 'Pop'],
    energy: 0.92,
    accent: palette.moodEnergetic,
  },
  {
    id: 'rock',
    name: 'Rock',
    tagline: 'Turn it up',
    seeds: ['Rock', 'Alternative', 'Indie Rock', 'Punk', 'Metal'],
    energy: 0.78,
    accent: palette.moodRock,
  },
];

export function getMood(id: string | undefined | null): Mood | undefined {
  return MOODS.find((m) => m.id === id);
}

export const MOOD_IDS: MoodId[] = MOODS.map((m) => m.id);

/**
 * Rough energy for a genre name, 0 (still) to 1 (relentless).
 * Used to match what a listener reaches for against what a mood is asking for.
 * Unknown genres land mid-scale so they are never unfairly penalised.
 */
const GENRE_ENERGY: Record<string, number> = {
  ambient: 0.1,
  'new age': 0.12,
  classical: 0.2,
  jazz: 0.35,
  blues: 0.4,
  'singer/songwriter': 0.35,
  folk: 0.35,
  country: 0.5,
  soundtrack: 0.4,
  'easy listening': 0.2,
  soul: 0.45,
  'r&b/soul': 0.5,
  gospel: 0.55,
  reggae: 0.55,
  pop: 0.68,
  'k-pop': 0.78,
  'hip-hop/rap': 0.75,
  rap: 0.75,
  afrobeats: 0.8,
  worldwide: 0.6,
  latin: 0.75,
  electronic: 0.8,
  dance: 0.85,
  house: 0.85,
  techno: 0.9,
  'drum & bass': 0.95,
  alternative: 0.65,
  indie: 0.6,
  rock: 0.78,
  punk: 0.9,
  'hard rock': 0.88,
  metal: 0.95,
};

export function genreEnergy(genre: string | null | undefined): number {
  if (!genre) return 0.5;
  const key = genre.trim().toLowerCase();
  if (GENRE_ENERGY[key] !== undefined) return GENRE_ENERGY[key];
  const partial = Object.keys(GENRE_ENERGY).find((k) => key.includes(k) || k.includes(key));
  return partial ? GENRE_ENERGY[partial] : 0.5;
}
