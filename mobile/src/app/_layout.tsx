import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Particles } from '@/components/Particles';
import { SessionProvider } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';

export default function RootLayout() {
  const [loaded] = useFonts({
    [fonts.light]: require('../../assets/fonts/Ranade-Light.ttf'),
    [fonts.regular]: require('../../assets/fonts/Ranade-Regular.ttf'),
    [fonts.medium]: require('../../assets/fonts/Ranade-Medium.ttf'),
    [fonts.bold]: require('../../assets/fonts/Ranade-Bold.ttf'),
  });
  if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="light" />
        {/* Navigation paints its own (light) background behind screens unless told otherwise:
            dark theme, transparent background, so our navy and the particles show through. */}
        <ThemeProvider value={{ ...DarkTheme, colors: { ...DarkTheme.colors, background: 'transparent', card: colors.bg, text: colors.text, border: 'transparent', primary: colors.accent } }}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <Particles />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              headerTitleStyle: { fontFamily: fonts.medium },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: 'transparent' }, // let the particles show through
            }}>
            <Stack.Screen name="index" options={{ title: 'Your devices' }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="add" options={{ title: 'Add a device' }} />
            <Stack.Screen name="pair/[code]" options={{ title: 'New device' }} />
            <Stack.Screen name="device/[id]" options={{ title: '' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          </Stack>
        </View>
        </ThemeProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
