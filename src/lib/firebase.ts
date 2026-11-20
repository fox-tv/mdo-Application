import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";
import type {
  CloudVoiceSession,
  LiveVoiceName,
  PublicUser,
  SavedLetter,
  VoiceTranscriptTurn,
} from "../types";

const app = initializeApp(firebaseConfig);
let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(
    app,
    typeof window !== "undefined"
      ? {
          experimentalAutoDetectLongPolling: true,
          ignoreUndefinedProperties: true,
        }
      : {
          ignoreUndefinedProperties: true,
        },
    firebaseConfig.firestoreDatabaseId
  );
} catch {
  dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}
export const db = dbInstance;
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    if (typeof window !== "undefined") {
      window.addEventListener(
        "online",
        () => {
          void testConnection();
        },
        { once: true }
      );
    }
    return;
  }
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("the client is offline")
    ) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

void testConnection();

export function sanitizeFirestoreId(raw: string): string {
  const cleaned = String(raw || "")
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .slice(0, 120);
  return cleaned || `doc-${Date.now()}`;
}

function clampString(value: unknown, maxLen: number): string {
  return String(value ?? "").trim().slice(0, maxLen);
}

function timestampToIso(ts: unknown): string {
  if (ts instanceof Timestamp) {
    return ts.toDate().toISOString();
  }
  if (
    typeof ts === "object" &&
    ts !== null &&
    "toDate" in ts &&
    typeof (ts as { toDate: () => Date }).toDate === "function"
  ) {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

export async function syncFirebaseUserProfile(
  fbUser: User,
  appUser?: PublicUser | null
): Promise<void> {
  const uid = sanitizeFirestoreId(fbUser.uid);
  const publicPath = `users/${uid}`;
  const privatePath = `users/${uid}/private/info`;

  const displayName = clampString(
    appUser?.fullName || fbUser.displayName || "ব্যবহারকারী",
    120
  );
  const designation = clampString(appUser?.designation || "", 120);
  const department = clampString(appUser?.department || "", 120);
  const role: "admin" | "user" =
    fbUser.email === "bipulmdmehedihasan@gmail.com" ? "admin" : "user";

  try {
    const publicRef = doc(db, "users", uid);
    const publicSnap = await getDoc(publicRef);
    if (!publicSnap.exists()) {
      await setDoc(publicRef, {
        uid,
        displayName,
        designation,
        department,
        role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(publicRef, {
        displayName,
        designation,
        department,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, publicPath);
  }

  if (fbUser.email) {
    const safeEmail = clampString(fbUser.email, 200);
    try {
      const privateRef = doc(db, "users", uid, "private", "info");
      const privateSnap = await getDoc(privateRef);
      if (!privateSnap.exists()) {
        await setDoc(privateRef, {
          uid,
          email: safeEmail,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privateRef, {
          email: safeEmail,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }
  }
}

export async function signInWithGoogleCloud(
  appUser?: PublicUser | null
): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  await syncFirebaseUserProfile(credential.user, appUser);
  return credential.user;
}

export async function signOutGoogleCloud(): Promise<void> {
  await signOut(auth);
}

export async function saveLetterToCloud(
  letter: SavedLetter,
  ownerUid: string,
  ownerNameFallback = ""
): Promise<void> {
  const id = sanitizeFirestoreId(letter.id);
  const uid = sanitizeFirestoreId(ownerUid);
  const docPath = `letters/${id}`;

  const mutableFields = {
    ownerName: clampString(letter.ownerName || ownerNameFallback, 120),
    templateType: clampString(letter.templateType || "সাধারণ দাপ্তরিক পত্র", 160),
    refNumber: clampString(letter.refNumber || "", 120),
    dateText: clampString(letter.dateText || "", 100),
    subject: clampString(letter.subject || "শিরোনামহীন পত্র", 300),
    recipientPrefix: clampString(letter.recipientPrefix || "বরাবর", 60),
    recipientName: clampString(letter.recipientName || "", 160),
    recipientTitle: clampString(letter.recipientTitle || "", 160),
    recipientOrg: clampString(letter.recipientOrg || "", 200),
    recipientAddress: clampString(letter.recipientAddress || "", 300),
    salutation: clampString(letter.salutation || "", 100),
    body: clampString(letter.body || "", 20000),
    closing: clampString(letter.closing || "", 120),
    signatoryName: clampString(letter.signatoryName || "", 160),
    signatoryTitle: clampString(letter.signatoryTitle || "", 160),
    signatoryDept: clampString(letter.signatoryDept || "", 160),
    attachments: clampString(letter.attachments || "", 1000),
    ccList: clampString(letter.ccList || "", 1000),
    letterheadStyle: (["classic", "modern", "archival"].includes(
      letter.letterheadStyle
    )
      ? letter.letterheadStyle
      : "classic") as "classic" | "modern" | "archival",
    letterFont: (["sutonnymj", "serif", "sans"].includes(letter.letterFont)
      ? letter.letterFont
      : "sutonnymj") as "sutonnymj" | "serif" | "sans",
    department: clampString(letter.department || "", 120),
    branchPadDepartment: clampString(letter.branchPadDepartment || "", 200),
  };

  try {
    const letterRef = doc(db, "letters", id);
    const snap = await getDoc(letterRef);
    if (!snap.exists()) {
      await setDoc(letterRef, {
        id,
        ownerUid: uid,
        ...mutableFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(letterRef, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}

export function subscribeCloudLetters(
  ownerUid: string,
  onData: (letters: SavedLetter[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const uid = sanitizeFirestoreId(ownerUid);
  const path = "letters";
  const q = query(
    collection(db, "letters"),
    where("ownerUid", "==", uid),
    limit(500)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: SavedLetter[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          templateType: String(data.templateType || "সাধারণ দাপ্তরিক পত্র"),
          refNumber: String(data.refNumber || ""),
          dateText: String(data.dateText || ""),
          showBanglaDate: true,
          banglaDateText: "",
          recipientPrefix: String(data.recipientPrefix || "বরাবর"),
          recipientName: String(data.recipientName || ""),
          recipientTitle: String(data.recipientTitle || ""),
          recipientOrg: String(data.recipientOrg || ""),
          recipientAddress: String(data.recipientAddress || ""),
          subject: String(data.subject || ""),
          salutation: String(data.salutation || "মহোদয়,"),
          body: String(data.body || ""),
          closing: String(data.closing || "বিনীত,"),
          signatoryName: String(data.signatoryName || ""),
          signatoryTitle: String(data.signatoryTitle || ""),
          signatoryDept: String(data.signatoryDept || ""),
          attachments: String(data.attachments || ""),
          ccList: String(data.ccList || ""),
          letterheadStyle:
            data.letterheadStyle === "modern" || data.letterheadStyle === "archival"
              ? data.letterheadStyle
              : "classic",
          letterFont:
            data.letterFont === "serif" || data.letterFont === "sans"
              ? data.letterFont
              : "sutonnymj",
          showWatermark: true,
          showSealPlaceholder: false,
          savedAt: timestampToIso(data.updatedAt || data.createdAt),
          ownerUserId: String(data.ownerUid || ""),
          ownerName: String(data.ownerName || ""),
          department: String(data.department || ""),
          ...(data.branchPadDepartment
            ? { branchPadDepartment: String(data.branchPadDepartment) }
            : {}),
        };
      });
      list.sort(
        (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
      );
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function deleteLetterFromCloud(letterId: string): Promise<void> {
  const id = sanitizeFirestoreId(letterId);
  const path = `letters/${id}`;
  try {
    await deleteDoc(doc(db, "letters", id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveVoiceSessionToCloud(
  session: {
    id: string;
    title: string;
    voiceName: LiveVoiceName;
    turns: VoiceTranscriptTurn[];
    summary?: string;
  },
  ownerUid: string
): Promise<void> {
  const id = sanitizeFirestoreId(session.id);
  const uid = sanitizeFirestoreId(ownerUid);
  const path = `voice_sessions/${id}`;

  const boundedTurns = session.turns.slice(0, 50).map((t) => ({
    id: clampString(t.id, 64),
    role: t.role === "assistant" ? "assistant" : "user",
    text: clampString(t.text, 2000),
    timestamp: clampString(t.timestamp, 64),
  }));

  const payload = {
    title: clampString(session.title || "ভয়েস কথোপকথন", 200),
    voiceName: session.voiceName,
    turns: boundedTurns,
    summary: clampString(session.summary || "", 2000),
  };

  try {
    const ref = doc(db, "voice_sessions", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id,
        ownerUid: uid,
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
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeVoiceSessions(
  ownerUid: string,
  onData: (sessions: CloudVoiceSession[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const uid = sanitizeFirestoreId(ownerUid);
  const path = "voice_sessions";
  const q = query(
    collection(db, "voice_sessions"),
    where("ownerUid", "==", uid),
    limit(25)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: CloudVoiceSession[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          ownerUid: String(data.ownerUid || uid),
          title: String(data.title || "ভয়েস কথোপকথন"),
          voiceName: (["Zephyr", "Kore", "Puck", "Charon", "Fenrir"].includes(
            data.voiceName
          )
            ? data.voiceName
            : "Zephyr") as LiveVoiceName,
          turns: Array.isArray(data.turns) ? data.turns : [],
          summary: String(data.summary || ""),
          createdAt: timestampToIso(data.createdAt),
          updatedAt: timestampToIso(data.updatedAt || data.createdAt),
        };
      });
      list.sort(
        (a, b) =>
          new Date(b.updatedAt || 0).getTime() -
          new Date(a.updatedAt || 0).getTime()
      );
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function deleteVoiceSessionFromCloud(
  sessionId: string
): Promise<void> {
  const id = sanitizeFirestoreId(sessionId);
  const path = `voice_sessions/${id}`;
  try {
    await deleteDoc(doc(db, "voice_sessions", id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
