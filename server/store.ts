import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  DEFAULT_DEPARTMENTS,
  DEFAULT_ORGANIZATION,
  DEFAULT_QUICK_PHRASES,
  DEFAULT_SITE_CONFIG,
  LETTER_TEMPLATES,
} from "../src/data/templates.ts";
import type {
  DepartmentItem,
  LetterTemplate,
  OrganizationProfile,
  PublicUser,
  QuickPhrase,
  SavedLetter,
  SiteConfig,
  UserRole,
} from "../src/types.ts";

export interface StoredUser extends PublicUser {
  passwordHash: string;
}

export interface AppDatabase {
  sessionSecret: string;
  siteConfig: SiteConfig;
  organization: OrganizationProfile;
  departments: DepartmentItem[];
  templates: LetterTemplate[];
  quickPhrases: QuickPhrase[];
  users: StoredUser[];
  letters: SavedLetter[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app-store.json");

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, "hex");
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

function createInitialDb(): AppDatabase {
  const now = new Date().toISOString();
  return {
    sessionSecret: crypto.randomBytes(32).toString("hex"),
    siteConfig: { ...DEFAULT_SITE_CONFIG },
    organization: { ...DEFAULT_ORGANIZATION },
    departments: DEFAULT_DEPARTMENTS.map((d) => ({ ...d })),
    templates: LETTER_TEMPLATES.map((t) => ({ ...t })),
    quickPhrases: DEFAULT_QUICK_PHRASES.map((p) => ({ ...p })),
    users: [
      {
        id: "usr-admin-1",
        userId: "admin",
        passwordHash: hashPassword("mdo@2026"),
        fullName: "প্রধান প্রশাসক",
        designation: "সিস্টেম অ্যাডমিন",
        department: "সকল বিভাগ",
        role: "admin",
        isActive: true,
        createdAt: now,
      },
    ],
    letters: [],
  };
}

let cachedDb: AppDatabase | null = null;

export function getDb(): AppDatabase {
  if (cachedDb) return cachedDb;

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<AppDatabase>;
      const fallback = createInitialDb();
      cachedDb = {
        sessionSecret: parsed.sessionSecret || fallback.sessionSecret,
        siteConfig: {
          ...fallback.siteConfig,
          ...(parsed.siteConfig || {}),
          navLabels: {
            ...fallback.siteConfig.navLabels,
            ...(parsed.siteConfig?.navLabels || {}),
          },
          customLinks: Array.isArray(parsed.siteConfig?.customLinks)
            ? parsed.siteConfig.customLinks
            : fallback.siteConfig.customLinks,
        },
        organization: { ...fallback.organization, ...(parsed.organization || {}) },
        departments:
          Array.isArray(parsed.departments) && parsed.departments.length > 0
            ? parsed.departments
            : fallback.departments,
        templates:
          Array.isArray(parsed.templates) && parsed.templates.length > 0
            ? parsed.templates
            : fallback.templates,
        quickPhrases:
          Array.isArray(parsed.quickPhrases)
            ? parsed.quickPhrases
            : fallback.quickPhrases,
        users:
          Array.isArray(parsed.users) && parsed.users.length > 0
            ? parsed.users
            : fallback.users,
        letters: Array.isArray(parsed.letters) ? parsed.letters : [],
      };
      return cachedDb;
    }
  } catch (err) {
    console.error("Failed to read app-store.json, initializing fresh store:", err);
  }

  cachedDb = createInitialDb();
  saveDb(cachedDb);
  return cachedDb;
}

export function saveDb(db: AppDatabase): void {
  cachedDb = db;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), "utf-8");
  fs.renameSync(tmpPath, DB_PATH);
}

export function toPublicUser(user: StoredUser): PublicUser {
  const { passwordHash: _ignored, ...rest } = user;
  return rest;
}

export interface SessionTokenPayload {
  uid: string;
  userId: string;
  role: UserRole;
  exp: number;
}

export function signSessionToken(user: StoredUser): string {
  const db = getDb();
  const payload: SessionTokenPayload = {
    uid: user.id,
    userId: user.userId,
    role: user.role,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", db.sessionSecret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): StoredUser | null {
  if (!token || !token.includes(".")) return null;
  const db = getDb();
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac("sha256", db.sessionSecret)
    .update(encoded)
    .digest("base64url");

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf-8")
    ) as SessionTokenPayload;
    if (!payload.uid || Date.now() > payload.exp) return null;

    const user = db.users.find((u) => u.id === payload.uid && u.isActive);
    return user || null;
  } catch {
    return null;
  }
}
