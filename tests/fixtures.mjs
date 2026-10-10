/**
 * Synthetic audio files for the tag tests.
 *
 * Built byte by byte rather than committed as binaries, so the expectations and
 * the bytes that produce them sit side by side and stay honest.
 */

function u32be(n) {
  return Buffer.from([(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}
function u32le(n) {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
}
function u16le(n) {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff]);
}
function syncsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG_STUB = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(40),
  Buffer.from([0xff, 0xd9]),
]);

/** MPEG 1 Layer III, 128 kbps, 44100 Hz, stereo. */
const MPEG_FRAME_HEADER = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

function id3TextFrame(id, text, unicode = false) {
  const payload = unicode
    ? Buffer.concat([Buffer.from([0x01]), Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    : Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'latin1')]);
  return Buffer.concat([Buffer.from(id, 'latin1'), u32be(payload.length), Buffer.alloc(2), payload]);
}

export function mp3WithId3v2() {
  const apicPayload = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from('image/png\0', 'latin1'),
    Buffer.from([0x03]), // front cover
    Buffer.from('cover\0', 'latin1'),
    PNG_1PX,
  ]);
  const apic = Buffer.concat([
    Buffer.from('APIC', 'latin1'),
    u32be(apicPayload.length),
    Buffer.alloc(2),
    apicPayload,
  ]);

  const frames = Buffer.concat([
    id3TextFrame('TIT2', "we can't be friends (wait for your love)"),
    id3TextFrame('TPE1', 'Ariana Grande', true),
    id3TextFrame('TALB', 'eternal sunshine'),
    id3TextFrame('TPE2', 'Ariana Grande'),
    id3TextFrame('TCON', '(14)'), // numeric genre code for R&B
    id3TextFrame('TYER', '2024'),
    id3TextFrame('TRCK', '6/13'),
    id3TextFrame('TPOS', '1/1'),
    apic,
  ]);

  const body = Buffer.concat([frames, Buffer.alloc(32)]); // frames plus padding
  const tag = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([0x03, 0x00, 0x00]),
    syncsafe(body.length),
    body,
  ]);
  return Buffer.concat([tag, MPEG_FRAME_HEADER, Buffer.alloc(417 * 200)]);
}

export function mp3WithOnlyId3v1() {
  const field = (text, length) => {
    const out = Buffer.alloc(length);
    Buffer.from(text, 'latin1').copy(out);
    return out;
  };
  const tag = Buffer.concat([
    Buffer.from('TAG', 'latin1'),
    field('Poor Filename Song', 30),
    field('Some Artist', 30),
    field('Some Album', 30),
    Buffer.from('1999', 'latin1'),
    Buffer.alloc(28),
    Buffer.from([0x00, 7]), // zero byte then track number
    Buffer.from([17]), // genre index for Rock
  ]);
  return Buffer.concat([MPEG_FRAME_HEADER, Buffer.alloc(417 * 50), tag]);
}

function box(type, payload) {
  return Buffer.concat([u32be(payload.length + 8), Buffer.from(type, 'latin1'), payload]);
}
function dataBox(value, dataType = 1) {
  return box('data', Buffer.concat([u32be(dataType), Buffer.alloc(4), value]));
}
function ilstItem(name, value, dataType = 1) {
  return box(name, dataBox(value, dataType));
}

/** An M4A whose moov box sits after the audio, which is the harder layout. */
export function m4aWithTrailingMoov() {
  const ilst = Buffer.concat([
    ilstItem('©nam', Buffer.from('Snooze', 'utf8')),
    ilstItem('©ART', Buffer.from('SZA', 'utf8')),
    ilstItem('©alb', Buffer.from('SOS', 'utf8')),
    ilstItem('aART', Buffer.from('SZA', 'utf8')),
    ilstItem('©gen', Buffer.from('R&B/Soul', 'utf8')),
    ilstItem('©day', Buffer.from('2022-12-09', 'utf8')),
    ilstItem('trkn', Buffer.from([0, 0, 0, 8, 0, 23, 0, 0]), 0),
    ilstItem('disk', Buffer.from([0, 0, 0, 1, 0, 1]), 0),
    ilstItem('covr', JPEG_STUB, 13),
  ]);
  const meta = box(
    'meta',
    Buffer.concat([Buffer.alloc(4), box('hdlr', Buffer.alloc(24)), box('ilst', ilst)]),
  );
  const mvhd = box(
    'mvhd',
    Buffer.concat([
      Buffer.alloc(4), // version and flags
      Buffer.alloc(8), // creation and modification times
      u32be(1000), // timescale
      u32be(201000), // duration
      Buffer.alloc(80),
    ]),
  );
  const moov = box('moov', Buffer.concat([mvhd, box('udta', meta)]));
  const ftyp = box('ftyp', Buffer.from('M4A \0\0\0\0M4A mp42isom', 'latin1'));
  return Buffer.concat([ftyp, box('mdat', Buffer.alloc(2048)), moov]);
}

function flacBlock(type, payload, last = false) {
  const header = Buffer.concat([
    Buffer.from([(last ? 0x80 : 0) | type]),
    u32be(payload.length).subarray(1),
  ]);
  return Buffer.concat([header, payload]);
}

export function flacWithVorbisComments() {
  const streamInfo = Buffer.alloc(34);
  const sampleRate = 44100;
  const channels = 2;
  const bitsPerSample = 16;
  const totalSamples = 44100 * 185;
  streamInfo[10] = (sampleRate >> 12) & 0xff;
  streamInfo[11] = (sampleRate >> 4) & 0xff;
  streamInfo[12] =
    ((sampleRate & 0x0f) << 4) | (((channels - 1) & 0x07) << 1) | (((bitsPerSample - 1) >> 4) & 0x01);
  streamInfo[13] = (((bitsPerSample - 1) & 0x0f) << 4) | ((totalSamples / 2 ** 32) & 0x0f);
  streamInfo[14] = (totalSamples >> 24) & 0xff;
  streamInfo[15] = (totalSamples >> 16) & 0xff;
  streamInfo[16] = (totalSamples >> 8) & 0xff;
  streamInfo[17] = totalSamples & 0xff;

  const fields = [
    'TITLE=Essence',
    'ARTIST=Wizkid',
    'ALBUM=Made in Lagos',
    'ALBUMARTIST=Wizkid',
    'GENRE=Afrobeats',
    'DATE=2020-10-30',
    'TRACKNUMBER=8',
  ];
  const vendor = Buffer.from('PulseTest', 'utf8');
  const comments = Buffer.concat([
    u32le(vendor.length),
    vendor,
    u32le(fields.length),
    ...fields.flatMap((field) => {
      const encoded = Buffer.from(field, 'utf8');
      return [u32le(encoded.length), encoded];
    }),
  ]);

  const mime = Buffer.from('image/jpeg', 'latin1');
  const picture = Buffer.concat([
    u32be(3), // front cover
    u32be(mime.length),
    mime,
    u32be(0), // empty description
    u32be(500),
    u32be(500),
    u32be(24),
    u32be(0),
    u32be(JPEG_STUB.length),
    JPEG_STUB,
  ]);

  return Buffer.concat([
    Buffer.from('fLaC', 'latin1'),
    flacBlock(0, streamInfo),
    flacBlock(4, comments),
    flacBlock(6, picture, true),
    Buffer.alloc(1000),
  ]);
}

export function wavWithInfoChunk() {
  const fmt = Buffer.concat([
    u16le(1), // PCM
    u16le(2), // channels
    u32le(44100),
    u32le(44100 * 4), // byte rate
    u16le(4),
    u16le(16),
  ]);

  const infoEntry = (id, value) => {
    let payload = Buffer.concat([Buffer.from(value, 'latin1'), Buffer.from([0])]);
    if (payload.length % 2 === 1) payload = Buffer.concat([payload, Buffer.from([0])]);
    return Buffer.concat([Buffer.from(id, 'latin1'), u32le(value.length + 1), payload]);
  };
  const info = Buffer.concat([
    Buffer.from('INFO', 'latin1'),
    infoEntry('INAM', 'Local Recording'),
    infoEntry('IART', 'Unknown Artist'),
  ]);

  const body = Buffer.concat([
    Buffer.from('WAVE', 'latin1'),
    Buffer.from('fmt ', 'latin1'),
    u32le(fmt.length),
    fmt,
    Buffer.from('LIST', 'latin1'),
    u32le(info.length),
    info,
    Buffer.from('data', 'latin1'),
    u32le(1764000),
    Buffer.alloc(1000),
  ]);

  return Buffer.concat([Buffer.from('RIFF', 'latin1'), u32le(body.length), body]);
}

export function notAudio() {
  return Buffer.from('this is a text file, not music at all', 'utf8');
}
