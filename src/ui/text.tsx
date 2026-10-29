import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { typography } from '@/src/theme/tokens';
import { useTheme, type ThemeColors } from '@/src/theme/theme';

type Variant = keyof typeof typography;
type Tone = 'default' | 'secondary' | 'muted' | 'faint' | 'accent' | 'danger' | 'onAccent';

const toneColor = (colors: ThemeColors, tone: Tone): string =>
  ({
    default: colors.text,
    secondary: colors.textSecondary,
    muted: colors.textMuted,
    faint: colors.textFaint,
    accent: colors.accentInk,
    danger: colors.danger,
    onAccent: colors.onAccent,
  })[tone];

export interface TxtProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  /** Uppercase micro label used for section eyebrows. */
  uppercase?: boolean;
  align?: TextStyle['textAlign'];
}

export function Txt({
  variant = 'body',
  tone = 'default',
  uppercase,
  align,
  style,
  ...rest
}: TxtProps) {
  const { colors } = useTheme();
  return (
    <RNText
      {...rest}
      style={[
        typography[variant],
        { color: toneColor(colors, tone) },
        uppercase && { textTransform: 'uppercase' },
        align && { textAlign: align },
        style,
      ]}
    />
  );
}
