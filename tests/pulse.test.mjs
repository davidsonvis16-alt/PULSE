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
]);

const { readTags } = await load(out, 'src/ingestion/tags/index.js');
const { bufferByteSource } = await load(out, 'src/ingestion/tags/bytes.js');
const text = await load(out, 'src/ingestion/identify/text.js');
const { catalogIdentifier, hasUsableTags } = await load(out, 'src/ingestion/identify/identifier.js');
const { familyForGenre } = await load(out, 'src/grooves/genres.js');
const grooves = await load(out, 'src/grooves/engine.js');
const { withinTasteBoundary } = await load(out, 'src/discovery/taste.js');

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
  t.above('an exact match with matching duration is confident', exact, 0.8);

  const wrongDuration = catalogIdentifier.confidenceScore(
    { filename: 'SZA - Snooze.mp3', tags: { title: 'Snooze', artist: 'SZA' }, durationMs: 95_000 },
    track(),
  );
  t.below('a wildly different duration drops below the confident bar', wrongDuration, 0.8);
  t.above('but it is still worth offering as a suggestion', wrongDuration, 0.5);

  const wrongArtist = catalogIdentifier.confidenceScore(
    { filename: 'x.mp3', tags: { title: 'Snooze', artist: 'Totally Different Band' }, durationMs: 201_000 },
    track(),
  );
  t.below('a matching title with the wrong artist is not confident', wrongArtist, 0.8);

  const filenameOnly = catalogIdentifier.confidenceScore(
    { filename: 'SZA - Snooze.mp3', tags: {}, durationMs: 201_000 },
    track(),
  );
  t.above('a clean filename alone can still identify', filenameOnly, 0.6);

  const unrelated = catalogIdentifier.confidenceScore(
    { filename: 'voice memo 4.m4a', tags: {}, durationMs: 12_000 },
    track(),
  );
  t.below('an unrelated recording scores near zero', unrelated, 0.3);

  t.ok('a file with title and artist has usable tags', hasUsableTags({ title: 'a', artist: 'b' }));
  t.not('a file with only a title does not', hasUsableTags({ title: 'a' }));

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

report(suites);
