// Tests never talk to a real cashout provider. Any request to one fails the
// test that made it, so a missing stub can't quietly reach EB (or anyone else)
// with a fake key. A test that stubs fetch itself replaces this, as it should.
import { beforeEach, vi } from 'vitest';

const PROVIDER_HOSTS = /electronicsbuyer\.gg|points4days\.com|earnfrombuying\.com/i;

beforeEach(() => {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (url, ...rest) => {
    if (PROVIDER_HOSTS.test(String(url?.url ?? url))) {
      return Promise.reject(new Error(`Blocked in tests: real request to ${String(url?.url ?? url)}`));
    }
    return realFetch(url, ...rest);
  });
});
