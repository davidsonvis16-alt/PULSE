# Your music, and what Pulse does with it

The premise of Pulse is that the music someone already owns says more about
them than anything they are likely to click in their first week. So the
collection on the device is the foundation: it becomes the library, it supplies
the artwork, it forms the Grooves, and it is what recommendations are built
from. Listening behaviour adjusts that picture over time rather than replacing
it.

```
device files → tags → identification → artwork → library
                                                    ├→ Grooves
                                                    └→ taste profile → recommendations
                                                            ↑
                                              listening behaviour
```

## Getting the music in

`MusicScanner` (`src/ingestion/scanner/`) is the only place that knows how to
find audio, because platforms differ sharply.

| Platform | How | Enumerates? |
| --- | --- | --- |
| Android | the media store, via `expo-media-library` | yes, with a change listener |
| iOS | the user picks files, via `expo-document-picker` | no |
| Web | file picking only | no |

iOS keeps the Music app's library behind a framework an Expo app cannot reach,
so Pulse asks for files instead of showing an empty scan and blaming the user.
Picked files are copied into Pulse's own storage, because the URIs the picker
returns do not survive a restart. Originals are never touched.

## Reading tags

`src/ingestion/tags/` parses containers directly — no native tag library, so it
works in Expo Go and on both platforms:

- **ID3v2.2/2.3/2.4** including unsynchronisation, the extended header, UTF-16
  text frames and `APIC` cover art, with **ID3v1** as a fallback
- **MP4/M4A** `ilst` atoms, handling a `moov` box that sits after the audio
- **FLAC** `STREAMINFO`, Vorbis comments and `PICTURE` blocks
- **Ogg Vorbis and Opus** comment headers
- **WAV** `fmt ` and the RIFF `INFO` chunk

Bitrate, sample rate, channel count and duration come from the stream itself —
the MPEG frame header (using Xing/Info for variable bitrate), `mvhd`, or
`STREAMINFO`.

Format is decided by the file's magic bytes, not its extension, because plenty
of files on a phone are named wrongly. Files are read in slices of a few
hundred kilobytes, never whole, because a scan touches hundreds of them.

`tests/pulse.test.mjs` runs all of this against files built byte by byte,
including the awkward cases: a numeric genre code, a UTF-16 artist, metadata
after the audio, and a text file that is not music at all.

## Identification, and refusing to guess

`MusicIdentifier` (`src/ingestion/identify/`) only runs on files whose own tags
are not good enough. It cleans the filename — stripping `(Official Video)`,
`[320kbps]`, site names and leading track numbers — searches the catalogue, and
scores each candidate on title and artist similarity, corroborated by duration.

Three outcomes, and the middle one is the point:

| Confidence | What happens |
| --- | --- |
| ≥ 0.80 | applied: title, artist, album, genre and artwork filled in |
| 0.52 – 0.80 | **needs identification** — the suggestion is kept, nothing is applied |
| < 0.52 | left exactly as it was |

A track Pulse is unsure about appears on the Identify screen with its best
guess and a search box. Attaching a plausible wrong artist would be worse than
admitting the uncertainty.

`identifyByFingerprint` exists on the interface and reports that it is
unsupported: content-based matching needs a native Chromaprint build, which an
Expo app does not have. The method is there so an adapter can supply it later
without anything above changing.

## Artwork

`ArtworkProvider` fills covers in a strict order:

1. artwork embedded in the user's own file — already correct, no network
2. official artwork for a track identified confidently
3. nothing

A cover that might belong to a different record is worse than no cover, so a
weak match leaves the track as it was. Album lookups are cached per
artist-and-album during a scan, so a twelve-track album costs one request.

## Grooves

A Groove is a cluster Pulse found in the collection, named after what is in it.
`GrooveEngine` (`src/grooves/engine.ts`) works from:

- **genre**, folded into families, because tag vocabularies disagree —
  "R&B/Soul", "Neo-Soul" and "Contemporary R&B" are one shelf
- **energy**, derived from that genre
- **era**, from release dates
- **artist concentration**, which shapes the description

Deliberately not used: tempo, key and loudness. Measuring those means decoding
the audio, which Pulse does not do, so it does not claim to know them.

Energy bands are **relative to the collection**, not absolute. Someone whose
library is entirely ambient still has a livelier third of it, and that is the
third they want on a Monday morning.

Clusters come out as family Grooves (split by energy when large enough),
cross-cutting Grooves that span families ("Late Night", "High Energy"), and an
era Groove when one decade genuinely stands out. A track can belong to several;
`is_primary` marks its best fit. A genre with four tracks in it does not become
a Groove — that is not a shelf.

Names are generated, not chosen from a list. "Late Night R&B", "Afrobeats
Energy", "Alternative Rock Essentials" all come from the cluster's own family,
dominant sub-genre and energy band.

## The taste profile

`TasteEngine` (`src/discovery/taste.ts`) combines two sources with weights that
shift as evidence accumulates:

| Signal | Weight |
| --- | --- |
| a track they own | 100 |
| a saved or downloaded track | 60 |
| a favourite | 220 |
| a followed artist | 300 |
| a minute of listening | 12, scaled up as listening grows |
| an artist they repeatedly skip | score cut to 35% |

Behaviour's share rises on a curve: at roughly ten hours of listening it
carries about as much as the collection does. That is what "imported music plus
listening behaviour" means in practice — the collection is never discarded,
it is gradually joined.

### The recommendation boundary

The profile keeps the genre families that account for the bulk of it, and
recommendations are filtered through that set. Someone who listens to R&B,
Afrobeats and pop does not get handed a metal record because it is charting.
Two exceptions, both deliberate: an artist already in their collection is
always allowed, and an unknown genre is not treated as evidence against.

Charts appear in exactly one place — a brand-new user with nothing imported and
nothing played — and they are labelled as charts rather than as a
recommendation. The moment there is a collection, that shelf is gone.

Shelves carry the reason they exist: "Because SZA is in your library", "Sounds
like your collection", "Artists related to your music", "Based on your imported
music". Each is only shown when it is true.

## Privacy

Music scanning is opt-in and explained before it is requested. Everything that
follows is local:

```
device music → local index → local metadata → local taste analysis
```

No audio file is uploaded. No filename is sent anywhere. Identification sends
only a search string — a title and artist — to the catalogue, the same request
that typing it into the search box would make.

Privacy settings has a **Remove my imported music** action that clears the
index, the cached covers and the Grooves built from them. The files on the
device are untouched, because Pulse never had any business changing them.

### Writing tags back

Section 4 of the brief asks for an optional "write metadata to files". Every
`MusicScanner` reports `canWriteTags: false`, because neither platform allows
it from an Expo app: Android needs the Storage Access Framework and iOS does
not expose the music library for writing at all. The capability is on the
interface so a scanner that can do it would light the option up, rather than
Pulse offering a button that quietly fails.
