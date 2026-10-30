// Gives the phone's media notification real previous / next buttons.
//
// expo-audio draws "10 seconds back / forward" there. Pulse already turns
// those presses into previous / next song (see notificationSkip in
// src/audio/player.ts); this only swaps the icons and names so the buttons
// look like what they do. It runs after every install and before every
// Android build, and does nothing if the change is already made.
import fs from 'node:fs';

const file = new URL(
  '../node_modules/expo-audio/android/src/main/java/expo/modules/audio/service/AudioControlsService.kt',
  import.meta.url,
);

if (!fs.existsSync(file)) process.exit(0);

const before = fs.readFileSync(file, 'utf8');
const after = before
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
