// All your devices, with the room temperature of each. "+" adds another one.
import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { SignedIn } from '@/components/Gate';
import { ADD_DEVICE_STEPS, Button, Card, Message, Pill, Steps, styles } from '@/components/ui';
import type { Device, Issue, Latest } from '@/lib/api';
import { roomStatus, roomTemperature, tempColor } from '@/lib/room';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

export default function DevicesScreen() {
  return <SignedIn><Devices /></SignedIn>;
}

function Devices() {
  const { api, guard, session, signOut } = useSession();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [latest, setLatest] = useState<Record<string, Latest>>({});
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, now, open] = await guard(() => Promise.all([api.devices(), api.latest(), api.issues()]));
      setDevices(list);
      setLatest(now);
      setIssues(open);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your devices.');
    }
  }, [api, guard]);

  // refresh while this screen is visible (also notices a device paired from the website)
  useFocusEffect(useCallback(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]));

  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <Pressable onPress={() => router.push('/add')} hitSlop={12} accessibilityLabel="Add a device"
            style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.cardStrong, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 24, lineHeight: 26, fontWeight: '300' }}>+</Text>
          </Pressable>
        ),
      }}
    />
  );

  if (devices && !devices.length) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        {header}
        <Card>
          <Text style={[styles.h1, { fontSize: 26 }]}>Add your first device</Text>
          <Text style={[styles.sub, { marginBottom: 10 }]}>Your account has no Room Sentinel yet. It takes about a minute:</Text>
          <Steps items={ADD_DEVICE_STEPS} />
          <Button title="Scan the QR code" onPress={() => router.push('/add')} />
        </Card>
        <Message text={error} error />
        <Footer email={session?.email} onSignOut={signOut} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {header}
      <FlatList
        data={devices ?? []}
        keyExtractor={d => d.device_id}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<Text style={[styles.muted, { textAlign: 'center', marginTop: 40 }]}>{error ? '' : 'Loading…'}</Text>}
        renderItem={({ item }) => {
          const now = latest[item.device_id];
          const temp = roomTemperature(now);
          const status = roomStatus(now, issues.filter(i => i.device_id === item.device_id));
          return (
            <Pressable onPress={() => router.push({ pathname: '/device/[id]', params: { id: item.device_id } })}
              style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }} numberOfLines={1}>{item.name || 'Unnamed device'}</Text>
                  <Text style={[styles.muted, { marginTop: 3 }]}>{item.device_id}</Text>
                  <View style={{ flexDirection: 'row', marginTop: 10 }}><Pill label={status.label} color={status.color} /></View>
                </View>
                <Text style={{ color: temp == null ? colors.text3 : tempColor(temp, item.target_temperature ?? 21), fontSize: 36, fontWeight: '200' }}>
                  {temp == null ? '--' : temp.toFixed(1)}<Text style={{ fontSize: 16, color: colors.text2 }}>°C</Text>
                </Text>
              </Card>
            </Pressable>
          );
        }}
        ListFooterComponent={<><Message text={error} error /><Footer email={session?.email} onSignOut={signOut} /></>}
      />
    </View>
  );
}

function Footer({ email, onSignOut }: { email?: string; onSignOut: () => void }) {
  return (
    <View style={{ marginTop: 24, alignItems: 'center', gap: 6 }}>
      <Text style={styles.muted}>Signed in as {email}</Text>
      <Pressable onPress={onSignOut} hitSlop={10}><Text style={{ color: colors.accent, fontSize: 14 }}>Sign out</Text></Pressable>
    </View>
  );
}
