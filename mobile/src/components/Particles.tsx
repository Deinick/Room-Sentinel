// Barely visible particles drifting up behind every screen, almost the colour of the background.
import { useEffect, useMemo } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';

const COUNT = 16;
// a fixed pseudo-random value per particle (rendering must not call Math.random)
const rand = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

export function Particles() {
  const { width, height } = useWindowDimensions();
  const specs = useMemo(() => Array.from({ length: COUNT }, (_, i) => {
    const progress = new Animated.Value(0);
    return {
      x: rand(i, 1) * width,
      size: 2 + rand(i, 2) * 4,
      opacity: 0.04 + rand(i, 3) * 0.07,
      duration: 28000 + rand(i, 4) * 30000,
      drift: (rand(i, 5) - 0.5) * 40,
      progress,
      // spread them over the screen from the start: each one begins at a different point of its loop
      position: Animated.modulo(Animated.add(progress, i / COUNT), 1),
    };
  }), [width]);

  useEffect(() => {
    let loops: Animated.CompositeAnimation[] = [];
    AccessibilityInfo.isReduceMotionEnabled().then(still => {
      if (still) return;
      loops = specs.map(s => Animated.loop(
        Animated.timing(s.progress, { toValue: 1, duration: s.duration, easing: Easing.linear, useNativeDriver: true }),
      ));
      loops.forEach(l => l.start());
    });
    return () => loops.forEach(l => l.stop());
  }, [specs]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {specs.map((s, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', left: s.x, top: 0,
            width: s.size, height: s.size, borderRadius: s.size / 2,
            backgroundColor: '#bed2f0', opacity: s.opacity,
            transform: [
              { translateY: s.position.interpolate({ inputRange: [0, 1], outputRange: [height + 20, -20] }) },
              { translateX: s.position.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, s.drift, 0] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}
