import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, layout, typography } from '@/src/theme/tokens';

type IconName = keyof typeof Ionicons.glyphMap;

const TABS: { name: string; title: string; icon: IconName; active: IconName }[] = [
  { name: 'index', title: 'Music', icon: 'musical-notes-outline', active: 'musical-notes' },
  { name: 'discover', title: 'Discover', icon: 'search-outline', active: 'search' },
  { name: 'library', title: 'Library', icon: 'library-outline', active: 'library' },
  { name: 'events', title: 'Events', icon: 'calendar-outline', active: 'calendar' },
  { name: 'profile', title: 'Profile', icon: 'person-outline', active: 'person' },
];

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const barHeight = layout.tabBarHeight + insets.bottom;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.background },
          tabBarActiveTintColor: colors.accent,
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

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.backgroundElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSoft,
    elevation: 0,
  },
});
