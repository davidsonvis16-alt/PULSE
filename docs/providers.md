# Provider architecture

Pulse never talks to a music or ticketing API directly. Screens, the player,
the download manager and the discovery engine all go through two interfaces,
and adapters are the only code that knows what a given service's JSON looks
like. That is what makes the source swappable instead of load-bearing.

## MusicProvider

`src/providers/music/types.ts`

```
searchTracks · searchArtists · searchAlbums · searchAll
getTrack · getArtist · getAlbum
getArtistTopTracks · getArtistAlbums · getArtistSingles · getRelatedArtists
getAlbumTracks
getRecommendations · getMoodTracks · getNewReleases · getTrending
getArtwork
getPlayableSource · getDownloadSource
```

The last two are the important ones. A `Track` is metadata; a `PlayableSource`
is bytes. Keeping them apart is why Pulse can be honest about what it is
playing: the source carries a `label` shown verbatim in the player, and an
`isExcerpt` flag the UI does not paper over.

### Capabilities

```ts
capabilities: {
  search, streaming, download, excerptsOnly,
  recommendations, newReleases, charts, relatedArtists
}
```

`download: false` removes every download affordance in the app — no disabled
buttons, no dead ends. `excerptsOnly: true` changes the wording wherever Pulse
describes what it is about to play or store.

### Adding a source

```ts
// src/providers/music/adapters/my-source.ts
export const mySource: MusicProvider = { /* implement the interface */ };

// at start-up
registerMusicProvider(mySource);
setActiveMusicProvider('my-source');
```

Ids are provider-qualified — `itunes:track:1440857781` — so a library built
against one source keeps working when another is added, and
`providerFor(track.provider)` resolves each saved item back to the adapter it
came from.

### The shipped adapter

`adapters/itunes.ts` uses the public Apple iTunes Search API. No key, real
catalogue, real artwork at whatever size the UI draws, and official 30-second
preview streams that Pulse can both play and store. It reports
`excerptsOnly: true`, because that is the truth about what Apple licenses here.

Where the source has no native concept for something Pulse needs, the adapter
derives it from real data rather than inventing it:

- **Artist images** come from the artist's newest release artwork, because the
  artist entity carries no image of its own.
- **Related artists** come from other artists appearing in the same genre and
  in searches for the artist's own name.
- **Recommendations** are genre and artist searches, ranked against the
  listener's measured energy profile and nudged toward recent releases.
- **Moods** are genre queries scored against the mood's energy.

## EventProvider

`src/providers/events/types.ts`

```
isConfigured · setupHint
searchEvents · nearbyEvents · getEvent · getTicketInformation
```

`isConfigured()` is what the Events screen checks before it renders anything.
If no provider is set up, Pulse says so and shows `setupHint()`. It does not
fabricate a concert to fill the space.

The Ticketmaster adapter never holds the API key. It calls the Pulse edge
function in `supabase/functions/events`, which validates the query, attaches the
key server-side, rate-limits per caller, and returns the provider's response
untouched.
