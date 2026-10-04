// Confirm the serial number, pair, then give the device a name.
// Also opens from a link: roomsentinel://pair/CODE
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { SignedIn } from '@/components/Gate';
import { Text } from '@/components/Text';
import { Button, Card, Eyebrow, Field, Message, styles } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

export default function PairScreen() {
  return <SignedIn><Pair /></SignedIn>;
}

function pairingError(e: unknown) {
  if (e instanceof ApiError && e.status === 410) return 'This code has expired. On the device, open Account Login again for a new QR code.';
  if (e instanceof ApiError && e.status === 404) return 'This code was already used, or doesn\'t exist. On the device, open Account Login again.';
  return e instanceof Error ? e.message : 'Something went wrong.';
}

function Pair() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { api, guard } = useSession();
  const [phase, setPhase] = useState<'checking' | 'confirm' | 'name' | 'failed'>('checking');
  const [serial, setSerial] = useState('');
  const [expires, setExpires] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    guard(() => api.pairingInfo(code))
      .then(info => { setSerial(info.device_id); setExpires(Date.parse(info.expires_at)); setPhase('confirm'); })
      .catch(e => { setError(pairingError(e)); setPhase('failed'); });
  }, [api, guard, code]);

  useEffect(() => {
    if (!expires || phase !== 'confirm') return;
    const tick = () => {
      const s = Math.max(0, Math.round((expires - Date.now()) / 1000));
      setLeft(s);
      if (!s) { setError('This code has expired. On the device, open Account Login again for a new QR code.'); setPhase('failed'); }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expires, phase]);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await guard(() => api.confirmPairing(code));
      setPhase('name');
    } catch (e) {
      setError(pairingError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    if (!name.trim()) return setError('Give it a name, for example "Living room".');
    setBusy(true);
    try {
      await guard(() => api.updateDevice(serial, { name: name.trim() }));
      router.replace({ pathname: '/device/[id]', params: { id: serial } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the name.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        {phase === 'checking' && <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />}

        {(phase === 'confirm' || phase === 'failed') && (
          <>
            <Eyebrow>New device</Eyebrow>
            <Text style={styles.h1}>Pair this device?</Text>
            <Card style={{ marginTop: 18, alignItems: 'center' }}>
              <Text style={[styles.muted, { letterSpacing: 2 }]}>SERIAL NUMBER</Text>
              <Text style={{ color: colors.text, fontSize: 28, letterSpacing: 1.5, marginVertical: 8 }}>{serial || '—'}</Text>
              <Text style={[styles.sub, { textAlign: 'center', marginTop: 0 }]}>Check that it matches the label on your device.</Text>
            </Card>
            <Message text={error} error />
            {phase === 'confirm' ? (
              <>
                <Button title="Pair device" onPress={confirm} busy={busy} />
                <Text style={[styles.muted, { textAlign: 'center', marginTop: 12 }]}>Code valid for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</Text>
              </>
            ) : (
              <Button title="Scan again" kind="ghost" onPress={() => router.replace('/add')} />
            )}
          </>
        )}

        {phase === 'name' && (
          <>
            <Eyebrow>Paired</Eyebrow>
            <Text style={styles.h1}>Name your device</Text>
            <Text style={styles.sub}>{serial} is on your account. What room is it in?</Text>
            <Card style={{ marginTop: 18 }}>
              <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Living room" autoCapitalize="words" maxLength={100} autoFocus />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 8, marginTop: 12 }}>
                {['Living room', 'Bedroom', 'Office', 'Kitchen'].map(s => (
                  <Text key={s} onPress={() => setName(s)} style={{ color: name === s ? colors.text : colors.accent, fontSize: 15 }}>{s}</Text>
                ))}
              </View>
              <Message text={error} error />
              <Button title="Save" onPress={saveName} busy={busy} />
            </Card>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
