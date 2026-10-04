// A handful of building blocks in the website's style: dark liquid glass, sharp-ish corners,
// statuses as plain coloured words (no pill frames, no dots).
import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type TextInputProps, type ViewStyle } from 'react-native';

import { Text, TextInput } from '@/components/Text';
import { colors, radius } from '@/lib/theme';

const OUTER_KEYS = ['margin', 'marginTop', 'marginBottom', 'marginHorizontal', 'marginVertical', 'borderColor', 'flex'] as const;

/** Liquid glass: blurred background (real blur on iOS, frosted fallback on Android), bright top edge. */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const flat = StyleSheet.flatten(style) ?? {};
  const outer: ViewStyle = {}, inner: ViewStyle = {};
  for (const [k, v] of Object.entries(flat)) {
    ((OUTER_KEYS as readonly string[]).includes(k) ? outer : inner)[k as keyof ViewStyle] = v as never;
  }
  return (
    <View style={[styles.card, outer]}>
      <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[styles.cardInner, inner]}>{children}</View>
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', busy = false, disabled = false }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; busy?: boolean; disabled?: boolean;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [styles.button, styles[kind], off && { opacity: 0.5 }, pressed && { opacity: 0.8, transform: [{ scale: 0.99 }] }]}>
      {busy ? <ActivityIndicator color={kind === 'primary' ? '#0b0f15' : colors.text} /> : (
        <Text style={[styles.buttonText, kind === 'primary' ? { color: '#0b0f15' } : kind === 'danger' ? { color: colors.crit } : null]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.text3} style={styles.input} autoCapitalize="none" {...props} />
    </View>
  );
}

export function Message({ text, error }: { text: string; error?: boolean }) {
  if (!text) return null;
  return <Text style={[styles.message, error && { color: colors.crit }]} accessibilityLiveRegion="polite">{text}</Text>;
}

/** A status such as NORMAL / WARNING: just the word, in its colour. */
export function Status({ label, color }: { label: string; color: string }) {
  return <Text style={[styles.status, { color }]}>{label.toUpperCase()}</Text>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function Steps({ items }: { items: [string, string][] }) {
  return (
    <View style={{ gap: 12, marginVertical: 8 }}>
      {items.map(([bold, rest], i) => (
        <View key={i} style={styles.step}>
          <Text style={styles.stepNum}>{i + 1}.</Text>
          <Text style={styles.stepText}><Text style={{ color: colors.text, fontWeight: '500' }}>{bold}</Text> {rest}</Text>
        </View>
      ))}
    </View>
  );
}

export const ADD_DEVICE_STEPS: [string, string][] = [
  ['On the device,', 'open Settings → Account Login. A QR code appears on its screen.'],
  ['Scan it', 'with the + button in this app.'],
  ['Confirm', 'the serial number from the device\'s label, then give it a name.'],
];

export const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card, overflow: 'hidden',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderTopColor: colors.edge,
  },
  cardInner: { padding: 18 },
  button: { minHeight: 50, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 14 },
  primary: { backgroundColor: '#f2f6fb' },
  ghost: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: colors.line },
  danger: { backgroundColor: 'rgba(255,122,107,0.08)', borderWidth: 1, borderColor: 'rgba(255,122,107,0.35)' },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '500' },
  label: { color: colors.text2, fontSize: 13, marginBottom: 6 },
  input: { color: colors.text, fontSize: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: radius.control, paddingHorizontal: 14, paddingVertical: 13 },
  message: { color: colors.ok, fontSize: 14, marginTop: 12 },
  status: { fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '500', letterSpacing: 2, textTransform: 'uppercase' },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNum: { color: colors.text3, fontSize: 15, fontWeight: '500', lineHeight: 21, minWidth: 16 },
  stepText: { flex: 1, color: colors.text2, fontSize: 15, lineHeight: 21 },
  h1: { color: colors.text, fontSize: 32, fontWeight: '300', marginTop: 6 },
  sub: { color: colors.text2, fontSize: 15, marginTop: 6, lineHeight: 21 },
  muted: { color: colors.text3, fontSize: 13 },
});
