import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider } from '@/lib/session';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '600' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
          }}>
          <Stack.Screen name="index" options={{ title: 'Your devices' }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="add" options={{ title: 'Add a device' }} />
          <Stack.Screen name="pair/[code]" options={{ title: 'New device' }} />
          <Stack.Screen name="device/[id]" options={{ title: '' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
