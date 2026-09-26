# Playback outside the app

What Pulse can and cannot do once the app is not on screen, and why.

## Background audio

On by default and not a setting. `src/audio/player.ts` configures the audio
session once at start-up with `shouldPlayInBackground: true`, so leaving Pulse
— switching apps, locking the phone — does not stop the music. A listener
should never have to find a switch for that.

## The lock screen and the notification shade

`PlayerStore.showNotification` hands the current track to the audio session with
`setActiveForLockScreen`, so Android draws it in the shade and on the lock
screen and iOS draws it on the lock screen and in Control Centre: cover, title,
artist, and transport.

Controls pressed from outside the app drive the same player object, and the
resulting state change arrives back through `playbackStatusUpdate`, so the UI
follows without any extra plumbing.

**What is on it:** play, pause, and ten seconds either way.

**What is not:** next and previous track.

This is a limit of the audio backend, not an oversight. `expo-audio` owns the
media session and exposes exactly four commands to JavaScript — play, pause,
seek forward, seek back (`AudioControlsService.kt` on Android,
`MediaController.swift` on iOS). Pulse's queue lives in JavaScript, in
`PlayerStore`, and the media session has no idea it exists, so there is nothing
for a "next" button on the lock screen to call.

Getting next and previous there means moving the queue into the native media
session, which means a different audio backend — `react-native-track-player` is
the usual choice. That is a real migration of `src/audio/player.ts` and it
takes Pulse out of Expo Go, which is why it has not been done quietly. It is a
decision, not a patch.

## Sharing the audio with other apps

`Playback` settings, and a button on the player. Off — the default, and what a
music app normally does — Pulse takes audio focus and other apps duck under it.
On, Pulse asks for no focus at all and plays alongside whatever else is going:
a podcast, a game, the background of a call.

Changing it means tearing down and rebuilding the phone's audio session, and
the OS stops playback while that happens. Rather than let the song cut out and
stay out, `setMixWithOtherApps` pauses on purpose, retunes, and seeks back to
where it was. `retuning` is true for that moment so the control can say what it
is doing instead of looking broken.

The phone cannot tell Pulse what other apps are playing, so the control is
always there rather than appearing when something else starts.
