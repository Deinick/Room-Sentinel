// Scan the QR code the device shows (Settings → Account Login), then confirm on the next screen.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { SignedIn } from '@/components/Gate';
import { Text } from '@/components/Text';
import { ADD_DEVICE_STEPS, Button, Card, Message, Steps, styles } from '@/components/ui';
import { pairingCode } from '@/lib/api';
import { colors, radius } from '@/lib/theme';

export default function AddScreen() {
  return <SignedIn><Add /></SignedIn>;
}

function Add() {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const handled = useRef(false); // the scanner fires many times per second

  function open(text: string) {
    const code = pairingCode(text);
    if (!code) {
      setError('That isn\'t a Room Sentinel pairing code. Open Settings → Account Login on the device and scan the code it shows.');
      setTimeout(() => { handled.current = false; }, 1500);
      return;
    }
    router.replace({ pathname: '/pair/[code]', params: { code } });
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Card>
        <Steps items={ADD_DEVICE_STEPS} />
      </Card>

      {!permission ? null : permission.granted ? (
        <View style={{ borderRadius: radius.card, overflow: 'hidden', aspectRatio: 1, borderWidth: 1, borderColor: colors.line }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (handled.current) return;
              handled.current = true;
              open(data);
            }}
          />
          <View pointerEvents="none" style={{ position: 'absolute', top: '18%', left: '18%', right: '18%', bottom: '18%', borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)', borderRadius: radius.card }} />
        </View>
      ) : (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '500' }}>Camera access</Text>
          <Text style={[styles.sub, { marginTop: 4 }]}>The camera is only used to read the QR code on your device.</Text>
          <Button title={permission.canAskAgain ? 'Allow camera' : 'Camera blocked: allow it in Settings'} onPress={requestPermission} disabled={!permission.canAskAgain} />
        </Card>
      )}

      <Message text={error} error />
    </ScrollView>
  );
}
