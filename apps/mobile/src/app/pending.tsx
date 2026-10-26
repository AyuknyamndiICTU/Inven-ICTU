import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { Body, Button, Capsule, Notice, Screen, Title } from '../components/ui';
import { useApp } from '../lib/app-context';

/** PENDING → polls `/enroll/claim` until the lab team decides (F7 step 5). */
export default function Pending() {
  const { t, api, pending, setPending, session, setCredentialId, credential, theme } = useApp();
  const [rejected, setRejected] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await api.call('enroll.claim', {
          body: { sessionId: pending.sessionId, pollToken: pending.pollToken },
        });
        if (!alive) return;
        if (r.status === 'ACTIVE' && r.tokens) {
          credential.activate(pending.credentialId);
          await session.accept(r.tokens, pending.credentialId);
          setCredentialId(pending.credentialId);
          await setPending(null);
          router.replace('/pass');
        } else if (r.status === 'REJECTED') {
          setRejected(r.reason ?? '');
        }
      } catch {
        // Offline or transient: try again on the next tick.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pending, api, session, setCredentialId, setPending, credential]);

  if (rejected !== null) {
    return (
      <Screen>
        <Title>{t('mobile.rejected')}</Title>
        {rejected ? <Notice>{rejected}</Notice> : null}
        <Button
          label={t('mobile.tryAgain')}
          onPress={() => {
            credential.forget();
            void setPending(null).then(() => router.replace('/welcome'));
          }}
        />
      </Screen>
    );
  }
  return (
    <Screen>
      <Capsule tone="low">{t('mobile.pending')}</Capsule>
      <Title>{t('mobile.pending')}</Title>
      <Body muted>{t('mobile.pendingHint')}</Body>
      <ActivityIndicator color={theme.accent} />
    </Screen>
  );
}
