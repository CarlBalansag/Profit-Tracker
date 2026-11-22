// The server connects to whatever IMAP host a user types for "Other", so the
// host must be a public DNS name. Private, loopback and link-local addresses
// are refused (no reaching our own network), and the connection is then made
// to the exact address checked here, so DNS can't change between check and use.
const dns = require('node:dns').promises;
const net = require('node:net');

function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = String(ip).toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateAddress(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

const HOST_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const userError = (message) => Object.assign(new Error(message), { userFacing: true });

async function resolvePublicHost(host, lookup = dns.lookup) {
  if (!HOST_PATTERN.test(host)) throw userError('Enter a mail server name like imap.example.com.');
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw userError('That mail server name could not be found.');
  }
  if (!addresses.length || addresses.some((a) => privateAddress(a.address))) {
    throw userError('That mail server is not on the public internet.');
  }
  return addresses[0].address;
}

module.exports = { resolvePublicHost, privateAddress, userError };
