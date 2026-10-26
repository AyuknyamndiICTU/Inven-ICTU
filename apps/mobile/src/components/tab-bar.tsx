import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../lib/app-context';

const TABS = [
  { href: '/pass', key: 'mobile.pass' },
  { href: '/loans', key: 'mobile.myLoans' },
  { href: '/profile', key: 'mobile.profile' },
] as const;

/** Bottom navigation for the signed-in screens. */
export function TabBar() {
  const { t, theme } = useApp();
  const path = usePathname();
  return (
    <View accessibilityRole="tablist" style={[s.bar, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      {TABS.map((tab) => {
        const active = path === tab.href;
        return (
          <Pressable
            key={tab.href}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => router.replace(tab.href)}
            style={s.tab}
          >
            <Text
              style={[s.text, { color: active ? theme.accent : theme.textMuted, fontWeight: active ? '700' : '500' }]}
            >
              {t(tab.key)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1 },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14 },
});
