/**
 * Genre families.
 *
 * Real tag data is a mess: "R&B/Soul", "Contemporary R&B", "rnb", "Alté" and
 * "Neo-Soul" all describe roughly the same shelf. Grooves need a coarser
 * vocabulary than tags provide, so genres are folded into families here, and
 * the family is what clustering and naming actually work with.
 */

export interface GenreFamily {
  id: string;
  /** How a Groove built from this family should refer to itself. */
  label: string;
  /** Typical energy, used when a track has nothing better to go on. */
  energy: number;
  accent: string;
  /** Lower-cased fragments that map a tag onto this family. */
  matches: string[];
}

export const GENRE_FAMILIES: GenreFamily[] = [
  {
    id: 'rnb',
    label: 'R&B',
    energy: 0.45,
    accent: '#8E6BFF',
    matches: ['r&b', 'rnb', 'soul', 'neo-soul', 'neosoul', 'quiet storm', 'motown', 'funk'],
  },
  {
    id: 'hiphop',
    label: 'Hip-Hop',
    energy: 0.72,
    accent: '#FF6B4A',
    matches: ['hip-hop', 'hip hop', 'rap', 'trap', 'drill', 'grime', 'boom bap'],
  },
  {
    id: 'afro',
    label: 'Afro',
    energy: 0.78,
    accent: '#FFB020',
    matches: ['afro', 'afrobeat', 'afrobeats', 'amapiano', 'highlife', 'alte', 'naija', 'bongo'],
  },
  {
    id: 'pop',
    label: 'Pop',
    energy: 0.66,
    accent: '#FF5C8A',
    matches: ['pop', 'k-pop', 'j-pop', 'synthpop', 'electropop', 'dance pop', 'teen pop'],
  },
  {
    id: 'rock',
    label: 'Rock',
    energy: 0.78,
    accent: '#F2803C',
    matches: ['rock', 'punk', 'grunge', 'metal', 'hardcore', 'emo', 'shoegaze', 'garage'],
  },
  {
    id: 'alternative',
    label: 'Alternative',
    energy: 0.58,
    accent: '#67C8B0',
    matches: ['alternative', 'indie', 'britpop', 'dream pop', 'bedroom pop', 'lo-fi', 'lofi'],
  },
  {
    id: 'electronic',
    label: 'Electronic',
    energy: 0.82,
    accent: '#4CC9F0',
    matches: [
      'electronic', 'dance', 'house', 'techno', 'edm', 'trance', 'dubstep', 'garage',
      'drum & bass', 'drum and bass', 'dnb', 'club', 'ambient', 'downtempo', 'chillout',
    ],
  },
  {
    id: 'caribbean',
    label: 'Reggae & Dancehall',
    energy: 0.66,
    accent: '#5CD98A',
    matches: ['reggae', 'dancehall', 'ska', 'dub', 'soca', 'calypso'],
  },
  {
    id: 'latin',
    label: 'Latin',
    energy: 0.76,
    accent: '#FF8FA3',
    matches: ['latin', 'reggaeton', 'salsa', 'bachata', 'cumbia', 'merengue', 'tango', 'samba'],
  },
  {
    id: 'jazz',
    label: 'Jazz',
    energy: 0.36,
    accent: '#C9A227',
    matches: ['jazz', 'bebop', 'swing', 'blues', 'big band', 'fusion'],
  },
  {
    id: 'classical',
    label: 'Classical',
    energy: 0.2,
    accent: '#A0A7B4',
    matches: ['classical', 'opera', 'symphony', 'chamber', 'baroque', 'piano', 'orchestral'],
  },
  {
    id: 'acoustic',
    label: 'Acoustic',
    energy: 0.34,
    accent: '#C08457',
    matches: ['folk', 'acoustic', 'singer/songwriter', 'singer-songwriter', 'country', 'americana', 'bluegrass'],
  },
  {
    id: 'gospel',
    label: 'Gospel',
    energy: 0.55,
    accent: '#7FB3FF',
    matches: ['gospel', 'christian', 'worship', 'spiritual', 'praise'],
  },
  {
    id: 'soundtrack',
    label: 'Soundtrack',
    energy: 0.4,
    accent: '#9AA5B1',
    matches: ['soundtrack', 'score', 'film', 'anime', 'game', 'instrumental', 'new age', 'meditative'],
  },
];

const OTHER: GenreFamily = {
  id: 'other',
  label: 'Mixed',
  energy: 0.55,
  accent: '#8C93A1',
  matches: [],
};

/**
 * Resolves a tag to a family.
 *
 * Genre names put the head noun last — "Alternative Rock" is rock, "Indie Pop"
 * is pop, "Hip-Hop/Rap" is rap — so the match that ends furthest right wins.
 * Length breaks ties, which is what keeps "afrobeats" from losing to "afro"
 * and "neo-soul" from losing to "soul".
 */
export function familyForGenre(genre: string | null | undefined): GenreFamily {
  if (!genre) return OTHER;
  const value = genre.toLowerCase();

  let best: { family: GenreFamily; end: number; length: number } | null = null;
  for (const family of GENRE_FAMILIES) {
    for (const fragment of family.matches) {
      const index = value.lastIndexOf(fragment);
      if (index === -1) continue;
      const end = index + fragment.length;
      const better =
        !best || end > best.end || (end === best.end && fragment.length > best.length);
      if (better) best = { family, end, length: fragment.length };
    }
  }
  return best?.family ?? OTHER;
}

export function familyById(id: string | null | undefined): GenreFamily {
  return GENRE_FAMILIES.find((family) => family.id === id) ?? OTHER;
}

export const OTHER_FAMILY = OTHER;
