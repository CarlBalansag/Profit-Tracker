// Sending Web Push notifications to a user's devices (services/notificationRun.js
// decides what to send). Needs VAPID keys in the environment; without them push
// is simply off and the Settings screen says so.
//
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  -- `npx web-push generate-vapid-keys`
//   VAPID_SUBJECT                         -- "mailto:you@example.com" or an https URL
const webpush = require('web-push');
const prisma = require('../prisma');

let configured = null;
// Tests swap the real sender for a fake (setSender).
let sender = (subscription, body, options) => webpush.sendNotification(subscription, body, options);

function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || process.env.FRONTEND_URL?.trim();
  if (!publicKey || !privateKey || !subject) return { enabled: false, publicKey: null };
  if (configured !== `${publicKey}|${subject}`) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = `${publicKey}|${subject}`;
  }
  return { enabled: true, publicKey };
}

function setSender(fn) {
  sender = fn || ((subscription, body, options) => webpush.sendNotification(subscription, body, options));
}

// The push service says this device is gone for good.
const isGone = (err) => err && (err.statusCode === 404 || err.statusCode === 410);

// Sends one notification to every device the user turned on. Devices the push
// service no longer knows are removed. Returns how many got it.
//   payload: { title, body, url, tag, badge }
async function sendToUser(userId, payload) {
  if (!pushConfig().enabled) return { sent: 0, failed: 0, removed: 0, disabled: true };
  const devices = await prisma.pushSubscription.findMany({ where: { user_id: userId } });
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const device of devices) {
    try {
      await sender({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, body, { TTL: 60 * 60 * 12, urgency: 'normal' });
      sent += 1;
      await prisma.pushSubscription.update({ where: { id: device.id }, data: { last_success_at: new Date() } }).catch(() => {});
    } catch (err) {
      if (isGone(err)) {
        removed += 1;
        await prisma.pushSubscription.deleteMany({ where: { id: device.id } }).catch(() => {});
      } else {
        failed += 1;
        console.error(`[push] send failed for user ${userId}: ${err.statusCode || ''} ${err.message}`);
      }
    }
  }
  return { sent, failed, removed, devices: devices.length };
}

module.exports = { pushConfig, sendToUser, setSender };
