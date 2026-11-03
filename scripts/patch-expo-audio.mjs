// Gives the phone's media notification real previous / next buttons.
//
// expo-audio draws "10 seconds back / forward" there, and keeps the queue out
// of its reach (Pulse's queue lives in JavaScript). So the buttons are changed
// to do something Pulse already understands: "next" jumps to the end of the
// song, which ends it and Pulse plays the next one exactly as when a song
// finishes; "previous" jumps to the start, which Pulse reads as "go back" (see
// notificationSkip in src/audio/player.ts). The icons and names are swapped to
// match. It runs after every install and before every Android build, and does
// nothing if the change is already made.
import fs from 'node:fs';

const file = new URL(
  '../node_modules/expo-audio/android/src/main/java/expo/modules/audio/service/AudioControlsService.kt',
  import.meta.url,
);

const callback = new URL(
  '../node_modules/expo-audio/android/src/main/java/expo/modules/audio/service/AudioMediaSessionCallback.kt',
  import.meta.url,
);

if (!fs.existsSync(file)) process.exit(0);

const toEnd = (player) =>
  `if (${player}.duration > 0) ${player}.seekTo(${player}.duration) else ${player}.seekTo(${player}.currentPosition + SEEK_INTERVAL_MS)`;

function edit(target, change) {
  if (!fs.existsSync(target)) return;
  const was = fs.readFileSync(target, 'utf8');
  const now = change(was);
  if (now !== was) fs.writeFileSync(target, now);
}

edit(callback, (text) =>
  text
    .replace(
      'session.player.seekTo(session.player.currentPosition + AudioControlsService.SEEK_INTERVAL_MS)',
      toEnd('session.player').replaceAll('SEEK_INTERVAL_MS', 'AudioControlsService.SEEK_INTERVAL_MS'),
    )
    .replace('session.player.seekTo(session.player.currentPosition - AudioControlsService.SEEK_INTERVAL_MS)', 'session.player.seekTo(0)'),
);

const before = fs.readFileSync(file, 'utf8');
const after = before
  .replace('player.seekTo(player.currentPosition + SEEK_INTERVAL_MS)', toEnd('player'))
  .replace('player.seekTo(player.currentPosition - SEEK_INTERVAL_MS)', 'player.seekTo(0)')
  .replace(
    'CommandButton.Builder(CommandButton.ICON_SKIP_BACK)\n          .setDisplayName("Seek Backward")',
    'CommandButton.Builder(CommandButton.ICON_PREVIOUS)\n          .setDisplayName("Previous")',
  )
  .replace(
    'CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD)\n          .setDisplayName("Seek Forward")',
    'CommandButton.Builder(CommandButton.ICON_NEXT)\n          .setDisplayName("Next")',
  );

if (after !== before) {
  fs.writeFileSync(file, after);
  console.log('expo-audio: notification buttons set to previous / next');
}
