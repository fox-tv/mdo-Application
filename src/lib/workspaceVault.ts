import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
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
  deletedLetterIds?: string[];
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

async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  concurrency = 12
): Promise<void> {
  if (tasks.length === 0) return;
  let index = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    async () => {
      while (index < tasks.length) {
        const current = index++;
        await tasks[current]();
      }
    }
  );
  await Promise.all(workers);
}

async function upsertDocWithKnownExistence(
  collectionName: string,
  docId: string,
  payload: Record<string, unknown>,
  cacheKey: string,
  existsAlready: boolean
): Promise<void> {
  const sig = computeSignature(payload);
  if (syncedSignatureCache.get(cacheKey) === sig) {
    return;
  }
  const path = `${collectionName}/${docId}`;
  try {
    const ref = doc(db, collectionName, docId);
    if (!existsAlready) {
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

async function fetchAllCollectionDocs(
  collectionName: string
): Promise<QueryDocumentSnapshot<DocumentData, DocumentData>[]> {
  const pageSize = 500;
  const firstSnap: QuerySnapshot<DocumentData, DocumentData> = await getDocs(
    query(collection(db, collectionName), limit(pageSize))
  );
  const allDocs: QueryDocumentSnapshot<DocumentData, DocumentData>[] = [
    ...firstSnap.docs,
  ];
  if (firstSnap.docs.length < pageSize) {
    return allDocs;
  }

  // Only paginate beyond 500 docs using ordered cursor; fall back gracefully if index is unavailable
  try {
    const pagedDocs: QueryDocumentSnapshot<DocumentData, DocumentData>[] = [];
    let cursor: QueryDocumentSnapshot<DocumentData, DocumentData> | null = null;
    for (let page = 0; page < 40; page++) {
      const q: Query<DocumentData, DocumentData> = cursor
        ? query(
            collection(db, collectionName),
            orderBy(documentId()),
            startAfter(cursor),
            limit(pageSize)
          )
        : query(
            collection(db, collectionName),
            orderBy(documentId()),
            limit(pageSize)
          );
      const snap: QuerySnapshot<DocumentData, DocumentData> = await getDocs(q);
      pagedDocs.push(...snap.docs);
      if (snap.docs.length < pageSize) {
        return pagedDocs;
      }
      cursor = snap.docs[snap.docs.length - 1];
    }
    return pagedDocs;
  } catch {
    return allDocs;
  }
}

export async function deleteWorkspaceLetterFromVault(
  letterId: string
): Promise<void> {
  const docId = sanitizeFirestoreId(letterId);
  const path = `${LETTERS_COLLECTION}/${docId}`;
  try {
    await deleteDoc(doc(db, LETTERS_COLLECTION, docId));
    syncedSignatureCache.delete(`${LETTERS_COLLECTION}:${docId}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveFullWorkspaceToFirestore(
  backup: FullWorkspaceBackup
): Promise<void> {
  const revision = Math.max(0, Math.floor(Number(backup.revision) || 0));

  // Fetch existing doc IDs across all 5 vault collections in parallel
  let metaExists = false;
  const existingUserIds = new Set<string>();
  const existingTplIds = new Set<string>();
  const existingLetterIds = new Set<string>();
  const existingMediaIds = new Set<string>();

  try {
    const [metaSnap, userDocs, tplDocs, letterDocs, mediaDocs] =
      await Promise.all([
        getDoc(doc(db, META_COLLECTION, META_DOC_ID)),
        fetchAllCollectionDocs(USERS_COLLECTION),
        fetchAllCollectionDocs(TEMPLATES_COLLECTION),
        fetchAllCollectionDocs(LETTERS_COLLECTION),
        fetchAllCollectionDocs(MEDIA_COLLECTION),
      ]);
    metaExists = metaSnap.exists();
    userDocs.forEach((d) => existingUserIds.add(d.id));
    tplDocs.forEach((d) => existingTplIds.add(d.id));
    letterDocs.forEach((d) => existingLetterIds.add(d.id));
    mediaDocs.forEach((d) => existingMediaIds.add(d.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, META_COLLECTION);
  }

  const normalizedDeletedIds = Array.from(
    new Set(
      (Array.isArray(backup.deletedLetterIds) ? backup.deletedLetterIds : [])
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => clampString(id.trim(), 128))
    )
  ).slice(-500);
  const deletedLetterDocIds = new Set(
    normalizedDeletedIds.map((id) => sanitizeFirestoreId(id))
  );

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
    deletedLetterIds: normalizedDeletedIds,
  };
  await upsertDocWithKnownExistence(
    META_COLLECTION,
    META_DOC_ID,
    metaPayload,
    `${META_COLLECTION}:${META_DOC_ID}`,
    metaExists
  );

  const writeTasks: Array<() => Promise<void>> = [];

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
    const existsAlready = existingUserIds.has(docId);
    writeTasks.push(() =>
      upsertDocWithKnownExistence(
        USERS_COLLECTION,
        docId,
        userPayload,
        `${USERS_COLLECTION}:${docId}`,
        existsAlready
      )
    );
  }
  for (const existingId of existingUserIds) {
    if (!desiredUserIds.has(existingId)) {
      writeTasks.push(async () => {
        try {
          await deleteDoc(doc(db, USERS_COLLECTION, existingId));
          syncedSignatureCache.delete(`${USERS_COLLECTION}:${existingId}`);
        } catch (error) {
          handleFirestoreError(
            error,
            OperationType.DELETE,
            `${USERS_COLLECTION}/${existingId}`
          );
        }
      });
    }
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
    const existsAlready = existingTplIds.has(docId);
    writeTasks.push(() =>
      upsertDocWithKnownExistence(
        TEMPLATES_COLLECTION,
        docId,
        tplPayload,
        `${TEMPLATES_COLLECTION}:${docId}`,
        existsAlready
      )
    );
  }
  for (const existingId of existingTplIds) {
    if (!desiredTplIds.has(existingId)) {
      writeTasks.push(async () => {
        try {
          await deleteDoc(doc(db, TEMPLATES_COLLECTION, existingId));
          syncedSignatureCache.delete(`${TEMPLATES_COLLECTION}:${existingId}`);
        } catch (error) {
          handleFirestoreError(
            error,
            OperationType.DELETE,
            `${TEMPLATES_COLLECTION}/${existingId}`
          );
        }
      });
    }
  }

  // 4. Sync workspace_letters (one doc per letter; NEVER auto-delete unlisted letters — only delete explicitly deleted IDs)
  for (const ltr of backup.letters || []) {
    const docId = sanitizeFirestoreId(ltr.id);
    if (deletedLetterDocIds.has(docId)) continue;
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
      branchPadDepartment: clampString(ltr.branchPadDepartment || "", 200),
    };
    const existsAlready = existingLetterIds.has(docId);
    writeTasks.push(() =>
      upsertDocWithKnownExistence(
        LETTERS_COLLECTION,
        docId,
        letterPayload,
        `${LETTERS_COLLECTION}:${docId}`,
        existsAlready
      )
    );
  }
  for (const existingId of existingLetterIds) {
    if (deletedLetterDocIds.has(existingId)) {
      writeTasks.push(async () => {
        try {
          await deleteDoc(doc(db, LETTERS_COLLECTION, existingId));
          syncedSignatureCache.delete(`${LETTERS_COLLECTION}:${existingId}`);
        } catch (error) {
          handleFirestoreError(
            error,
            OperationType.DELETE,
            `${LETTERS_COLLECTION}/${existingId}`
          );
        }
      });
    }
  }

  // 5. Sync workspace_media (one doc per uploaded media file under ~900KB base64)
  for (const [filename, base64Data] of Object.entries(backup.mediaFiles || {})) {
    if (!filename || typeof base64Data !== "string" || !base64Data) continue;
    if (base64Data.length > 940000) continue;
    const docId = sanitizeFirestoreId(filename);
    const existsAlready = existingMediaIds.has(docId);
    writeTasks.push(() =>
      upsertDocWithKnownExistence(
        MEDIA_COLLECTION,
        docId,
        {
          id: docId,
          filename: clampString(filename, 200),
          base64Data,
        },
        `${MEDIA_COLLECTION}:${docId}`,
        existsAlready
      )
    );
  }

  await runWithConcurrency(writeTasks, 12);
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

  let userDocs: QueryDocumentSnapshot<DocumentData, DocumentData>[];
  let tplDocs: QueryDocumentSnapshot<DocumentData, DocumentData>[];
  let letterDocs: QueryDocumentSnapshot<DocumentData, DocumentData>[];
  let mediaDocs: QueryDocumentSnapshot<DocumentData, DocumentData>[];
  try {
    [userDocs, tplDocs, letterDocs, mediaDocs] = await Promise.all([
      fetchAllCollectionDocs(USERS_COLLECTION),
      fetchAllCollectionDocs(TEMPLATES_COLLECTION),
      fetchAllCollectionDocs(LETTERS_COLLECTION),
      fetchAllCollectionDocs(MEDIA_COLLECTION),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, USERS_COLLECTION);
  }

  const users: StoredUserBackup[] = userDocs.map((d) => {
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

  const templates: LetterTemplate[] = tplDocs.map((d) => {
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

  const letters: SavedLetter[] = letterDocs
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
        ...(l.branchPadDepartment
          ? { branchPadDepartment: String(l.branchPadDepartment) }
          : {}),
      };
    })
    .sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );

  const mediaFiles: Record<string, string> = {};
  for (const d of mediaDocs) {
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
    deletedLetterIds: Array.isArray(meta.deletedLetterIds)
      ? (meta.deletedLetterIds as unknown[]).filter(
          (id): id is string => typeof id === "string"
        )
      : [],
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
    const compact: FullWorkspaceBackup = {
      ...backup,
      mediaFiles: undefined,
    };
    localStorage.setItem("mdo_admin_safety_ls_v1", JSON.stringify(compact));
  } catch {
    // Ignore localStorage quota limits
  }
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
  let idbSnap: FullWorkspaceBackup | null = null;
  try {
    const idb = await openSafetyDb();
    idbSnap = await new Promise<FullWorkspaceBackup | null>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(ADMIN_SNAPSHOT_KEY);
      req.onsuccess = () =>
        resolve((req.result as FullWorkspaceBackup | undefined) || null);
      req.onerror = () => reject(req.error);
    });
    idb.close();
  } catch {
    idbSnap = null;
  }

  let lsSnap: FullWorkspaceBackup | null = null;
  try {
    const raw = localStorage.getItem("mdo_admin_safety_ls_v1");
    if (raw) {
      lsSnap = JSON.parse(raw) as FullWorkspaceBackup;
    }
  } catch {
    lsSnap = null;
  }

  if (idbSnap && lsSnap) {
    return (lsSnap.revision || 0) > (idbSnap.revision || 0) ? lsSnap : idbSnap;
  }
  return idbSnap || lsSnap || null;
}

export async function saveUserLettersSafetySnapshot(
  userId: string,
  letters: SavedLetter[]
): Promise<void> {
  try {
    localStorage.setItem(
      `mdo_user_letters_ls_${userId}`,
      JSON.stringify(letters.slice(0, 100))
    );
  } catch {
    // Ignore localStorage quota errors
  }
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
    if (res.length > 0) return res;
  } catch {
    // Fall back to localStorage
  }
  try {
    const raw = localStorage.getItem(`mdo_user_letters_ls_${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SavedLetter[]) : [];
    }
  } catch {
    // Ignore
  }
  return [];
}

export async function saveUserTemplatesSafetySnapshot(
  userId: string,
  templates: LetterTemplate[]
): Promise<void> {
  try {
    localStorage.setItem(
      `mdo_user_templates_ls_${userId}`,
      JSON.stringify(templates.slice(0, 200))
    );
  } catch {
    // Ignore
  }
  try {
    const idb = await openSafetyDb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(templates, `user_templates_${userId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    idb.close();
  } catch {
    // Non-blocking
  }
}

export async function loadUserTemplatesSafetySnapshot(
  userId: string
): Promise<LetterTemplate[]> {
  try {
    const idb = await openSafetyDb();
    const res = await new Promise<LetterTemplate[]>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(`user_templates_${userId}`);
      req.onsuccess = () =>
        resolve(Array.isArray(req.result) ? (req.result as LetterTemplate[]) : []);
      req.onerror = () => reject(req.error);
    });
    idb.close();
    if (res.length > 0) return res;
  } catch {
    // Fall back to localStorage
  }
  try {
    const raw = localStorage.getItem(`mdo_user_templates_ls_${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as LetterTemplate[]) : [];
    }
  } catch {
    // Ignore
  }
  return [];
}
