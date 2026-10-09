const DATABASE_NAME = "tastetwin";
const STORE_NAME = "state";
const PROFILE_STORE = "profiles";
const DATABASE_VERSION = 2;
type Profile = { id: string };
type StoredApp = { storageFormat: "profiles-v2"; profileIds: string[]; value: Record<string, unknown> };
let persistedProfiles = new Map<string, Profile>();
let writeQueue: Promise<void> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      for (const name of [STORE_NAME, PROFILE_STORE]) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other TasteTwin windows to upgrade local storage."));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadPersistentState<T>(key: string): Promise<T | undefined> {
  await writeQueue;
  const database = await openDatabase();
  try {
    const transaction = database.transaction([STORE_NAME, PROFILE_STORE], "readonly");
    const saved = await requestValue(transaction.objectStore(STORE_NAME).get(key));
    if (key !== "app" || saved?.storageFormat !== "profiles-v2") {
      // Keep the old snapshot intact until the first successful v2 write.
      persistedProfiles = new Map();
      return saved as T | undefined;
    }
    const envelope = saved as StoredApp;
    const profiles = transaction.objectStore(PROFILE_STORE);
    const users = await Promise.all(envelope.profileIds.map(id => requestValue<Profile | undefined>(profiles.get(id))));
    if (users.some(user => !user)) throw new Error("A stored TasteTwin profile is missing; restore a backup.");
    persistedProfiles = new Map((users as Profile[]).map(user => [user.id, user]));
    return { ...envelope.value, users } as T;
  } finally {
    database.close();
  }
}

function enqueueWrite(action: () => Promise<void>): Promise<void> {
  const operation = writeQueue.then(action);
  writeQueue = operation.catch(() => {});
  return operation;
}

export function savePersistentState<T>(key: string, value: T): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    try {
      const app = value as Record<string, unknown>;
      const users = key === "app" && Array.isArray(app?.users) ? app.users as Profile[] : undefined;
      const nextProfiles = users ? new Map(users.map(user => [user.id, user])) : undefined;
      if (users && (nextProfiles!.size !== users.length || users.some(user => typeof user.id !== "string" || !user.id))) {
        throw new Error("TasteTwin profiles require unique IDs.");
      }
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME, PROFILE_STORE], "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        try {
        if (users) {
          const profiles = transaction.objectStore(PROFILE_STORE);
          for (const user of users) {
            if (persistedProfiles.get(user.id) !== user) profiles.put(user, user.id);
          }
          const keys = profiles.getAllKeys();
          keys.onsuccess = () => {
            for (const id of keys.result) if (!nextProfiles!.has(String(id))) profiles.delete(id);
          };
          const { users: _users, ...metadata } = app;
          const envelope: StoredApp = { storageFormat: "profiles-v2", profileIds: users.map(user => user.id), value: metadata };
          transaction.objectStore(STORE_NAME).put(envelope, key);
        } else {
          transaction.objectStore(STORE_NAME).put(value, key);
        }
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      });
      if (nextProfiles) persistedProfiles = nextProfiles;
    } finally {
      database.close();
    }
  });
}

export function clearPersistentState(key: string): Promise<void> {
  return enqueueWrite(async () => {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME, PROFILE_STORE], "readwrite");
        transaction.objectStore(STORE_NAME).delete(key);
        if (key === "app") transaction.objectStore(PROFILE_STORE).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      if (key === "app") persistedProfiles = new Map();
    } finally {
      database.close();
    }
  });
}
