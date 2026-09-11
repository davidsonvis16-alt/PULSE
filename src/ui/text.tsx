import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { colors, typography } from '@/src/theme/tokens';

type Variant = keyof typeof typography;
type Tone = 'default' | 'secondary' | 'muted' | 'faint' | 'accent' | 'danger' | 'onAccent';

const TONE: Record<Tone, string> = {
  default: colors.text,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  faint: colors.textFaint,
  accent: colors.accent,
  danger: colors.danger,
  onAccent: colors.onAccent,
};

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
  return (
    <RNText
      {...rest}
      style={[
        typography[variant],
        { color: TONE[tone] },
        uppercase && { textTransform: 'uppercase' },
        align && { textAlign: align },
        style,
      ]}
    />
  );
}
