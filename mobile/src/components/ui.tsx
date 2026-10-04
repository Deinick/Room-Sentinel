// A handful of building blocks in the website's style: dark, frosted cards, rounded corners.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { colors, radius } from '@/lib/theme';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
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
        <Text style={[styles.buttonText, kind === 'primary' ? { color: '#0b0f15' } : kind === 'danger' ? { color: '#ffb3a8' } : null]}>{title}</Text>
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

export function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function Steps({ items }: { items: [string, string][] }) {
  return (
    <View style={{ gap: 12, marginVertical: 8 }}>
      {items.map(([bold, rest], i) => (
        <View key={i} style={styles.step}>
          <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
          <Text style={styles.stepText}><Text style={{ color: colors.text, fontWeight: '600' }}>{bold}</Text> {rest}</Text>
        </View>
      ))}
    </View>
  );
}

export const ADD_DEVICE_STEPS: [string, string][] = [
  ['On the device,', 'open Settings → Account Login. A QR code appears on its screen.'],
  ['Scan it', 'with this app (the + button), or with your phone camera.'],
  ['Confirm', 'the serial number from the device\'s label, then give it a name.'],
];

export const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: radius.card, padding: 18 },
  button: { minHeight: 50, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 14 },
  primary: { backgroundColor: '#f2f6fb' },
  ghost: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: colors.line },
  danger: { backgroundColor: 'rgba(255,122,107,0.08)', borderWidth: 1, borderColor: 'rgba(255,122,107,0.35)' },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  label: { color: colors.text2, fontSize: 13, marginBottom: 6 },
  input: { color: colors.text, fontSize: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: radius.control, paddingHorizontal: 14, paddingVertical: 13 },
  message: { color: colors.ok, fontSize: 14, marginTop: 12 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '600', letterSpacing: 2, textTransform: 'uppercase' },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: { width: 26, height: 26, borderRadius: 9, backgroundColor: '#cfe6fb', alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: '#0b0f15', fontWeight: '700', fontSize: 13 },
  stepText: { flex: 1, color: colors.text2, fontSize: 15, lineHeight: 21 },
  h1: { color: colors.text, fontSize: 32, fontWeight: '200', marginTop: 6 },
  sub: { color: colors.text2, fontSize: 15, marginTop: 6, lineHeight: 21 },
  muted: { color: colors.text3, fontSize: 13 },
});
