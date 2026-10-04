// Text and TextInput in Ranade. A custom font comes as one file per weight, so fontWeight is
// turned into the matching font file (otherwise Android falls back to the system font).
import { forwardRef } from 'react';
import { Text as RNText, TextInput as RNTextInput, StyleSheet, type StyleProp, type TextInputProps, type TextProps, type TextStyle } from 'react-native';

import { colors, fonts } from '@/lib/theme';

const BY_WEIGHT: Record<string, string> = {
  '100': fonts.light, '200': fonts.light, '300': fonts.light,
  normal: fonts.regular, '400': fonts.regular,
  '500': fonts.medium, '600': fonts.medium,
  bold: fonts.bold, '700': fonts.bold, '800': fonts.bold, '900': fonts.bold,
};

function ranade(style: StyleProp<TextStyle>): TextStyle {
  const weight = String(StyleSheet.flatten(style)?.fontWeight ?? '400');
  return { fontFamily: BY_WEIGHT[weight] ?? fonts.regular, fontWeight: 'normal' };
}

export function Text({ style, ...props }: TextProps) {
  return <RNText {...props} style={[{ color: colors.text }, style, ranade(style)]} />;
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  return <RNTextInput ref={ref} {...props} style={[style, ranade(style)]} />;
});
