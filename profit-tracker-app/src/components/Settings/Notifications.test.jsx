import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Notifications } from './Notifications';
import { deviceLabel } from '../../utils/pushDevice';

let config;
let settings;
const calls = { save: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), removeDevice: vi.fn(), test: vi.fn() };
const mutation = (fn) => ({ mutate: fn, mutateAsync: fn, isPending: false });

vi.mock('../../hooks/useApi', () => ({
  usePushConfig: () => ({ data: config, isLoading: false }),
  usePushSettings: () => ({ data: settings, isLoading: false }),
  usePushMutations: () => Object.fromEntries(Object.entries(calls).map(([name, fn]) => [name, mutation(fn)])),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-device';
const fakeSub = { endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: vi.fn() };
let existingSub;
const pushManager = { getSubscription: vi.fn(async () => existingSub), subscribe: vi.fn(async () => fakeSub) };
const registration = { pushManager };

function installPush({ permission = 'default', grant = 'granted' } = {}) {
  window.PushManager = function PushManager() {};
  window.Notification = { permission, requestPermission: vi.fn(async () => grant) };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration), getRegistration: vi.fn(async () => registration) },
  });
}

function removePush() {
  delete window.PushManager;
  delete window.Notification;
  delete navigator.serviceWorker;
}

beforeEach(() => {
  config = { enabled: true, public_key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' };
  settings = { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, digest_enabled: true, digest_time: '08:00', reminder_alerts: true, urgent_alerts: true, saved: false, devices: [] };
  existingSub = null;
  Object.values(calls).forEach((fn) => fn.mockReset());
  pushManager.subscribe.mockClear();
  installPush();
});
afterEach(() => {
  cleanup();
  removePush();
});

describe('Notifications settings', () => {
  it('says so when the server has no push keys', () => {
    config = { enabled: false, public_key: null };
    render(<Notifications />);
    expect(screen.getByText(/aren't set up on the server yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Turn on/ })).not.toBeInTheDocument();
  });

  it('walks an iPhone in Safari through Add to Home Screen', () => {
    removePush();
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1');
    render(<Notifications />);
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    ua.mockRestore();
  });

  it('explains when notifications are blocked', () => {
    installPush({ permission: 'denied' });
    render(<Notifications />);
    expect(screen.getByText(/blocked for this site/)).toBeInTheDocument();
  });

  it('turns this device on: asks permission, subscribes, saves it with the device and time zone', async () => {
    calls.subscribe.mockResolvedValue({});
    render(<Notifications />);
    fireEvent.click(screen.getByRole('button', { name: /Turn on notifications/ }));
    await waitFor(() => expect(calls.subscribe).toHaveBeenCalled());
    expect(window.Notification.requestPermission).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }));
    expect(calls.subscribe).toHaveBeenCalledWith({
      subscription: { endpoint: ENDPOINT, keys: { p256dh: 'p', auth: 'a' } },
      device: expect.any(String),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it('does not subscribe when permission is refused', async () => {
    installPush({ grant: 'denied' });
    render(<Notifications />);
    fireEvent.click(screen.getByRole('button', { name: /Turn on notifications/ }));
    await waitFor(() => expect(window.Notification.requestPermission).toHaveBeenCalled());
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls.subscribe).not.toHaveBeenCalled();
  });

  it('shows a device that is on, sends a test, and turns it off', async () => {
    existingSub = fakeSub;
    settings.devices = [{ id: 'd1', endpoint: ENDPOINT, device: 'iPhone', created_at: '2026-11-21T10:00:00Z', last_success_at: null }];
    calls.unsubscribe.mockResolvedValue({});
    render(<Notifications />);
    expect(await screen.findByText('On for this device.')).toBeInTheDocument();
    expect(screen.getByText('iPhone (this one)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Send a test/ }));
    expect(calls.test).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off here' }));
    await waitFor(() => expect(calls.unsubscribe).toHaveBeenCalledWith(ENDPOINT));
    expect(fakeSub.unsubscribe).toHaveBeenCalled();
  });

  it('saves each setting as it changes', () => {
    render(<Notifications />);
    fireEvent.click(screen.getByLabelText(/Urgent alerts/));
    expect(calls.save).toHaveBeenLastCalledWith({ urgent_alerts: false }, expect.any(Object));
    fireEvent.click(screen.getByLabelText(/Reminder alerts/));
    expect(calls.save).toHaveBeenLastCalledWith({ reminder_alerts: false }, expect.any(Object));
    const time = screen.getByLabelText('Send at');
    fireEvent.change(time, { target: { value: '07:15' } });
    fireEvent.blur(time);
    expect(calls.save).toHaveBeenLastCalledWith({ digest_time: '07:15' }, expect.any(Object));
  });

  it('offers this device\'s time zone when the saved one differs', () => {
    settings.timezone = 'Pacific/Honolulu';
    render(<Notifications />);
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (here === 'Pacific/Honolulu') return;
    fireEvent.click(screen.getByRole('button', { name: `Use ${here}` }));
    expect(calls.save).toHaveBeenLastCalledWith({ timezone: here }, expect.any(Object));
  });

  it('removes another device', () => {
    settings.devices = [{ id: 'd2', endpoint: 'https://push.example/other', device: 'Chrome on Windows', created_at: '2026-11-21T10:00:00Z', last_success_at: '2026-11-21T13:00:00Z' }];
    render(<Notifications />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Chrome on Windows' }));
    expect(calls.removeDevice).toHaveBeenCalledWith('d2', expect.any(Object));
  });
});

describe('device names', () => {
  it('names phones and desktop browsers', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Safari/604.1')).toBe('iPhone');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 16; Pixel 10) Chrome/142.0 Mobile Safari/537.36')).toBe('Android phone');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36 Edg/142.0')).toBe('Edge on Windows');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0 Safari/537.36')).toBe('Chrome on Windows');
  });
});
