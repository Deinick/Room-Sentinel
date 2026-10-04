// Account settings: who is signed in, change password, sign out.
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView } from 'react-native';

import { SignedIn } from '@/components/Gate';
import { Text } from '@/components/Text';
import { Button, Card, Field, Message, styles } from '@/components/ui';
import { ApiError, PASSWORD_RULE, validPassword } from '@/lib/api';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

export default function SettingsScreen() {
  return <SignedIn><Settings /></SignedIn>;
}

function Settings() {
  const { api, session, signOut } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function changePassword() {
    setError('');
    setMessage('');
    if (!current) return setError('Enter your current password.');
    if (!validPassword(next)) return setError(`New password must be ${PASSWORD_RULE}`);
    if (next !== again) return setError('The new passwords do not match.');
    if (next === current) return setError('Choose a different password from your current one.');
    setBusy(true);
    try {
      // the current password is checked by signing in with it
      let verified: string;
      try { verified = await api.signIn(session!.email, current); }
      catch (e) { throw e instanceof ApiError && (e.status === 401 || e.status === 400) ? new Error('The current password is incorrect.') : e; }
      await api.changePassword(verified, next);
      setMessage('Password updated. Sign in again with your new password.');
      setTimeout(signOut, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={[styles.muted, { letterSpacing: 2 }]}>SIGNED IN AS</Text>
          <Text style={{ fontSize: 17, marginTop: 6 }}>{session?.email}</Text>
          <Text style={[styles.muted, { marginTop: 4 }]}>{session?.server.replace(/^https?:\/\//, '')}</Text>
        </Card>

        <Card>
          <Text style={{ fontSize: 17, fontWeight: '500' }}>Change password</Text>
          <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" maxLength={32} />
          <Field label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" maxLength={32} placeholder="8–32 characters, a letter and a number" />
          <Field label="Confirm new password" value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" maxLength={32} />
          <Message text={message} />
          <Message text={error} error />
          <Button title="Change password" kind="ghost" onPress={changePassword} busy={busy} />
        </Card>

        <Pressable onPress={signOut} hitSlop={10} style={{ alignItems: 'center', paddingVertical: 14 }} accessibilityRole="button">
          <Text style={{ color: colors.crit, fontSize: 16, fontWeight: '500' }}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
