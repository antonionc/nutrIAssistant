// Base64 ↔ bytes helpers shared by every module that talks to encryption.
//
// Single source of truth: encryption.ts, keyRotation.ts, secureFileStore.ts
// and any future at-rest encryption surface all import from here. Before
// centralisation, three identical copies of these helpers lived in the
// codebase and would have drifted on the first edit.
//
// Implementation note: we rely on `globalThis.btoa`/`atob`, which are
// available in React Native (Hermes) since 0.71+. The signatures match
// what `@noble/ciphers` expects.

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return globalThis.btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
