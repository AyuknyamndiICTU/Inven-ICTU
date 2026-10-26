'use client';

import {
  AccessPointIcon,
  BlurPush,
  Button,
  ConsoleCableIcon,
  DepthType,
  Dialog,
  Drawer,
  EmptyState,
  EquipmentCombobox,
  ErrorState,
  FirewallIcon,
  HorizonGlow,
  IconButton,
  Input,
  KpiCounter,
  LiveTicker,
  PatchCableIcon,
  PinPad,
  QrCode,
  QuantityStepper,
  ReaderEye,
  RingLanding,
  RouterIcon,
  SfpIcon,
  Skeleton,
  StatusCapsule,
  StockHealthBadge,
  StockSkyline,
  SwitchIcon,
  TabPanel,
  Tabs,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
  type ReaderEyeState,
} from '@labpass/ui';
import { Plus, Settings } from 'lucide-react';
import { useState, type ReactNode } from 'react';

const ITEMS = [
  { id: '1', name: 'Cisco 2911 Router', code: 'RT-2911', categoryName: 'Routers', available: 4, health: 'OK' as const },
  {
    id: '2',
    name: 'Cisco 4321 Router',
    code: 'RT-4321',
    categoryName: 'Routers',
    available: 0,
    health: 'OUT' as const,
  },
  {
    id: '3',
    name: 'Catalyst 2960 Switch',
    code: 'SW-2960',
    categoryName: 'Switches',
    available: 1,
    health: 'LOW' as const,
  },
  {
    id: '4',
    name: 'Console cable (RJ45–USB)',
    code: 'CB-CON',
    categoryName: 'Cables',
    available: 18,
    health: 'OK' as const,
  },
];

function Section({ title, children, dark }: { title: string; children: ReactNode; dark?: boolean }) {
  return (
    <section
      className={`relative overflow-hidden rounded-card border border-line p-6 ${dark ? 'theme-dark bg-ink-950 text-text' : 'bg-surface-raised'}`}
    >
      <h2 className="mb-4 font-mono text-xs uppercase tracking-caps text-text-muted">{title}</h2>
      {children}
    </section>
  );
}

/** Living gallery of @labpass/ui (S08a): every component and state, light and dark, for rendered review. */
export default function KitPage() {
  const toast = useToast();
  const [qty, setQty] = useState(2);
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState('a');
  const [stage, setStage] = useState(0);
  const [eye, setEye] = useState<ReaderEyeState>('idle');
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-6 py-10">
      <header>
        <p className="font-mono text-xs text-text-muted">@labpass/ui</p>
        <h1 className="text-4xl font-bold tracking-display">UI kit</h1>
      </header>
      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" icon={<Plus size={14} />}>
            Small
          </Button>
          <Button size="lg">Large</Button>
          <IconButton label="Settings" icon={<Settings size={18} />} />
        </div>
      </Section>
      <Section title="Fields, badges, capsules, stepper">
        <div className="grid gap-4 md:grid-cols-3">
          <Input label="Matricule" mono hint="As printed on the card" placeholder="ICTU20240001" />
          <Input label="Reason" error="Enter at least 3 characters." defaultValue="ok" />
          <div className="grid content-start gap-3">
            <div className="flex flex-wrap gap-2">
              <StockHealthBadge health="OK" available={12} />
              <StockHealthBadge health="LOW" available={2} />
              <StockHealthBadge health="OUT" available={0} />
            </div>
            <QuantityStepper label="Quantity" value={qty} max={4} onChange={setQty} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusCapsule>Neutral</StatusCapsule>
          <StatusCapsule tone="signal" busy>
            Reading…
          </StatusCapsule>
          <StatusCapsule tone="ok">Borrowed</StatusCapsule>
          <StatusCapsule tone="low">Due soon</StatusCapsule>
          <StatusCapsule tone="out">Card not recognised</StatusCapsule>
          <StatusCapsule tone="offline">Offline — loans will sync</StatusCapsule>
        </div>
      </Section>
      <Section title="Equipment combobox (kiosk dropdown)">
        <div className="max-w-xl">
          <EquipmentCombobox
            items={ITEMS}
            label="Choose equipment"
            onSelect={(i) => toast.show({ title: `Selected ${i.name}`, tone: 'success' })}
          />
        </div>
      </Section>
      <Section title="Overlays & feedback">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Open dialog
          </Button>
          <Button variant="secondary" onClick={() => setDrawer(true)}>
            Open drawer
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.show({
                title: 'Stock updated: Router 2911',
                description: 'Total 8 · Available 6',
                tone: 'success',
                action: { label: 'Undo', onAction: () => toast.show({ title: 'Change undone' }) },
              })
            }
          >
            Toast with Undo
          </Button>
          <Button variant="secondary" onClick={() => toast.show({ title: 'Delivery failed', tone: 'error' })}>
            Error toast
          </Button>
        </div>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="Record return"
          description="Use this when equipment comes back without the student at the kiosk."
          footer={<Button onClick={() => setDialog(false)}>Confirm</Button>}
        >
          <Input label="Reason" />
        </Dialog>
        <Drawer
          open={drawer}
          onOpenChange={setDrawer}
          title="Adjust stock"
          footer={<Button onClick={() => setDrawer(false)}>Save</Button>}
        >
          <Input label="Change" type="number" defaultValue={1} />
        </Drawer>
      </Section>
      <Section title="Data & states">
        <div className="grid gap-4 md:grid-cols-4">
          <KpiCounter label="Items out" value={23} />
          <KpiCounter label="Overdue" value={2} tone="out" hint="9 open loans" />
          <KpiCounter label="Low stock" value={3} tone="low" />
          <KpiCounter label="Students today" value={41} />
        </div>
        <div className="mt-4">
          <Tabs
            value={tab}
            onValueChange={setTab}
            label="Demo tabs"
            items={[
              { value: 'a', label: 'Open', count: 9 },
              { value: 'b', label: 'Overdue', count: 2 },
            ]}
          >
            <TabPanel value="a" className="mt-3">
              <Table caption="Loans">
                <THead>
                  <Tr>
                    <Th>Student</Th>
                    <Th>Item</Th>
                    <Th numeric>Qty</Th>
                  </Tr>
                </THead>
                <TBody>
                  <Tr>
                    <Td>Awa Ngo Bassa</Td>
                    <Td>Cisco 2911 Router</Td>
                    <Td numeric>2</Td>
                  </Tr>
                  <Tr>
                    <Td>Jean-Paul Kamga</Td>
                    <Td>Console cable</Td>
                    <Td numeric>1</Td>
                  </Tr>
                </TBody>
              </Table>
            </TabPanel>
            <TabPanel value="b" className="mt-3">
              <ErrorState title="This section could not load." detail="Network error" onRetry={() => undefined} />
            </TabPanel>
          </Tabs>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Skeleton width="60%" />
            <Skeleton width="100%" />
            <Skeleton width="80%" />
          </div>
          <EmptyState
            title="No equipment yet"
            description="Add the routers, switches and cables students can borrow."
            action={<Button>Add first equipment</Button>}
          />
        </div>
      </Section>
      <Section title="Stock skyline (A5)">
        <StockSkyline
          label="Stock by item"
          bars={ITEMS.concat(ITEMS.map((i) => ({ ...i, id: `${i.id}b` }))).map((i, n) => ({
            id: i.id,
            name: i.name,
            available: i.available,
            total: 4 + (n % 3) * 4,
            health: i.health,
          }))}
        />
      </Section>
      <Section title="Icons">
        <div className="flex flex-wrap gap-6 text-text-muted">
          {[RouterIcon, SwitchIcon, FirewallIcon, AccessPointIcon, PatchCableIcon, SfpIcon, ConsoleCableIcon].map(
            (I, n) => (
              <I key={n} width={72} height={48} />
            ),
          )}
        </div>
      </Section>
      <Section title="Kiosk theatre — CSS level (A1, A2, E1, A6, A9, A10, A11, A13)" dark>
        <HorizonGlow />
        <div className="relative grid items-center gap-6 md:grid-cols-[1fr_auto]">
          <div className="relative grid place-items-center py-8">
            <DepthType text="Cisco Lab" className="absolute [--lp-depth-size:96px]" />
            <ReaderEye state={eye} size={260} />
          </div>
          <div className="grid justify-items-center gap-3">
            <QrCode value="LPK1.demo-kiosk.demo-nonce" label="Kiosk challenge" size={140} />
            <div className="flex flex-wrap justify-center gap-2">
              {(['idle', 'reading', 'success', 'error', 'offline'] as const).map((s) => (
                <Button key={s} size="sm" variant={eye === s ? 'primary' : 'secondary'} onClick={() => setEye(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <div className="relative mt-4 grid items-center gap-6 md:grid-cols-[auto_1fr]">
          <RingLanding label="Borrowed" size={140} key={stage} />
          <div className="grid gap-3">
            <BlurPush stage={String(stage)} className="text-2xl font-bold">
              {stage % 2 ? 'Sign Out' : 'Sign In'}
            </BlurPush>
            <div>
              <Button size="sm" variant="secondary" onClick={() => setStage((s) => s + 1)}>
                Replay landing + blur push
              </Button>
            </div>
          </div>
        </div>
        <div className="relative mt-6">
          <LiveTicker
            label="Recent activity"
            items={[
              'Router 2911 returned · 2 min ago',
              'Console cable borrowed · 4 min ago',
              'Switch 2960 returned · 9 min ago',
            ].map((s) => ({ key: s, text: s }))}
          />
        </div>
        <div className="relative mt-6 flex flex-wrap items-end gap-8">
          <PinPad
            label="Enter your PIN"
            onSubmit={(p) => toast.show({ title: `PIN ${'•'.repeat(p.length)} submitted` })}
          />
          <div className="grid gap-3">
            <Button size="kiosk">Sign In</Button>
            <Button size="kiosk" variant="secondary">
              Sign Out
            </Button>
          </div>
        </div>
      </Section>
    </main>
  );
}
