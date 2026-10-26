'use client';

import type { AdminRole } from '@labpass/contracts/client';
import type { MessageKey } from '@labpass/i18n';
import { CapsuleNav, Dialog, IconButton, StatusCapsule, useToast } from '@labpass/ui';
import { Command } from 'cmdk';
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  FileClock,
  Inbox,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  Upload,
  Users,
  UserSquare2,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export const NAV: Array<{ href: string; key: MessageKey; role: AdminRole; icon: ReactNode; primary?: boolean }> = [
  { href: '/', key: 'admin.nav.dashboard', role: 'VIEWER', icon: <LayoutDashboard size={16} />, primary: true },
  { href: '/inventory', key: 'admin.nav.inventory', role: 'VIEWER', icon: <Boxes size={16} />, primary: true },
  { href: '/loans', key: 'admin.nav.loans', role: 'VIEWER', icon: <Activity size={16} />, primary: true },
  { href: '/students', key: 'admin.nav.students', role: 'VIEWER', icon: <UserSquare2 size={16} />, primary: true },
  { href: '/requests', key: 'admin.nav.requests', role: 'LAB_ASSISTANT', icon: <Inbox size={16} />, primary: true },
  { href: '/alerts', key: 'admin.nav.alerts', role: 'VIEWER', icon: <Bell size={16} />, primary: true },
  { href: '/import', key: 'admin.nav.import', role: 'LAB_ADMIN', icon: <Upload size={16} /> },
  { href: '/kiosks', key: 'admin.nav.kiosks', role: 'LAB_ASSISTANT', icon: <Monitor size={16} /> },
  { href: '/reports', key: 'admin.nav.reports', role: 'VIEWER', icon: <BarChart3 size={16} /> },
  { href: '/settings', key: 'admin.nav.settings', role: 'VIEWER', icon: <Settings size={16} /> },
  { href: '/users', key: 'admin.nav.users', role: 'SUPER_ADMIN', icon: <Users size={16} /> },
  { href: '/audit', key: 'admin.nav.audit', role: 'LAB_ADMIN', icon: <FileClock size={16} /> },
];

const NextLink = ({
  href,
  className,
  children,
  ...rest
}: {
  href: string;
  className?: string;
  'aria-current'?: 'page';
  children: ReactNode;
}) => (
  <Link href={href} className={className} {...rest}>
    {children}
  </Link>
);

function Palette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { can } = useSession();
  const router = useRouter();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.shell.paletteLabel')}
      closeLabel={t('admin.ui.close')}
      className="lp-palette"
    >
      <Command label={t('admin.shell.paletteLabel')} className="lp-combo" loop>
        <div className="lp-combo__search">
          <Search aria-hidden size={18} />
          <Command.Input autoFocus placeholder={t('admin.shell.palette')} aria-label={t('admin.shell.palette')} />
        </div>
        <Command.List className="lp-combo__list">
          <Command.Empty className="lp-combo__empty">{t('admin.ui.noResults')}</Command.Empty>
          {NAV.filter((n) => can(n.role)).map((n) => (
            <Command.Item
              key={n.href}
              value={t(n.key)}
              className="lp-combo__item !grid-cols-[auto_1fr]"
              onSelect={() => {
                onOpenChange(false);
                router.push(n.href);
              }}
            >
              <span className="text-text-muted">{n.icon}</span>
              <span className="lp-combo__name">{t(n.key)}</span>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </Dialog>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const { user, can, logout } = useSession();
  const { theme, toggle } = useTheme();
  const pathname = usePathname();
  const toast = useToast();
  const [palette, setPalette] = useState(false);
  const live = useRealtime({
    'credentialRequest.created': (p) => {
      if (p.decision === 'PENDING') toast.show({ title: t('admin.requests.newRequest'), tone: 'info' });
    },
    'alert.fired': (p) =>
      toast.show({
        title: p.severity === 'OUT' ? t('admin.alerts.outOfStock') : t('admin.alerts.lowStock'),
        description: p.equipmentName,
        tone: p.severity === 'OUT' ? 'error' : 'info',
      }),
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const items = NAV.filter((n) => n.primary && can(n.role)).map((n) => ({
    href: n.href,
    label: t(n.key),
    icon: n.icon,
  }));
  const more = NAV.filter((n) => !n.primary && can(n.role));
  return (
    <>
      <a href="#main" className="lp-skip">
        {t('admin.shell.skip')}
      </a>
      <CapsuleNav
        link={NextLink}
        activeHref={pathname}
        label={t('app.name')}
        items={items}
        brand={
          <Link href="/" className="flex items-center gap-2 no-underline">
            <span className="lp-brand-mark" aria-hidden />
            <span>LabPass</span>
          </Link>
        }
        actions={
          <>
            <IconButton
              label={t('admin.shell.openPalette')}
              icon={<Search size={18} />}
              size="sm"
              onClick={() => setPalette(true)}
            />
            <IconButton
              label={`${t('admin.shell.theme')}: ${theme === 'light' ? t('admin.shell.light') : t('admin.shell.dark')}`}
              icon={theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              size="sm"
              onClick={toggle}
            />
            <button
              type="button"
              className="lp-btn lp-btn--ghost lp-btn--sm font-mono"
              aria-label={`${t('common.language')}: ${locale === 'en' ? 'English' : 'Français'}`}
              onClick={() => setLocale(locale === 'en' ? 'fr' : 'en')}
            >
              {locale === 'en' ? 'FR' : 'EN'}
            </button>
            <IconButton
              label={t('admin.shell.signOut')}
              icon={<LogOut size={18} />}
              size="sm"
              onClick={() => void logout()}
            />
          </>
        }
      />
      <div className="mx-auto mt-3 flex w-[min(1280px,calc(100%-24px))] flex-wrap items-center justify-between gap-2 px-2 text-sm">
        <nav aria-label={t('admin.ui.details')} className="flex flex-wrap gap-1">
          {more.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`lp-subnav ${pathname.startsWith(n.href) ? 'is-active' : ''}`}
              aria-current={pathname.startsWith(n.href) ? 'page' : undefined}
            >
              {n.icon}
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-text-muted">
          <span>
            {user.name} · {t(`admin.roles.${user.role}`)}
          </span>
          <StatusCapsule tone={live ? 'ok' : 'neutral'}>
            {live ? t('admin.shell.live') : t('admin.shell.reconnecting')}
          </StatusCapsule>
        </div>
      </div>
      <main id="main" className="mx-auto w-[min(1280px,calc(100%-24px))] px-2 pb-16 pt-8">
        {children}
      </main>
      <Palette open={palette} onOpenChange={setPalette} />
    </>
  );
}
