import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock navigator
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true,
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};
global.localStorage = localStorageMock as Storage;

// Mock sessionStorage
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};
global.sessionStorage = sessionStorageMock as Storage;

// Mock crypto.randomUUID
if (!global.crypto) {
  global.crypto = {} as Crypto;
}
global.crypto.randomUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Mock Service Worker
global.navigator.serviceWorker = {
  register: vi.fn().mockResolvedValue({
    installing: null,
    waiting: null,
    active: { state: 'activated' },
    scope: '/',
    updateViaCache: 'imports',
    update: vi.fn(),
    unregister: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
  ready: Promise.resolve({
    active: { state: 'activated' },
    installing: null,
    waiting: null,
    scope: '/',
    updateViaCache: 'imports',
    update: vi.fn(),
    unregister: vi.fn(),
    sync: {
      register: vi.fn(),
    },
  } as any),
  controller: null,
  getRegistration: vi.fn(),
  getRegistrations: vi.fn().mockResolvedValue([]),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
} as any;

// Mock IndexedDB (basic implementation)
const indexedDBMock = {
  open: vi.fn().mockImplementation(() => ({
    result: {
      objectStoreNames: [],
      transaction: vi.fn(),
      close: vi.fn(),
    },
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  })),
  deleteDatabase: vi.fn(),
};
global.indexedDB = indexedDBMock as any;

// Mock BroadcastChannel
global.BroadcastChannel = vi.fn().mockImplementation(() => ({
  postMessage: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})) as any;