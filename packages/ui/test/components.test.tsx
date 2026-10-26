import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  Dialog,
  Drawer,
  EmptyState,
  EquipmentCombobox,
  IconButton,
  Input,
  KpiCounter,
  PinPad,
  QrCode,
  QuantityStepper,
  StatusCapsule,
  StockHealthBadge,
  TabPanel,
  Tabs,
  Table,
  TBody,
  Td,
  Th,
  THead,
  ToastProvider,
  Tr,
  useToast,
} from '../src';
import { seriousViolations } from './axe';

const items = [
  { id: 'a', name: 'Cisco 2911 Router', code: 'RT-2911', categoryName: 'Routers', available: 4, health: 'OK' as const },
  {
    id: 'b',
    name: 'Cisco 4321 Router',
    code: 'RT-4321',
    categoryName: 'Routers',
    available: 0,
    health: 'OUT' as const,
  },
  {
    id: 'c',
    name: 'Catalyst 2960 Switch',
    code: 'SW-2960',
    categoryName: 'Switches',
    available: 1,
    health: 'LOW' as const,
  },
];

describe('primitives', () => {
  it('Button: busy state disables and announces', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Sign In</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} loading>
        Sign In
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Sign In' });
    expect(b).toHaveProperty('disabled', true);
    expect(b.getAttribute('aria-busy')).toBe('true');
  });

  it('IconButton always has an accessible name', () => {
    render(<IconButton label="Close panel" icon={<svg />} />);
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeTruthy();
  });

  it('Input wires label, hint and problem+json error', () => {
    const { rerender } = render(<Input label="Matricule" hint="As printed on your card" />);
    const input = screen.getByLabelText('Matricule');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe(
      'As printed on your card',
    );
    rerender(<Input label="Matricule" error="Unknown matricule" />);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Unknown matricule');
  });

  it('stock health is shown with an icon and a label, never colour alone', () => {
    render(
      <StockHealthBadge health="LOW" available={2} labels={{ OK: 'Disponible', LOW: 'Faible', OUT: 'Rupture' }} />,
    );
    expect(screen.getByText('Faible')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(document.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it('StatusCapsule is a polite live region', () => {
    render(<StatusCapsule tone="offline">Offline — loans will sync</StatusCapsule>);
    const s = screen.getByRole('status');
    expect(s.getAttribute('aria-live')).toBe('polite');
    expect(s.textContent).toContain('Offline');
  });

  it('QuantityStepper clamps to the live availability and supports the keyboard', () => {
    function Harness() {
      const [v, setV] = useState(1);
      return <QuantityStepper value={v} onChange={setV} max={3} label="Quantity" />;
    }
    render(<Harness />);
    const spin = screen.getByRole('spinbutton', { name: 'Quantity' });
    fireEvent.keyDown(spin, { key: 'ArrowUp' });
    fireEvent.keyDown(spin, { key: 'ArrowUp' });
    fireEvent.keyDown(spin, { key: 'ArrowUp' });
    expect(spin.getAttribute('aria-valuenow')).toBe('3');
    expect(screen.getByRole('button', { name: 'Increase' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(spin, { key: 'Home' });
    expect(spin.getAttribute('aria-valuenow')).toBe('1');
  });

  it('PinPad submits from on-screen keys or the keyboard, only at the minimum length', async () => {
    const onSubmit = vi.fn();
    render(<PinPad label="Enter your PIN" onSubmit={onSubmit} />);
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    for (const d of ['4', '8', '2']) await userEvent.click(screen.getByRole('button', { name: d }));
    expect(confirm).toHaveProperty('disabled', true);
    const group = screen.getByRole('group', { name: 'Enter your PIN' });
    fireEvent.keyDown(group, { key: '9' });
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('4829');
  });

  it('KpiCounter settles on its value', async () => {
    render(<KpiCounter label="Items out" value={12} />);
    await vi.waitFor(() => expect(screen.getByText('12')).toBeTruthy(), { timeout: 2000 });
  });
});

describe('EquipmentCombobox (kiosk dropdown)', () => {
  it('groups by category, filters by name or code, and disables items at 0', async () => {
    const onSelect = vi.fn();
    render(<EquipmentCombobox items={items} onSelect={onSelect} label="Choose equipment" />);
    expect(screen.getByText('Routers')).toBeTruthy();
    expect(screen.getByText('Switches')).toBeTruthy();
    const out = screen.getByText('Cisco 4321 Router').closest('[cmdk-item]')!;
    expect(out.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(out);
    expect(onSelect).not.toHaveBeenCalled();

    await userEvent.type(screen.getByRole('combobox', { name: 'Choose equipment' }), 'SW-29');
    expect(screen.queryByText('Cisco 2911 Router')).toBeNull();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }));
  });

  it('has no serious axe violations', async () => {
    const { container } = render(
      <EquipmentCombobox items={items} onSelect={() => undefined} label="Choose equipment" />,
    );
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('overlays & feedback', () => {
  it('Dialog is a labelled modal that closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="Force return"
        description="Record a return on behalf of a student"
      >
        <Input label="Reason" />
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Force return' });
    expect(dialog).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(await seriousViolations(document.body)).toEqual([]);
  });

  it('Drawer traps focus inside', async () => {
    render(
      <>
        <button type="button">Outside</button>
        <Drawer open onOpenChange={() => undefined} title="Adjust stock">
          <Input label="Delta" />
        </Drawer>
      </>,
    );
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('Toast offers Undo and runs it once', async () => {
    const onUndo = vi.fn();
    function Harness() {
      const toast = useToast();
      return (
        <Button
          onClick={() =>
            toast.show({ title: 'Stock adjusted', tone: 'success', action: { label: 'Undo', onAction: onUndo } })
          }
        >
          Adjust
        </Button>
      );
    }
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('Tabs, Table and EmptyState are accessible', async () => {
    const { container } = render(
      <div>
        <Tabs
          value="open"
          onValueChange={() => undefined}
          label="Loan filter"
          items={[
            { value: 'open', label: 'Open', count: 3 },
            { value: 'overdue', label: 'Overdue', count: 1 },
          ]}
        >
          <TabPanel value="open">Open loans</TabPanel>
          <TabPanel value="overdue">Overdue loans</TabPanel>
        </Tabs>
        <Table caption="Loans">
          <THead>
            <Tr>
              <Th>Student</Th>
              <Th numeric>Qty</Th>
            </Tr>
          </THead>
          <TBody>
            <Tr>
              <Td>Awa Ngo Bassa</Td>
              <Td numeric>2</Td>
            </Tr>
          </TBody>
        </Table>
        <EmptyState
          title="No equipment yet"
          description="Add the first item to start lending."
          action={<Button>Add first equipment</Button>}
        />
      </div>,
    );
    expect(screen.getByRole('tab', { name: /Open/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('table', { name: 'Loans' })).toBeTruthy();
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('Toast auto-dismisses', async () => {
    vi.useFakeTimers();
    function Harness() {
      const toast = useToast();
      return <button onClick={() => toast.show({ title: 'Saved', durationMs: 1000 })}>Save</button>;
    }
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByText('Saved')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    vi.useRealTimers();
    await vi.waitFor(() => expect(screen.queryByText('Saved')).toBeNull());
  });
});

describe('QrCode', () => {
  it('renders a labelled SVG whose module grid changes with the value and error-correction level', async () => {
    const { container, rerender } = render(<QrCode value="otpauth://totp/LabPass:a@b?secret=ABC" label="Scan me" />);
    const svg = screen.getByRole('img', { name: 'Scan me' });
    const first = container.querySelector('path')!.getAttribute('d');
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    expect(first).toMatch(/^M\d+ \d+h1v1h-1z/);
    rerender(<QrCode value="otpauth://totp/LabPass:a@b?secret=XYZ" label="Scan me" ecc="H" />);
    expect(container.querySelector('path')!.getAttribute('d')).not.toBe(first);
    expect(await seriousViolations(container)).toEqual([]);
  });
});
