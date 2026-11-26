import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  DEFAULT_AI_ASSISTANT_CONFIG,
  DEFAULT_DEPARTMENTS,
  DEFAULT_ORGANIZATION,
  DEFAULT_PLUGINS,
  DEFAULT_QUICK_PHRASES,
  DEFAULT_SITE_CONFIG,
  LETTER_TEMPLATES,
} from "../src/data/templates.ts";
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
  UserRole,
  UserUsageProfile,
} from "../src/types.ts";

export interface StoredUser extends PublicUser {
  passwordHash: string;
}

export interface AppDatabase {
  schemaVersion: number;
  revision: number;
  updatedAt?: string;
  sessionSecret: string;
  siteConfig: SiteConfig;
  aiAssistantConfig: AiAssistantConfig;
  organization: OrganizationProfile;
  departments: DepartmentItem[];
  templates: LetterTemplate[];
  quickPhrases: QuickPhrase[];
  plugins: SitePlugin[];
  userUsage: Record<string, UserUsageProfile>;
  users: StoredUser[];
  letters: SavedLetter[];
  deletedLetterIds?: string[];
}

const CURRENT_SCHEMA_VERSION = 7;
const DATA_DIR = path.resolve(process.cwd(), "data");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const DB_PATH = path.join(DATA_DIR, "app-store.json");
const DB_BACKUP_PATH = path.join(DATA_DIR, "app-store.backup.json");

export function emptyUsageProfile(): UserUsageProfile {
  return {
    templateCounts: {},
    pinnedTemplateIds: [],
    recentTemplateIds: [],
  };
}

export function getUserUsage(
  db: AppDatabase,
  userId: string
): UserUsageProfile {
  if (!db.userUsage) db.userUsage = {};
  if (!db.userUsage[userId]) {
    db.userUsage[userId] = emptyUsageProfile();
  }
  return db.userUsage[userId];
}

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
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    updatedAt: now,
    sessionSecret: crypto.randomBytes(32).toString("hex"),
    siteConfig: { ...DEFAULT_SITE_CONFIG },
    aiAssistantConfig: {
      ...DEFAULT_AI_ASSISTANT_CONFIG,
      quickCommands: [...DEFAULT_AI_ASSISTANT_CONFIG.quickCommands],
    },
    organization: { ...DEFAULT_ORGANIZATION },
    departments: DEFAULT_DEPARTMENTS.map((d) => ({ ...d })),
    templates: LETTER_TEMPLATES.map((t) => ({ ...t })),
    quickPhrases: DEFAULT_QUICK_PHRASES.map((p) => ({ ...p })),
    plugins: DEFAULT_PLUGINS.map((pl) => ({ ...pl, config: { ...pl.config } })),
    userUsage: {},
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
    deletedLetterIds: [],
  };
}

let cachedDb: AppDatabase | null = null;

function readJsonStoreFile(filePath: string): Partial<AppDatabase> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppDatabase>;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (err) {
    console.error(`Failed to parse store file ${filePath}:`, err);
  }
  return null;
}

export function getDb(): AppDatabase {
  if (cachedDb) return cachedDb;

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const parsed = readJsonStoreFile(DB_PATH) || readJsonStoreFile(DB_BACKUP_PATH);
    if (parsed) {
      const fallback = createInitialDb();
      const loadedSchema = parsed.schemaVersion || 1;

      const departments =
        Array.isArray(parsed.departments) && parsed.departments.length > 0
          ? [...parsed.departments]
          : fallback.departments;

      const templates =
        Array.isArray(parsed.templates) && parsed.templates.length > 0
          ? [...parsed.templates]
          : fallback.templates;

      const plugins =
        Array.isArray(parsed.plugins) && parsed.plugins.length > 0
          ? [...parsed.plugins]
          : fallback.plugins;

      let migrated = false;
      if (loadedSchema < CURRENT_SCHEMA_VERSION) {
        migrated = true;
        // Ensure Audit department exists on upgrade
        const auditDept = DEFAULT_DEPARTMENTS.find(
          (d) => d.id === "dept-audit"
        );
        if (
          auditDept &&
          !departments.some(
            (d) => d.id === auditDept.id || d.name === auditDept.name
          )
        ) {
          departments.splice(1, 0, { ...auditDept });
        }

        // Seed Audit templates and Incentive Allowance template if not already present
        for (const tpl of LETTER_TEMPLATES) {
          if (
            (tpl.id.startsWith("tpl-audit-") ||
              tpl.id === "tpl-ngo-incentive-allowance") &&
            !templates.some((t) => t.id === tpl.id)
          ) {
            templates.push({ ...tpl });
          }
        }

        // Ensure all built-in plugins exist and upgrade branch-pad-designer config defaults
        for (const pl of DEFAULT_PLUGINS) {
          const existingIdx = plugins.findIndex((existing) => existing.id === pl.id);
          if (existingIdx < 0) {
            plugins.push({ ...pl, config: { ...pl.config } });
          } else if (pl.type === "branch-pad-designer") {
            const cur = plugins[existingIdx];
            plugins[existingIdx] = {
              ...cur,
              name: pl.name,
              description: pl.description,
              config: {
                ...(cur.config || {}),
                branchPads: cur.config?.branchPads || {},
                userPads: cur.config?.userPads || {},
                allowUserSelfPadCustomize:
                  cur.config?.allowUserSelfPadCustomize !== false,
              },
            };
          }
        }
      }

      cachedDb = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        revision: typeof parsed.revision === "number" ? parsed.revision : 0,
        updatedAt:
          typeof parsed.updatedAt === "string"
            ? parsed.updatedAt
            : fallback.updatedAt,
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
          uiTexts: {
            ...(fallback.siteConfig.uiTexts || {}),
            ...(parsed.siteConfig?.uiTexts && typeof parsed.siteConfig.uiTexts === "object"
              ? parsed.siteConfig.uiTexts
              : {}),
          },
          uiBlocks: Array.isArray(parsed.siteConfig?.uiBlocks)
            ? parsed.siteConfig.uiBlocks
            : [],
          customBlocks: Array.isArray(parsed.siteConfig?.customBlocks)
            ? parsed.siteConfig.customBlocks
            : [],
        },
        aiAssistantConfig: {
          ...fallback.aiAssistantConfig,
          ...(parsed.aiAssistantConfig || {}),
          quickCommands: Array.isArray(parsed.aiAssistantConfig?.quickCommands)
            ? parsed.aiAssistantConfig.quickCommands
            : fallback.aiAssistantConfig.quickCommands,
        },
        organization: {
          ...fallback.organization,
          ...(parsed.organization || {}),
        },
        departments,
        templates,
        quickPhrases: Array.isArray(parsed.quickPhrases)
          ? parsed.quickPhrases
          : fallback.quickPhrases,
        plugins,
        userUsage:
          parsed.userUsage && typeof parsed.userUsage === "object"
            ? parsed.userUsage
            : {},
        users:
          Array.isArray(parsed.users) && parsed.users.length > 0
            ? parsed.users
            : fallback.users,
        letters: Array.isArray(parsed.letters) ? parsed.letters : [],
        deletedLetterIds: Array.isArray(parsed.deletedLetterIds)
          ? parsed.deletedLetterIds
              .filter((id): id is string => typeof id === "string" && Boolean(id))
              .slice(0, 500)
          : [],
      };

      if (migrated) {
        saveDb(cachedDb, { bumpRevision: false });
      }
      return cachedDb;
    }
  } catch (err) {
    console.error("Failed to read app-store.json, initializing fresh store:", err);
  }

  cachedDb = createInitialDb();
  saveDb(cachedDb, { bumpRevision: false });
  return cachedDb;
}

export function saveDb(
  db: AppDatabase,
  options?: { bumpRevision?: boolean }
): void {
  const bumpRevision = options?.bumpRevision !== false;
  if (bumpRevision) {
    db.revision = (typeof db.revision === "number" ? db.revision : 0) + 1;
    db.updatedAt = new Date().toISOString();
  }
  cachedDb = db;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const serialized = JSON.stringify(db, null, 2);
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, serialized, "utf-8");
  fs.renameSync(tmpPath, DB_PATH);

  try {
    const bakTmpPath = `${DB_BACKUP_PATH}.tmp`;
    fs.writeFileSync(bakTmpPath, serialized, "utf-8");
    fs.renameSync(bakTmpPath, DB_BACKUP_PATH);
  } catch {
    // Non-blocking secondary backup write
  }
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

export function filterTemplatesForUser(
  db: AppDatabase,
  user: StoredUser
): LetterTemplate[] {
  if (user.role === "admin") {
    return db.templates;
  }

  const accessPlugin = db.plugins.find((p) => p.type === "template-access");
  if (!accessPlugin || !accessPlugin.enabled) {
    return db.templates;
  }

  const rules = accessPlugin.config?.userTemplateRules || {};
  const userRule = rules[user.userId];
  const enforceDefault = accessPlugin.config?.enforceDepartmentDefault !== false;
  const mode = userRule?.mode || (enforceDefault ? "department" : "all");

  if (mode === "all") {
    return db.templates;
  }

  if (mode === "custom") {
    const allowedCats = new Set(userRule?.allowedCategories || []);
    const allowedIds = new Set(userRule?.allowedTemplateIds || []);
    return db.templates.filter(
      (tpl) => allowedCats.has(tpl.category) || allowedIds.has(tpl.id)
    );
  }

  // Default: department-scoped visibility
  if (!user.department || user.department === "সকল বিভাগ") {
    return db.templates;
  }
  return db.templates.filter((tpl) => tpl.category === user.department);
}

interface AiUndoEntry {
  id: string;
  createdAt: string;
  snapshotJson: string;
}

const aiUndoStack: AiUndoEntry[] = [];

export function createAiUndoSnapshot(db: AppDatabase): string {
  const id = `undo-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  aiUndoStack.unshift({
    id,
    createdAt: new Date().toISOString(),
    snapshotJson: JSON.stringify(db),
  });
  if (aiUndoStack.length > 15) {
    aiUndoStack.length = 15;
  }
  return id;
}

export function restoreAiUndoSnapshot(snapshotId: string): AppDatabase | null {
  const idx = aiUndoStack.findIndex((item) => item.id === snapshotId);
  if (idx === -1) return null;
  const entry = aiUndoStack[idx];
  const parsed = JSON.parse(entry.snapshotJson) as AppDatabase;
  aiUndoStack.splice(idx, 1);
  saveDb(parsed);
  return parsed;
}

export function sanitizeSvgMarkup(rawSvg: string): string {
  let clean = rawSvg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
  const svgStart = clean.search(/<svg[\s>]/i);
  const svgEnd = clean.lastIndexOf("</svg>");
  if (svgStart === -1 || svgEnd === -1) return "";
  clean = clean.slice(svgStart, svgEnd + 6).trim();
  if (!/xmlns\s*=/i.test(clean)) {
    clean = clean.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return clean;
}

export function saveMediaBuffer(buffer: Buffer, ext: string): string {
  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  }
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
  const filename = `media-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${safeExt}`;
  fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
  return `/api/media/${filename}`;
}

export function saveSvgMedia(rawSvg: string): string {
  const clean = sanitizeSvgMarkup(rawSvg);
  if (!clean) {
    throw new Error("Invalid SVG markup");
  }
  return saveMediaBuffer(Buffer.from(clean, "utf-8"), "svg");
}

export function getMediaFilePath(filename: string): string | null {
  if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(filename)) {
    return null;
  }
  const fullPath = path.join(MEDIA_DIR, filename);
  return fs.existsSync(fullPath) ? fullPath : null;
}

export function exportMediaFilesForBackup(): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(MEDIA_DIR)) return result;
  for (const name of fs.readdirSync(MEDIA_DIR)) {
    if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(name)) continue;
    const buf = fs.readFileSync(path.join(MEDIA_DIR, name));
    result[name] = buf.toString("base64");
  }
  return result;
}

export function restoreMediaFilesFromBackup(files: unknown): void {
  if (!files || typeof files !== "object") return;
  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  }
  for (const [name, b64] of Object.entries(files as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|svg)$/.test(name)) continue;
    if (typeof b64 !== "string" || !b64) continue;
    fs.writeFileSync(path.join(MEDIA_DIR, name), Buffer.from(b64, "base64"));
  }
}
