// IndexedDB persistence. Two stores:
//   - sessions:   every recorded session (captured) and logged play (reference)
//   - references: a track-keyed library of canonical fingerprints, each seeded
//                 from a clean file-path capture, so metadata-only plays of the
//                 same track can inherit a spectrum.

const DB_NAME = 'echovault'
const SESSIONS = 'sessions'
const REFERENCES = 'references'
const VERSION = 2

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SESSIONS)) {
        const os = db.createObjectStore(SESSIONS, { keyPath: 'id', autoIncrement: true })
        os.createIndex('startedAt', 'startedAt')
      }
      if (!db.objectStoreNames.contains(REFERENCES)) {
        db.createObjectStore(REFERENCES, { keyPath: 'trackKey' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function store(db, name, mode) {
  return db.transaction(name, mode).objectStore(name)
}

function reqProm(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// ---- Sessions ----
export async function saveSession(session) {
  const db = await openDb()
  return reqProm(store(db, SESSIONS, 'readwrite').add(session))
}

export async function updateSession(session) {
  const db = await openDb()
  return reqProm(store(db, SESSIONS, 'readwrite').put(session))
}

export async function deleteSession(id) {
  const db = await openDb()
  return reqProm(store(db, SESSIONS, 'readwrite').delete(id))
}

/** All sessions, newest first. */
export async function listSessions() {
  const db = await openDb()
  const all = await reqProm(store(db, SESSIONS, 'readonly').getAll())
  return all.sort((a, b) => b.startedAt - a.startedAt)
}

// ---- References (track-keyed fingerprint library) ----
export async function getReference(trackKey) {
  if (!trackKey) return null
  const db = await openDb()
  return reqProm(store(db, REFERENCES, 'readonly').get(trackKey))
}

export async function putReference(ref) {
  const db = await openDb()
  return reqProm(store(db, REFERENCES, 'readwrite').put(ref))
}

export async function listReferences() {
  const db = await openDb()
  return reqProm(store(db, REFERENCES, 'readonly').getAll())
}

/**
 * Seed/refresh the reference library from a captured session. Only file-path
 * captures with a track key are eligible, and a longer capture (more columns)
 * wins over a shorter existing one.
 */
export async function upsertReferenceFromSession(session) {
  if (!session.referenceEligible || !session.trackKey) return false
  const candidateCols = session.spectrogramDims?.cols || 0
  if (candidateCols <= 0) return false

  const existing = await getReference(session.trackKey)
  if (existing && (existing.spectrogramDims?.cols || 0) >= candidateCols) return false

  await putReference({
    trackKey: session.trackKey,
    title: session.label?.title || '',
    artist: session.label?.artist || '',
    album: session.label?.spotify?.album || '',
    spotify: session.label?.spotify || null,
    spectrogram: session.spectrogram,
    spectrogramDims: session.spectrogramDims,
    stats: session.stats,
    dominant: session.dominant,
    sourceSessionId: session.id ?? null,
    updatedAt: Date.now(),
  })
  return true
}

// Exports serialize spectrograms as plain number arrays; revive them to Uint8Array.
function reviveSpectro(o) {
  if (o && Array.isArray(o.spectrogram)) return { ...o, spectrogram: Uint8Array.from(o.spectrogram) }
  return o
}

// Signature used to skip re-importing sessions already in the vault.
const sessionSig = (s) => `${s.startedAt}|${s.kind}|${s.capturePath}|${s.durationMs}|${s.trackKey}`

/**
 * Merge sessions + references from an export into the vault. Sessions are added
 * with fresh ids (never overwriting existing rows); ones matching an existing
 * signature are skipped so re-importing the same file is idempotent. References
 * are upserted by trackKey.
 * @returns {Promise<{added:number, skipped:number, references:number}>}
 */
export async function bulkImport(sessions = [], references = []) {
  const db = await openDb()
  const existing = await listSessions()
  const existingRefs = await listReferences()
  const seen = new Set(existing.map(sessionSig))
  const refCols = new Map(existingRefs.map((r) => [r.trackKey, r.spectrogramDims?.cols || 0]))
  let added = 0, skipped = 0, refs = 0

  await new Promise((resolve, reject) => {
    const tx = db.transaction([SESSIONS, REFERENCES], 'readwrite')
    const ss = tx.objectStore(SESSIONS)
    const rs = tx.objectStore(REFERENCES)
    for (const raw of sessions) {
      if (!raw || typeof raw.startedAt !== 'number' || !raw.kind) continue
      const s = reviveSpectro(raw)
      if (seen.has(sessionSig(s))) { skipped++; continue }
      seen.add(sessionSig(s))
      delete s.id
      ss.add(s)
      added++
    }
    for (const raw of references) {
      if (!raw || !raw.trackKey) continue
      // Don't let an imported reference clobber a better (longer-capture) one.
      const cols = raw.spectrogramDims?.cols || 0
      if (cols <= (refCols.get(raw.trackKey) || 0) && refCols.has(raw.trackKey)) continue
      refCols.set(raw.trackKey, cols)
      rs.put(reviveSpectro(raw))
      refs++
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return { added, skipped, references: refs }
}
