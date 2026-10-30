import { StyleSheet, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useResponsive } from '@/src/hooks/use-responsive';
import { TABS, type SidebarTab } from '@/src/ui/sidebar';
import { layout, typography } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/** Pulse Radio sits in the middle of the bar; it opens full screen. */
const RADIO_TAB: SidebarTab = {
  name: 'live',
  href: '/radio',
  title: 'Radio',
  icon: 'radio-outline',
  active: 'radio',
};

/** The bar, left to right: Profile is reached from the picture on Home instead. */
const BAR = [
  ...TABS.filter((tab) => tab.name === 'index' || tab.name === 'discover'),
  RADIO_TAB,
  ...TABS.filter((tab) => tab.name === 'library' || tab.name === 'events'),
];

/**
 * Phones get tabs along the bottom, under the thumb. Laptops get the sidebar
 * instead (see Sidebar), so the bar is not drawn there at all.
 */
export default function TabLayout() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { isLaptopUp } = useResponsive();
  const router = useRouter();
  const barHeight = layout.tabBarHeight + insets.bottom;

  return (
    <View style={{ flex: 1, backgroundColor: isLaptopUp ? 'transparent' : colors.background }}>
      <Tabs
        // On a laptop the sidebar (mounted around the whole app) is the navigation.
        tabBar={isLaptopUp ? () => null : undefined}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: isLaptopUp ? 'transparent' : colors.background },
          tabBarActiveTintColor: colors.accentInk,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: [styles.bar, { height: barHeight, paddingBottom: insets.bottom }],
          tabBarLabelStyle: typography.micro,
          tabBarItemStyle: { paddingTop: 8 },
        }}
      >
        {BAR.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? tab.active : tab.icon} size={22} color={color} />
              ),
            }}
            listeners={
              tab === RADIO_TAB
                ? {
                    tabPress: (event) => {
                      event.preventDefault();
                      router.push('/radio');
                    },
                  }
                : undefined
            }
          />
        ))}
        {/* Still a page — opened from the picture at the top of Home. */}
        <Tabs.Screen name="profile" options={{ href: null }} />
      </Tabs>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    bar: {
      backgroundColor: colors.backgroundElevated,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderSoft,
      elevation: 0,
    },
  });
