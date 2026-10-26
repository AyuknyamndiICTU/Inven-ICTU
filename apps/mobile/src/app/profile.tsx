import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { TabBar } from '../components/tab-bar';
import { Body, Button, Card, Field, Notice, Screen, Title } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useApp } from '../lib/app-context';
import { enableWebPush, webPushSupported } from '../lib/push';
import { clearCachedApi, prefsStore } from '../lib/storage';

/** Profile: language, matricule PIN, lost phone → revoke, sign out. */
export default function Profile() {
  const { t, api, locale, setLocale, session, credential, theme } = useApp();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'out'; text: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote({ tone: 'out', text: errorMessage(e, t('mobile.error')) });
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    credential.forget();
    await prefsStore.set('me', null);
    await clearCachedApi();
    await session.clear();
    router.replace('/welcome');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Screen>
        <Title>{t('mobile.profile')}</Title>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}

        <Card>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 17 }}>{t('mobile.language')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['en', 'fr'] as const).map((l) => (
              <Pressable
                key={l}
                accessibilityRole="radio"
                accessibilityState={{ checked: locale === l }}
                onPress={() => setLocale(l)}
                style={{
                  minHeight: 44,
                  paddingHorizontal: 20,
                  borderRadius: 999,
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: locale === l ? theme.accent : theme.line,
                }}
              >
                <Text style={{ color: locale === l ? theme.accent : theme.text, fontWeight: '600' }}>
                  {l === 'en' ? 'English' : 'Français'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 17 }}>{t('mobile.pinTitle')}</Text>
          <Body muted>{t('mobile.pinHint')}</Body>
          <Field
            label={t('mobile.pinTitle')}
            value={pin}
            onChangeText={(x) => setPin(x.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            secureTextEntry
          />
          <Button
            label={t('mobile.savePin')}
            variant="secondary"
            disabled={pin.length < 4}
            loading={busy === 'pin'}
            onPress={() =>
              void run('pin', async () => {
                await api.me('me.pin', { body: { pin } });
                setPin('');
                setNote({ tone: 'ok', text: t('mobile.pinSet') });
              })
            }
          />
        </Card>

        {webPushSupported() && (
          <Button
            label={t('mobile.notifications')}
            variant="secondary"
            loading={busy === 'push'}
            onPress={() =>
              void run('push', async () => {
                const ok = await enableWebPush(api);
                setNote(
                  ok ? { tone: 'ok', text: t('mobile.notificationsOn') } : { tone: 'out', text: t('mobile.error') },
                );
              })
            }
          />
        )}

        <Card>
          {confirmRevoke ? (
            <>
              <Body>{t('mobile.revokeConfirm')}</Body>
              <Button
                label={t('mobile.revoke')}
                variant="danger"
                loading={busy === 'revoke'}
                onPress={() =>
                  void run('revoke', async () => {
                    await api.me('me.revoke');
                    await leave();
                  })
                }
              />
            </>
          ) : (
            <Button label={t('mobile.lostPhone')} variant="ghost" onPress={() => setConfirmRevoke(true)} />
          )}
        </Card>

        <Button
          label={t('mobile.signOut')}
          variant="secondary"
          loading={busy === 'out'}
          onPress={() =>
            void run('out', async () => {
              await api.me('studentAuth.logout').catch(() => undefined);
              await leave();
            })
          }
        />
      </Screen>
      <TabBar />
    </View>
  );
}
