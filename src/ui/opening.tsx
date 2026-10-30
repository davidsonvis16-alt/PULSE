import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Txt } from '@/src/ui/text';
import { PulseLogo } from '@/src/ui/logo';
import { brand, fonts, spacing } from '@/src/theme/tokens';

/**
 * What Pulse shows while it opens: a white page, the painted mark, and its
 * name and promise written by hand in thick black marker. The handwriting is
 * for this screen alone. `written` is false only for the very first moment,
 * before the marker font has loaded, so nothing shows in the wrong typeface.
 */
export function OpeningScreen({ written = true }: { written?: boolean }) {
  return (
    <View style={styles.page}>
      <PulseLogo size={92} />
      {written && (
        <View style={{ alignItems: 'center', marginTop: spacing.xl }}>
          <Txt style={styles.name}>Pulse</Txt>
          <Txt style={styles.promise}>Own your music</Txt>
        </View>
      )}
      <ActivityIndicator color="#0A0B0A" style={{ marginTop: spacing.xxxl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    // The same white as the launch screen, so the hand-off does not flash.
    backgroundColor: brand.launchBackground,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  name: { fontFamily: fonts.marker, fontSize: 52, lineHeight: 62, color: '#0A0B0A' },
  promise: { fontFamily: fonts.marker, fontSize: 20, lineHeight: 26, color: '#0A0B0A', marginTop: 2 },
});
