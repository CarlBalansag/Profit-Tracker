import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BellRing, Send, Smartphone, Trash2 } from 'lucide-react';
import { usePushConfig, usePushMutations, usePushSettings } from '../../hooks/useApi';
import { deviceLabel } from '../../utils/pushDevice';

// Settings > Notifications: turn push on for this device, choose what gets
// sent (api services/notificationRun.js), and see the devices that are on.

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// The VAPID public key as the bytes PushManager.subscribe wants.
function keyBytes(base64url) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// The service worker, or an error if it never starts (e.g. the dev server,
// which doesn't run one).
async function readyWorker() {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("The app's background worker isn't running. Reload the page and try again.")), 10000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

const PANEL = 'rounded-xl border border-gray-800 bg-[#12121A] p-5 sm:p-6 space-y-4';
const ROW = 'flex min-h-[44px] items-center justify-between gap-4';

function Toggle({ id, label, hint, checked, disabled, onChange }) {
  return (
    <div className={ROW}>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm text-gray-100">{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </label>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--accent)]" />
    </div>
  );
}

export function Notifications() {
  const { data: config, isLoading: configLoading } = usePushConfig();
  const { data: settings, isLoading: settingsLoading } = usePushSettings();
  const { save, subscribe, unsubscribe, removeDevice, test } = usePushMutations();
  const [endpoint, setEndpoint] = useState(null); // this browser's subscription, if any
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const [working, setWorking] = useState(false);

  // Is this browser already subscribed?
  useEffect(() => {
    if (!pushSupported()) return undefined;
    let live = true;
    navigator.serviceWorker.getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => { if (live) setEndpoint(sub?.endpoint ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (configLoading || settingsLoading) return <div className={PANEL}><p className="text-sm text-gray-500">Loading…</p></div>;

  const devices = settings?.devices ?? [];
  const thisDeviceOn = Boolean(endpoint && devices.some((device) => device.endpoint === endpoint));

  const turnOn = async () => {
    setWorking(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') throw new Error(result === 'denied' ? 'Notifications are blocked. Allow them for this site in your settings.' : 'Notifications were not allowed.');
      const reg = await readyWorker();
      const sub = (await reg.pushManager.getSubscription())
        || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.public_key) });
      await subscribe.mutateAsync({ subscription: sub.toJSON(), device: deviceLabel(), timezone: deviceZone() });
      setEndpoint(sub.endpoint);
      toast.success('Notifications are on for this device.');
    } catch (err) {
      toast.error(err.message || 'Could not turn notifications on.');
    } finally {
      setWorking(false);
    }
  };

  const turnOff = async () => {
    setWorking(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribe.mutateAsync(sub.endpoint);
        await sub.unsubscribe();
      }
      setEndpoint(null);
      toast.success('Notifications are off for this device.');
    } catch (err) {
      toast.error(err.message || 'Could not turn notifications off.');
    } finally {
      setWorking(false);
    }
  };

  const change = (changes) => save.mutate(changes, { onError: (err) => toast.error(`Could not save: ${err.message}`) });
  const sendTest = () => test.mutate(undefined, {
    onSuccess: (result) => toast.success(result.sent ? `Test sent to ${result.sent} ${result.sent === 1 ? 'device' : 'devices'}.` : 'No device got it. Turn notifications on again on your phone.'),
    onError: (err) => toast.error(err.message),
  });

  // What this device can do, most specific first.
  let thisDevice;
  if (!config?.enabled) {
    thisDevice = <p className="text-sm text-gray-400">Notifications aren't set up on the server yet.</p>;
  } else if (!pushSupported()) {
    thisDevice = isIos() && !isInstalled() ? (
      <div className="space-y-2 text-sm text-gray-300">
        <p>On iPhone and iPad, notifications work once Profit Tracker is on your Home Screen:</p>
        <ol className="list-decimal space-y-1 pl-5 text-gray-400">
          <li>In Safari, tap the Share button.</li>
          <li>Tap <span className="text-gray-200">Add to Home Screen</span>.</li>
          <li>Open Profit Tracker from the Home Screen and come back here.</li>
        </ol>
      </div>
    ) : <p className="text-sm text-gray-400">This browser can't receive notifications. Try Chrome, Edge, Firefox or Safari.</p>;
  } else if (permission === 'denied') {
    thisDevice = <p className="text-sm text-gray-400">Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.</p>;
  } else if (thisDeviceOn) {
    thisDevice = (
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-gray-200">On for this device.</p>
        <button type="button" onClick={sendTest} disabled={test.isPending} className="page-btn page-btn-secondary"><Send size={14} aria-hidden="true" /> Send a test</button>
        <button type="button" onClick={turnOff} disabled={working} className="page-btn page-btn-secondary">Turn off here</button>
      </div>
    );
  } else {
    thisDevice = (
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-gray-400">Off for this device.</p>
        <button type="button" onClick={turnOn} disabled={working} className="page-btn page-btn-primary"><BellRing size={14} aria-hidden="true" /> {working ? 'Turning on…' : 'Turn on notifications'}</button>
      </div>
    );
  }

  const zone = settings?.timezone;
  const localZone = deviceZone();
  const busy = save.isPending;

  return (
    <div className="space-y-4">
      <section aria-labelledby="notif-device" className={PANEL}>
        <div>
          <h2 id="notif-device" className="text-sm font-bold text-white">This device</h2>
          <p className="mt-1 text-xs text-gray-500">Get your To-Do summary, reminders and urgent items as notifications, and a count on the app icon.</p>
        </div>
        {thisDevice}
      </section>

      <section aria-labelledby="notif-what" className={PANEL}>
        <h2 id="notif-what" className="text-sm font-bold text-white">What to send</h2>
        <div className="divide-y divide-white/[0.06]">
          <div className="pb-2">
            <Toggle id="notif-digest" label="Morning summary" hint="What's on your To-Do list, once a day" checked={settings.digest_enabled} disabled={busy} onChange={(on) => change({ digest_enabled: on })} />
            {settings.digest_enabled && (
              <div className={ROW}>
                <label htmlFor="notif-digest-time" className="text-xs text-gray-400">Send at</label>
                <input
                  id="notif-digest-time"
                  type="time"
                  defaultValue={settings.digest_time}
                  key={settings.digest_time}
                  disabled={busy}
                  onBlur={(e) => { if (e.target.value && e.target.value !== settings.digest_time) change({ digest_time: e.target.value }); }}
                  className="w-32 rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] px-3 py-2 text-base sm:text-sm text-[var(--dp-text-primary)]"
                />
              </div>
            )}
          </div>
          <div className="py-2">
            <Toggle id="notif-reminders" label="Reminder alerts" hint="At the time you set on a reminder" checked={settings.reminder_alerts} disabled={busy} onChange={(on) => change({ reminder_alerts: on })} />
          </div>
          <div className="pt-2">
            <Toggle id="notif-urgent" label="Urgent alerts" hint="A card due, a return window closing, a cash-out to reconnect, a dispute… when it comes up after the summary" checked={settings.urgent_alerts} disabled={busy} onChange={(on) => change({ urgent_alerts: on })} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3 text-xs text-gray-500">
          <span>Times are in {zone}. Nothing is sent after 9 PM.</span>
          {zone !== localZone && (
            <button type="button" disabled={busy} onClick={() => change({ timezone: localZone })} className="page-btn page-btn-secondary !text-xs">Use {localZone}</button>
          )}
        </div>
      </section>

      {devices.length > 0 && (
        <section aria-labelledby="notif-devices" className={PANEL}>
          <h2 id="notif-devices" className="text-sm font-bold text-white">Devices with notifications on</h2>
          <ul className="divide-y divide-white/[0.06]">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 py-2">
                <Smartphone size={16} className="shrink-0 text-gray-500" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-200">{device.device || 'Device'}{device.endpoint === endpoint ? ' (this one)' : ''}</p>
                  <p className="text-xs text-gray-500">
                    Added {new Date(device.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {device.last_success_at ? ` · last sent ${new Date(device.last_success_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeDevice.mutate(device.id, { onError: (err) => toast.error(err.message) })}
                  disabled={removeDevice.isPending}
                  className="page-btn page-btn-secondary shrink-0 !px-3"
                >
                  <Trash2 size={14} aria-hidden="true" /><span className="sr-only">Remove {device.device || 'device'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
