// Screens that need an account: wait for the saved session, send everyone else to sign in.
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

export function SignedIn({ children }: { children: ReactNode }) {
  const { ready, session } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;
  return <>{children}</>;
}
