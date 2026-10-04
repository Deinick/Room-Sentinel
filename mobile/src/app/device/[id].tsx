// One device: the room temperature (like the website's top-right card), then every sensor.
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { SignedIn } from '@/components/Gate';
import { Text } from '@/components/Text';
import { Button, Card, Field, Message, Status, styles } from '@/components/ui';
import type { Device, Issue, Latest } from '@/lib/api';
import { SENSORS, STATUS_TEXT, forecastText, kindLabel, roomStatus, roomTemperature } from '@/lib/room';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

const SEVERITY_COLOR = { INFO: colors.accent, WARNING: colors.warn, CRITICAL: colors.crit };

export default function DeviceScreen() {
  return <SignedIn><DeviceDetail /></SignedIn>;
}

function DeviceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, guard } = useSession();
  const [device, setDevice] = useState<Device | null>(null);
  const [latest, setLatest] = useState<Latest | undefined>();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, now, open] = await guard(() => Promise.all([api.devices(), api.latest(), api.issues()]));
      const mine = list.find(d => d.device_id === id) ?? null;
      if (!mine) { router.replace('/'); return; } // unpaired elsewhere
      setDevice(mine);
      setLatest(now[id]);
      setIssues(open.filter(i => i.device_id === id));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this device.');
    }
  }, [api, guard, id]);

  useFocusEffect(useCallback(() => {
    load();
    const timer = setInterval(load, 2000); // the device sends every second
    return () => clearInterval(timer);
  }, [load]));

  async function rename() {
    if (!name.trim()) return setError('A device needs a name.');
    setBusy(true);
    try {
      setDevice(await guard(() => api.updateDevice(id, { name: name.trim() })));
      setEditing(false);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the name.');
    } finally {
      setBusy(false);
    }
  }

  function unpair() {
    Alert.alert('Unpair this device?', 'It stops sending to your account. To use it again, pair it again from the device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair', style: 'destructive', onPress: async () => {
          try { await guard(() => api.unpairDevice(id)); router.replace('/'); }
          catch (e) { setError(e instanceof Error ? e.message : 'Could not unpair.'); }
        },
      },
    ]);
  }

  const temp = roomTemperature(latest);
  const status = roomStatus(latest, issues);
  const forecast = forecastText(issues);
  const sensorIssues = issues.filter(i => i.kind === 'SENSOR_FAULT');
  const roomIssues = issues.filter(i => i.kind !== 'SENSOR_FAULT');

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Stack.Screen
        options={{
          title: device?.name || id,
          headerRight: () => (
            <Pressable onPress={() => { setName(device?.name ?? ''); setEditing(e => !e); }} hitSlop={10}>
              <Text style={{ color: colors.accent, fontSize: 16 }}>{editing ? 'Cancel' : 'Rename'}</Text>
            </Pressable>
          ),
        }}
      />

      {editing && (
        <Card>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Living room" autoCapitalize="words" maxLength={100} autoFocus />
          <Button title="Save" onPress={rename} busy={busy} />
        </Card>
      )}

      <Card>
        <Text style={[styles.muted, { letterSpacing: 2 }]}>ROOM TEMPERATURE</Text>
        <Text style={{ fontSize: 72, fontWeight: '300', marginTop: 4 }}>
          {temp == null ? '--.-' : temp.toFixed(1)}<Text style={{ fontSize: 24, color: colors.text2 }}>°C</Text>
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <Text style={styles.muted}>{latest ? (latest.mode === 'demo' ? 'Demo room' : `${device?.device_id ?? id}`) : 'No readings yet'}</Text>
          <Status label={status.label} color={status.color} />
        </View>
        {forecast && (
          <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line }}>
            <Text style={{ fontSize: 15, fontWeight: '500' }}>{forecast}</Text>
            {roomIssues[0]?.recommendations?.[0] && <Text style={[styles.sub, { marginTop: 4 }]}>{roomIssues[0].recommendations[0]}</Text>}
          </View>
        )}
        {!latest && (
          <Text style={[styles.sub, { marginTop: 12 }]}>{`Waiting for ${device?.name || id} to send readings. Check that it's powered and on Wi-Fi.`}</Text>
        )}
      </Card>

      {roomIssues.map(issue => (
        <Card key={`${issue.kind}-${issue.sensor ?? ''}`} style={{ borderColor: SEVERITY_COLOR[issue.severity] }}>
          <Text style={{ color: SEVERITY_COLOR[issue.severity], fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }}>{kindLabel(issue.kind).toUpperCase()}</Text>
          <Text style={{ fontSize: 15, marginTop: 6, lineHeight: 21 }}>{issue.message}</Text>
          {issue.recommendations?.[0] && (
            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
              <Text style={[styles.muted, { fontSize: 11, letterSpacing: 1.5 }]}>WHAT TO DO</Text>
              <Text style={{ fontSize: 15, marginTop: 3 }}>{issue.recommendations[0]}</Text>
            </View>
          )}
        </Card>
      ))}

      <Text style={[styles.muted, { letterSpacing: 2, marginTop: 6 }]}>SENSORS</Text>
      <Card style={{ paddingVertical: 4 }}>
        {SENSORS.map(({ key, label }, i) => {
          const reading = latest?.sensors[key];
          const ok = reading?.status === 'ok' && reading.temp != null;
          const fault = sensorIssues.find(f => f.sensor === key);
          return (
            <View key={key} style={{ paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 16 }}>{label}</Text>
                <Text style={{ color: !latest ? colors.text3 : ok ? colors.text : colors.crit, fontSize: ok ? 20 : 15, fontWeight: ok ? '300' : '500' }}>
                  {!latest ? '—' : ok ? `${reading!.temp!.toFixed(1)}°` : 'No signal'}
                </Text>
              </View>
              {latest && !ok && (
                <Text style={[styles.muted, { marginTop: 4 }]}>
                  {STATUS_TEXT[reading?.status ?? 'missing'] ?? reading?.status}{fault?.recommendations?.[0] ? ` · ${fault.recommendations[0]}` : ''}
                </Text>
              )}
            </View>
          );
        })}
      </Card>

      <Message text={error} error />
      <Button title="Unpair device" kind="danger" onPress={unpair} />
    </ScrollView>
  );
}
