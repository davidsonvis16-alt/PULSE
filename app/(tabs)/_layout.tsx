import { Tabs } from "expo-router";
import { Text } from "react-native";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0a0a0f",
          borderTopColor: "#1a1a2e",
          borderTopWidth: 1,
          height: 65,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: "#00d4ff",
        tabBarInactiveTintColor: "#444",
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22 }}>🏠</Text>,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: "Discover",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22 }}>🌍</Text>,
        }}
      />
      <Tabs.Screen
        name="concerts"
        options={{
          title: "Concerts",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22 }}>🎤</Text>,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22 }}>📚</Text>,
        }}
      />
    </Tabs>
  );
}
