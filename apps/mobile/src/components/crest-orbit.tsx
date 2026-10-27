import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import CREST from '../../assets/brand/ictu-shield.png';

/**
 * ICT University crest spinning in 3D (perspective rotateY, front + back faces) inside an animated orbit:
 * a pulsing halo, two orbit rings with travelling sparks and a class of students circling the crest
 * (each student is drawn twice, behind and in front of the crest, cross-fading as they pass the sides).
 * Native-driver animations only, so it runs on the UI thread on Android. Stops with "reduce motion".
 */

const RATIO = 528 / 472;
const SAMPLES = 36;

type Pose = 'laptop' | 'cap' | 'book' | 'wave' | 'phone';
interface Look {
  skin: string;
  hair: string;
  top: string;
  trim: string;
  pose: Pose;
}
const CLASS: Look[] = [
  { skin: '#8D5524', hair: '#1B0F08', top: '#2B2390', trim: '#EBC37E', pose: 'laptop' },
  { skin: '#C68642', hair: '#2A1A10', top: '#E87D01', trim: '#05014D', pose: 'wave' },
  { skin: '#5C3A21', hair: '#0E0805', top: '#05014D', trim: '#E87D01', pose: 'cap' },
  { skin: '#E0AC69', hair: '#3B2416', top: '#4B3FC4', trim: '#F7A23B', pose: 'book' },
  { skin: '#3B2219', hair: '#0B0604', top: '#F7A23B', trim: '#05014D', pose: 'phone' },
  { skin: '#A0662F', hair: '#1A0F09', top: '#1E1878', trim: '#EBC37E', pose: 'laptop' },
  { skin: '#6B4226', hair: '#120A06', top: '#E87D01', trim: '#2B2390', pose: 'cap' },
  { skin: '#D19A62', hair: '#2E1B0F', top: '#2B2390', trim: '#F7A23B', pose: 'wave' },
];

function Student({ look, u }: { look: Look; u: number }) {
  const px = (n: number) => n * u;
  return (
    <View style={{ width: px(32), height: px(50), alignItems: 'center' }}>
      {look.pose === 'cap' && (
        <View style={{ position: 'absolute', top: px(1), zIndex: 3, alignItems: 'center' }}>
          <View style={{ width: px(20), height: px(5), backgroundColor: '#05014D', borderRadius: px(1) }} />
          <View style={{ width: px(10), height: px(3), backgroundColor: '#05014D' }} />
          <View
            style={{
              position: 'absolute',
              right: -px(1),
              top: px(2),
              width: px(2),
              height: px(7),
              backgroundColor: '#EBC37E',
            }}
          />
        </View>
      )}
      <View
        style={{ width: px(13), height: px(13), borderRadius: px(7), backgroundColor: look.skin, marginTop: px(3) }}
      >
        <View
          style={{
            height: px(5),
            borderTopLeftRadius: px(7),
            borderTopRightRadius: px(7),
            backgroundColor: look.hair,
          }}
        />
        <View style={[st.eyes, { marginTop: px(1.5), gap: px(4) }]}>
          <View style={[st.eye, { width: px(1.6), height: px(1.6) }]} />
          <View style={[st.eye, { width: px(1.6), height: px(1.6) }]} />
        </View>
      </View>
      <View
        style={{
          width: px(19),
          height: px(17),
          marginTop: px(1),
          borderTopLeftRadius: px(8),
          borderTopRightRadius: px(8),
          backgroundColor: look.top,
          overflow: 'hidden',
          justifyContent: 'flex-end',
        }}
      >
        <View style={{ height: px(2.5), backgroundColor: look.trim }} />
      </View>
      {look.pose === 'wave' && (
        <View
          style={{
            position: 'absolute',
            right: -px(1),
            top: px(10),
            width: px(4),
            height: px(12),
            borderRadius: px(2),
            backgroundColor: look.top,
            transform: [{ rotate: '-25deg' }],
          }}
        />
      )}
      {(look.pose === 'laptop' || look.pose === 'book' || look.pose === 'phone') && (
        <View
          style={{
            position: 'absolute',
            top: px(23),
            width: look.pose === 'phone' ? px(6) : px(17),
            height: look.pose === 'phone' ? px(10) : px(11),
            right: look.pose === 'phone' ? px(4) : undefined,
            borderRadius: px(1.5),
            backgroundColor: look.pose === 'book' ? '#E87D01' : '#cfd3dc',
            padding: px(1.2),
          }}
        >
          {look.pose !== 'book' && <View style={{ flex: 1, borderRadius: px(1), backgroundColor: '#7fe3ff' }} />}
        </View>
      )}
      <View style={[st.legs, { gap: px(2) }]}>
        <View style={{ width: px(4.5), height: px(12), borderRadius: px(2), backgroundColor: '#1a1740' }} />
        <View style={{ width: px(4.5), height: px(12), borderRadius: px(2), backgroundColor: '#1a1740' }} />
      </View>
    </View>
  );
}

function loop(value: Animated.Value, duration: number, easing = Easing.linear) {
  return Animated.loop(Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver: true }));
}

export function CrestOrbit({ size = 150, students = 8 }: { size?: number; students?: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const [still, setStill] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (still) return;
    const anims = [loop(spin, 16000), loop(orbit, 30000), loop(pulse, 5000, Easing.inOut(Easing.sin)), loop(bob, 1600)];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [still, spin, orbit, pulse, bob]);

  const W = size * 2.2;
  const H = size * 1.75;
  const crestH = size * RATIO;
  const R = size * 0.98;
  const r = size * 0.24;
  const cy = H * 0.48;
  const u = size / 150;
  const class_ = CLASS.slice(0, students);

  const input = useMemo(() => Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES), []);
  const paths = useMemo(
    () =>
      class_.map((_, i) => {
        const phase = (i / class_.length) * Math.PI * 2;
        const th = input.map((p) => p * Math.PI * 2 + phase);
        const depth = th.map((t) => Math.cos(t));
        return {
          x: orbit.interpolate({ inputRange: input, outputRange: th.map((t) => R * Math.sin(t)) }),
          y: orbit.interpolate({ inputRange: input, outputRange: depth.map((d) => r * d + size * 0.36) }),
          scale: orbit.interpolate({ inputRange: input, outputRange: depth.map((d) => 0.78 + 0.26 * d) }),
          front: orbit.interpolate({ inputRange: input, outputRange: depth.map((d) => (d > 0.05 ? 1 : 0)) }),
          back: orbit.interpolate({ inputRange: input, outputRange: depth.map((d) => (d > 0.05 ? 0 : 1)) }),
          hop: bob.interpolate({
            inputRange: input,
            outputRange: input.map((p) => -Math.abs(Math.sin(p * Math.PI * 2 + i * 0.8)) * 5 * u),
          }),
        };
      }),
    [class_, input, orbit, bob, R, r, size, u],
  );
  const sparks = useMemo(
    () =>
      [1.02, 0.72].map((k, j) => ({
        x: orbit.interpolate({
          inputRange: input,
          outputRange: input.map((p) => R * k * Math.cos((j ? -p * 5 : p * 3.3) * Math.PI * 2)),
        }),
        y: orbit.interpolate({
          inputRange: input,
          outputRange: input.map((p) => r * k * Math.sin((j ? -p * 5 : p * 3.3) * Math.PI * 2)),
        }),
      })),
    [input, orbit, R, r],
  );

  const rotateY = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rotateBack = spin.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '540deg'] });
  const haloScale = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.92, 1.08, 0.92] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.7, 1, 0.7] });
  const float = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -size * 0.05, 0] });

  const renderClass = (layer: 'front' | 'back') =>
    class_.map((look, i) => {
      const p = paths[i]!;
      return (
        <Animated.View
          key={`${layer}${i}`}
          pointerEvents="none"
          style={[
            st.abs,
            {
              left: W / 2 - 16 * u,
              top: cy - 25 * u,
              opacity: layer === 'front' ? p.front : p.back,
              transform: [{ translateX: p.x }, { translateY: p.y }, { translateY: p.hop }, { scale: p.scale }],
            },
          ]}
        >
          <Student look={look} u={u} />
        </Animated.View>
      );
    });

  const ring = (k: number, color: string) => (
    <View
      style={[
        st.abs,
        {
          left: W / 2 - R * k,
          top: cy + size * 0.36 - R * k,
          width: R * 2 * k,
          height: R * 2 * k,
          borderRadius: R * k,
          borderWidth: 1.5,
          borderColor: color,
          transform: [{ scaleY: r / R }],
        },
      ]}
    />
  );

  return (
    <View
      style={{ width: W, height: H, alignSelf: 'center' }}
      accessible
      accessibilityRole="image"
      accessibilityLabel="The ICT University"
    >
      <Animated.View
        style={[
          st.abs,
          {
            width: size * 1.7,
            height: size * 1.7,
            left: W / 2 - size * 0.85,
            top: cy - size * 0.85,
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
          },
        ]}
      >
        {[
          [1, 'rgba(43,35,144,0.10)'],
          [0.78, 'rgba(232,125,1,0.10)'],
          [0.56, 'rgba(232,125,1,0.14)'],
          [0.36, 'rgba(247,162,59,0.18)'],
        ].map(([k, color]) => (
          <View
            key={color as string}
            style={[
              st.abs,
              {
                width: size * 1.7 * (k as number),
                height: size * 1.7 * (k as number),
                borderRadius: size * (k as number),
                left: size * 0.85 * (1 - (k as number)),
                top: size * 0.85 * (1 - (k as number)),
                backgroundColor: color as string,
              },
            ]}
          />
        ))}
      </Animated.View>
      {ring(1.02, 'rgba(235,195,126,0.55)')}
      {ring(0.72, 'rgba(138,125,255,0.55)')}
      {renderClass('back')}
      <Animated.View
        style={[
          st.abs,
          { left: W / 2 - size / 2, top: cy - crestH / 2, width: size, height: crestH },
          { transform: [{ translateY: float }] },
        ]}
      >
        <Animated.Image
          source={CREST}
          resizeMode="contain"
          style={[st.face, { transform: [{ perspective: size * 6 }, { rotateY }] }]}
        />
        <Animated.Image
          source={CREST}
          resizeMode="contain"
          style={[st.face, { transform: [{ perspective: size * 6 }, { rotateY: rotateBack }] }]}
        />
      </Animated.View>
      {sparks.map((sp, i) => (
        <Animated.View
          key={i}
          style={[
            st.abs,
            st.spark,
            {
              left: W / 2 - 4,
              top: cy + size * 0.36 - 4,
              backgroundColor: i ? '#c9c2ff' : '#ffd79a',
              transform: [{ translateX: sp.x }, { translateY: sp.y }],
            },
          ]}
        />
      ))}
      {renderClass('front')}
    </View>
  );
}

const st = StyleSheet.create({
  abs: { position: 'absolute' },
  face: { position: 'absolute', width: '100%', height: '100%', backfaceVisibility: 'hidden' },
  spark: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowColor: '#f7a23b',
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 6,
  },
  eyes: { flexDirection: 'row', justifyContent: 'center' },
  eye: { borderRadius: 2, backgroundColor: '#120a06' },
  legs: { flexDirection: 'row', marginTop: -1 },
});
