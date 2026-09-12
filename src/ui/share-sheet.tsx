import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Txt } from '@/src/ui/text';
import { Sheet, SheetAction } from '@/src/ui/sheet';
import { PulseLogo } from '@/src/ui/logo';
import { useToast } from '@/src/ui/toast';
import { radii, spacing } from '@/src/theme/tokens';
import { useTheme, useThemedStyles, type ThemeColors } from '@/src/theme/theme';
import { copyLink, shareCard, shareLink, type SharePayload } from '@/src/share/share';

const ShareContext = createContext<(payload: SharePayload) => void>(() => {});

export function useShareSheet() {
  return useContext(ShareContext);
}

/**
 * The share surface.
 *
 * It shows the Pulse card the recipient will see, then hands off to the
 * operating system's share sheet. Pulse picks no destination and sends no
 * message — WhatsApp, Messages, Instagram and everything else appear because
 * the OS put them there.
 */
export function ShareSheetProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const cardRef = useRef<View>(null);
  const toast = useToast();

  const open = useCallback((next: SharePayload) => setPayload(next), []);
  const close = useCallback(() => setPayload(null), []);
  const value = useMemo(() => open, [open]);

  return (
    <ShareContext.Provider value={value}>
      {children}
      <Sheet visible={!!payload} onClose={close} title="Share">
        {payload && (
          <>
            <View ref={cardRef} collapsable={false} style={styles.card}>
              <View style={styles.cardArt}>
                {payload.artworkUrl ? (
                  <Image
                    source={{ uri: payload.artworkUrl }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.cardArtEmpty]}>
                    <Ionicons name="musical-notes" size={40} color={colors.textFaint} />
                  </View>
                )}
              </View>
              <View style={styles.cardBody}>
                <Txt variant="title3" numberOfLines={2}>
                  {payload.title}
                </Txt>
                <Txt variant="body" tone="secondary" numberOfLines={1}>
                  {payload.subtitle}
                </Txt>
                {payload.detail ? (
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {payload.detail}
                  </Txt>
                ) : null}
                <View style={styles.cardFooter}>
                  <PulseLogo size={20} showWordmark />
                </View>
              </View>
            </View>

            <View style={styles.actions}>
              <SheetAction
                icon="share-social-outline"
                label="Share Pulse card"
                detail="Opens your share sheet with the image"
                tone="accent"
                onPress={async () => {
                  const ok = await shareCard(cardRef, payload);
                  if (!ok) toast('Sharing was cancelled');
                  close();
                }}
              />
              <SheetAction
                icon="link-outline"
                label="Share link"
                detail={payload.url}
                onPress={async () => {
                  await shareLink(payload);
                  close();
                }}
              />
              <SheetAction
                icon="copy-outline"
                label="Copy link"
                onPress={async () => {
                  await copyLink(payload);
                  toast('Link copied', 'success');
                  close();
                }}
              />
            </View>
          </>
        )}
      </Sheet>
    </ShareContext.Provider>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radii.xl,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cardArt: { width: '100%', aspectRatio: 1.35, backgroundColor: colors.cardHigh },
    cardArtEmpty: { alignItems: 'center', justifyContent: 'center' },
    cardBody: { padding: spacing.xl, gap: 4 },
    cardFooter: { marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center' },
    actions: { marginTop: spacing.md },
  });
