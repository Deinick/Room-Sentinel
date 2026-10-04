// Sign in, or create an account. Same rules and messages as the website.
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { Button, Card, Eyebrow, Field, Message, styles } from '@/components/ui';
import { DEFAULT_API, PASSWORD_RULE, validEmail, validPassword } from '@/lib/api';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

export default function Login() {
  const { ready, session, signIn, register, server, setServer } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showServer, setShowServer] = useState(false);

  if (ready && session) return <Redirect href="/" />;
  const registering = mode === 'register';

  async function submit() {
    const address = email.trim().toLowerCase();
    setError('');
    if (!validEmail(address)) return setError('Enter a valid email address.');
    if (!validPassword(password)) return setError(`Password must be ${PASSWORD_RULE}`);
    if (registering && password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    setNotice(registering ? 'Creating your account…' : 'Signing in… (the server may take a moment to wake up)');
    try {
      if (registering) {
        await register(address, password);
        setPassword('');
        setConfirm('');
        setMode('login');
        setNotice('Account created. Sign in with your email and password.');
      } else {
        await signIn(address, password); // the session change redirects to the devices
      }
    } catch (e) {
      setNotice('');
      setError(e instanceof Error ? e.message : 'Could not complete the request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 22, paddingTop: 40, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: '#6aa3dd', alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: '#fff' }} />
            </View>
            <View>
              <Text style={{ fontWeight: '700', fontSize: 16 }}>Room Sentinel</Text>
              <Text style={styles.muted}>Thermal guard for real rooms</Text>
            </View>
          </View>

          <Eyebrow>Your room, at a glance</Eyebrow>
          <Text style={styles.h1}>{registering ? 'Create your account' : 'Welcome back'}</Text>
          <Text style={styles.sub}>{registering ? 'One account for the app and the website.' : 'Sign in to see your devices.'}</Text>

          <Card style={{ marginTop: 22 }}>
            <Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="you@example.com" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={registering ? 'new-password' : 'current-password'} placeholder="8–32 characters, a letter and a number" maxLength={32} />
            {registering && <Field label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" placeholder="Enter your password again" maxLength={32} />}
            <Message text={notice} />
            <Message text={error} error />
            <Button title={registering ? 'Create account' : 'Sign in'} onPress={submit} busy={busy} />
          </Card>

          <Pressable onPress={() => { setMode(registering ? 'login' : 'register'); setError(''); setNotice(''); }} style={{ marginTop: 18, alignItems: 'center' }}>
            <Text style={{ color: colors.text2, fontSize: 15 }}>
              {registering ? 'Already have an account? ' : 'New to Room Sentinel? '}
              <Text style={{ color: colors.accent, fontWeight: '500' }}>{registering ? 'Sign in' : 'Create an account'}</Text>
            </Text>
          </Pressable>

          <Pressable onPress={() => setShowServer(s => !s)} style={{ marginTop: 26 }}>
            <Text style={styles.muted}>{showServer ? '▾' : '▸'} Server</Text>
          </Pressable>
          {showServer && (
            <Field label="API address" value={server} onChangeText={setServer} keyboardType="url" placeholder={DEFAULT_API} autoCorrect={false} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
