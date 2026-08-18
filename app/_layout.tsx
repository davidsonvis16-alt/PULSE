import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";

export default function RootLayout() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_event, session) => setSession(session));
  }, []);

  async function handleLogin() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) alert(error.message);
    setLoading(false);
  }

  async function handleSignUp() {
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) alert(error.message);
    else alert("Check your email to confirm!");
    setLoading(false);
  }

  if (!session) {
    return (
      <View style={styles.authScreen}>
        <Text style={styles.authLogo}>PULSE</Text>
        <Text style={styles.authTagline}>Feel the music</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#666"
          onChangeText={setEmail}
          value={email}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#666"
          secureTextEntry
          onChangeText={setPassword}
          value={password}
        />
        <TouchableOpacity style={styles.authBtn} onPress={handleLogin}>
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.authBtnText}>Login</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={handleSignUp}>
          <Text style={styles.switchText}>Create Account</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="upload" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  authScreen: {
    flex: 1,
    backgroundColor: "#0a0a0f",
    justifyContent: "center",
    padding: 30,
  },
  authLogo: {
    color: "#00d4ff",
    fontSize: 48,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: 8,
  },
  authTagline: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 40,
    letterSpacing: 3,
  },
  input: {
    backgroundColor: "#1a1a2e",
    color: "#fff",
    padding: 18,
    borderRadius: 12,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#2a2a3e",
  },
  authBtn: {
    backgroundColor: "#00d4ff",
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
  },
  authBtnText: { fontWeight: "bold", fontSize: 16, color: "#000" },
  switchText: {
    color: "#666",
    textAlign: "center",
    marginTop: 25,
    fontSize: 14,
  },
});
