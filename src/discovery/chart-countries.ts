import { Store } from '@/src/core/store';
import { getSetting, setSetting } from '@/src/db/repos/settings';
import type { ChartEntry } from '@/src/discovery/charts';

/**
 * Every country with a published Apple Music most-played chart, checked
 * against the live feed. Countries Apple publishes no chart for are left out
 * rather than offered and left empty.
 */
export const CHART_COUNTRIES: { code: string; name: string }[] = [
  { code: 'al', name: 'Albania' },
  { code: 'dz', name: 'Algeria' },
  { code: 'ao', name: 'Angola' },
  { code: 'ag', name: 'Antigua & Barbuda' },
  { code: 'ar', name: 'Argentina' },
  { code: 'am', name: 'Armenia' },
  { code: 'au', name: 'Australia' },
  { code: 'at', name: 'Austria' },
  { code: 'az', name: 'Azerbaijan' },
  { code: 'bs', name: 'Bahamas' },
  { code: 'bh', name: 'Bahrain' },
  { code: 'bb', name: 'Barbados' },
  { code: 'by', name: 'Belarus' },
  { code: 'be', name: 'Belgium' },
  { code: 'bz', name: 'Belize' },
  { code: 'bj', name: 'Benin' },
  { code: 'bm', name: 'Bermuda' },
  { code: 'bt', name: 'Bhutan' },
  { code: 'bo', name: 'Bolivia' },
  { code: 'ba', name: 'Bosnia & Herzegovina' },
  { code: 'bw', name: 'Botswana' },
  { code: 'br', name: 'Brazil' },
  { code: 'vg', name: 'British Virgin Islands' },
  { code: 'bn', name: 'Brunei' },
  { code: 'bg', name: 'Bulgaria' },
  { code: 'bf', name: 'Burkina Faso' },
  { code: 'kh', name: 'Cambodia' },
  { code: 'ca', name: 'Canada' },
  { code: 'cv', name: 'Cape Verde' },
  { code: 'ky', name: 'Cayman Islands' },
  { code: 'td', name: 'Chad' },
  { code: 'cl', name: 'Chile' },
  { code: 'co', name: 'Colombia' },
  { code: 'cg', name: 'Congo - Brazzaville' },
  { code: 'cd', name: 'Congo - Kinshasa' },
  { code: 'cr', name: 'Costa Rica' },
  { code: 'ci', name: 'Côte d’Ivoire' },
  { code: 'hr', name: 'Croatia' },
  { code: 'cy', name: 'Cyprus' },
  { code: 'cz', name: 'Czechia' },
  { code: 'dk', name: 'Denmark' },
  { code: 'dm', name: 'Dominica' },
  { code: 'ec', name: 'Ecuador' },
  { code: 'eg', name: 'Egypt' },
  { code: 'sv', name: 'El Salvador' },
  { code: 'ee', name: 'Estonia' },
  { code: 'sz', name: 'Eswatini' },
  { code: 'fj', name: 'Fiji' },
  { code: 'fi', name: 'Finland' },
  { code: 'fr', name: 'France' },
  { code: 'ga', name: 'Gabon' },
  { code: 'gm', name: 'Gambia' },
  { code: 'ge', name: 'Georgia' },
  { code: 'de', name: 'Germany' },
  { code: 'gh', name: 'Ghana' },
  { code: 'gr', name: 'Greece' },
  { code: 'gd', name: 'Grenada' },
  { code: 'gt', name: 'Guatemala' },
  { code: 'gw', name: 'Guinea-Bissau' },
  { code: 'gy', name: 'Guyana' },
  { code: 'hn', name: 'Honduras' },
  { code: 'hk', name: 'Hong Kong SAR China' },
  { code: 'hu', name: 'Hungary' },
  { code: 'in', name: 'India' },
  { code: 'id', name: 'Indonesia' },
  { code: 'iq', name: 'Iraq' },
  { code: 'ie', name: 'Ireland' },
  { code: 'il', name: 'Israel' },
  { code: 'it', name: 'Italy' },
  { code: 'jm', name: 'Jamaica' },
  { code: 'jp', name: 'Japan' },
  { code: 'jo', name: 'Jordan' },
  { code: 'kz', name: 'Kazakhstan' },
  { code: 'ke', name: 'Kenya' },
  { code: 'xk', name: 'Kosovo' },
  { code: 'kw', name: 'Kuwait' },
  { code: 'kg', name: 'Kyrgyzstan' },
  { code: 'la', name: 'Laos' },
  { code: 'lv', name: 'Latvia' },
  { code: 'lb', name: 'Lebanon' },
  { code: 'lr', name: 'Liberia' },
  { code: 'ly', name: 'Libya' },
  { code: 'lt', name: 'Lithuania' },
  { code: 'lu', name: 'Luxembourg' },
  { code: 'mo', name: 'Macao SAR China' },
  { code: 'mg', name: 'Madagascar' },
  { code: 'mw', name: 'Malawi' },
  { code: 'mv', name: 'Maldives' },
  { code: 'ml', name: 'Mali' },
  { code: 'mt', name: 'Malta' },
  { code: 'mr', name: 'Mauritania' },
  { code: 'mu', name: 'Mauritius' },
  { code: 'mx', name: 'Mexico' },
  { code: 'fm', name: 'Micronesia' },
  { code: 'md', name: 'Moldova' },
  { code: 'mn', name: 'Mongolia' },
  { code: 'me', name: 'Montenegro' },
  { code: 'ms', name: 'Montserrat' },
  { code: 'ma', name: 'Morocco' },
  { code: 'mz', name: 'Mozambique' },
  { code: 'mm', name: 'Myanmar (Burma)' },
  { code: 'np', name: 'Nepal' },
  { code: 'nl', name: 'Netherlands' },
  { code: 'nz', name: 'New Zealand' },
  { code: 'ni', name: 'Nicaragua' },
  { code: 'ne', name: 'Niger' },
  { code: 'ng', name: 'Nigeria' },
  { code: 'mk', name: 'North Macedonia' },
  { code: 'no', name: 'Norway' },
  { code: 'om', name: 'Oman' },
  { code: 'pk', name: 'Pakistan' },
  { code: 'pa', name: 'Panama' },
  { code: 'pg', name: 'Papua New Guinea' },
  { code: 'py', name: 'Paraguay' },
  { code: 'pe', name: 'Peru' },
  { code: 'ph', name: 'Philippines' },
  { code: 'pl', name: 'Poland' },
  { code: 'pt', name: 'Portugal' },
  { code: 'qa', name: 'Qatar' },
  { code: 'ro', name: 'Romania' },
  { code: 'rw', name: 'Rwanda' },
  { code: 'st', name: 'São Tomé & Príncipe' },
  { code: 'sa', name: 'Saudi Arabia' },
  { code: 'sn', name: 'Senegal' },
  { code: 'sc', name: 'Seychelles' },
  { code: 'sl', name: 'Sierra Leone' },
  { code: 'sg', name: 'Singapore' },
  { code: 'sk', name: 'Slovakia' },
  { code: 'si', name: 'Slovenia' },
  { code: 'sb', name: 'Solomon Islands' },
  { code: 'za', name: 'South Africa' },
  { code: 'es', name: 'Spain' },
  { code: 'lk', name: 'Sri Lanka' },
  { code: 'kn', name: 'St. Kitts & Nevis' },
  { code: 'lc', name: 'St. Lucia' },
  { code: 'vc', name: 'St. Vincent & Grenadines' },
  { code: 'sr', name: 'Suriname' },
  { code: 'se', name: 'Sweden' },
  { code: 'ch', name: 'Switzerland' },
  { code: 'tw', name: 'Taiwan' },
  { code: 'tj', name: 'Tajikistan' },
  { code: 'to', name: 'Tonga' },
  { code: 'tt', name: 'Trinidad & Tobago' },
  { code: 'tn', name: 'Tunisia' },
  { code: 'tr', name: 'Türkiye' },
  { code: 'tm', name: 'Turkmenistan' },
  { code: 'tc', name: 'Turks & Caicos Islands' },
  { code: 'ug', name: 'Uganda' },
  { code: 'ua', name: 'Ukraine' },
  { code: 'ae', name: 'United Arab Emirates' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'us', name: 'United States' },
  { code: 'uy', name: 'Uruguay' },
  { code: 'uz', name: 'Uzbekistan' },
  { code: 'vu', name: 'Vanuatu' },
  { code: 've', name: 'Venezuela' },
  { code: 'vn', name: 'Vietnam' },
  { code: 'ye', name: 'Yemen' },
  { code: 'zm', name: 'Zambia' },
];


const COUNTRY_KEY = 'charts.country';

export function chartCountryName(code: string): string {
  if (code === 'global') return 'Worldwide';
  return CHART_COUNTRIES.find((country) => country.code === code)?.name ?? code.toUpperCase();
}

/**
 * The country whose chart this listener follows, remembered on the device.
 * "global" is the worldwide board built from several countries.
 */
class ChartCountryStore extends Store<{ code: string; loaded: boolean }> {
  async load() {
    if (this.getSnapshot().loaded) return;
    const saved = await getSetting(COUNTRY_KEY).catch(() => null);
    const known = saved === 'global' || CHART_COUNTRIES.some((country) => country.code === saved);
    this.set({ code: known && saved ? saved : 'global', loaded: true });
  }

  choose(code: string) {
    this.set({ code, loaded: true });
    void setSetting(COUNTRY_KEY, code).catch(() => {});
  }
}

export const chartCountry = new ChartCountryStore({ code: 'global', loaded: false });

export interface ChartSummary {
  number1: ChartEntry | null;
  /** The artist with the most songs in the chart. */
  topArtist: { name: string; songs: number } | null;
  /** The genre most of the chart belongs to. */
  topGenre: { name: string; songs: number } | null;
}

export function summariseChart(entries: ChartEntry[]): ChartSummary {
  const most = (names: (string | null)[]) => {
    const counts = new Map<string, number>();
    for (const name of names) if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    let best: { name: string; songs: number } | null = null;
    for (const [name, songs] of counts) if (!best || songs > best.songs) best = { name, songs };
    return best;
  };
  return {
    number1: entries[0] ?? null,
    // "A & B" credits count for each of them.
    topArtist: most(entries.flatMap((e) => e.track.artistName.split(/\s*(?:&|,|feat\.?|ft\.?|x)\s+/i))),
    topGenre: most(entries.map((e) => e.track.genre)),
  };
}
