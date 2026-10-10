import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import { darkColors, lightColors, type ThemeColors } from '@/src/theme/tokens';
import { getSetting, setSetting, SETTINGS_KEYS } from '@/src/db/repos/settings';

export type { ThemeColors };

/**
 * Light and dark.
 *
 * Pulse follows the phone. Someone who has set their device to switch at
 * sunset expects every app to switch with it, so the default preference is
 * "system" and the colours change underneath the app without a restart. The
 * override exists for the people who want one app to differ from the rest, and
 * it is remembered on the device.
 *
 * Components read colours through `useTheme`, and their StyleSheets are built
 * per scheme through `useThemedStyles`, because a StyleSheet created at module
 * load would freeze whichever scheme happened to be active at launch.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

interface ThemeValue {
  colors: ThemeColors;
  scheme: Scheme;
  /** What the user chose, which may be "follow the phone". */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeValue>({
  colors: darkColors,
  scheme: 'dark',
  preference: 'system',
  setPreference: () => {},
  isDark: true,
});

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/** Builds a StyleSheet for the active scheme, rebuilt only when it changes. */
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setLocalPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    void (async () => {
      const saved = await getSetting(SETTINGS_KEYS.theme).catch(() => null);
      if (saved === 'light' || saved === 'dark' || saved === 'system') setLocalPreference(saved);
    })();
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setLocalPreference(next);
    void setSetting(SETTINGS_KEYS.theme, next).catch(() => {});
  }, []);

  const value = useMemo<ThemeValue>(() => {
    const scheme: Scheme = preference === 'system' ? (system ?? 'dark') : preference;
    return {
      scheme,
      colors: scheme === 'light' ? lightColors : darkColors,
      preference,
      setPreference,
      isDark: scheme === 'dark',
    };
  }, [preference, system, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
