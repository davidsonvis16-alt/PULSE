import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useResponsive } from '@/src/hooks/use-responsive';
import { TABS } from '@/src/ui/sidebar';
import { layout, typography } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';

/**
 * Phones get tabs along the bottom, under the thumb. Laptops get the sidebar
 * instead (see Sidebar), so the bar is not drawn there at all.
 */
export default function TabLayout() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { isLaptopUp } = useResponsive();
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
        {TABS.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? tab.active : tab.icon} size={22} color={color} />
              ),
            }}
          />
        ))}
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
