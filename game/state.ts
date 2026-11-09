// Wire format: base64url(JSON), nothing else. The whole game lives in the URL,
// so /b/<payload>.svg is both the board and the state, and the README committed
// after each move is the only storage the worker needs.

import type { State } from './engine.ts';
import { isValidState, spawnX } from './engine.ts';

export function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeState(s: State): string {
  return b64urlEncode(JSON.stringify(s));
}

export function decodeState(payload: string): State | null {
  try {
    const raw = JSON.parse(b64urlDecode(payload));
    if (!raw || typeof raw !== 'object') return null;
    // States written before the falling piece had a position: put it at spawn.
    if (typeof raw.x !== 'number' || typeof raw.y !== 'number') {
      if (!Number.isInteger(raw.p) || !Number.isInteger(raw.r)) return null;
      raw.x = spawnX(raw.p, raw.r);
      raw.y = 0;
    }
    if (!isValidState(raw)) return null;
    return raw as State;
  } catch {
    return null;
  }
}

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % 2_000_000_000;
}
