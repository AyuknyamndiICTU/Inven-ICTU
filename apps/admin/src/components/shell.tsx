'use client';

import type { AdminRole } from '@labpass/contracts/client';
import type { MessageKey } from '@labpass/i18n';
import { motionTokens, springs, tween, useSafeMotion } from '@labpass/motion/react';
import { Dialog, Drawer, IconButton, StatusCapsule, useToast } from '@labpass/ui';
import { Command } from 'cmdk';
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  CloudOff,
  FileClock,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  Upload,
  Users,
  UserSquare2,
} from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

type Group = 'overview' | 'operations' | 'admin';

export const NAV: Array<{ href: string; key: MessageKey; role: AdminRole; icon: ReactNode; group: Group }> = [
  { href: '/', key: 'admin.nav.dashboard', role: 'VIEWER', icon: <LayoutDashboard size={18} />, group: 'overview' },
  { href: '/inventory', key: 'admin.nav.inventory', role: 'VIEWER', icon: <Boxes size={18} />, group: 'overview' },
  { href: '/loans', key: 'admin.nav.loans', role: 'VIEWER', icon: <Activity size={18} />, group: 'overview' },
  { href: '/students', key: 'admin.nav.students', role: 'VIEWER', icon: <UserSquare2 size={18} />, group: 'overview' },
  {
    href: '/requests',
    key: 'admin.nav.requests',
    role: 'LAB_ASSISTANT',
    icon: <Inbox size={18} />,
    group: 'operations',
  },
  { href: '/alerts', key: 'admin.nav.alerts', role: 'VIEWER', icon: <Bell size={18} />, group: 'operations' },
  { href: '/kiosks', key: 'admin.nav.kiosks', role: 'LAB_ASSISTANT', icon: <Monitor size={18} />, group: 'operations' },
  {
    href: '/offline',
    key: 'admin.nav.offline',
    role: 'LAB_ASSISTANT',
    icon: <CloudOff size={18} />,
    group: 'operations',
  },
  { href: '/import', key: 'admin.nav.import', role: 'LAB_ADMIN', icon: <Upload size={18} />, group: 'admin' },
  { href: '/reports', key: 'admin.nav.reports', role: 'VIEWER', icon: <BarChart3 size={18} />, group: 'admin' },
  { href: '/settings', key: 'admin.nav.settings', role: 'VIEWER', icon: <Settings size={18} />, group: 'admin' },
  { href: '/users', key: 'admin.nav.users', role: 'SUPER_ADMIN', icon: <Users size={18} />, group: 'admin' },
  { href: '/audit', key: 'admin.nav.audit', role: 'LAB_ADMIN', icon: <FileClock size={18} />, group: 'admin' },
];

const GROUPS: Array<[Group, MessageKey]> = [
  ['overview', 'admin.shell.groupOverview'],
  ['operations', 'admin.shell.groupOperations'],
  ['admin', 'admin.shell.groupAdmin'],
];

const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

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

/** Grouped navigation. The glowing active pill slides between links (shared layout animation). */
function SideNav({ id, onNavigate, badge }: { id: string; onNavigate?: () => void; badge: number }) {
  const { t } = useI18n();
  const { can } = useSession();
  const pathname = usePathname();
  return (
    <>
      {GROUPS.map(([group, label]) => {
        const links = NAV.filter((n) => n.group === group && can(n.role));
        if (!links.length) return null;
        return (
          <div key={group} className="lp-nav__group">
            <p className="lp-nav__heading">{t(label)}</p>
            <ul className="grid gap-1">
              {links.map((n) => {
                const active = isActive(pathname, n.href);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      className={`lp-nav__link ${active ? 'is-active' : ''}`}
                      aria-current={active ? 'page' : undefined}
                      title={t(n.key)}
                      onClick={onNavigate}
                    >
                      {active && (
                        <motion.span layoutId={`${id}-active`} className="lp-nav__pill" transition={springs.snappy} />
                      )}
                      <span className="lp-nav__icon">{n.icon}</span>
                      <span className="lp-nav__text">{t(n.key)}</span>
                      {n.href === '/requests' && badge > 0 && <span className="lp-nav__badge">{badge}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const { user, can, logout } = useSession();
  const { theme, toggle } = useTheme();
  const pathname = usePathname();
  const toast = useToast();
  const [palette, setPalette] = useState(false);
  const [menu, setMenu] = useState(false);
  const enter = useSafeMotion(motionTokens.distance.md);
  const summary = useApi('dashboard.summary', undefined, { refetchInterval: 60_000 });
  const pending = can('LAB_ASSISTANT') ? (summary.data?.pendingCredentialRequests ?? 0) : 0;
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
  const s = summary.data;

  return (
    <div className="lp-admin">
      <div className="lp-aurora" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <a href="#main" className="lp-skip">
        {t('admin.shell.skip')}
      </a>

      <aside className="lp-side">
        <Link href="/" className="lp-side__brand" title="LabPass">
          <span className="lp-brand-mark" aria-hidden />
          <span className="lp-nav__text grid leading-tight">
            <span className="lp-side__name">LabPass</span>
            <span className="lp-side__sub">{t('app.lab')}</span>
          </span>
        </Link>
        <nav aria-label={t('app.name')} className="lp-side__nav">
          <SideNav id="side" badge={pending} />
        </nav>
        <div className="lp-side__foot">
          {s && (
            <Link href="/kiosks" className="lp-fleet" title={t('admin.dashboard.kioskFleet')}>
              <span className={`lp-fleet__dot ${s.kiosksOnline > 0 ? 'is-on' : ''}`} aria-hidden />
              <span className="lp-nav__text grid leading-tight">
                <span className="text-xs text-text-muted">{t('admin.dashboard.kioskFleet')}</span>
                <span className="font-semibold">
                  {s.kiosksOnline}/{s.kiosksTotal} {t('admin.dashboard.kiosks').toLowerCase()}
                </span>
              </span>
            </Link>
          )}
          <div className="lp-usercard">
            <span className="lp-avatar" aria-hidden>
              {initials(user.name)}
            </span>
            <span className="lp-nav__text grid min-w-0 leading-tight">
              <span className="truncate font-semibold">{user.name}</span>
              <span className="truncate text-xs text-text-muted">{t(`admin.roles.${user.role}`)}</span>
            </span>
            <IconButton
              label={t('admin.shell.signOut')}
              icon={<LogOut size={16} />}
              size="sm"
              className="lp-nav__text ml-auto"
              onClick={() => void logout()}
            />
          </div>
        </div>
      </aside>

      <div className="lp-col">
        <header className="lp-topbar">
          <IconButton
            label={t('admin.shell.menu')}
            icon={<Menu size={18} />}
            size="sm"
            className="lp-topbar__menu"
            onClick={() => setMenu(true)}
          />
          <button type="button" className="lp-search" onClick={() => setPalette(true)}>
            <Search size={16} aria-hidden />
            <span className="truncate">{t('admin.shell.palette')}</span>
            <kbd aria-hidden>Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="lp-topbar__live">
              <StatusCapsule tone={live ? 'ok' : 'neutral'}>
                {live ? t('admin.shell.live') : t('admin.shell.reconnecting')}
              </StatusCapsule>
            </span>
            {can('LAB_ASSISTANT') && (
              <Link
                href="/requests"
                className="lp-bell"
                aria-label={
                  pending
                    ? `${t('admin.shell.notifications')}: ${t('admin.shell.pendingRequests', { count: pending })}`
                    : t('admin.shell.notifications')
                }
              >
                <Bell size={18} aria-hidden />
                {pending > 0 && <span className="lp-bell__count">{pending}</span>}
              </Link>
            )}
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
            <span className="lp-avatar lp-avatar--sm" title={user.name} aria-hidden>
              {initials(user.name)}
            </span>
          </div>
        </header>
        <main id="main" className="lp-main">
          <motion.div
            key={pathname}
            initial={enter.initial}
            animate={enter.animate}
            transition={tween('slow', 'emphasized')}
          >
            {children}
          </motion.div>
        </main>
      </div>

      <Drawer
        open={menu}
        onOpenChange={setMenu}
        title="LabPass"
        closeLabel={t('admin.ui.close')}
        className="lp-navdrawer"
      >
        <nav aria-label={t('app.name')}>
          <SideNav id="drawer" badge={pending} onNavigate={() => setMenu(false)} />
        </nav>
        <button type="button" className="lp-btn lp-btn--secondary lp-btn--sm mt-6" onClick={() => void logout()}>
          <LogOut size={16} aria-hidden /> {t('admin.shell.signOut')}
        </button>
      </Drawer>
      <Palette open={palette} onOpenChange={setPalette} />
    </div>
  );
}
