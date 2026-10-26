import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { TabBar } from '../components/tab-bar';
import { Body, Capsule, Card, Notice, Screen, Title } from '../components/ui';
import { useApp } from '../lib/app-context';

function dueText(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CM' : 'en-GB', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** My loans with due status (DESIGN §5 Mobile). */
export default function Loans() {
  const { t, api, locale, theme } = useApp();
  const loans = useQuery({ queryKey: ['me', 'loans'], queryFn: () => api.me('me.loans'), refetchInterval: 60_000 });
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Screen>
        <Title>{t('mobile.myLoans')}</Title>
        {loans.isError && <Notice tone="low">{t('mobile.offline')}</Notice>}
        {loans.data && loans.data.length === 0 && <Body muted>{t('mobile.noLoans')}</Body>}
        {loans.data?.map((l) => (
          <Card key={l.loanId}>
            <Capsule tone={l.overdue ? 'out' : 'signal'}>
              {l.overdue ? t('mobile.overdue') : t('mobile.due', { time: dueText(l.dueAt, locale) })}
            </Capsule>
            {l.lines.map((ln) => (
              <Body key={ln.equipmentName}>
                {ln.equipmentName} ×{ln.outstanding}
              </Body>
            ))}
          </Card>
        ))}
      </Screen>
      <TabBar />
    </View>
  );
}
