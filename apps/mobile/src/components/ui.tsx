import { palette, radius } from '@labpass/design-tokens';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../lib/app-context';

/** Touch targets ≥ 44 px (DESIGN §3, mobile). Colours come from the shared tokens and follow the system theme. */
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const { theme } = useApp();
  const body = <View style={s.inner}>{children}</View>;
  return (
    <SafeAreaView style={[s.root, { backgroundColor: theme.bg }]}>
      {scroll ? <ScrollView contentContainerStyle={s.scroll}>{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const { theme } = useApp();
  return (
    <Text accessibilityRole="header" style={[s.title, { color: theme.text }]}>
      {children}
    </Text>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  const { theme } = useApp();
  return <Text style={[s.kicker, { color: theme.textMuted }]}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const { theme } = useApp();
  return <Text style={[s.body, { color: muted ? theme.textMuted : theme.text }, style]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { theme } = useApp();
  const bg =
    variant === 'primary'
      ? theme.text
      : variant === 'danger'
        ? palette.out[500]
        : variant === 'secondary'
          ? theme.surfaceRaised
          : 'transparent';
  const fg = variant === 'primary' ? theme.bg : variant === 'danger' ? '#fff' : theme.text;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, borderColor: theme.line, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'secondary' && s.btnBorder,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...rest }: TextInputProps & { label: string; error?: string | null }) {
  const { theme } = useApp();
  return (
    <View style={s.field}>
      <Text style={[s.label, { color: theme.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textMuted}
        style={[
          s.input,
          { color: theme.text, borderColor: error ? palette.out[500] : theme.line, backgroundColor: theme.surface },
        ]}
        {...rest}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[s.error, { color: theme.outText }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { theme } = useApp();
  return (
    <View style={[s.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }, style]}>{children}</View>
  );
}

export function Capsule({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'low' | 'out' | 'signal';
}) {
  const { theme } = useApp();
  const color = {
    neutral: theme.textMuted,
    ok: theme.okText,
    low: theme.lowText,
    out: theme.outText,
    signal: theme.accent,
  }[tone];
  return (
    <View accessibilityRole="text" style={[s.capsule, { borderColor: color }]}>
      <Text style={[s.capsuleText, { color }]}>{children}</Text>
    </View>
  );
}

export function Notice({ children, tone = 'out' }: { children: ReactNode; tone?: 'out' | 'low' | 'ok' }) {
  const { theme } = useApp();
  const color = { out: theme.outText, low: theme.lowText, ok: theme.okText }[tone];
  return (
    <Text accessibilityLiveRegion="assertive" style={[s.notice, { color, borderColor: color }]}>
      {children}
    </Text>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
  inner: { flex: 1, padding: 24, gap: 16, width: '100%', maxWidth: 520, alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.6 },
  kicker: { fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  body: { fontSize: 16, lineHeight: 23 },
  btn: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  btnBorder: { borderWidth: 1 },
  btnText: { fontSize: 16, fontWeight: '700' },
  field: { gap: 6 },
  label: { fontSize: 13 },
  input: { minHeight: 52, borderWidth: 1, borderRadius: radius.field, paddingHorizontal: 16, fontSize: 17 },
  error: { fontSize: 13 },
  card: { borderWidth: 1, borderRadius: radius.card, padding: 20, gap: 10 },
  capsule: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  capsuleText: { fontSize: 13, fontWeight: '600' },
  notice: { borderWidth: 1, borderRadius: radius.field, padding: 12, fontSize: 15 },
});
