import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, Animated, ActivityIndicator, Dimensions } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { Audio } from 'expo-av';
import Slider from '@react-native-community/slider';
import { supabase } from '../../lib/supabase';
import { router } from 'expo-router';

const { width } = Dimensions.get('window');

const moods = [
  { mood: 'Happy', emoji: '😊', color: '#f4a261' },
  { mood: 'Sad', emoji: '😢', color: '#457b9d' },
  { mood: 'Party', emoji: '🎉', color: '#e63946' },
  { mood: 'Exercise', emoji: '💪', color: '#2a9d8f' },
  { mood: 'Chill', emoji: '😌', color: '#9b5de5' },
  { mood: 'Focus', emoji: '🎯', color: '#4a00e0' },
];

const highlights = [
  { id: '1', artist: 'Dua Lipa', duration: '30s', color: '#9b5de5' },
  { id: '2', artist: 'Kendrick', duration: '45s', color: '#e63946' },
  { id: '3', artist: 'Wizkid', duration: '20s', color: '#2a9d8f' },
  { id: '4', artist: 'Tems', duration: '35s', color: '#f4a261' },
];

const concerts = [
  { id: '1', artist: 'Dua Lipa', status: 'Coming Soon', color: '#9b5de5' },
  { id: '2', artist: 'Kendrick Lamar', status: 'On Tour Now', color: '#e63946' },
  { id: '3', artist: 'EDM Festival', status: 'This Weekend', color: '#457b9d' },
];

const topTabs = ['Home', 'Browse', 'Radio', 'Concerts', 'Library'];
const COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#9b5de5', '#f4a261', '#4a00e0'];

function WaveBar({ delay, paused }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    if (!paused) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 400 + delay, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0.3, duration: 400 + delay, useNativeDriver: true }),
        ])
      ).start();
    } else {
      anim.stopAnimation();
      anim.setValue(0.3);
    }
  }, [paused, delay]);
  return (
    <Animated.View style={{
      width: 3, height: 20,
      backgroundColor: '#00d4ff',
      borderRadius: 2, marginHorizontal: 1,
      transform: [{ scaleY: anim }],
    }} />
  );
}

export default function HomeScreen() {
  const [activeTab, setActiveTab] = useState('Home');
  const [activeMood, setActiveMood] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sound, setSound] = useState(null);
  const [currentSong, setCurrentSong] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [miniExpanded, setMiniExpanded] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState({});
  const expandAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => { fetchSongs(); }, []);

  async function fetchSongs() {
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .eq('status', 'approved')
        .order('plays', { ascending: false });
      if (error) throw error;
      setSongs(data || []);
    } catch (error) {
      console.error('Error fetching songs:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  function toggleMini() {
    const toValue = miniExpanded ? 0 : 1;
    Animated.timing(expandAnim, { toValue, duration: 300, useNativeDriver: false }).start();
    setMiniExpanded(!miniExpanded);
  }

  async function playSong(track, index) {
    try {
      if (sound) await sound.unloadAsync();
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: track.url },
        { isLooping: repeat, shouldPlay: true },
        (status) => {
          if (status.isLoaded) {
            setPlaybackStatus(status);
            setPaused(!status.isPlaying);
          }
        }
      );
      setSound(newSound);
      setCurrentSong(track);
      setCurrentIndex(index);
      setPaused(false);
      await supabase.from('songs').update({ plays: (track.plays || 0) + 1 }).eq('id', track.id);
      setMiniExpanded(false);
      Animated.timing(expandAnim, { toValue: 0, duration: 100, useNativeDriver: false }).start();
    } catch (error) {
      console.error('Audio play error:', error);
    }
  }

  async function togglePlay() {
    if (!sound) return;
    paused ? await sound.playAsync() : await sound.pauseAsync();
  }

  async function nextSong() {
    if (songs.length === 0) return;
    const next = (currentIndex + 1) % songs.length;
    await playSong(songs[next], next);
  }

  async function prevSong() {
    if (songs.length === 0) return;
    const prev = (currentIndex - 1 + songs.length) % songs.length;
    await playSong(songs[prev], prev);
  }

  useEffect(() => {
    return () => { if (sound) sound.unloadAsync(); };
  }, [sound]);

  const miniWidth = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [56, 280] });
  const miniRadius = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 20] });
  const contentOpacity = expandAnim;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.profileIcon}>👤</Text>
        </TouchableOpacity>
        <Text style={styles.logo}>PULSE</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => router.push('/upload')} style={styles.uploadBtn}>
            <Text style={styles.uploadIcon}>⬆️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.notifBtn}>
            <Text style={styles.notifText}>🔔</Text>
            <View style={styles.notifBadge}><Text style={styles.notifBadgeText}>3</Text></View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.topTabsRow}>
        {topTabs.map(tab => (
          <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)} style={styles.topTab}>
            <Text style={[styles.topTabText, activeTab === tab && styles.topTabActive]}>{tab}</Text>
            {activeTab === tab && <View style={styles.topTabLine} />}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroInner}>
            <Text style={styles.heroSub}>Trending Near You:</Text>
            <Text style={styles.heroCity}>Nairobi</Text>
          </View>
          <View style={styles.heroBottom}>
            <Text style={styles.heroEvent}>Major Lazer Live · Tickets Available</Text>
            <TouchableOpacity style={styles.ticketBtn}>
              <Text style={styles.ticketText}>Get Tickets ›</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Hot Tracks</Text>
        {loading ? (
          <ActivityIndicator color="#00d4ff" style={{ marginVertical: 20 }} />
        ) : songs.length === 0 ? (
          <Text style={styles.emptyText}>No songs yet. Be the first to upload!</Text>
        ) : (
          songs.map((track, index) => (
            <TouchableOpacity key={track.id} style={styles.trackRow} onPress={() => playSong(track, index)} onLongPress={() => { playSong(track, index); setShowOptions(true); }}>
              <View style={[styles.trackArt, { backgroundColor: COLORS[index % COLORS.length] }]} />
              <View style={styles.trackInfo}>
                <Text style={styles.trackTitle}>{track.title}</Text>
                <Text style={styles.trackArtist}>{track.artist}</Text>
              </View>
              <Text style={styles.trackPlays}>▶ {(track.plays / 1000).toFixed(0)}k 🔥</Text>
            </TouchableOpacity>
          ))
        )}

        <Text style={styles.sectionTitle}>🎭 Pick Your Mood</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          {moods.map(item => (
            <TouchableOpacity key={item.mood} onPress={() => setActiveMood(item.mood)} style={[styles.moodBtn, { borderColor: item.color, backgroundColor: activeMood === item.mood ? item.color + '33' : 'rgba(255,255,255,0.04)' }]}>
              <Text style={styles.moodEmoji}>{item.emoji}</Text>
              <Text style={[styles.moodText, activeMood === item.mood && { color: item.color }]}>{item.mood}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.sectionTitle}>✨ Highlights</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {highlights.map(h => (
            <TouchableOpacity key={h.id} style={[styles.highlightCard, { backgroundColor: h.color }]}>
              <View style={styles.highlightPlay}><Text style={styles.highlightPlayText}>▶</Text></View>
              <Text style={styles.highlightArtist}>{h.artist}</Text>
              <Text style={styles.highlightDuration}>{h.duration}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.sectionTitle}>Live Concerts</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 160 }}>
          {concerts.map(c => (
            <TouchableOpacity key={c.id} style={[styles.concertCard, { backgroundColor: c.color }]}>
              <Text style={styles.concertArtist}>{c.artist}</Text>
              <Text style={styles.concertStatus}>{c.status}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </ScrollView>

      {currentSong && (
        <Animated.View style={[styles.miniPlayer, { width: miniWidth, borderRadius: miniRadius }]}>
          <TouchableOpacity onPress={miniExpanded ? () => setShowPlayer(true) : toggleMini} style={styles.miniThumb}>
            <View style={[styles.miniArt, { backgroundColor: COLORS[currentIndex % COLORS.length] }]} />
          </TouchableOpacity>
          <Animated.View style={[styles.miniExpandedContent, { opacity: contentOpacity }]}>
            <View style={styles.miniInfo}>
              <Text style={styles.miniTitle} numberOfLines={1}>{currentSong.title}</Text>
              <Text style={styles.miniArtist} numberOfLines={1}>{currentSong.artist}</Text>
            </View>
            <View style={styles.waveRow}>
              {[0, 100, 50, 150, 80].map((d, i) => <WaveBar key={i} delay={d} paused={paused} />)}
            </View>
            <TouchableOpacity onPress={prevSong} style={styles.miniCtrl}>
              <Text style={styles.miniCtrlText}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlay} style={styles.miniPlayBtn}>
              <Text style={styles.miniPlayText}>{paused ? '▶' : '⏸'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={nextSong} style={styles.miniCtrl}>
              <Text style={styles.miniCtrlText}>⏭</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}

      <Modal visible={showPlayer} animationType="slide">
        <View style={styles.fullPlayer}>
          <TouchableOpacity style={styles.downBtn} onPress={() => setShowPlayer(false)}>
            <Text style={styles.downText}>⌄</Text>
          </TouchableOpacity>
          <View style={[styles.fullArt, { backgroundColor: COLORS[currentIndex % COLORS.length] }]} />
          <Text style={styles.fullTitle}>{currentSong?.title}</Text>
          <Text style={styles.fullArtist}>{currentSong?.artist}</Text>
          <Slider
            style={styles.fullSlider}
            minimumValue={0}
            maximumValue={playbackStatus.durationMillis || 1}
            value={playbackStatus.positionMillis || 0}
            minimumTrackTintColor="#00d4ff"
            maximumTrackTintColor="rgba(255,255,255,0.2)"
            thumbTintColor="#00d4ff"
            onSlidingComplete={async (value) => { if (sound) await sound.setPositionAsync(value); }}
          />
          <View style={styles.fullControls}>
            <TouchableOpacity onPress={() => setRepeat(!repeat)}>
              <Text style={[styles.fullCtrlText, { fontSize: 22, color: repeat ? '#00d4ff' : '#fff' }]}>🔁</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={prevSong}>
              <Text style={styles.fullCtrlText}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlay} style={styles.fullPlayBtn}>
              <Text style={styles.fullPlayText}>{paused ? '▶' : '⏸'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={nextSong}>
              <Text style={styles.fullCtrlText}>⏭</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowOptions(true)}>
              <Text style={[styles.fullCtrlText, { fontSize: 22 }]}>•••</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showOptions} animationType="slide" transparent>
        <TouchableOpacity style={styles.optionsOverlay} onPress={() => setShowOptions(false)}>
          <View style={styles.optionsSheet}>
            <Text style={styles.optionsSong}>{currentSong?.title}</Text>
            <Text style={styles.optionsArtist}>{currentSong?.artist}</Text>
            <TouchableOpacity style={styles.optionBtn}>
              <Text style={styles.optionIcon}>➕</Text>
              <Text style={styles.optionText}>Save to Library</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.optionBtn}>
              <Text style={styles.optionIcon}>⬇️</Text>
              <Text style={styles.optionText}>Download</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.optionBtn}>
              <Text style={styles.optionIcon}>🔗</Text>
              <Text style={styles.optionText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.optionBtn} onPress={() => setShowOptions(false)}>
              <Text style={[styles.optionText, { color: '#e63946' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0a0f' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 55, paddingHorizontal: 15, paddingBottom: 10 },
  profileIcon: { fontSize: 24 },
  logo: { color: '#00d4ff', fontSize: 22, fontWeight: 'bold', letterSpacing: 6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  uploadBtn: { padding: 5 },
  uploadIcon: { fontSize: 20 },
  notifBtn: { position: 'relative' },
  notifText: { fontSize: 22 },
  notifBadge: { position: 'absolute', top: -5, right: -5, backgroundColor: '#e63946', borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  notifBadgeText: { color: '#fff', fontSize: 9, fontWeight: 'bold' },
  topTabsRow: { paddingHorizontal: 15, marginBottom: 10, maxHeight: 40 },
  topTab: { marginRight: 20, paddingBottom: 8 },
  topTabText: { color: '#666', fontSize: 14 },
  topTabActive: { color: '#00d4ff', fontWeight: 'bold' },
  topTabLine: { height: 2, backgroundColor: '#00d4ff', marginTop: 4 },
  hero: { marginHorizontal: 15, borderRadius: 14, backgroundColor: '#1a1a2e', marginBottom: 20, height: 150, overflow: 'hidden' },
  heroInner: { padding: 15, flex: 1 },
  heroSub: { color: '#aaa', fontSize: 13 },
  heroCity: { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  heroBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: '#0d0d1a' },
  heroEvent: { color: '#ccc', fontSize: 13, flex: 1 },
  ticketBtn: { backgroundColor: '#00d4ff', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 8 },
  ticketText: { color: '#000', fontWeight: 'bold', fontSize: 12 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginLeft: 15, marginBottom: 12, marginTop: 20 },
  emptyText: { color: '#666', fontSize: 14, marginLeft: 15, marginBottom: 20 },
  trackRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 15, marginBottom: 15 },
  trackArt: { width: 50, height: 50, borderRadius: 8, marginRight: 12 },
  trackInfo: { flex: 1 },
  trackTitle: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  trackArtist: { color: '#aaa', fontSize: 12 },
  trackPlays: { color: '#aaa', fontSize: 12 },
  moodBtn: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginLeft: 12, alignItems: 'center' },
  moodEmoji: { fontSize: 22 },
  moodText: { color: '#fff', fontSize: 11, marginTop: 4 },
  highlightCard: { width: 120, height: 180, borderRadius: 14, marginLeft: 15, justifyContent: 'flex-end', padding: 10 },
  highlightPlay: { position: 'absolute', top: '40%', left: '33%', backgroundColor: 'rgba(0,0,0,0.3)', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  highlightPlayText: { color: '#fff' },
  highlightArtist: { color: '#fff', fontWeight: 'bold' },
  highlightDuration: { color: 'rgba(255,255,255,0.6)', fontSize: 10 },
  concertCard: { width: 160, height: 120, borderRadius: 12, marginLeft: 15, justifyContent: 'flex-end', padding: 10 },
  concertArtist: { color: '#fff', fontWeight: 'bold' },
  concertStatus: { color: '#ddd', fontSize: 11 },
  miniPlayer: { position: 'absolute', bottom: 75, right: 12, height: 56, backgroundColor: '#1a1a2e', flexDirection: 'row', alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: '#00d4ff33' },
  miniThumb: { padding: 8 },
  miniArt: { width: 40, height: 40, borderRadius: 8 },
  miniExpandedContent: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 8, gap: 6 },
  miniInfo: { flex: 1 },
  miniTitle: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  miniArtist: { color: '#666', fontSize: 9 },
  waveRow: { flexDirection: 'row', alignItems: 'center', height: 20 },
  miniCtrl: { padding: 4 },
  miniCtrlText: { color: '#fff', fontSize: 14 },
  miniPlayBtn: { backgroundColor: '#00d4ff', width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  miniPlayText: { color: '#000', fontSize: 12, fontWeight: 'bold' },
  fullPlayer: { flex: 1, backgroundColor: '#0a0a0f', alignItems: 'center', padding: 30 },
  downBtn: { alignSelf: 'flex-start', marginTop: 20 },
  downText: { color: '#fff', fontSize: 40 },
  fullArt: { width: width * 0.8, height: width * 0.8, borderRadius: 20, marginVertical: 30 },
  fullTitle: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  fullArtist: { color: '#aaa', fontSize: 16, marginTop: 5 },
  fullSlider: { width: width * 0.9, height: 40, marginTop: 20 },
  fullControls: { flexDirection: 'row', alignItems: 'center', gap: 30, marginTop: 30 },
  fullCtrlText: { color: '#fff', fontSize: 35 },
  fullPlayBtn: { backgroundColor: '#00d4ff', width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center' },
  fullPlayText: { fontSize: 28, fontWeight: 'bold', color: '#000' },
  optionsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  optionsSheet: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 30 },
  optionsSong: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 5 },
  optionsArtist: { color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 20 },
  optionBtn: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingVertical: 15, borderBottomWidth: 0.5, borderBottomColor: '#333' },
  optionIcon: { fontSize: 22 },
  optionText: { color: '#fff', fontSize: 16 },
