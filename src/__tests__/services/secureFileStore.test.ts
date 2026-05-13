// Mocks set up before imports.
const memSecureStore: Record<string, string> = {}

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => memSecureStore[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    memSecureStore[key] = value
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete memSecureStore[key]
  }),
}))

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => {
    const arr = new Uint8Array(n)
    for (let i = 0; i < n; i++) arr[i] = (i * 17 + 9) % 256
    return arr
  },
}))

// In-memory FileSystem fake. Stored on globalThis so the jest.mock factory
// (which is hoisted above the const declarations) can resolve it lazily.
;(globalThis as any).__mockFs = { files: {} as Record<string, string> }

jest.mock('expo-file-system/legacy', () => {
  const fakeDir = '/tmp/fake-fs/'
  const fakeCache = '/tmp/fake-cache/'
  return {
    get documentDirectory() {
      return fakeDir
    },
    get cacheDirectory() {
      return fakeCache
    },
    EncodingType: { UTF8: 'utf8', Base64: 'base64' },
    async readAsStringAsync(uri: string, opts?: { encoding?: string }) {
      const files = (globalThis as any).__mockFs.files
      const data = files[uri]
      if (data === undefined) throw new Error(`ENOENT: ${uri}`)
      if (opts?.encoding === 'utf8') {
        return Buffer.from(data, 'base64').toString('utf8')
      }
      return data
    },
    async writeAsStringAsync(uri: string, data: string, opts?: { encoding?: string }) {
      const files = (globalThis as any).__mockFs.files
      if (opts?.encoding === 'utf8') {
        files[uri] = Buffer.from(data, 'utf8').toString('base64')
      } else {
        files[uri] = data
      }
    },
    async deleteAsync(uri: string) {
      const files = (globalThis as any).__mockFs.files
      delete files[uri]
    },
    async getInfoAsync(uri: string) {
      const files = (globalThis as any).__mockFs.files
      if (files[uri] !== undefined) return { exists: true }
      const dirPrefix = uri.endsWith('/') ? uri : uri + '/'
      for (const k of Object.keys(files)) {
        if (k.startsWith(dirPrefix)) return { exists: true }
      }
      return { exists: false }
    },
    async readDirectoryAsync(uri: string) {
      const files = (globalThis as any).__mockFs.files
      const prefix = uri.endsWith('/') ? uri : uri + '/'
      const seen = new Set<string>()
      for (const p of Object.keys(files)) {
        if (!p.startsWith(prefix)) continue
        const rest = p.slice(prefix.length)
        if (!rest) continue
        const firstSeg = rest.split('/')[0]
        if (firstSeg) seen.add(firstSeg)
      }
      return [...seen]
    },
    async makeDirectoryAsync(_uri: string) {
      /* no-op */
    },
  }
})

// Convenience handle for the test bodies.
const mockFs = {
  files: (globalThis as any).__mockFs.files as Record<string, string>,
  reset() {
    for (const k of Object.keys(this.files)) delete this.files[k]
  },
}

import { ensureKey, _resetKeyCacheForTests } from '../../services/encryption'
import {
  writeEncryptedFile,
  readEncryptedToTemp,
  withEncryptedSuffix,
  isEncryptedPath,
  migratePlaintextDocumentsToEncrypted,
} from '../../services/secureFileStore'

describe('secureFileStore', () => {
  beforeEach(async () => {
    _resetKeyCacheForTests()
    for (const k of Object.keys(memSecureStore)) delete memSecureStore[k]
    mockFs.reset()
    await ensureKey()
  })

  it('withEncryptedSuffix is idempotent', () => {
    expect(withEncryptedSuffix('/a/b.pdf')).toBe('/a/b.pdf.enc')
    expect(withEncryptedSuffix('/a/b.pdf.enc')).toBe('/a/b.pdf.enc')
  })

  it('isEncryptedPath recognises the .enc suffix', () => {
    expect(isEncryptedPath('/a/b.pdf')).toBe(false)
    expect(isEncryptedPath('/a/b.pdf.enc')).toBe(true)
  })

  it('roundtrips: writeEncryptedFile then readEncryptedToTemp returns the original bytes', async () => {
    // Seed a "source PDF" as base64-encoded bytes.
    const sourceUri = '/tmp/fake-fs/source.pdf'
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]) // "%PDF-1.7"
    mockFs.files[sourceUri] = Buffer.from(pdfBytes).toString('base64')

    const destPath = '/tmp/fake-fs/dest.pdf'
    const encPath = await writeEncryptedFile(sourceUri, destPath)
    expect(encPath).toBe('/tmp/fake-fs/dest.pdf.enc')

    // On-disk content must NOT contain the plaintext PDF magic bytes.
    const stored = mockFs.files[encPath]
    expect(stored).toBeDefined()
    expect(stored).not.toContain('JVBERi') // base64 prefix of "%PDF-"

    // Decrypt to a temp file and verify the bytes match.
    const { tempUri, dispose } = await readEncryptedToTemp(encPath)
    const tempBase64 = mockFs.files[tempUri]
    expect(tempBase64).toBeDefined()
    const recovered = Buffer.from(tempBase64, 'base64')
    expect(Array.from(recovered)).toEqual(Array.from(pdfBytes))

    // dispose() removes the temp file.
    await dispose()
    expect(mockFs.files[tempUri]).toBeUndefined()
  })

  it('migratePlaintextDocumentsToEncrypted converts old .pdf files to .pdf.enc and removes plaintext', async () => {
    // Seed a fake legacy plaintext install: two member dirs with PDFs.
    const root = '/tmp/fake-fs/profile-documents/'
    const memberA = `${root}member-a/`
    const memberB = `${root}member-b/`
    mockFs.files[`${memberA}doc-1.pdf`] = Buffer.from('aaa').toString('base64')
    mockFs.files[`${memberB}doc-2.pdf`] = Buffer.from('bbb').toString('base64')

    const result = await migratePlaintextDocumentsToEncrypted()
    expect(result.encrypted).toBe(2)
    expect(result.failed).toBe(0)

    // Plaintext PDFs gone.
    expect(mockFs.files[`${memberA}doc-1.pdf`]).toBeUndefined()
    expect(mockFs.files[`${memberB}doc-2.pdf`]).toBeUndefined()

    // Encrypted siblings present.
    expect(mockFs.files[`${memberA}doc-1.pdf.enc`]).toBeDefined()
    expect(mockFs.files[`${memberB}doc-2.pdf.enc`]).toBeDefined()

    // Idempotent: running again is a no-op (alreadyMigrated counter
    // would activate, but there are no straggler plaintext files).
    const second = await migratePlaintextDocumentsToEncrypted()
    expect(second.encrypted).toBe(0)
    expect(second.failed).toBe(0)
  })

  it('migrate is a no-op when no profile-documents directory exists', async () => {
    const result = await migratePlaintextDocumentsToEncrypted()
    expect(result).toEqual({ encrypted: 0, alreadyMigrated: 0, failed: 0 })
  })
})
