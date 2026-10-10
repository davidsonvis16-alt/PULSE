/**
 * Pulse logic tests.
 *
 * Covers the parts that make decisions a user would notice: reading tags out of
 * real container bytes, deciding whether a catalogue match is the song on their
 * device, folding messy genre tags into families, clustering a collection into
 * Grooves, and keeping recommendations inside someone's taste.
 *
 * Run with: npm test
 */

import { compile, createSuite, load, report } from './harness.mjs';
import {
  flacWithVorbisComments,
  m4aWithTrailingMoov,
  mp3WithId3v2,
  mp3WithOnlyId3v1,
  notAudio,
  wavWithInfoChunk,
} from './fixtures.mjs';

const out = compile([
  'src/ingestion/tags/index.ts',
  'src/ingestion/identify/text.ts',
  'src/ingestion/identify/identifier.ts',
  'src/grooves/genres.ts',
  'src/grooves/engine.ts',
  'src/discovery/taste.ts',
  'src/news/rss.ts',
  'src/news/wikitext.ts',
  'src/news/headlines.ts',
  'src/news/fresh.ts',
  'src/core/http.ts',
  'src/discovery/rotation.ts',
  'src/discovery/mix.ts',
  'src/profile/schedule.ts',
  'src/social/notes.ts',
  'supabase/functions/_shared/alerts.ts',
]);

const { readTags } = await load(out, 'src/ingestion/tags/index.js');
const { bufferByteSource } = await load(out, 'src/ingestion/tags/bytes.js');
const text = await load(out, 'src/ingestion/identify/text.js');
const { catalogIdentifier, hasUsableTags, CONFIDENT_THRESHOLD } = await load(out, 'src/ingestion/identify/identifier.js');
const { familyForGenre } = await load(out, 'src/grooves/genres.js');
const grooves = await load(out, 'src/grooves/engine.js');
const { withinTasteBoundary } = await load(out, 'src/discovery/taste.js');
const rss = await load(out, 'src/news/rss.js');
const wiki = await load(out, 'src/news/wikitext.js');
const { groupStories } = await load(out, 'src/news/headlines.js');
const alerts = await load(out, 'supabase/functions/_shared/alerts.js');
const { settleWithin } = await load(out, 'src/core/http.js');
const { rotate } = await load(out, 'src/discovery/rotation.js');
const fresh = await load(out, 'src/news/fresh.js');
const { buildMix } = await load(out, 'src/discovery/mix.js');
const avatar = await load(out, 'src/profile/schedule.js');

const suites = [];
const read = (buffer) => readTags(bufferByteSource(new Uint8Array(buffer)));

/* ----------------------------------------------------------------- tags --- */
{
  const t = createSuite('tag reader');

  const mp3 = await read(mp3WithId3v2());
  t.is('mp3 container detected from magic bytes', mp3.container, 'mp3');
  t.is('mp3 title', mp3.title, "we can't be friends (wait for your love)");
  t.is('mp3 artist decoded from UTF-16', mp3.artist, 'Ariana Grande');
  t.is('mp3 album', mp3.album, 'eternal sunshine');
  t.is('mp3 album artist', mp3.albumArtist, 'Ariana Grande');
  t.is('mp3 numeric genre code resolves to a name', mp3.genre, 'R&B');
  t.is('mp3 year', mp3.year, '2024');
  t.is('mp3 track number parsed from "6/13"', mp3.trackNumber, 6);
  t.is('mp3 disc number parsed from "1/1"', mp3.discNumber, 1);
  t.is('mp3 embedded cover type', mp3.picture?.mimeType, 'image/png');
  t.is(
    'mp3 cover survives the base64 round trip',
    mp3.picture ? Buffer.from(mp3.picture.base64, 'base64').subarray(1, 4).toString('latin1') : null,
    'PNG',
  );
  t.is('mp3 sample rate from the frame header', mp3.sampleRate, 44100);
  t.is('mp3 bitrate from the frame header', mp3.bitrate, 128000);
  t.is('mp3 channels from the frame header', mp3.channels, 2);
  t.near('mp3 duration derived from constant bitrate', mp3.durationMs, 5212, 200);

  const v1 = await read(mp3WithOnlyId3v1());
  t.is('id3v1 fallback title', v1.title, 'Poor Filename Song');
  t.is('id3v1 fallback artist', v1.artist, 'Some Artist');
  t.is('id3v1 fallback year', v1.year, '1999');
  t.is('id3v1 fallback track number', v1.trackNumber, 7);
  t.is('id3v1 genre index resolves', v1.genre, 'Rock');

  const m4a = await read(m4aWithTrailingMoov());
  t.is('m4a container', m4a.container, 'mp4');
  t.is('m4a title with metadata after the audio', m4a.title, 'Snooze');
  t.is('m4a artist', m4a.artist, 'SZA');
  t.is('m4a album', m4a.album, 'SOS');
  t.is('m4a album artist', m4a.albumArtist, 'SZA');
  t.is('m4a genre', m4a.genre, 'R&B/Soul');
  t.is('m4a year trimmed from a full date', m4a.year, '2022');
  t.is('m4a track number', m4a.trackNumber, 8);
  t.is('m4a disc number', m4a.discNumber, 1);
  t.is('m4a duration from mvhd timescale', m4a.durationMs, 201000);
  t.is('m4a cover type', m4a.picture?.mimeType, 'image/jpeg');

  const flac = await read(flacWithVorbisComments());
  t.is('flac container', flac.container, 'flac');
  t.is('flac title', flac.title, 'Essence');
  t.is('flac artist', flac.artist, 'Wizkid');
  t.is('flac album', flac.album, 'Made in Lagos');
  t.is('flac genre', flac.genre, 'Afrobeats');
  t.is('flac year', flac.year, '2020');
  t.is('flac track number', flac.trackNumber, 8);
  t.is('flac sample rate from STREAMINFO', flac.sampleRate, 44100);
  t.is('flac channels from STREAMINFO', flac.channels, 2);
  t.is('flac duration from total samples', flac.durationMs, 185000);
  t.is('flac picture block', flac.picture?.mimeType, 'image/jpeg');

  const wav = await read(wavWithInfoChunk());
  t.is('wav container', wav.container, 'wav');
  t.is('wav title from the INFO chunk', wav.title, 'Local Recording');
  t.is('wav artist from the INFO chunk', wav.artist, 'Unknown Artist');
  t.is('wav sample rate', wav.sampleRate, 44100);

  const junk = await read(notAudio());
  t.is('non-audio is rejected rather than guessed at', junk.container, null);
  t.is('non-audio yields no title', junk.title, undefined);

  suites.push(t);
}

/* --------------------------------------------------------- filename text --- */
{
  const t = createSuite('filename cleaning');

  t.is(
    'strips download-site noise',
    text.cleanFilename('Ariana Grande - we cant be friends (Official Video) [320kbps] www.mp3site.com.mp3'),
    'Ariana Grande - we cant be friends',
  );
  t.is('strips a leading track number', text.cleanFilename('07 - Snooze.mp3'), 'Snooze');
  t.is('turns underscores into spaces', text.cleanFilename('we_cant_be_friends.mp3'), 'we cant be friends');

  const split = text.splitArtistTitle('Brent Faiyaz - Dead Man Walking.mp3');
  t.is('splits artist from title', split.artist, 'Brent Faiyaz');
  t.is('splits title from artist', split.title, 'Dead Man Walking');

  const noSplit = text.splitArtistTitle('untitled recording 3.m4a');
  t.is('does not invent an artist when there is no separator', noSplit.artist, null);

  t.is(
    'reads dots as separators when there are no spaces',
    text.cleanFilename('Burna.Boy.-.Last.Last.mp3'),
    'Burna Boy - Last Last',
  );

  t.is('fixes careless lower case', text.titleCase('burna boy'), 'Burna Boy');
  t.is('fixes shouting', text.titleCase('BURNA BOY'), 'Burna Boy');
  t.is('leaves deliberate capitals alone', text.titleCase('SZA'), 'SZA');
  t.is('leaves mixed case alone', text.titleCase('DaBaby'), 'DaBaby');

  const named = text.displayNameFromFilename('07 - brent faiyaz - dead man walking [320kbps].mp3');
  t.is('names an unidentified file by its artist', named.artist, 'Brent Faiyaz');
  t.is('names an unidentified file by its title', named.title, 'Dead Man Walking');

  t.ok('spots a filename that is only a number', text.isLowInformationName('03.mp3'));
  t.ok('spots a messenger export', text.isLowInformationName('AUD-20240113-WA0002.mp3'));
  t.ok('spots a generic recording name', text.isLowInformationName('new recording 3.m4a'));
  t.ok(
    'leaves a real name alone',
    !text.isLowInformationName('07 - Brent Faiyaz - Dead Man Walking.mp3'),
  );

  const unnamed = text.displayNameFromFilename('voice memo 4.m4a');
  t.is('keeps a title when there is no artist', unnamed.title, 'Voice Memo 4');
  t.is('still refuses to invent an artist', unnamed.artist, null);

  t.is('normalises punctuation and case', text.normalise("We Can't Be Friends"), 'we cant be friends');
  t.is('drops a featured-artist suffix', text.coreTitle('Essence (feat. Tems)'), 'essence');

  t.above('near-identical titles score high', text.similarity('Snooze', 'snooze'), 0.95);
  t.above('a contained title still scores high', text.similarity('Essence', 'Essence (feat. Tems)'), 0.85);
  t.below('unrelated titles score low', text.similarity('Snooze', 'Bohemian Rhapsody'), 0.35);

  suites.push(t);
}

/* ------------------------------------------------------- identification --- */
{
  const t = createSuite('identification confidence');

  const track = (overrides) => ({
    id: 'itunes:track:1',
    provider: 'itunes',
    providerTrackId: '1',
    title: 'Snooze',
    artistName: 'SZA',
    artistId: null,
    albumTitle: 'SOS',
    albumId: null,
    artworkUrl: null,
    durationMs: 201_000,
    releaseDate: '2022-12-09',
    genre: 'R&B/Soul',
    trackNumber: null,
    discNumber: null,
    explicit: false,
    externalUrl: null,
    ...overrides,
  });

  const exact = catalogIdentifier.confidenceScore(
    { filename: 'SZA - Snooze.mp3', tags: { title: 'Snooze', artist: 'SZA' }, durationMs: 201_000 },
    track(),
  );
  t.above('an exact match with matching duration is confident', exact, CONFIDENT_THRESHOLD);

  const wrongDuration = catalogIdentifier.confidenceScore(
    { filename: 'SZA - Snooze.mp3', tags: { title: 'Snooze', artist: 'SZA' }, durationMs: 95_000 },
    track(),
  );
  t.below('a wildly different duration drops below the confident bar', wrongDuration, CONFIDENT_THRESHOLD);
  t.above('but it is still worth offering as a suggestion', wrongDuration, 0.5);

  const wrongArtist = catalogIdentifier.confidenceScore(
    { filename: 'x.mp3', tags: { title: 'Snooze', artist: 'Totally Different Band' }, durationMs: 201_000 },
    track(),
  );
  t.below('a matching title with the wrong artist is not confident', wrongArtist, CONFIDENT_THRESHOLD);

  const filenameOnly = catalogIdentifier.confidenceScore(
    { filename: 'SZA - Snooze.mp3', tags: {}, durationMs: 201_000 },
    track(),
  );
  t.above('a clean filename alone can still identify', filenameOnly, 0.6);

  t.ok('a 65% match is applied without asking', CONFIDENT_THRESHOLD <= 0.65);

  const unrelated = catalogIdentifier.confidenceScore(
    { filename: 'voice memo 4.m4a', tags: {}, durationMs: 12_000 },
    track(),
  );
  t.below('an unrelated recording scores near zero', unrelated, 0.3);

  t.ok('a file with title and artist has usable tags', hasUsableTags({ title: 'a', artist: 'b' }));
  t.not('a file with only a title does not', hasUsableTags({ title: 'a' }));

  suites.push(t);
}

/* -------------------------------------------------------------- your mix --- */
{
  const t = createSuite('your mix');
  const song = (id, artist = 'A') => ({ id, title: `Song ${id}`, artistName: artist });
  const own = Array.from({ length: 40 }, (_, i) => song(`own${i}`, `Mine ${i}`));
  const shelfA = Array.from({ length: 10 }, (_, i) => song(`a${i}`, 'New A'));
  const shelfB = Array.from({ length: 10 }, (_, i) => song(`b${i}`, 'New B'));

  const mix = buildMix(own, [shelfA, shelfB], 0, 30);
  const isOwn = (track) => track.id.startsWith('own');
  t.is('the mix is the requested length', mix.length, 30);
  t.is('two of theirs, then one new, from the top', mix.slice(0, 3).map(isOwn).join(), 'true,true,false');
  t.is('two thirds of it is their own music', mix.filter(isOwn).length, 20);
  t.is('new songs take turns between shelves', mix[2].artistName !== mix[5].artistName, true);
  t.is('no song appears twice', new Set(mix.map((track) => track.id)).size, mix.length);

  const withDuplicate = buildMix(own.slice(0, 4), [[own[0], song('x')]], 0, 30);
  t.is('a suggestion they already own is not counted as new', withDuplicate.filter((x) => x.id === 'own0').length, 1);

  t.is('only new music still makes a mix', buildMix([], [shelfA], 0, 5).length, 5);
  t.is('only their own music still makes a mix', buildMix(own, [], 0, 5).length, 5);
  t.is('a later rotation starts somewhere else', buildMix(own, [], 1, 5)[0].id !== buildMix(own, [], 0, 5)[0].id, true);
  suites.push(t);
}

/* --------------------------------------------------------- genre families --- */
{
  const t = createSuite('genre families');

  t.is('R&B/Soul folds into R&B', familyForGenre('R&B/Soul').id, 'rnb');
  t.is('Neo-Soul folds into R&B', familyForGenre('Neo-Soul').id, 'rnb');
  t.is('Afrobeats folds into Afro', familyForGenre('Afrobeats').id, 'afro');
  t.is('Amapiano folds into Afro', familyForGenre('Amapiano').id, 'afro');
  t.is('Hip-Hop/Rap folds into Hip-Hop', familyForGenre('Hip-Hop/Rap').id, 'hiphop');
  t.is('Trap folds into Hip-Hop', familyForGenre('Trap').id, 'hiphop');
  t.is('Alternative Rock folds into Rock, not Alternative', familyForGenre('Alternative Rock').id, 'rock');
  t.is('Drum & Bass folds into Electronic', familyForGenre('Drum & Bass').id, 'electronic');
  t.is('an unknown tag falls through to mixed', familyForGenre('Gqom Experimental').id, 'other');
  t.is('a missing tag falls through to mixed', familyForGenre(null).id, 'other');

  suites.push(t);
}

/* ---------------------------------------------------------------- grooves --- */
{
  const t = createSuite('groove clustering');

  const rows = [
    ...repeat(14, (i) => row(`rnb-${i}`, 'SZA', 'R&B/Soul', '2022-01-01')),
    ...repeat(8, (i) => row(`calm-${i}`, 'Giveon', 'Neo-Soul', '2021-01-01')),
    ...repeat(10, (i) => row(`afro-${i}`, 'Wizkid', 'Afrobeats', '2020-01-01')),
    ...repeat(7, (i) => row(`rock-${i}`, 'Arctic Monkeys', 'Alternative Rock', '2013-01-01')),
    ...repeat(2, (i) => row(`odd-${i}`, 'Someone', 'Polka', '1978-01-01')),
  ];

  const features = grooves.buildFeatures(rows);
  t.is('every track gets a feature', features.length, rows.length);
  t.is('genre drives the family', features[0].family.id, 'rnb');
  t.is('release date becomes a decade', features[0].decade, 2020);

  const drafts = grooves.clusterTracks(features);
  const names = drafts.map((draft) => draft.name);

  t.ok('a Groove is generated for the dominant family', names.some((n) => n.includes('R&B')));
  t.ok('a Groove is generated for Afro', names.some((n) => n.includes('Afro')));
  t.ok('a Groove is generated for Rock', names.some((n) => n.includes('Rock')));
  t.ok(
    'names are derived from the collection, not a fixed list',
    names.every((name) => typeof name === 'string' && name.length > 0),
  );
  t.not(
    'a two-track genre does not get its own Groove',
    names.some((name) => name.toLowerCase().includes('polka')),
  );

  const memberships = new Map();
  for (const draft of drafts) {
    for (const member of draft.members) {
      memberships.set(member.trackId, (memberships.get(member.trackId) ?? 0) + 1);
    }
  }
  t.ok(
    'a track can belong to more than one Groove',
    [...memberships.values()].some((count) => count > 1),
  );
  t.ok(
    'every Groove is large enough to be worth opening',
    drafts.every((draft) => draft.members.length >= 4),
  );
  t.ok(
    'each Groove has exactly one primary home per track',
    drafts.every((draft) =>
      draft.members.every((member) => typeof member.isPrimary === 'boolean'),
    ),
  );

  const tiny = grooves.clusterTracks(grooves.buildFeatures(repeat(2, (i) => row(`x-${i}`, 'A', 'Pop', null))));
  t.is('a collection too small to cluster produces no Grooves', tiny.length, 0);

  suites.push(t);

  function row(trackId, artistName, genre, releaseDate) {
    return { trackId, artistName, genre, releaseDate, durationMs: 200_000 };
  }
  function repeat(count, make) {
    return Array.from({ length: count }, (_unused, index) => make(index));
  }
}

/* --------------------------------------------------------- taste boundary --- */
{
  const t = createSuite('taste boundary');

  const profile = {
    families: ['rnb', 'afro', 'pop'],
    artists: [{ name: 'SZA', score: 900, ownedTracks: 12, msPlayed: 0, followed: false }],
  };

  t.ok('R&B is inside the boundary', withinTasteBoundary({ genre: 'R&B/Soul' }, profile));
  t.ok('Afrobeats is inside the boundary', withinTasteBoundary({ genre: 'Amapiano' }, profile));
  t.not('death metal is outside it', withinTasteBoundary({ genre: 'Death Metal' }, profile));
  t.not('classical is outside it', withinTasteBoundary({ genre: 'Classical' }, profile));
  t.ok(
    'an artist already in the collection is always inside',
    withinTasteBoundary({ genre: 'Death Metal', artistName: 'SZA' }, profile),
  );
  t.ok(
    'an unknown genre is not treated as evidence against',
    withinTasteBoundary({ genre: null }, profile),
  );
  t.ok(
    'with no profile yet, nothing is excluded',
    withinTasteBoundary({ genre: 'Death Metal' }, { families: [], artists: [] }),
  );

  suites.push(t);
}

/* ----------------------------------------------------------------- news --- */
{
  const t = createSuite('music news');

  const feed = `<?xml version="1.0"?><rss><channel>
    <item><title>Tems Shares New Single &#8216;Love Me JeJe&#8217;</title>
      <link>https://example.com/tems-single</link>
      <pubDate>Wed, 16 Sep 2026 22:42:10 +0000</pubDate>
      <description><![CDATA[The singer returns with <em>a new song</em>.]]></description>
      <media:thumbnail url="https://example.com/tems.jpg" width="100"/></item>
    <item><title>Lagos Festival Lineup Announced</title>
      <link>https://example.com/fest</link>
      <pubDate>Tue, 15 Sep 2026 10:00:00 +0000</pubDate>
      <content:encoded><![CDATA[<img src="" data-lazy-src="https://site.com/wp-content/uploads/2026/09/fest.jpg?resize=237%2C147"><p>Big names.</p>]]></content:encoded></item>
    <item><title>No link here</title></item>
  </channel></rss>`;
  const items = rss.parseFeed(feed, 'Test Weekly');
  t.is('items without a link are dropped', items.length, 2);
  t.is('entities decoded in titles', items[0].title, 'Tems Shares New Single ‘Love Me JeJe’');
  t.is('markup stripped from the standfirst', items[0].summary, 'The singer returns with a new song .');
  t.is('media thumbnail used as the picture', items[0].imageUrl, 'https://example.com/tems.jpg');
  t.is(
    'lazy-loaded body image found and served full size',
    items[1].imageUrl,
    'https://site.com/wp-content/uploads/2026/09/fest.jpg',
  );
  t.is('publication date parsed', items[0].publishedAt, Date.parse('2026-09-16T22:42:10Z'));
  t.is('new single classed as new music', items[0].topic, 'new-music');
  t.is('festival lineup classed as live', items[1].topic, 'tours');
  t.is('"award-winning" alone is not award news', rss.topicOf('Award-Winning Singer Plays Lagos Concert'), 'tours');
  t.is(
    'a death is not filed under awards',
    rss.topicOf('Icon Accepts Award in Video Recorded Before Her Death'),
    'memoriam',
  );
  t.ok('artist named as a whole word', rss.mentionsArtist({ title: 'Rema tops the chart', summary: '' }, 'Rema'));
  t.not(
    'artist name inside another word is not a mention',
    rss.mentionsArtist({ title: 'Remarkable night', summary: '' }, 'Rema'),
  );

  const now = Date.parse('2026-09-17T08:00:00Z');
  const base = { summary: '', author: null, topic: 'tours' };
  const stories = groupStories(
    [
      { ...base, id: 'a', url: 'a', imageUrl: null, publishedAt: now, source: 'One', title: 'Macklemore Donates $1 Million Tour Earnings to Palestine Aid' },
      { ...base, id: 'b', url: 'b', imageUrl: 'pic', publishedAt: now - 1000, source: 'Two', title: 'Macklemore to Donate $1 Million Ed Sheeran Tour Earnings to Palestine' },
      { ...base, id: 'c', url: 'c', imageUrl: null, publishedAt: now - 2000, source: 'One', title: 'Burna Boy Announces Stadium Tour' },
    ],
    ['Burna Boy'],
  );
  t.is('the same story from two outlets becomes one card', stories.length, 2);
  t.is('the grouped card keeps the version with a picture', stories[0].imageUrl, 'pic');
  t.is('every outlet that ran it is listed', stories[0].sources.length, 2);
  t.is('library artists named in a story are picked out', stories[1].mentions[0], 'Burna Boy');

  // The layouts award pages use, reduced to their essentials.
  const inCell = `{{Use mdy dates|date=June 2025}}
{{Infobox award
| name = 2026 MTV Video Music Awards
| date = September 27, 2026
| host = [[Snoop Dogg]]
| most_nominations = [[Madonna]] (11)
}}
{| class="wikitable"
| style="vertical-align:top" width="50%" |
{{Award category|#EEDD85|[[MTV Video Music Award for Best Collaboration|Best Collaboration]]}}
* [[Shakira]] and [[Burna Boy]] – "[[Dai Dai]]"<ref>{{cite web|title=x}}</ref>
* [[Teyana Taylor]] and [[Lucky Daye]] – "Hard Part"
| style="vertical-align:top" width="50%" |
{{Award category|#EEDD85|[[Grammy Award for Album of the Year|Album of the Year]]}}
* '''''[[Debí Tirar Más Fotos]]'' – [[Bad Bunny]]'''
* ''[[Swag (album)|Swag]]'' '''''–''''' [[Justin Bieber]]
|-
| {{Award category|#FFF|[[Song of the Year]]}}
* '''"[[Wildflower (song)|Wildflower]]"'''
** [[Billie Eilish]] & [[Finneas]], songwriters
* "[[Abracadabra (song)|Abracadabra]]"
** [[Lady Gaga]], Andrew Watt & Henry Walter, songwriters
|}`;
  const info = wiki.parseInfobox(inCell);
  t.is('ceremony date from the infobox, not the dates template', info.date, '2026-09-27');
  t.is('host link text', info.host, 'Snoop Dogg');
  t.is('most nominations', info.mostNominations, 'Madonna (11)');
  const cats = wiki.parseAwardCategories(inCell);
  t.is(
    'categories named inside cells',
    cats.map((c) => c.name).join(' / '),
    'Best Collaboration / Album of the Year / Song of the Year',
  );
  t.is('credit before the dash', cats[0].nominees[0].credit, 'Shakira and Burna Boy');
  t.is('quoted work after the dash', cats[0].nominees[0].work, 'Dai Dai');
  t.is('every linked act kept for matching', cats[0].nominees[0].artists.join(','), 'Shakira,Burna Boy');
  t.not('no winner before the ceremony', cats[0].nominees.some((n) => n.winner));
  t.is('italic title first, artist after', cats[1].nominees[1].work, 'Swag');
  t.is('artist after an emphasised dash', cats[1].nominees[1].credit, 'Justin Bieber');
  t.ok('bold nominee is the winner', cats[1].nominees[0].winner);
  t.is('songwriters on the line below become the credit', cats[2].nominees[0].credit, 'Billie Eilish & Finneas');
  t.is('the title stays the work', cats[2].nominees[0].work, 'Wildflower');

  const headerRow = `| date = {{start date|2026|02|28|df=y}}
{| class="wikitable"
! width="40%" |[[Brit Award for British Album of the Year|British Album of the Year]]<br/>{{small|(presented by [[Jeff Goldblum]])}}
! width="40%" |[[Brit Award for British Single|Song of the Year]]
|-
| valign="top" |
* '''''[[The Art of Loving (album)|The Art of Loving]]'' – [[Olivia Dean]]'''
**<small> ''[[The Boy Who Played the Harp]]'' – [[Dave (rapper)|Dave]]</small>
**<small> ''[[West End Girl]]'' – [[Lily Allen]]</small>
| valign="top" |
* {{Blue ribbon}} '''"[[Rein Me In]]" – [[Sam Fender]] and [[Olivia Dean]]'''
** "[[Blessings (song)|Blessings]]" – [[Calvin Harris]]
** "Egwu" – [[Chike (singer)|Chike]] & [[MohBad]]
|}
{| class="wikitable"
! Artist(s) !! Song(s)
|-
| [[Olivia Dean]] || "Man I Need"
|}`;
  t.is('start date template read', wiki.parseInfobox(headerRow).date, '2026-02-28');
  const brits = wiki.parseAwardCategories(headerRow);
  t.is(
    'categories from a header row, presenter note dropped',
    brits.map((c) => c.name).join(' / '),
    'British Album of the Year / Song of the Year',
  );
  t.is('winner first with the field indented', brits[0].nominees.length, 3);
  t.ok('the top line is the winner', brits[0].nominees[0].winner);
  t.not('indented nominees did not win', brits[0].nominees[1].winner);
  t.is('piped link shows its label', brits[0].nominees[1].credit, 'Dave');
  t.is('ribbon-marked winner parsed', brits[1].nominees[0].work, 'Rein Me In');
  t.is('performance tables are not categories', brits.length, 2);

  t.is('"November 28–29, 2025" takes the first day', wiki.parseWikiDate('November 28–29, 2025'), '2025-11-28');
  t.is('day-month-year dates', wiki.parseWikiDate('1 February 2026'), '2026-02-01');
  const songwriting = wiki.parseAwardCategories(`{|
| {{Award category|#FFF|Song of the Year}}
* "Si Antes" – Edgar Barrera & [[Karol G]], songwriters ([[Karol G]])
* "Bogotá" – [[Andrés Cepeda]], songwriter ([[Andrés Cepeda]])
|}`);
  t.is('performer in brackets leads a songwriting credit', songwriting[0].nominees[0].credit, 'Karol G');

  suites.push(t);
}

/* ------------------------------------------------------------ push rules --- */
{
  const t = createSuite('push alerts');

  const now = Date.parse('2026-09-22T12:00:00Z');
  const story = (id, title, source, hoursAgo = 1, imageUrl = null) => ({
    id,
    url: `https://example.com/${id}`,
    title,
    summary: '',
    imageUrl,
    publishedAt: now - hoursAgo * 3600 * 1000,
    source,
    author: null,
    topic: 'news',
  });

  const widelyRun = [
    story('a', 'Burna Boy Announces World Tour Dates for 2027', 'Billboard'),
    story('b', 'Burna Boy Announces 2027 World Tour', 'NME', 2, 'pic'),
    story('c', 'Burna Boy Reveals World Tour Dates', 'Pitchfork', 3),
    story('d', 'Small Label Signs New Artist', 'Stereogum'),
  ];
  const breaking = alerts.breakingStories(widelyRun, now);
  t.is('only the story several outlets ran is breaking', breaking.length, 1);
  t.ok('the breaking alert names the story', breaking[0].title.includes('Burna Boy'));
  t.is('breaking alerts go to everyone on that topic', breaking[0].forArtists, undefined);
  t.is(
    'the version with a picture is the one linked',
    breaking[0].data.url,
    'https://example.com/b',
  );

  const stale = widelyRun.map((item) => ({ ...item, publishedAt: now - 20 * 3600 * 1000 }));
  t.is('yesterday is not breaking news', alerts.breakingStories(stale, now).length, 0);

  const edition = (date, winners, id = '2026 MTV Video Music Awards') => ({
    id,
    shortName: id.includes('Headies') ? 'The Headies' : 'VMAs',
    title: id,
    date,
    mostNominations: 'Madonna (13)',
    categories: [
      {
        name: 'Best Collaboration',
        nominees: [
          { credit: 'Shakira and Burna Boy', work: 'Dai Dai', artists: ['Shakira', 'Burna Boy'], winner: winners },
          { credit: 'Tems', work: 'Free Mind', artists: ['Tems'], winner: false },
        ],
      },
    ],
  });

  const upcoming = alerts.awardAlerts([edition('2026-10-10', false)], now);
  t.ok(
    'nominees being out is announced once',
    upcoming.filter((a) => a.kind === 'award-nominees').length === 1,
  );
  t.is(
    'each nominated artist gets their own alert',
    upcoming.filter((a) => a.kind === 'award-nominated').length,
    3,
  );
  t.is(
    'a nomination alert is only for that artist',
    upcoming.find((a) => a.kind === 'award-nominated').forArtists.length,
    1,
  );
  t.ok(
    'award alerts open the ceremony page',
    upcoming[0].data.route.startsWith('/awards/'),
  );

  const tonight = alerts.awardAlerts([edition('2026-09-22', false)], now);
  t.is('the day itself is announced', tonight.filter((a) => a.kind === 'award-today').length, 1);
  const headies = alerts.awardAlerts([edition('2026-09-22', false, 'The Headies 2026')], now);
  t.is(
    'a name starting with "The" is not doubled',
    headies.find((a) => a.kind === 'award-today').title,
    'The Headies are on today',
  );

  const done = alerts.awardAlerts([edition('2026-09-21', true)], now);
  t.is('winners are announced', done.filter((a) => a.kind === 'award-winners').length, 1);
  t.is('and each winner gets their own', done.filter((a) => a.kind === 'award-won').length, 1);
  t.ok('the winner alert names the category', done.find((a) => a.kind === 'award-won').body.includes('2026'));

  const devices = [
    { token: 'all', topics: ['breaking', 'awards', 'new-music'], artists: ['Burna Boy'] },
    { token: 'awards-only', topics: ['awards'], artists: [] },
    { token: 'other-taste', topics: ['breaking', 'awards'], artists: ['Metallica'] },
  ];
  const nomination = upcoming.find((a) => a.forArtists?.[0] === 'Burna Boy');
  t.is(
    'a nomination reaches only the listener who has that artist',
    alerts.recipientsFor(nomination, devices, []).map((d) => d.token).join(','),
    'all',
  );
  t.is(
    'someone who shared no artists still hears the general award news',
    alerts.recipientsFor(upcoming.find((a) => a.kind === 'award-nominees'), devices, []).length,
    3,
  );
  t.is(
    'breaking news skips anyone who turned that topic off',
    alerts.recipientsFor(breaking[0], devices, widelyRun).map((d) => d.token).join(','),
    'all,other-taste',
  );

  const personal = alerts.artistStories(widelyRun, now);
  t.is(
    'a story is personal only to whoever it names',
    alerts.recipientsFor(personal[0], devices, widelyRun).map((d) => d.token).join(','),
    'all',
  );

  suites.push(t);
}

/* ------------------------------------------------- work that may be late --- */
{
  const t = createSuite('slow sources');

  const answers = (value, afterMs) =>
    new Promise((resolve) => setTimeout(() => resolve(value), afterMs));
  /** A source that has stopped answering — the failure this exists for. */
  const hangs = () => new Promise(() => {});

  const startedAt = Date.now();
  const got = await settleWithin([answers('us', 5), hangs(), answers('gb', 5), hangs()], 60);
  const took = Date.now() - startedAt;

  t.is('what arrived in time is kept, in order', got, ['us', undefined, 'gb', undefined]);
  t.ok('one dead source costs the deadline, not its own timeout', took < 400);

  const rejected = await settleWithin([Promise.reject(new Error('no')), answers('ok', 1)], 60);
  t.is('a source that fails outright is simply absent', rejected, [undefined, 'ok']);

  t.is('nothing to wait for resolves immediately', await settleWithin([], 60), []);

  suites.push(t);
}

/* ----------------------------------------------- suggestions stay fresh --- */
{
  const t = createSuite('rotation');

  const pool = ['a', 'b', 'c', 'd', 'e'];
  t.is('a rotation takes its slice of the pool', rotate(pool, 0, 3), ['a', 'b', 'c']);
  t.is('the next one has moved on', rotate(pool, 1, 3), ['b', 'c', 'd']);
  t.is('and wraps round the end rather than running out', rotate(pool, 4, 3), ['e', 'a', 'b']);
  t.is('the same rotation always gives the same slice', rotate(pool, 7, 3), rotate(pool, 7, 3));
  t.is('a pool no bigger than the slice is used whole', rotate(['a', 'b'], 3, 3), ['a', 'b']);
  t.is('nothing to draw from is not an error', rotate([], 2, 3), []);

  suites.push(t);
}

/* -------------------------------------------------- new music ages out --- */
{
  const t = createSuite('release window');

  const now = Date.parse('2026-09-22T12:00:00Z');
  const daysAgo = (n) => new Date(now - n * 24 * 3600 * 1000).toISOString();

  t.is('a record out today is nought days old', fresh.daysSinceRelease(daysAgo(0), now), 0);
  t.is('and one from last week is seven', fresh.daysSinceRelease(daysAgo(7), now), 7);
  t.is('no release date means no place on a rail about dates', fresh.daysSinceRelease(null, now), null);
  t.is('nor does an unreadable one', fresh.daysSinceRelease('not a date', now), null);

  const poster = (days, reason = 'your-artist') =>
    fresh.posterWords(
      { album: { albumType: 'single', releaseDate: daysAgo(days) }, reason, daysOut: days, leavingSoon: false },
      now,
    );

  t.is('today is said plainly', poster(0).when, 'Out today');
  t.is('yesterday too', poster(1).when, 'Out yesterday');
  t.is('inside a week it is the weekday it landed', poster(3).when, 'Out Saturday');
  t.is('the week after that is said as a week', poster(9).when, 'Out last week');
  t.ok('older than that gets a date', poster(20).when.startsWith('Out 2 Sep'));
  t.is('the poster says why it is here', poster(0).why, 'From your library');
  t.is('a charting record says so instead', poster(0, 'charting').why, 'Already charting');

  suites.push(t);
}

/* ------------------------------------------- picture through the day --- */
{
  const t = createSuite('picture schedule');

  const at = (hours, minutes = 0) => new Date(2026, 8, 29, hours, minutes);
  const happy = { kind: 'feeling', feelingId: 'happy' };
  const sleepy = { kind: 'feeling', feelingId: 'sleepy' };
  const photo = { kind: 'photo', uri: 'file:///me.jpg' };
  const news = { kind: 'news', imageUrl: 'https://x/y.jpg', title: 'A story', link: 'https://x/y' };

  t.is('just after midnight is the first part', avatar.slotIndexAt(4, at(0, 1)), 0);
  t.is('a boundary belongs to the part it starts', avatar.slotIndexAt(4, at(6)), 1);
  t.is('the last minute of the day is the last part', avatar.slotIndexAt(4, at(23, 59)), 3);
  t.is('a day in one piece is always the same part', avatar.slotIndexAt(1, at(17)), 0);
  t.is('twelve parts are two hours each', avatar.slotIndexAt(12, at(13, 30)), 6);

  t.is('the next change is the end of this part', avatar.nextChangeAt(4, at(7, 15)).getHours(), 12);
  t.is('the last part hands over at midnight', avatar.nextChangeAt(4, at(20)).getDate(), 30);

  t.is('parts are named by their hours', avatar.slotLabel(1, 4), '6 AM – Noon');
  t.is('the last part runs to midnight', avatar.slotLabel(3, 4), '6 PM – Midnight');
  t.is('an unsplit day is all day', avatar.slotLabel(0, 1), 'All day');

  const day = { enabled: true, slots: [sleepy, happy, news, null] };
  t.is('the morning look shows in the morning', avatar.lookAt(day, at(9)), happy);
  t.is('the afternoon look shows in the afternoon', avatar.lookAt(day, at(14)), news);
  t.is('an empty part falls back to the usual picture', avatar.lookAt(day, at(21)), null);
  t.is('the next day starts over', avatar.lookAt(day, new Date(2026, 8, 30, 2)), sleepy);
  t.is('switched off, nothing is scheduled', avatar.lookAt({ ...day, enabled: false }, at(9)), null);

  t.is(
    'splitting finer keeps every look in the hours it covered',
    avatar.resizeSlots([sleepy, happy], 4),
    [sleepy, sleepy, happy, happy],
  );
  t.is(
    'splitting coarser keeps the look at the start of each part',
    avatar.resizeSlots([sleepy, happy, news, photo], 2),
    [sleepy, news],
  );
  t.is('an uneven split still lines up by the clock', avatar.resizeSlots([sleepy, happy, news], 4), [
    sleepy,
    sleepy,
    happy,
    news,
  ]);

  t.is('nothing stored means the default', avatar.normaliseSchedule(null), avatar.DEFAULT_SCHEDULE);
  t.is(
    'an unknown feeling or a broken entry becomes an empty part',
    avatar.normaliseSchedule({ enabled: true, slots: [happy, { kind: 'feeling', feelingId: 'nope' }] }).slots,
    [happy, null],
  );
  t.is(
    'a split Pulse does not offer is fitted to the default',
    avatar.normaliseSchedule({ enabled: true, slots: [happy, sleepy, photo, news, happy] }).slots.length,
    4,
  );

  suites.push(t);
}

// ---------------------------------------------------------------------------
{
  const t = createSuite('Song notes');
  const notes = await load(out, 'src/social/notes.js');

  t.ok('twelve feelings, each with an emoji and colour', notes.FEELINGS.length === 12 && notes.FEELINGS.every((f) => f.emoji && /^#/.test(f.color)));
  t.is('an unknown feeling falls back rather than breaking', notes.feelingById('nope').id, 'hyped');
  t.is('a card colour is stable for the same seed', notes.cardColor('wanjiru'), notes.cardColor('wanjiru'));

  const now = Date.now();
  const day = { scope: 'day', createdAt: now - 60_000 };
  const yesterday = { scope: 'day', createdAt: now - 26 * 3_600_000 };
  const week = { scope: 'week', createdAt: now - 3 * 24 * 3_600_000 };
  const stale = { scope: 'week', createdAt: now - 8 * 24 * 3_600_000 };
  t.ok('a note from today is current', notes.isCurrent(day));
  t.ok('a day note from yesterday has expired', !notes.isCurrent(yesterday));
  t.ok('a week note lasts the week', notes.isCurrent(week));
  t.ok('and expires after it', !notes.isCurrent(stale));
  t.ok('no note is not current', !notes.isCurrent(null));

  const friend = {
    topArtists: ['Wizkid', 'Tems', 'Burna Boy', 'Rema', 'Ayra Starr'],
    topGenres: ['Afrobeats', 'R&B/Soul'],
  };
  const family = (id) => ({ id });
  const taste = (artists, genres) => ({
    hasData: true,
    artists: artists.map((name) => ({ name })),
    genres: genres.map(([genre, fam]) => ({ genre, family: family(fam) })),
  });
  const none = notes.tasteMatch(friend, null);
  t.is('no taste yet means no match claimed', none.percent, 0);

  const close = notes.tasteMatch(friend, taste(['wizkid', 'Tems', 'Rema'], [['Afrobeats', 'african'], ['R&B/Soul', 'rnb']]));
  const far = notes.tasteMatch(friend, taste(['Metallica'], [['Metal', 'rock']]));
  t.is('shared artists are found regardless of case', close.sharedArtists, ['Wizkid', 'Tems', 'Rema']);
  t.ok('a close taste scores higher than a distant one', close.percent > far.percent);
  t.ok('the match never claims 100%', close.percent <= 99);
  t.ok('nothing shared still lands on a sane floor', far.percent >= 18 && far.sharedArtists.length === 0);

  suites.push(t);
}

report(suites);
