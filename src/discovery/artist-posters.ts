import {
  chartsStore,
  getCountryChart,
  type ChartEntry,
} from "@/src/discovery/charts";
import {
  chartCountry,
  chartCountryName,
} from "@/src/discovery/chart-countries";
import { getArtistProfile } from "@/src/discovery/artists";
import { getTopArtists } from "@/src/db/repos/history";
import { formatListeningTime } from "@/src/core/format";
import { getJson } from "@/src/core/http";

/** One big poster on the search page. */
export interface ArtistPosterData {
  key: string;
  name: string;
  imageUrl: string | null;
  scribble: string;
  strip: string;
  /** Where tapping goes: the artist page when the catalogue knows them, else a search. */
  artistId: string | null;
}

const CHART_POSTERS = 5;
const OWN_POSTERS = 3;

/** The first artist a credit names: "Wizkid & Tems" is a Wizkid poster. */
function leadArtist(credit: string): string {
  return credit
    .split(/\s*(?:,|&|\+|;)\s*|\s+(?:feat\.?|ft\.?|featuring|with|x)\s+/i)[0]
    .trim();
}

/**
 * Posters for the artists of the moment: the biggest names in the chart of
 * the country the listener follows, then the ones they play most themselves.
 * Every photo is a real one from the artist sources; an artist without one is
 * skipped rather than shown as a blank.
 */
export async function loadArtistPosters(): Promise<ArtistPosterData[]> {
  await chartCountry.load();
  const country = chartCountry.getSnapshot().code;
  const place = chartCountryName(country);
  const worldwide = country === "global";

  let entries: ChartEntry[] = [];
  if (worldwide) {
    await chartsStore.open().catch(() => {});
    entries = chartsStore.getSnapshot().board?.entries ?? [];
  } else {
    entries = await getCountryChart(country, 50).catch(() => []);
  }

  // Count each artist's songs in the chart and remember their best position.
  const byArtist = new Map<
    string,
    {
      name: string;
      songs: number;
      best: number;
      artistId: string | null;
      genre: string | null;
    }
  >();
  entries.forEach((entry, index) => {
    const name = leadArtist(entry.track.artistName);
    const key = name.toLowerCase();
    const seen = byArtist.get(key);
    if (seen) seen.songs += 1;
    else
      byArtist.set(key, {
        name,
        songs: 1,
        best: index + 1,
        artistId: entry.track.artistId,
        genre: entry.track.genre,
      });
  });
  // When the chart cannot be reached, the posters still come: Deezer's
  // worldwide top artists need no key.
  if (byArtist.size === 0) {
    const top = await getJson<{ data?: { name: string; position?: number }[] }>(
      "https://api.deezer.com/chart/0/artists?limit=12",
      { ttlMs: 6 * 60 * 60 * 1000 },
    ).catch(() => null);
    (top?.data ?? []).forEach((row, index) =>
      byArtist.set(row.name.toLowerCase(), {
        name: row.name,
        songs: 1,
        best: index + 1,
        artistId: null,
        genre: null,
      }),
    );
  }
  const leaders = [...byArtist.values()]
    .sort((a, b) => a.best - b.best)
    .slice(0, CHART_POSTERS + 3);

  const [mine] = await Promise.all([
    getTopArtists("month", OWN_POSTERS + 2).catch(() => []),
  ]);

  const posters: ArtistPosterData[] = [];
  for (const artist of leaders) {
    if (posters.length >= CHART_POSTERS) break;
    const profile = await getArtistProfile(artist.name).catch(() => null);
    if (!profile?.pictureUrl) continue;
    const where = worldwide ? "the world" : place;
    posters.push({
      key: `chart-${artist.name}`,
      name: artist.name,
      imageUrl: profile.pictureUrl,
      scribble:
        artist.best === 1
          ? `#1 in ${where} right now`
          : artist.songs > 1
            ? `${artist.songs} songs in the ${worldwide ? "world" : place} chart`
            : `#${artist.best} in ${where}`,
      strip: [artist.genre, `Chart · ${worldwide ? "Worldwide" : place}`]
        .filter(Boolean)
        .join(" · "),
      artistId: artist.artistId,
    });
  }

  const taken = new Set(posters.map((p) => p.name.toLowerCase()));
  let own = 0;
  for (const artist of mine) {
    if (own >= OWN_POSTERS || taken.has(artist.name.toLowerCase())) continue;
    const profile = await getArtistProfile(artist.name).catch(() => null);
    const imageUrl = profile?.pictureUrl ?? artist.imageUrl ?? null;
    if (!imageUrl) continue;
    own += 1;
    posters.push({
      key: `mine-${artist.name}`,
      name: artist.name,
      imageUrl,
      scribble:
        own === 1
          ? "your most played this month"
          : `${formatListeningTime(artist.msPlayed)} with you this month`,
      strip: "Your music · On repeat",
      artistId: artist.artistId,
    });
  }
  return posters;
}
