// IndexedDB persistence for recorded sessions. IndexedDB is used (not
// localStorage) because sessions contain binary spectrogram data and can add up;
// IndexedDB stores typed arrays natively via structured clone and has no ~5 MB
// string cap.

const DB_NAME = 'echovault'
const STORE = 'sessions'
const VERSION = 1

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        os.createIndex('startedAt', 'startedAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE)
}

export async function saveSession(session) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').add(session)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function updateSession(session) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').put(session)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteSession(id) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/** All sessions, newest first. */
export async function listSessions() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readonly').getAll()
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.startedAt - a.startedAt))
    req.onerror = () => reject(req.error)
  })
}
