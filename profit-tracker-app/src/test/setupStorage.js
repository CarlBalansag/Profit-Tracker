// Node 25+ has its own global localStorage/sessionStorage, which is unusable
// unless Node is started with --localstorage-file, and it hides jsdom's. Tests
// then crash on localStorage.clear()/setItem(). When that happens, put jsdom's
// own storage back (or an in-memory one if there's no jsdom window).

const memoryStorage = () => {
  const store = new Map();
  return {
    get length() { return store.size; },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => { store.set(String(key), String(value)); },
    removeItem: (key) => { store.delete(String(key)); },
    clear: () => { store.clear(); },
  };
};

const works = (storage) => {
  try {
    return typeof storage?.getItem === 'function' && typeof storage?.setItem === 'function';
  } catch {
    return false;
  }
};

for (const name of ['localStorage', 'sessionStorage']) {
  let current;
  try { current = globalThis[name]; } catch { current = undefined; }
  if (works(current)) continue;
  const fromJsdom = globalThis.jsdom?.window?.[name];
  const storage = works(fromJsdom) ? fromJsdom : memoryStorage();
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
}
