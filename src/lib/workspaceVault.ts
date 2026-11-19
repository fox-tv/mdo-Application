import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  db,
  handleFirestoreError,
  OperationType,
  sanitizeFirestoreId,
} from "./firebase";
import type {
  AiAssistantConfig,
  DepartmentItem,
  LetterTemplate,
  OrganizationProfile,
  PublicUser,
  QuickPhrase,
  SavedLetter,
  SiteConfig,
  SitePlugin,
  UserUsageProfile,
} from "../types";

export interface StoredUserBackup extends PublicUser {
  passwordHash: string;
}

export interface FullWorkspaceBackup {
  version?: number;
  scope?: string;
  revision: number;
  updatedAt?: string;
  exportedAt?: string;
  siteConfig: SiteConfig;
  aiAssistantConfig: AiAssistantConfig;
  organization: OrganizationProfile;
  departments: DepartmentItem[];
  templates: LetterTemplate[];
  quickPhrases: QuickPhrase[];
  plugins: SitePlugin[];
  userUsage: Record<string, UserUsageProfile>;
  users: StoredUserBackup[];
  letters: SavedLetter[];
  mediaFiles?: Record<string, string>;
}

const META_COLLECTION = "workspace_meta";
const META_DOC_ID = "config";
const USERS_COLLECTION = "workspace_users";
const TEMPLATES_COLLECTION = "workspace_templates";
const LETTERS_COLLECTION = "workspace_letters";
const MEDIA_COLLECTION = "workspace_media";

const IDB_NAME = "mdo_persistent_vault_v1";
const IDB_STORE = "snapshots";
const ADMIN_SNAPSHOT_KEY = "admin_full_workspace";

function clampString(value: unknown, maxLen: number): string {
  return String(value ?? "").slice(0, maxLen);
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

// Track per-session document checksums to avoid redundant Firestore writes
const syncedSignatureCache = new Map<string, string>();

function computeSignature(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(Date.now());
  }
}

export async function getCloudWorkspaceRevision(): Promise<number | null> {
  const path = `${META_COLLECTION}/${META_DOC_ID}`;
  try {
    const snap = await getDoc(doc(db, META_COLLECTION, META_DOC_ID));
    if (!snap.exists()) return null;
    const data = snap.data();
    return typeof data.revision === "number" ? data.revision : 0;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

async function upsertDocClean(
  collectionName: string,
  docId: string,
  payload: Record<string, unknown>,
  cacheKey: string
): Promise<void> {
  const sig = computeSignature(payload);
  if (syncedSignatureCache.get(cacheKey) === sig) {
    return;
  }
  const path = `${collectionName}/${docId}`;
  try {
    const ref = doc(db, collectionName, docId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    }
    syncedSignatureCache.set(cacheKey, sig);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveFullWorkspaceToFirestore(
  backup: FullWorkspaceBackup
): Promise<void> {
  const revision = Math.max(0, Math.floor(Number(backup.revision) || 0));

  // 1. Save metadata document (native Maps & Lists, zero JSON strings)
  const metaPayload = {
    id: META_DOC_ID,
    revision,
    siteConfig: stripUndefinedDeep(backup.siteConfig || {}),
    aiAssistantConfig: stripUndefinedDeep(backup.aiAssistantConfig || {}),
    organization: stripUndefinedDeep(backup.organization || {}),
    departments: stripUndefinedDeep((backup.departments || []).slice(0, 200)),
    quickPhrases: stripUndefinedDeep((backup.quickPhrases || []).slice(0, 500)),
    plugins: stripUndefinedDeep((backup.plugins || []).slice(0, 200)),
    userUsage: stripUndefinedDeep(backup.userUsage || {}),
  };
  await upsertDocClean(
    META_COLLECTION,
    META_DOC_ID,
    metaPayload,
    `${META_COLLECTION}:${META_DOC_ID}`
  );

  // 2. Sync workspace_users (one doc per user, delete removed users)
  const desiredUserIds = new Set<string>();
  for (const u of backup.users || []) {
    const docId = sanitizeFirestoreId(u.id || u.userId);
    desiredUserIds.add(docId);
    const userPayload: Record<string, unknown> = {
      id: docId,
      userId: clampString(u.userId, 64) || docId,
      passwordHash: clampString(u.passwordHash, 300),
      fullName: clampString(u.fullName || u.userId, 200) || "ব্যবহারকারী",
      designation: clampString(u.designation || "", 200),
      department: clampString(u.department || "সকল বিভাগ", 200),
      role: u.role === "admin" ? "admin" : "user",
      isActive: Boolean(u.isActive),
      avatarDataUrl: clampString(u.avatarDataUrl || "", 400000),
      avatarUrl: clampString(u.avatarUrl || "", 1000),
      userCreatedAt: clampString(u.createdAt || "", 100),
      lastLoginAt: clampString(u.lastLoginAt || "", 100),
    };
    await upsertDocClean(
      USERS_COLLECTION,
      docId,
      userPayload,
      `${USERS_COLLECTION}:${docId}`
    );
  }
  try {
    const existingUsers = await getDocs(
      query(collection(db, USERS_COLLECTION), limit(500))
    );
    for (const d of existingUsers.docs) {
      if (!desiredUserIds.has(d.id)) {
        await deleteDoc(doc(db, USERS_COLLECTION, d.id));
        syncedSignatureCache.delete(`${USERS_COLLECTION}:${d.id}`);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, USERS_COLLECTION);
  }

  // 3. Sync workspace_templates (one doc per template, delete removed)
  const desiredTplIds = new Set<string>();
  for (const tpl of backup.templates || []) {
    const docId = sanitizeFirestoreId(tpl.id);
    desiredTplIds.add(docId);
    const tplPayload: Record<string, unknown> = {
      id: docId,
      title: clampString(tpl.title || "শিরোনামহীন টেমপ্লেট", 300),
      category: clampString(tpl.category || "প্রশাসনিক ও সাধারণ", 200),
      summary: clampString(tpl.summary || "", 1000),
      refSuffix: clampString(tpl.refSuffix || "পত্র", 120),
      recipientPrefix: clampString(tpl.recipientPrefix || "বরাবর", 100),
      recipientName: clampString(tpl.recipientName || "", 200),
      recipientTitle: clampString(tpl.recipientTitle || "", 200),
      recipientOrg: clampString(tpl.recipientOrg || "", 300),
      recipientAddress: clampString(tpl.recipientAddress || "", 500),
      subject: clampString(tpl.subject || "", 500),
      salutation: clampString(tpl.salutation || "মহোদয়,", 200),
      body: clampString(tpl.body || "", 50000),
      closing: clampString(tpl.closing || "বিনীত,", 200),
      attachments: clampString(tpl.attachments || "", 2000),
      ccList: clampString(tpl.ccList || "", 2000),
    };
    await upsertDocClean(
      TEMPLATES_COLLECTION,
      docId,
      tplPayload,
      `${TEMPLATES_COLLECTION}:${docId}`
    );
  }
  try {
    const existingTpls = await getDocs(
      query(collection(db, TEMPLATES_COLLECTION), limit(500))
    );
    for (const d of existingTpls.docs) {
      if (!desiredTplIds.has(d.id)) {
        await deleteDoc(doc(db, TEMPLATES_COLLECTION, d.id));
        syncedSignatureCache.delete(`${TEMPLATES_COLLECTION}:${d.id}`);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, TEMPLATES_COLLECTION);
  }

  // 4. Sync workspace_letters (one doc per letter, delete removed)
  const desiredLetterIds = new Set<string>();
  for (const ltr of backup.letters || []) {
    const docId = sanitizeFirestoreId(ltr.id);
    desiredLetterIds.add(docId);
    const letterPayload: Record<string, unknown> = {
      id: docId,
      templateType: clampString(ltr.templateType || "সাধারণ দাপ্তরিক পত্র", 300),
      refNumber: clampString(ltr.refNumber || "", 200),
      dateText: clampString(ltr.dateText || "", 200),
      showBanglaDate: Boolean(ltr.showBanglaDate),
      banglaDateText: clampString(ltr.banglaDateText || "", 200),
      recipientPrefix: clampString(ltr.recipientPrefix || "বরাবর", 100),
      recipientName: clampString(ltr.recipientName || "", 200),
      recipientTitle: clampString(ltr.recipientTitle || "", 200),
      recipientOrg: clampString(ltr.recipientOrg || "", 300),
      recipientAddress: clampString(ltr.recipientAddress || "", 500),
      subject: clampString(ltr.subject || "", 500),
      salutation: clampString(ltr.salutation || "মহোদয়,", 200),
      body: clampString(ltr.body || "", 50000),
      closing: clampString(ltr.closing || "বিনীত,", 200),
      signatoryName: clampString(ltr.signatoryName || "", 200),
      signatoryTitle: clampString(ltr.signatoryTitle || "", 200),
      signatoryDept: clampString(ltr.signatoryDept || "", 200),
      attachments: clampString(ltr.attachments || "", 2000),
      ccList: clampString(ltr.ccList || "", 2000),
      letterheadStyle:
        ltr.letterheadStyle === "modern" || ltr.letterheadStyle === "archival"
          ? ltr.letterheadStyle
          : "classic",
      letterFont:
        ltr.letterFont === "serif" || ltr.letterFont === "sans"
          ? ltr.letterFont
          : "sutonnymj",
      showWatermark: Boolean(ltr.showWatermark),
      showSealPlaceholder: Boolean(ltr.showSealPlaceholder),
      savedAt: clampString(ltr.savedAt || new Date().toISOString(), 100),
      ownerUserId: clampString(ltr.ownerUserId || "", 128),
      ownerName: clampString(ltr.ownerName || "", 200),
      department: clampString(ltr.department || "", 200),
    };
    await upsertDocClean(
      LETTERS_COLLECTION,
      docId,
      letterPayload,
      `${LETTERS_COLLECTION}:${docId}`
    );
  }
  try {
    const existingLetters = await getDocs(
      query(collection(db, LETTERS_COLLECTION), limit(500))
    );
    for (const d of existingLetters.docs) {
      if (!desiredLetterIds.has(d.id)) {
        await deleteDoc(doc(db, LETTERS_COLLECTION, d.id));
        syncedSignatureCache.delete(`${LETTERS_COLLECTION}:${d.id}`);
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, LETTERS_COLLECTION);
  }

  // 5. Sync workspace_media (one doc per uploaded media file under ~900KB base64)
  for (const [filename, base64Data] of Object.entries(backup.mediaFiles || {})) {
    if (!filename || typeof base64Data !== "string" || !base64Data) continue;
    if (base64Data.length > 940000) continue;
    const docId = sanitizeFirestoreId(filename);
    await upsertDocClean(
      MEDIA_COLLECTION,
      docId,
      {
        id: docId,
        filename: clampString(filename, 200),
        base64Data,
      },
      `${MEDIA_COLLECTION}:${docId}`
    );
  }
}

export async function loadFullWorkspaceFromFirestore(): Promise<FullWorkspaceBackup | null> {
  let metaSnap;
  try {
    metaSnap = await getDoc(doc(db, META_COLLECTION, META_DOC_ID));
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.GET,
      `${META_COLLECTION}/${META_DOC_ID}`
    );
  }
  if (!metaSnap.exists()) {
    return null;
  }
  const meta = metaSnap.data();

  let userDocs;
  try {
    userDocs = await getDocs(query(collection(db, USERS_COLLECTION), limit(500)));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, USERS_COLLECTION);
  }

  let tplDocs;
  try {
    tplDocs = await getDocs(
      query(collection(db, TEMPLATES_COLLECTION), limit(500))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, TEMPLATES_COLLECTION);
  }

  let letterDocs;
  try {
    letterDocs = await getDocs(
      query(collection(db, LETTERS_COLLECTION), limit(500))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, LETTERS_COLLECTION);
  }

  let mediaDocs;
  try {
    mediaDocs = await getDocs(
      query(collection(db, MEDIA_COLLECTION), limit(500))
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, MEDIA_COLLECTION);
  }

  const users: StoredUserBackup[] = userDocs.docs.map((d) => {
    const u = d.data();
    return {
      id: String(u.id || d.id),
      userId: String(u.userId || ""),
      passwordHash: String(u.passwordHash || ""),
      fullName: String(u.fullName || ""),
      designation: String(u.designation || ""),
      department: String(u.department || "সকল বিভাগ"),
      role: u.role === "admin" ? "admin" : "user",
      isActive: u.isActive !== false,
      avatarDataUrl: String(u.avatarDataUrl || ""),
      avatarUrl: String(u.avatarUrl || ""),
      createdAt: String(u.userCreatedAt || new Date().toISOString()),
      lastLoginAt: u.lastLoginAt ? String(u.lastLoginAt) : undefined,
    };
  });

  const templates: LetterTemplate[] = tplDocs.docs.map((d) => {
    const t = d.data();
    return {
      id: String(t.id || d.id),
      title: String(t.title || ""),
      category: String(t.category || ""),
      summary: String(t.summary || ""),
      refSuffix: String(t.refSuffix || "পত্র"),
      recipientPrefix: String(t.recipientPrefix || "বরাবর"),
      recipientName: String(t.recipientName || ""),
      recipientTitle: String(t.recipientTitle || ""),
      recipientOrg: String(t.recipientOrg || ""),
      recipientAddress: String(t.recipientAddress || ""),
      subject: String(t.subject || ""),
      salutation: String(t.salutation || "মহোদয়,"),
      body: String(t.body || ""),
      closing: String(t.closing || "বিনীত,"),
      attachments: String(t.attachments || ""),
      ccList: String(t.ccList || ""),
    };
  });

  const letters: SavedLetter[] = letterDocs.docs
    .map((d) => {
      const l = d.data();
      return {
        id: String(l.id || d.id),
        templateType: String(l.templateType || "সাধারণ দাপ্তরিক পত্র"),
        refNumber: String(l.refNumber || ""),
        dateText: String(l.dateText || ""),
        showBanglaDate: l.showBanglaDate !== false,
        banglaDateText: String(l.banglaDateText || ""),
        recipientPrefix: String(l.recipientPrefix || "বরাবর"),
        recipientName: String(l.recipientName || ""),
        recipientTitle: String(l.recipientTitle || ""),
        recipientOrg: String(l.recipientOrg || ""),
        recipientAddress: String(l.recipientAddress || ""),
        subject: String(l.subject || ""),
        salutation: String(l.salutation || "মহোদয়,"),
        body: String(l.body || ""),
        closing: String(l.closing || "বিনীত,"),
        signatoryName: String(l.signatoryName || ""),
        signatoryTitle: String(l.signatoryTitle || ""),
        signatoryDept: String(l.signatoryDept || ""),
        attachments: String(l.attachments || ""),
        ccList: String(l.ccList || ""),
        letterheadStyle:
          l.letterheadStyle === "modern" || l.letterheadStyle === "archival"
            ? l.letterheadStyle
            : "classic",
        letterFont:
          l.letterFont === "serif" || l.letterFont === "sans"
            ? l.letterFont
            : "sutonnymj",
        showWatermark: l.showWatermark !== false,
        showSealPlaceholder: Boolean(l.showSealPlaceholder),
        savedAt: String(l.savedAt || new Date().toISOString()),
        ownerUserId: String(l.ownerUserId || ""),
        ownerName: String(l.ownerName || ""),
        department: String(l.department || ""),
      };
    })
    .sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );

  const mediaFiles: Record<string, string> = {};
  for (const d of mediaDocs.docs) {
    const m = d.data();
    if (typeof m.filename === "string" && typeof m.base64Data === "string") {
      mediaFiles[m.filename] = m.base64Data;
    }
  }

  return {
    version: 2,
    scope: "full-server",
    revision: typeof meta.revision === "number" ? meta.revision : 0,
    siteConfig: meta.siteConfig as SiteConfig,
    aiAssistantConfig: meta.aiAssistantConfig as AiAssistantConfig,
    organization: meta.organization as OrganizationProfile,
    departments: Array.isArray(meta.departments)
      ? (meta.departments as DepartmentItem[])
      : [],
    templates,
    quickPhrases: Array.isArray(meta.quickPhrases)
      ? (meta.quickPhrases as QuickPhrase[])
      : [],
    plugins: Array.isArray(meta.plugins) ? (meta.plugins as SitePlugin[]) : [],
    userUsage: (meta.userUsage || {}) as Record<string, UserUsageProfile>,
    users,
    letters,
    mediaFiles,
  };
}

// ================= BROWSER INDEXEDDB SAFETY MIRROR =================
function openSafetyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

export async function saveLocalSafetySnapshot(
  backup: FullWorkspaceBackup
): Promise<void> {
  try {
    const idb = await openSafetyDb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(backup, ADMIN_SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  } catch {
    // Non-blocking fallback
  }
}

export async function loadLocalSafetySnapshot(): Promise<FullWorkspaceBackup | null> {
  try {
    const idb = await openSafetyDb();
    const res = await new Promise<FullWorkspaceBackup | null>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(ADMIN_SNAPSHOT_KEY);
      req.onsuccess = () =>
        resolve((req.result as FullWorkspaceBackup | undefined) || null);
      req.onerror = () => reject(req.error);
    });
    idb.close();
    return res;
  } catch {
    return null;
  }
}

export async function saveUserLettersSafetySnapshot(
  userId: string,
  letters: SavedLetter[]
): Promise<void> {
  try {
    const idb = await openSafetyDb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(letters, `user_letters_${userId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  } catch {
    // Non-blocking
  }
}

export async function loadUserLettersSafetySnapshot(
  userId: string
): Promise<SavedLetter[]> {
  try {
    const idb = await openSafetyDb();
    const res = await new Promise<SavedLetter[]>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(`user_letters_${userId}`);
      req.onsuccess = () =>
        resolve(Array.isArray(req.result) ? (req.result as SavedLetter[]) : []);
      req.onerror = () => reject(req.error);
    });
    idb.close();
    return res;
  } catch {
    return [];
  }
}
