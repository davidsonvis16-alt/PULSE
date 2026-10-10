import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MiniPlayer } from '@/src/ui/mini-player';
import { layout } from '@/src/theme/tokens';

/** Routes that own the full screen and must not be overlapped. */
const HIDE_ON = ['/player', '/queue'];

/** Tab routes, where the mini player has to clear the tab bar. */
const TAB_ROUTES = ['/', '/discover', '/library', '/events', '/profile'];

/**
 * Mounted once at the root so the mini player survives every navigation. It
 * sits above the tab bar on tab screens and above the home indicator elsewhere,
 * and steps aside for the full-screen player and the queue.
 */
export function GlobalMiniPlayer() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  if (HIDE_ON.some((route) => pathname.startsWith(route))) return null;

  const onTab = TAB_ROUTES.includes(pathname);
  const bottom = onTab ? layout.tabBarHeight + insets.bottom + 6 : insets.bottom + 12;

  return <MiniPlayer bottom={bottom} />;
}
