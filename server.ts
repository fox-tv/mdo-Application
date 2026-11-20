import "dotenv/config";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Type, ThinkingLevel } from "@google/genai";
import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };
import { attachLiveVoiceServer } from "./server/liveVoiceBridge.ts";
import {
  generateContentResilient,
  getGeminiClient,
} from "./server/geminiClient.ts";
import {
  createAiUndoSnapshot,
  exportMediaFilesForBackup,
  filterTemplatesForUser,
  getDb,
  getMediaFilePath,
  getUserUsage,
  hashPassword,
  restoreAiUndoSnapshot,
  restoreMediaFilesFromBackup,
  saveDb,
  saveMediaBuffer,
  saveSvgMedia,
  signSessionToken,
  toPublicUser,
  verifyPassword,
  verifySessionToken,
} from "./server/store.ts";
import type { StoredUser } from "./server/store.ts";
import {
  executeAssistantTool,
  runAdminAssistantTurn,
} from "./server/adminAssistant.ts";
import {
  DEFAULT_AI_ASSISTANT_CONFIG,
  DEFAULT_PLUGINS,
  DEFAULT_SITE_CONFIG,
} from "./src/data/templates.ts";
import type {
  AiAssistantActionLog,
  AiAssistantConfig,
  AiAssistantPendingProposal,
  BranchPadConfig,
  BranchPadSignatory,
  CrestType,
  CustomNavLink,
  LetterFont,
  LetterheadStyle,
  LetterTemplate,
  OrganizationProfile,
  PluginConfigData,
  PluginType,
  SavedLetter,
  SiteConfig,
  SitePlugin,
  TemplateAccessMode,
  UserRole,
  UserTemplateAccessRule,
  UserUsageProfile,
} from "./src/types.ts";

function sanitizeCustomLinks(links: unknown): CustomNavLink[] {
  if (!Array.isArray(links)) return [];
  return links
    .filter((item): item is CustomNavLink => {
      return (
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as CustomNavLink).label === "string" &&
        typeof (item as CustomNavLink).url === "string"
      );
    })
    .map((item) => {
      const rawUrl = item.url.trim();
      const lower = rawUrl.toLowerCase();
      if (
        lower.startsWith("javascript:") ||
        lower.startsWith("data:") ||
        lower.startsWith("vbscript:")
      ) {
        return null;
      }
      const safeUrl =
        rawUrl.startsWith("http://") ||
        rawUrl.startsWith("https://") ||
        rawUrl.startsWith("/")
          ? rawUrl
          : `https://${rawUrl}`;
      return {
        id: typeof item.id === "string" && item.id ? item.id : `lnk-${Date.now()}`,
        label: item.label.trim(),
        url: safeUrl,
      };
    })
    .filter((item): item is CustomNavLink => Boolean(item && item.label && item.url));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const SESSION_COOKIE_NAME = "mdo_session";

interface AuthenticatedRequest extends Request {
  currentUser?: StoredUser;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = decodeURIComponent(part.slice(eq + 1).trim());
    if (key) result[key] = val;
  }
  return result;
}

function extractToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || "";
}

function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);
  const user = verifySessionToken(token);
  if (!user) {
    res.status(401).json({ error: "অনুগ্রহ করে প্রথমে লগইন করুন।" });
    return;
  }
  req.currentUser = user;
  next();
}

function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.currentUser || req.currentUser.role !== "admin") {
    res.status(403).json({
      error: "এই কাজটি করার জন্য অ্যাডমিন অনুমতি প্রয়োজন।",
    });
    return;
  }
  next();
}

function sendGeminiError(res: Response, err: unknown, fallbackBn: string): void {
  const raw = err instanceof Error ? err.message : String(err);
  const errStatus =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  console.error("[sendGeminiError]", { status: errStatus, message: raw.slice(0, 400) });

  if (raw.includes("GEMINI_API_KEY_MISSING")) {
    res.status(503).json({
      error:
        "সার্ভারে Gemini API কী কনফিগার করা নেই। অনুগ্রহ করে Settings > Secrets প্যানেল থেকে API কী যাচাই করুন।",
    });
    return;
  }

  if (
    errStatus === 403 ||
    raw.includes("403") ||
    raw.includes("PERMISSION_DENIED") ||
    raw.includes("API_KEY_INVALID") ||
    raw.toLowerCase().includes("api key not valid")
  ) {
    res.status(403).json({
      error:
        "API কী অনুমোদিত নয় বা সঠিক নয়। অনুগ্রহ করে Settings > Secrets প্যানেল থেকে API কী পরীক্ষা করুন।",
    });
    return;
  }

  if (errStatus === 429 || raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
    res.status(429).json({
      error:
        "অনুরোধের কোটা বা সীমা অতিক্রম করেছে। কিছুক্ষণ পর আবার চেষ্টা করুন অথবা Settings > Secrets প্যানেল থেকে বিলিং-সক্রিয় API কী পরীক্ষা করুন।",
    });
    return;
  }

  if (
    errStatus === 503 ||
    raw.includes('"code":503') ||
    raw.includes("UNAVAILABLE") ||
    raw.toLowerCase().includes("high demand")
  ) {
    res.status(503).json({
      error:
        "এআই সার্ভারে সাময়িকভাবে অতিরিক্ত চাপ রয়েছে। অনুগ্রহ করে কয়েক সেকেন্ড পর আবার চেষ্টা করুন।",
    });
    return;
  }

  if (errStatus === 400 || raw.includes("INVALID_ARGUMENT")) {
    res.status(400).json({
      error: `${fallbackBn} (${raw.slice(0, 180)})`,
    });
    return;
  }

  if (errStatus === 404 || raw.includes("NOT_FOUND")) {
    res.status(404).json({
      error: `${fallbackBn} (মডেল পাওয়া যায়নি: ${raw.slice(0, 160)})`,
    });
    return;
  }

  res.status(500).json({
    error: `${fallbackBn} (${raw.slice(0, 180)})`,
  });
}

interface GenerateLetterBody {
  mode: "generate" | "polish";
  prompt?: string;
  templateType?: string;
  tone?: string;
  organizationName?: string;
  organizationType?: string;
  recipientInfo?: string;
  currentSubject?: string;
  currentBody?: string;
}

async function startServer() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "10mb" }));

  // Initialize DB on startup
  getDb();

  app.get("/favicon.ico", (_req, res) => {
    res.sendFile(
      path.resolve(__dirname, "public/assets/aistudio/logo_a428c800.png")
    );
  });

  // ================= PUBLIC & AUTH ROUTES =================
  app.get("/api/bootstrap", (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const token = extractToken(req);
    const user = verifySessionToken(token);

    const publicBranding = {
      websiteName: db.siteConfig.websiteName,
      websiteSubtitle: db.siteConfig.websiteSubtitle,
      footerText: db.siteConfig.footerText,
      orgNameBn: db.organization.nameBn,
      logoDataUrl: db.organization.logoDataUrl,
      primaryColor: db.siteConfig.primaryColor,
      surfaceBgColor: db.siteConfig.surfaceBgColor,
      showLoginLogo: db.siteConfig.showLoginLogo,
      uiTexts: db.siteConfig.uiTexts || {},
      loginBannerUrl: db.siteConfig.loginBannerUrl || "",
      loginHeroImageUrl:
        db.siteConfig.loginHeroImageUrl || db.siteConfig.loginBannerUrl || "",
      loginHeroCaption: db.siteConfig.loginHeroCaption || "",
      showLiveClock: Boolean(db.siteConfig.showLiveClock),
      uiBlocks: (db.siteConfig.uiBlocks || []).filter(
        (b) =>
          b.enabled &&
          (b.placement === "login-top" || b.placement === "login-bottom")
      ),
      customBlocks: (db.siteConfig.customBlocks || db.siteConfig.uiBlocks || []).filter(
        (b) =>
          b.enabled &&
          (b.placement === "login-top" || b.placement === "login-bottom")
      ),
    };

    if (!user) {
      res.json({ authenticated: false, publicBranding });
      return;
    }

    const visibleLetters =
      user.role === "admin"
        ? db.letters
        : db.letters.filter(
            (l) => !l.ownerUserId || l.ownerUserId === user.userId
          );

    const visibleTemplates = filterTemplatesForUser(db, user);

    res.json({
      authenticated: true,
      publicBranding,
      workspace: {
        revision: db.revision || 0,
        user: toPublicUser(user),
        siteConfig: db.siteConfig,
        organization: db.organization,
        departments: db.departments,
        templates: visibleTemplates,
        quickPhrases: db.quickPhrases,
        plugins: db.plugins,
        userUsage: getUserUsage(db, user.userId),
        letters: visibleLetters,
        deletedLetterIds: db.deletedLetterIds || [],
      },
    });
  });

  app.post("/api/auth/login", (req, res) => {
    const { userId, password } = req.body as {
      userId?: string;
      password?: string;
    };
    const cleanId = (userId || "").trim();
    if (!cleanId || !password) {
      res.status(400).json({ error: "ইউজার আইডি ও পাসওয়ার্ড লিখুন।" });
      return;
    }

    const db = getDb();
    const found = db.users.find(
      (u) => u.userId.toLowerCase() === cleanId.toLowerCase()
    );

    if (!found || !verifyPassword(password, found.passwordHash)) {
      res.status(401).json({ error: "ইউজার আইডি বা পাসওয়ার্ড সঠিক নয়।" });
      return;
    }

    if (!found.isActive) {
      res.status(403).json({
        error: "আপনার অ্যাকাউন্টটি নিষ্ক্রিয় করা হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।",
      });
      return;
    }

    found.lastLoginAt = new Date().toISOString();
    saveDb(db, { bumpRevision: false });

    const token = signSessionToken(found);
    const isHttps =
      req.secure ||
      String(req.headers["x-forwarded-proto"] || "")
        .split(",")[0]
        .trim() === "https";
    const cookieAttrs = isHttps
      ? "HttpOnly; Path=/; SameSite=None; Secure"
      : "HttpOnly; Path=/; SameSite=Lax";
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${7 * 24 * 60 * 60}; ${cookieAttrs}`
    );

    res.json({
      token,
      user: toPublicUser(found),
    });
  });

  app.post("/api/auth/firebase-login", async (req, res) => {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken || typeof idToken !== "string") {
      res.status(400).json({ error: "Google টোকেন পাওয়া যায়নি।" });
      return;
    }

    try {
      const lookupRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        }
      );

      if (!lookupRes.ok) {
        res.status(401).json({ error: "Google অ্যাকাউন্ট যাচাই করা যায়নি।" });
        return;
      }

      const lookupData = (await lookupRes.json()) as {
        users?: Array<{
          localId?: string;
          email?: string;
          emailVerified?: boolean;
          displayName?: string;
        }>;
      };
      const account = lookupData.users?.[0];
      if (
        !account ||
        !account.emailVerified ||
        !account.email ||
        account.email.toLowerCase() !== "bipulmdmehedihasan@gmail.com"
      ) {
        res.status(403).json({
          error:
            "শুধুমাত্র অনুমোদিত প্রধান প্রশাসকের যাচাইকৃত Google অ্যাকাউন্ট দিয়ে সরাসরি প্রবেশ করা যাবে।",
        });
        return;
      }

      const db = getDb();
      const adminUser =
        db.users.find((u) => u.userId === "admin" && u.isActive) ||
        db.users.find((u) => u.role === "admin" && u.isActive);

      if (!adminUser) {
        res.status(403).json({
          error: "কোনো সক্রিয় অ্যাডমিন অ্যাকাউন্ট পাওয়া যায়নি।",
        });
        return;
      }

      adminUser.lastLoginAt = new Date().toISOString();
      saveDb(db, { bumpRevision: false });

      const token = signSessionToken(adminUser);
      const isHttps =
        req.secure ||
        String(req.headers["x-forwarded-proto"] || "")
          .split(",")[0]
          .trim() === "https";
      const cookieAttrs = isHttps
        ? "HttpOnly; Path=/; SameSite=None; Secure"
        : "HttpOnly; Path=/; SameSite=Lax";
      res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${7 * 24 * 60 * 60}; ${cookieAttrs}`
      );

      res.json({
        token,
        user: toPublicUser(adminUser),
      });
    } catch (err) {
      console.error("Firebase login verification error:", err);
      res.status(500).json({ error: "Google লগইন যাচাই করতে সমস্যা হয়েছে।" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const isHttps =
      req.secure ||
      String(req.headers["x-forwarded-proto"] || "")
        .split(",")[0]
        .trim() === "https";
    const cookieAttrs = isHttps
      ? "HttpOnly; Path=/; SameSite=None; Secure"
      : "HttpOnly; Path=/; SameSite=Lax";
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=; Max-Age=0; ${cookieAttrs}`
    );
    res.json({ ok: true });
  });

  app.post(
    "/api/auth/change-password",
    requireAuth,
    (req: AuthenticatedRequest, res) => {
      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };
      if (!currentPassword || !newPassword || newPassword.length < 4) {
        res.status(400).json({
          error: "বর্তমান পাসওয়ার্ড ও কমপক্ষে ৪ অক্ষরের নতুন পাসওয়ার্ড দিন।",
        });
        return;
      }

      const db = getDb();
      const target = db.users.find((u) => u.id === req.currentUser!.id);
      if (!target || !verifyPassword(currentPassword, target.passwordHash)) {
        res.status(400).json({ error: "বর্তমান পাসওয়ার্ড সঠিক নয়।" });
        return;
      }

      target.passwordHash = hashPassword(newPassword);
      if (target.userId === "admin") {
        db.siteConfig.adminPasswordChanged = true;
      }
      saveDb(db);

      res.json({ ok: true, adminPasswordChanged: db.siteConfig.adminPasswordChanged });
    }
  );

  // ================= MEDIA & AVATAR ROUTES =================
  app.get("/api/media/:filename", (req, res) => {
    const filePath = getMediaFilePath(String(req.params.filename || ""));
    if (!filePath) {
      res.status(404).json({ error: "মিডিয়া ফাইল পাওয়া যায়নি।" });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
    };
    res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(filePath);
  });

  app.post("/api/media/upload", requireAuth, (req, res) => {
    const { dataUrl } = req.body as { dataUrl?: string };
    if (typeof dataUrl !== "string" || !dataUrl.trim()) {
      res.status(400).json({ error: "সঠিক ছবির ডাটা প্রদান করুন।" });
      return;
    }
    const match = /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=]+)$/i.exec(
      dataUrl.trim()
    );
    if (!match) {
      res.status(400).json({ error: "শুধুমাত্র PNG, JPG, WEBP, GIF বা SVG ছবি আপলোড করা যাবে।" });
      return;
    }
    const mimeSubtype = match[1].toLowerCase();
    const buf = Buffer.from(match[2], "base64");
    if (buf.length > 4 * 1024 * 1024) {
      res.status(400).json({ error: "ছবির আকার ৪ মেগাবাইটের কম হতে হবে।" });
      return;
    }
    try {
      const url =
        mimeSubtype === "svg+xml"
          ? saveSvgMedia(buf.toString("utf-8"))
          : saveMediaBuffer(buf, mimeSubtype === "jpeg" ? "jpg" : mimeSubtype);
      const db = getDb();
      saveDb(db);
      res.json({ url });
    } catch {
      res.status(400).json({ error: "ছবিটি সংরক্ষণ করা যায়নি।" });
    }
  });

  app.post("/api/auth/avatar", requireAuth, (req: AuthenticatedRequest, res) => {
    const { avatarDataUrl, avatarUrl } = req.body as {
      avatarDataUrl?: string;
      avatarUrl?: string;
    };
    const db = getDb();
    const target = db.users.find((u) => u.id === req.currentUser!.id);
    if (!target) {
      res.status(404).json({ error: "ব্যবহারকারী পাওয়া যায়নি।" });
      return;
    }
    const rawInput = typeof avatarDataUrl === "string" ? avatarDataUrl : avatarUrl;
    const raw = typeof rawInput === "string" ? rawInput.trim() : "";
    if (!raw) {
      target.avatarDataUrl = "";
      target.avatarUrl = "";
      saveDb(db);
      res.json({ user: toPublicUser(target) });
      return;
    }
    let storedUrl = "";
    const dataMatch = /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=]+)$/i.exec(
      raw
    );
    if (dataMatch) {
      const subtype = dataMatch[1].toLowerCase();
      const buf = Buffer.from(dataMatch[2], "base64");
      storedUrl =
        subtype === "svg+xml"
          ? saveSvgMedia(buf.toString("utf-8"))
          : saveMediaBuffer(buf, subtype === "jpeg" ? "jpg" : subtype);
    } else if (raw.startsWith("/api/media/") || raw.startsWith("/assets/") || /^https?:\/\//i.test(raw)) {
      storedUrl = raw;
    } else {
      res.status(400).json({ error: "সঠিক ছবির ফরম্যাট প্রদান করুন।" });
      return;
    }
    target.avatarDataUrl = storedUrl;
    target.avatarUrl = storedUrl;
    saveDb(db);
    res.json({ user: toPublicUser(target) });
  });

  // ================= LETTERS & WORKSPACE ROUTES =================
  app.post("/api/letters", requireAuth, (req: AuthenticatedRequest, res) => {
    const letter = req.body as SavedLetter;
    if (!letter || !letter.id) {
      res.status(400).json({ error: "চিঠির তথ্য সঠিক নয়।" });
      return;
    }

    const db = getDb();
    const user = req.currentUser!;
    const idx = db.letters.findIndex((item) => item.id === letter.id);
    const entry: SavedLetter = {
      ...letter,
      savedAt: new Date().toISOString(),
      ownerUserId:
        idx >= 0 ? db.letters[idx].ownerUserId || user.userId : user.userId,
      ownerName:
        idx >= 0 ? db.letters[idx].ownerName || user.fullName : user.fullName,
      department:
        idx >= 0 ? db.letters[idx].department || user.department : user.department,
    };

    if (idx >= 0) {
      const existing = db.letters[idx];
      if (
        user.role !== "admin" &&
        existing.ownerUserId &&
        existing.ownerUserId !== user.userId
      ) {
        res.status(403).json({ error: "অন্য ব্যবহারকারীর চিঠি সম্পাদনার অনুমতি নেই।" });
        return;
      }
      db.letters[idx] = entry;
    } else {
      db.letters.unshift(entry);
    }

    if (Array.isArray(db.deletedLetterIds) && db.deletedLetterIds.includes(entry.id)) {
      db.deletedLetterIds = db.deletedLetterIds.filter((id) => id !== entry.id);
    }

    const matchedTpl = db.templates.find(
      (t) => t.title === letter.templateType
    );
    if (idx < 0 && matchedTpl) {
      const usage = getUserUsage(db, user.userId);
      usage.templateCounts[matchedTpl.id] =
        (usage.templateCounts[matchedTpl.id] || 0) + 1;
      usage.recentTemplateIds = [
        matchedTpl.id,
        ...usage.recentTemplateIds.filter((id) => id !== matchedTpl.id),
      ].slice(0, 8);
    }

    saveDb(db);
    res.json({ letter: entry });
  });

  app.post("/api/usage/track", requireAuth, (req: AuthenticatedRequest, res) => {
    const { templateId, action } = req.body as {
      templateId?: string;
      action?: "use" | "pin" | "unpin";
    };
    const db = getDb();
    const user = req.currentUser!;
    const usage = getUserUsage(db, user.userId);

    if (templateId && typeof templateId === "string") {
      if (action === "pin") {
        if (!usage.pinnedTemplateIds.includes(templateId)) {
          usage.pinnedTemplateIds.unshift(templateId);
        }
      } else if (action === "unpin") {
        usage.pinnedTemplateIds = usage.pinnedTemplateIds.filter(
          (id) => id !== templateId
        );
      } else {
        usage.templateCounts[templateId] =
          (usage.templateCounts[templateId] || 0) + 1;
        usage.recentTemplateIds = [
          templateId,
          ...usage.recentTemplateIds.filter((id) => id !== templateId),
        ].slice(0, 8);
      }
      saveDb(db);
    }

    res.json({ userUsage: usage });
  });

  app.get(
    "/api/my-backup",
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const user = req.currentUser!;
      const myLetters = db.letters.filter(
        (l) => !l.ownerUserId || l.ownerUserId === user.userId
      );
      res.json({
        version: 2,
        scope: "user",
        exportedAt: new Date().toISOString(),
        user: toPublicUser(user),
        userUsage: getUserUsage(db, user.userId),
        letters: myLetters,
      });
    }
  );

  app.delete("/api/letters/:id", requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const user = req.currentUser!;
    const letterId = String(req.params.id || "").trim();
    if (!letterId) {
      res.status(400).json({ error: "চিঠির আইডি সঠিক নয়।" });
      return;
    }

    const target = db.letters.find((l) => l.id === letterId);
    if (!target) {
      if (user.role !== "admin") {
        res.status(404).json({ error: "চিঠি খুঁজে পাওয়া যায়নি।" });
        return;
      }
      const prevDeleted = Array.isArray(db.deletedLetterIds) ? db.deletedLetterIds : [];
      db.deletedLetterIds = [
        letterId,
        ...prevDeleted.filter((id) => id !== letterId),
      ].slice(0, 500);
      saveDb(db);
      res.json({ ok: true, deletedFromCloudOnly: true });
      return;
    }

    if (
      user.role !== "admin" &&
      target.ownerUserId &&
      target.ownerUserId !== user.userId
    ) {
      res.status(403).json({ error: "এই চিঠিটি মুছে ফেলার অনুমতি নেই।" });
      return;
    }

    db.letters = db.letters.filter((l) => l.id !== letterId);
    const prevDeleted = Array.isArray(db.deletedLetterIds) ? db.deletedLetterIds : [];
    db.deletedLetterIds = [
      letterId,
      ...prevDeleted.filter((id) => id !== letterId),
    ].slice(0, 500);
    saveDb(db);
    res.json({ ok: true });
  });

  app.put("/api/organization", requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const user = req.currentUser!;
    if (user.role !== "admin" && !db.siteConfig.allowUserOrgEdit) {
      res.status(403).json({
        error: "প্রতিষ্ঠানের তথ্য শুধুমাত্র অ্যাডমিন পরিবর্তন করতে পারবেন।",
      });
      return;
    }

    const updated = req.body as OrganizationProfile;
    db.organization = { ...db.organization, ...updated };
    saveDb(db);
    res.json({ organization: db.organization });
  });

  // Templates CRUD (Admin or authorized user)
  app.post("/api/templates", requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const user = req.currentUser!;
    if (user.role !== "admin" && !db.siteConfig.allowUserTemplateCreate) {
      res.status(403).json({
        error: "নতুন টেমপ্লেট যোগ করার অনুমতি শুধুমাত্র অ্যাডমিনের রয়েছে।",
      });
      return;
    }

    const tpl = req.body as Partial<LetterTemplate>;
    if (!tpl.title?.trim() || !tpl.category?.trim()) {
      res.status(400).json({ error: "টেমপ্লেটের শিরোনাম ও বিভাগ আবশ্যক।" });
      return;
    }

    const requestedId =
      typeof tpl.id === "string" &&
      /^tpl-[a-zA-Z0-9_-]{3,64}$/.test(tpl.id.trim()) &&
      !db.templates.some((t) => t.id === tpl.id!.trim())
        ? tpl.id.trim()
        : `tpl-${Date.now()}`;

    const created: LetterTemplate = {
      id: requestedId,
      title: tpl.title.trim(),
      category: tpl.category.trim(),
      summary: (tpl.summary || "").trim(),
      refSuffix: (tpl.refSuffix || "পত্র").trim(),
      recipientPrefix: tpl.recipientPrefix ?? "বরাবর",
      recipientName: tpl.recipientName || "",
      recipientTitle: tpl.recipientTitle || "",
      recipientOrg: tpl.recipientOrg || "",
      recipientAddress: tpl.recipientAddress || "",
      subject: tpl.subject || "",
      salutation: tpl.salutation || "মহোদয়,",
      body: tpl.body || "",
      closing: tpl.closing || "বিনীত,",
      attachments: tpl.attachments || "",
      ccList: tpl.ccList || "",
    };

    db.templates.unshift(created);
    saveDb(db);
    res.json({ template: created });
  });

  app.put("/api/templates/:id", requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const user = req.currentUser!;
    if (user.role !== "admin" && !db.siteConfig.allowUserTemplateCreate) {
      res.status(403).json({
        error: "টেমপ্লেট সম্পাদনার অনুমতি শুধুমাত্র অ্যাডমিনের রয়েছে।",
      });
      return;
    }

    const idx = db.templates.findIndex((t) => t.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: "টেমপ্লেট পাওয়া যায়নি।" });
      return;
    }

    const patch = req.body as Partial<LetterTemplate>;
    db.templates[idx] = { ...db.templates[idx], ...patch, id: db.templates[idx].id };
    saveDb(db);
    res.json({ template: db.templates[idx] });
  });

  app.delete("/api/templates/:id", requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const user = req.currentUser!;
    const tplPluginEnabled = db.plugins.some(
      (p) => p.type === "template-manager" && p.enabled
    );
    if (
      user.role !== "admin" &&
      (!db.siteConfig.allowUserTemplateCreate || !tplPluginEnabled)
    ) {
      res.status(403).json({
        error: "টেমপ্লেট মুছে ফেলার অনুমতি শুধুমাত্র অ্যাডমিনের রয়েছে।",
      });
      return;
    }
    db.templates = db.templates.filter((t) => t.id !== req.params.id);
    saveDb(db);
    res.json({ ok: true });
  });

  // ================= ADMIN PANEL ROUTES =================
  app.get("/api/admin/users", requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    res.json({ users: db.users.map(toPublicUser) });
  });

  app.post("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
    const { userId, password, fullName, designation, department, role, avatarDataUrl } =
      req.body as {
        userId?: string;
        password?: string;
        fullName?: string;
        designation?: string;
        department?: string;
        role?: UserRole;
        avatarDataUrl?: string;
      };

    const cleanId = (userId || "").trim();
    if (!cleanId || !/^[a-zA-Z0-9_.-]{3,32}$/.test(cleanId)) {
      res.status(400).json({
        error:
          "ইউজার আইডি ৩ থেকে ৩২ অক্ষরের মধ্যে হতে হবে (ইংরেজি অক্ষর, সংখ্যা বা _.-)।",
      });
      return;
    }
    if (!password || password.length < 4) {
      res.status(400).json({ error: "কমপক্ষে ৪ অক্ষরের পাসওয়ার্ড দিন।" });
      return;
    }
    if (!fullName?.trim()) {
      res.status(400).json({ error: "ব্যবহারকারীর পূর্ণ নাম লিখুন।" });
      return;
    }

    const db = getDb();
    if (db.users.some((u) => u.userId.toLowerCase() === cleanId.toLowerCase())) {
      res.status(409).json({ error: "এই ইউজার আইডি আগে থেকেই রয়েছে।" });
      return;
    }

    const created: StoredUser = {
      id: `usr-${Date.now()}`,
      userId: cleanId,
      passwordHash: hashPassword(password),
      fullName: fullName.trim(),
      designation: (designation || "").trim(),
      department: (department || "সকল বিভাগ").trim(),
      role: role === "admin" ? "admin" : "user",
      isActive: true,
      avatarDataUrl: typeof avatarDataUrl === "string" ? avatarDataUrl.trim() : "",
      createdAt: new Date().toISOString(),
    };

    db.users.push(created);
    saveDb(db);
    res.json({ user: toPublicUser(created) });
  });

  app.put(
    "/api/admin/users/:id",
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      const target = db.users.find((u) => u.id === req.params.id);
      if (!target) {
        res.status(404).json({ error: "ব্যবহারকারী পাওয়া যায়নি।" });
        return;
      }

      const { fullName, designation, department, role, isActive, newPassword, avatarDataUrl } =
        req.body as {
          fullName?: string;
          designation?: string;
          department?: string;
          role?: UserRole;
          isActive?: boolean;
          newPassword?: string;
          avatarDataUrl?: string;
        };

      if (target.id === req.currentUser!.id) {
        if (isActive === false) {
          res.status(400).json({ error: "নিজের অ্যাডমিন অ্যাকাউন্ট নিষ্ক্রিয় করা যাবে না।" });
          return;
        }
        if (role === "user") {
          res.status(400).json({ error: "নিজের অ্যাডমিন ভূমিকা পরিবর্তন করা যাবে না।" });
          return;
        }
      }

      if (typeof fullName === "string" && fullName.trim()) {
        target.fullName = fullName.trim();
      }
      if (typeof designation === "string") {
        target.designation = designation.trim();
      }
      if (typeof department === "string" && department.trim()) {
        target.department = department.trim();
      }
      if (role === "admin" || role === "user") {
        target.role = role;
      }
      if (typeof isActive === "boolean") {
        target.isActive = isActive;
      }
      if (typeof avatarDataUrl === "string") {
        target.avatarDataUrl = avatarDataUrl.trim();
      }
      if (typeof newPassword === "string" && newPassword.length > 0) {
        if (newPassword.length < 4) {
          res.status(400).json({ error: "নতুন পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে।" });
          return;
        }
        target.passwordHash = hashPassword(newPassword);
        if (target.userId === "admin") {
          db.siteConfig.adminPasswordChanged = true;
        }
      }

      saveDb(db);
      res.json({ user: toPublicUser(target) });
    }
  );

  app.delete(
    "/api/admin/users/:id",
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const db = getDb();
      if (req.params.id === req.currentUser!.id) {
        res.status(400).json({ error: "নিজের অ্যাকাউন্ট মুছে ফেলা যাবে না।" });
        return;
      }

      const target = db.users.find((u) => u.id === req.params.id);
      if (!target) {
        res.status(404).json({ error: "ব্যবহারকারী পাওয়া যায়নি।" });
        return;
      }

      if (
        target.role === "admin" &&
        db.users.filter((u) => u.role === "admin" && u.isActive).length <= 1
      ) {
        res.status(400).json({ error: "অন্তত একজন সক্রিয় অ্যাডমিন থাকতে হবে।" });
        return;
      }

      db.users = db.users.filter((u) => u.id !== req.params.id);
      const accessPlg = db.plugins.find((p) => p.type === "template-access");
      if (accessPlg?.config?.userTemplateRules) {
        delete accessPlg.config.userTemplateRules[target.userId];
      }
      saveDb(db);
      res.json({ ok: true, plugins: db.plugins });
    }
  );

  app.put("/api/admin/site-config", requireAuth, requireAdmin, (req, res) => {
    const db = getDb();
    const patch = req.body as Partial<SiteConfig>;
    db.siteConfig = {
      ...db.siteConfig,
      ...patch,
      navLabels: {
        ...db.siteConfig.navLabels,
        ...(patch.navLabels || {}),
      },
      customLinks: Array.isArray(patch.customLinks)
        ? sanitizeCustomLinks(patch.customLinks)
        : db.siteConfig.customLinks,
      uiTexts:
        patch.uiTexts && typeof patch.uiTexts === "object"
          ? { ...(db.siteConfig.uiTexts || {}), ...patch.uiTexts }
          : db.siteConfig.uiTexts || {},
      uiBlocks: Array.isArray(patch.uiBlocks)
        ? patch.uiBlocks
        : db.siteConfig.uiBlocks || [],
      adminPasswordChanged: db.siteConfig.adminPasswordChanged,
    };
    saveDb(db);
    res.json({ siteConfig: db.siteConfig });
  });

  app.post("/api/admin/reset-site-config", requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    db.siteConfig = {
      ...DEFAULT_SITE_CONFIG,
      navLabels: { ...DEFAULT_SITE_CONFIG.navLabels },
      customLinks: [],
      uiTexts: {},
      uiBlocks: [],
      adminPasswordChanged: db.siteConfig.adminPasswordChanged,
    };
    saveDb(db);
    res.json({ siteConfig: db.siteConfig });
  });

  app.get("/api/admin/backup", requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    res.json({
      version: 2,
      scope: "full-server",
      revision: db.revision || 0,
      updatedAt: db.updatedAt || new Date().toISOString(),
      exportedAt: new Date().toISOString(),
      siteConfig: db.siteConfig,
      aiAssistantConfig: db.aiAssistantConfig,
      organization: db.organization,
      departments: db.departments,
      templates: db.templates,
      quickPhrases: db.quickPhrases,
      plugins: db.plugins,
      userUsage: db.userUsage,
      users: db.users,
      letters: db.letters,
      deletedLetterIds: db.deletedLetterIds || [],
      mediaFiles: exportMediaFilesForBackup(),
    });
  });

  app.post("/api/admin/restore", requireAuth, requireAdmin, (req, res) => {
    const payload = req.body as {
      revision?: number;
      fromCloudRestore?: boolean;
      siteConfig?: Partial<SiteConfig>;
      aiAssistantConfig?: Partial<AiAssistantConfig>;
      organization?: Partial<OrganizationProfile>;
      departments?: { id: string; name: string }[];
      templates?: LetterTemplate[];
      quickPhrases?: { id: string; text: string }[];
      plugins?: SitePlugin[];
      userUsage?: Record<string, UserUsageProfile>;
      users?: StoredUser[];
      letters?: SavedLetter[];
      deletedLetterIds?: string[];
      mediaFiles?: Record<string, string>;
    };

    if (!payload || typeof payload !== "object") {
      res.status(400).json({ error: "সঠিক ব্যাকআপ JSON ফাইল প্রদান করুন।" });
      return;
    }

    const db = getDb();
    let preservedServerData = false;

    if (payload.siteConfig) {
      db.siteConfig = {
        ...db.siteConfig,
        ...payload.siteConfig,
        navLabels: {
          ...db.siteConfig.navLabels,
          ...(payload.siteConfig.navLabels || {}),
        },
        customLinks: Array.isArray(payload.siteConfig.customLinks)
          ? sanitizeCustomLinks(payload.siteConfig.customLinks)
          : db.siteConfig.customLinks,
        adminPasswordChanged:
          typeof payload.siteConfig.adminPasswordChanged === "boolean"
            ? payload.siteConfig.adminPasswordChanged
            : db.siteConfig.adminPasswordChanged,
      };
    }
    if (payload.aiAssistantConfig && typeof payload.aiAssistantConfig === "object") {
      db.aiAssistantConfig = {
        ...db.aiAssistantConfig,
        ...payload.aiAssistantConfig,
        quickCommands: Array.isArray(payload.aiAssistantConfig.quickCommands)
          ? payload.aiAssistantConfig.quickCommands
          : db.aiAssistantConfig.quickCommands,
      };
    }
    if (payload.organization) {
      db.organization = { ...db.organization, ...payload.organization };
    }
    if (Array.isArray(payload.departments) && payload.departments.length > 0) {
      db.departments = payload.departments;
    }
    if (Array.isArray(payload.templates) && payload.templates.length > 0) {
      if (payload.fromCloudRestore) {
        const incomingIds = new Set(payload.templates.map((t) => t.id));
        const extraServerTemplates = db.templates.filter(
          (t) => t && t.id && !incomingIds.has(t.id)
        );
        if (extraServerTemplates.length > 0) {
          preservedServerData = true;
        }
        db.templates = [...extraServerTemplates, ...payload.templates];
      } else {
        db.templates = payload.templates;
      }
    }
    if (Array.isArray(payload.quickPhrases)) {
      db.quickPhrases = payload.quickPhrases;
    }
    if (Array.isArray(payload.plugins) && payload.plugins.length > 0) {
      const restoredPlugins = payload.plugins.map((pl) => ({ ...pl }));
      for (const defPlugin of DEFAULT_PLUGINS) {
        if (!restoredPlugins.some((p) => p.id === defPlugin.id || p.type === defPlugin.type)) {
          restoredPlugins.push({
            ...defPlugin,
            config: { ...defPlugin.config },
          });
        }
      }
      db.plugins = restoredPlugins;
    }
    if (payload.userUsage && typeof payload.userUsage === "object") {
      db.userUsage = payload.userUsage;
    }
    if (Array.isArray(payload.users) && payload.users.length > 0) {
      const validUsers = payload.users.filter(
        (u) =>
          u &&
          typeof u.id === "string" &&
          typeof u.userId === "string" &&
          typeof u.passwordHash === "string" &&
          typeof u.fullName === "string"
      );
      if (validUsers.length > 0) {
        if (payload.fromCloudRestore) {
          const userMap = new Map<string, StoredUser>();
          for (const u of validUsers) {
            userMap.set(u.id, u);
          }
          for (const existingU of db.users) {
            if (!userMap.has(existingU.id)) {
              userMap.set(existingU.id, existingU);
              preservedServerData = true;
            }
          }
          db.users = Array.from(userMap.values());
        } else {
          db.users = validUsers;
        }
      }
    }

    const incomingDeleted = Array.isArray(payload.deletedLetterIds)
      ? payload.deletedLetterIds.filter((id): id is string => typeof id === "string" && Boolean(id))
      : [];
    const existingDeleted = Array.isArray(db.deletedLetterIds) ? db.deletedLetterIds : [];
    const mergedDeletedSet = new Set<string>(
      payload.fromCloudRestore
        ? [...incomingDeleted, ...existingDeleted]
        : incomingDeleted
    );
    db.deletedLetterIds = Array.from(mergedDeletedSet).slice(0, 500);

    if (Array.isArray(payload.letters)) {
      if (payload.fromCloudRestore) {
        const payloadIds = new Set(payload.letters.map((l) => l.id));
        const mergedLetters = new Map<string, SavedLetter>();
        for (const ltr of payload.letters) {
          if (ltr && ltr.id && !mergedDeletedSet.has(ltr.id)) {
            mergedLetters.set(ltr.id, ltr);
          }
        }
        for (const srvLtr of db.letters) {
          if (!srvLtr || !srvLtr.id || mergedDeletedSet.has(srvLtr.id)) continue;
          const prev = mergedLetters.get(srvLtr.id);
          if (!prev) {
            mergedLetters.set(srvLtr.id, srvLtr);
            preservedServerData = true;
          } else {
            const srvTime = new Date(srvLtr.savedAt || 0).getTime();
            const cloudTime = new Date(prev.savedAt || 0).getTime();
            if (srvTime > cloudTime) {
              mergedLetters.set(srvLtr.id, srvLtr);
              preservedServerData = true;
            }
          }
        }
        for (const srvLtr of db.letters) {
          if (srvLtr && srvLtr.id && !payloadIds.has(srvLtr.id) && !mergedDeletedSet.has(srvLtr.id)) {
            preservedServerData = true;
          }
        }
        db.letters = Array.from(mergedLetters.values()).sort(
          (a, b) => new Date(b.savedAt || 0).getTime() - new Date(a.savedAt || 0).getTime()
        );
      } else {
        db.letters = payload.letters.filter((l) => l && l.id && !mergedDeletedSet.has(l.id));
      }
    }
    if (payload.mediaFiles) {
      restoreMediaFilesFromBackup(payload.mediaFiles);
    }

    if (
      payload.fromCloudRestore &&
      typeof payload.revision === "number" &&
      payload.revision >= 0
    ) {
      if (preservedServerData) {
        db.revision = Math.max(payload.revision, db.revision || 0) + 1;
      } else {
        db.revision = payload.revision;
      }
      db.updatedAt = new Date().toISOString();
      saveDb(db, { bumpRevision: false });
    } else {
      saveDb(db);
    }

    res.json({
      revision: db.revision,
      siteConfig: db.siteConfig,
      organization: db.organization,
      departments: db.departments,
      templates: db.templates,
      quickPhrases: db.quickPhrases,
      plugins: db.plugins,
      users: db.users.map(toPublicUser),
      letters: db.letters,
    });
  });

  // ================= IN-BUILT PLUGINS ROUTES =================
  app.post("/api/admin/plugins", requireAuth, requireAdmin, (req, res) => {
    const { name, description, type, config } = req.body as {
      name?: string;
      description?: string;
      type?: PluginType;
      config?: PluginConfigData;
    };
    const cleanName = (name || "").trim();
    if (!cleanName) {
      res.status(400).json({ error: "প্লাগইনের নাম লিখুন।" });
      return;
    }

    const allowedTypes: PluginType[] = [
      "dashboard-widget",
      "letter-snippet",
      "custom-css",
    ];
    const safeType: PluginType = allowedTypes.includes(type as PluginType)
      ? (type as PluginType)
      : "dashboard-widget";

    const db = getDb();
    const created: SitePlugin = {
      id: `plg-${Date.now()}`,
      name: cleanName,
      description: (description || "").trim(),
      type: safeType,
      enabled: true,
      builtIn: false,
      config: config && typeof config === "object" ? config : {},
      createdAt: new Date().toISOString(),
    };

    db.plugins.push(created);
    saveDb(db);
    res.json({ plugin: created, plugins: db.plugins });
  });

  app.put("/api/admin/plugins/:id", requireAuth, requireAdmin, (req, res) => {
    const db = getDb();
    const idx = db.plugins.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: "প্লাগইন পাওয়া যায়নি।" });
      return;
    }

    const patch = req.body as Partial<SitePlugin>;
    const existing = db.plugins[idx];
    db.plugins[idx] = {
      ...existing,
      name:
        typeof patch.name === "string" && patch.name.trim()
          ? patch.name.trim()
          : existing.name,
      description:
        typeof patch.description === "string"
          ? patch.description.trim()
          : existing.description,
      enabled:
        typeof patch.enabled === "boolean" ? patch.enabled : existing.enabled,
      config:
        patch.config && typeof patch.config === "object"
          ? { ...existing.config, ...patch.config }
          : existing.config,
    };

    saveDb(db);
    res.json({ plugin: db.plugins[idx], plugins: db.plugins });
  });

  app.delete("/api/admin/plugins/:id", requireAuth, requireAdmin, (req, res) => {
    const db = getDb();
    const target = db.plugins.find((p) => p.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: "প্লাগইন পাওয়া যায়নি।" });
      return;
    }
    if (target.builtIn) {
      res.status(400).json({
        error: "মূল সিস্টেম প্লাগইন মুছে ফেলা যাবে না; চাইলে নিষ্ক্রিয় করতে পারবেন।",
      });
      return;
    }
    db.plugins = db.plugins.filter((p) => p.id !== req.params.id);
    saveDb(db);
    res.json({ plugins: db.plugins });
  });

  app.put(
    "/api/admin/template-access/:userId",
    requireAuth,
    requireAdmin,
    (req, res) => {
      const targetUserId = (req.params.userId || "").trim();
      const db = getDb();
      const targetUser = db.users.find((u) => u.userId === targetUserId);
      if (!targetUser) {
        res.status(404).json({ error: "ব্যবহারকারী খুঁজে পাওয়া যায়নি।" });
        return;
      }

      const body = req.body as Partial<UserTemplateAccessRule>;
      const validModes: TemplateAccessMode[] = ["department", "custom", "all"];
      const mode: TemplateAccessMode = validModes.includes(
        body.mode as TemplateAccessMode
      )
        ? (body.mode as TemplateAccessMode)
        : "department";

      let accessPlugin = db.plugins.find((p) => p.type === "template-access");
      if (!accessPlugin) {
        const def = DEFAULT_PLUGINS.find((p) => p.type === "template-access")!;
        accessPlugin = { ...def, config: { ...def.config, userTemplateRules: {} } };
        db.plugins.push(accessPlugin);
      }
      if (!accessPlugin.config) {
        accessPlugin.config = {};
      }
      if (!accessPlugin.config.userTemplateRules) {
        accessPlugin.config.userTemplateRules = {};
      }

      if (mode === "department") {
        accessPlugin.config.userTemplateRules[targetUserId] = {
          mode: "department",
        };
      } else if (mode === "all") {
        accessPlugin.config.userTemplateRules[targetUserId] = {
          mode: "all",
        };
      } else {
        const allowedCategories = Array.isArray(body.allowedCategories)
          ? body.allowedCategories.filter((c): c is string => typeof c === "string")
          : [];
        const allowedTemplateIds = Array.isArray(body.allowedTemplateIds)
          ? body.allowedTemplateIds.filter((id): id is string => typeof id === "string")
          : [];
        accessPlugin.config.userTemplateRules[targetUserId] = {
          mode: "custom",
          allowedCategories,
          allowedTemplateIds,
        };
      }

      saveDb(db);
      res.json({ plugins: db.plugins });
    }
  );

  const sanitizeAndSaveBranchPad = (
    deptName: string,
    rawBody: Partial<BranchPadConfig>
  ): { plugins: SitePlugin[]; branchPad: BranchPadConfig } => {
    const body = (rawBody || {}) as Partial<BranchPadConfig>;
    const validStyles: LetterheadStyle[] = ["classic", "modern", "archival"];
    const validFonts: LetterFont[] = ["sutonnymj", "serif", "sans"];
    const validCrests: CrestType[] = [
      "academic",
      "corporate",
      "heritage",
      "justice",
      "tech",
      "civic",
    ];
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(String(body.accentColor || "").trim())
      ? String(body.accentColor).trim()
      : undefined;

    const rawSigs = Array.isArray(body.signatories) ? body.signatories : [];
    const sanitizedSigs: BranchPadSignatory[] = rawSigs.slice(0, 6).map((s, idx) => {
      const sigUrl = String(s?.signatureUrl || "").trim();
      const safeSigUrl =
        sigUrl.startsWith("/api/media/") ||
        sigUrl.startsWith("/assets/") ||
        /^https?:\/\//i.test(sigUrl)
          ? sigUrl.slice(0, 500)
          : "";
      return {
        id:
          typeof s?.id === "string" && s.id.trim()
            ? s.id.trim().slice(0, 64)
            : `sig-${Date.now()}-${idx + 1}`,
        roleLabel: String(s?.roleLabel || "").trim().slice(0, 80),
        name: String(s?.name || "").trim().slice(0, 160),
        title: String(s?.title || "").trim().slice(0, 160),
        department: String(s?.department || "").trim().slice(0, 160),
        signatureUrl: safeSigUrl,
      };
    });

    const rawLogo = String(body.logoUrl || "").trim();
    const safeLogoUrl =
      rawLogo.startsWith("/api/media/") ||
      rawLogo.startsWith("/assets/") ||
      /^https?:\/\//i.test(rawLogo)
        ? rawLogo.slice(0, 500)
        : "";

    const normalizedConfig: BranchPadConfig = {
      enabled: body.enabled !== false,
      branchTitleBn: String(body.branchTitleBn ?? deptName).trim().slice(0, 160),
      orgNameOverride: String(body.orgNameOverride || "").trim().slice(0, 200),
      nameEnOverride: String(body.nameEnOverride || "").trim().slice(0, 200),
      headerTagline: String(body.headerTagline || "").trim().slice(0, 240),
      regNumber: String(body.regNumber || "").trim().slice(0, 160),
      address: String(body.address || "").trim().slice(0, 300),
      phone: String(body.phone || "").trim().slice(0, 120),
      email: String(body.email || "").trim().slice(0, 160),
      website: String(body.website || "").trim().slice(0, 200),
      refPrefix: String(body.refPrefix || "").trim().slice(0, 80),
      accentColor: safeColor,
      crestType: validCrests.includes(body.crestType as CrestType)
        ? (body.crestType as CrestType)
        : undefined,
      letterheadStyle: validStyles.includes(body.letterheadStyle as LetterheadStyle)
        ? (body.letterheadStyle as LetterheadStyle)
        : "classic",
      letterFont: validFonts.includes(body.letterFont as LetterFont)
        ? (body.letterFont as LetterFont)
        : "sutonnymj",
      logoUrl: safeLogoUrl,
      footerNote: String(body.footerNote || "").trim().slice(0, 240),
      signatories: sanitizedSigs,
    };

    const db = getDb();
    let padPlugin = db.plugins.find((p) => p.type === "branch-pad-designer");
    if (!padPlugin) {
      const def = DEFAULT_PLUGINS.find((p) => p.type === "branch-pad-designer")!;
      padPlugin = { ...def, config: { ...def.config, branchPads: {} } };
      db.plugins.push(padPlugin);
    }
    if (!padPlugin.config) padPlugin.config = {};
    if (!padPlugin.config.branchPads) padPlugin.config.branchPads = {};

    padPlugin.config.branchPads[deptName] = normalizedConfig;
    saveDb(db);
    return { plugins: db.plugins, branchPad: normalizedConfig };
  };

  const canModifyBranchPad = (
    user: StoredUser,
    deptName: string
  ): boolean => {
    if (user.role === "admin") return true;
    const db = getDb();
    if (!db.siteConfig.allowUserOrgEdit) return false;
    if (!user.department || user.department === "সকল বিভাগ") return true;
    return user.department === deptName;
  };

  app.put(
    "/api/branch-pads/:department",
    requireAuth,
    (req: AuthenticatedRequest, res) => {
      const deptName = decodeURIComponent(String(req.params.department || "")).trim();
      if (!deptName || deptName.length > 200) {
        res.status(400).json({ error: "সঠিক শাখা বা বিভাগের নাম দিন।" });
        return;
      }
      if (!canModifyBranchPad(req.currentUser!, deptName)) {
        res.status(403).json({
          error: "আপনার শুধুমাত্র নিজ শাখার প্যাড পরিবর্তনের অনুমতি রয়েছে।",
        });
        return;
      }
      res.json(sanitizeAndSaveBranchPad(deptName, (req.body || {}) as Partial<BranchPadConfig>));
    }
  );

  app.delete(
    "/api/branch-pads/:department",
    requireAuth,
    (req: AuthenticatedRequest, res) => {
      const deptName = decodeURIComponent(String(req.params.department || "")).trim();
      if (!deptName || !canModifyBranchPad(req.currentUser!, deptName)) {
        res.status(403).json({
          error: "এই শাখার প্যাড রিসেট করার অনুমতি নেই।",
        });
        return;
      }
      const db = getDb();
      const padPlugin = db.plugins.find((p) => p.type === "branch-pad-designer");
      if (padPlugin?.config?.branchPads && deptName) {
        delete padPlugin.config.branchPads[deptName];
        saveDb(db);
      }
      res.json({ plugins: db.plugins });
    }
  );

  app.put(
    "/api/admin/branch-pads/:department",
    requireAuth,
    requireAdmin,
    (req, res) => {
      const deptName = decodeURIComponent(String(req.params.department || "")).trim();
      if (!deptName || deptName.length > 200) {
        res.status(400).json({ error: "সঠিক শাখা বা বিভাগের নাম দিন।" });
        return;
      }
      res.json(sanitizeAndSaveBranchPad(deptName, (req.body || {}) as Partial<BranchPadConfig>));
    }
  );

  app.delete(
    "/api/admin/branch-pads/:department",
    requireAuth,
    requireAdmin,
    (req, res) => {
      const deptName = decodeURIComponent(String(req.params.department || "")).trim();
      const db = getDb();
      const padPlugin = db.plugins.find((p) => p.type === "branch-pad-designer");
      if (padPlugin?.config?.branchPads && deptName) {
        delete padPlugin.config.branchPads[deptName];
        saveDb(db);
      }
      res.json({ plugins: db.plugins });
    }
  );

  app.post("/api/admin/departments", requireAuth, requireAdmin, (req, res) => {
    const { name } = req.body as { name?: string };
    const cleanName = (name || "").trim();
    if (!cleanName) {
      res.status(400).json({ error: "বিভাগের নাম লিখুন।" });
      return;
    }

    const db = getDb();
    if (db.departments.some((d) => d.name === cleanName)) {
      res.status(409).json({ error: "এই বিভাগটি আগে থেকেই রয়েছে।" });
      return;
    }

    const item = { id: `dept-${Date.now()}`, name: cleanName };
    db.departments.push(item);
    saveDb(db);
    res.json({ department: item, departments: db.departments });
  });

  app.put("/api/admin/departments/:id", requireAuth, requireAdmin, (req, res) => {
    const { name } = req.body as { name?: string };
    const cleanName = (name || "").trim();
    if (!cleanName) {
      res.status(400).json({ error: "বিভাগের নতুন নাম লিখুন।" });
      return;
    }

    const db = getDb();
    const target = db.departments.find((d) => d.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: "বিভাগ পাওয়া যায়নি।" });
      return;
    }

    const oldName = target.name;
    target.name = cleanName;
    // Sync template category names seamlessly
    db.templates = db.templates.map((t) =>
      t.category === oldName ? { ...t, category: cleanName } : t
    );
    const padPlugin = db.plugins.find((p) => p.type === "branch-pad-designer");
    if (padPlugin?.config?.branchPads?.[oldName] && oldName !== cleanName) {
      padPlugin.config.branchPads[cleanName] = padPlugin.config.branchPads[oldName];
      delete padPlugin.config.branchPads[oldName];
    }
    saveDb(db);
    res.json({ departments: db.departments, templates: db.templates });
  });

  app.delete("/api/admin/departments/:id", requireAuth, requireAdmin, (req, res) => {
    const db = getDb();
    if (db.departments.length <= 1) {
      res.status(400).json({ error: "অন্তত একটি বিভাগ রাখতে হবে।" });
      return;
    }
    db.departments = db.departments.filter((d) => d.id !== req.params.id);
    saveDb(db);
    res.json({ departments: db.departments });
  });

  app.post("/api/admin/phrases", requireAuth, requireAdmin, (req, res) => {
    const { text } = req.body as { text?: string };
    const clean = (text || "").trim();
    if (!clean) {
      res.status(400).json({ error: "বাক্যটি লিখুন।" });
      return;
    }
    const db = getDb();
    const phrase = { id: `qp-${Date.now()}`, text: clean };
    db.quickPhrases.push(phrase);
    saveDb(db);
    res.json({ quickPhrases: db.quickPhrases });
  });

  app.delete("/api/admin/phrases/:id", requireAuth, requireAdmin, (req, res) => {
    const db = getDb();
    db.quickPhrases = db.quickPhrases.filter((p) => p.id !== req.params.id);
    saveDb(db);
    res.json({ quickPhrases: db.quickPhrases });
  });

  // ================= AI LETTER GENERATION =================
  app.post("/api/generate-letter", requireAuth, async (req, res) => {
    try {
      const db = getDb();
      if (!db.siteConfig.allowAiDrafting) {
        res.status(403).json({
          error: "অ্যাডমিন প্যানেল থেকে এআই চিঠি রচনা সুবিধা বর্তমানে বন্ধ রাখা হয়েছে।",
        });
        return;
      }

      const body = req.body as GenerateLetterBody;
      const mode = body.mode === "polish" ? "polish" : "generate";

      if (mode === "generate" && (!body.prompt || !body.prompt.trim())) {
        res.status(400).json({
          error: "অনুগ্রহ করে কী বিষয়ে চিঠি লিখতে চান তা সংক্ষেপে উল্লেখ করুন।",
        });
        return;
      }

      if (mode === "polish" && (!body.currentBody || !body.currentBody.trim())) {
        res.status(400).json({
          error: "পরিমার্জন করার জন্য চিঠির মূল বক্তব্য লিখুন।",
        });
        return;
      }

      const ai = getGeminiClient();

      const toneGuide = body.tone || "অতি আনুষ্ঠানিক ও দাপ্তরিক (Formal Institutional)";
      const orgContext = body.organizationName
        ? `প্রতিষ্ঠানের নাম: ${body.organizationName}${body.organizationType ? ` (${body.organizationType})` : ""}`
        : `প্রতিষ্ঠানের নাম: ${db.organization.nameBn}`;

      const systemInstruction = [
        "আপনি বাংলাদেশের একটি এনজিও ও ক্ষুদ্রঋণ উন্নয়ন সংস্থার অভিজ্ঞ শাখা হিসাবরক্ষক ও দাপ্তরিক পত্রলেখক।",
        "আপনার কাজ হলো বাংলা একাডেমির প্রমিত বাংলা বানানরীতি এবং বাংলাদেশের সরকারি ও প্রাতিষ্ঠানিক দাপ্তরিক ভাষা ও পরিভাষা (যেমন: স্মারক নং, বিষয়, সূত্র, মহোদয়, বিনীত নিবেদন এই যে, এতদ্বারা, যথাযথ কর্তৃপক্ষের অনুমোদনক্রমে, সদয় অবগতি ও প্রয়োজনীয় কার্যার্থে, ঋণ প্রোডাক্টের রিবেট, সার্ভিস চার্জ সমন্বয়, প্রাপ্তি স্বীকারপত্র, ক্রয় ও মেরামত ভাউচার, অনুষ্ঠানের চাঁদা/অনুদান রসিদ, শাখা হিসাব সংক্রান্ত পত্র) কঠোরভাবে অনুসরণ করে চিঠির বিষয়, সম্বোধন, মূল বক্তব্য ও সমাপ্তি সম্ভাষণ রচনা করা।",
        "সর্বদা বাংলাদেশি শুদ্ধ, মার্জিত ও প্রমিত দাপ্তরিক বাংলা ব্যবহার করবেন; কোনো অপ্রয়োজনীয় ইংরেজি মিশ্রণ বা আঞ্চলিক/কলকাতাকেন্দ্রিক কথ্য শব্দ ব্যবহার করবেন না।",
        "ব্যবহৃত বাংলা হবে স্বাভাবিক, সুস্পষ্ট, মর্যাদাপূর্ণ এবং সুতনি এমজে (SutonnyMJ) ও ইউনিকোড বাংলায় মুদ্রণ ও ওয়ার্ড/এক্সেল রূপান্তরের জন্য সম্পূর্ণ উপযোগী।",
        "সর্বদা প্রদত্ত JSON স্কিমা অনুযায়ী আউটপুট দেবেন। মূল বক্তব্যে প্রতিটি অনুচ্ছেদ দুটি নতুন লাইন (\\n\\n) দিয়ে পৃথক করবেন।",
        "কোনো মার্কডাউন চিহ্ন (*, #, **) বা অতিরিক্ত ব্র্যাকেট প্লেসহোল্ডার ব্যবহার করবেন না।",
      ].join(" ");

      const userPrompt =
        mode === "polish"
          ? `নিচের খসড়া বাংলা দাপ্তরিক চিঠিটির ভাষা, বানান ও প্রাতিষ্ঠানিক গাম্ভীর্য পরিমার্জন করুন।
${orgContext}
ধরন: ${body.templateType || "সাধারণ দাপ্তরিক পত্র"}
সুর/ভঙ্গি: ${toneGuide}
প্রাপক তথ্য: ${body.recipientInfo || "উল্লেখিত প্রাপক"}
বর্তমান বিষয়: ${body.currentSubject || ""}
বর্তমান মূল বক্তব্য:
${body.currentBody}

মূল অর্থ অটুট রেখে ভাষাটিকে আরও মার্জিত, নির্ভুল ও পেশাদার দাপ্তরিক বাংলায় রূপান্তর করুন।`
          : `নিচের নির্দেশনা অনুযায়ী একটি সম্পূর্ণ দাপ্তরিক বাংলা চিঠির খসড়া তৈরি করুন।
${orgContext}
চিঠির ধরন: ${body.templateType || "সাধারণ দাপ্তরিক পত্র"}
সুর/ভঙ্গি: ${toneGuide}
প্রাপক তথ্য: ${body.recipientInfo || "সংশ্লিষ্ট কর্তৃপক্ষ / প্রাপক"}
ব্যবহারকারীর নির্দেশনা (বাংলা বা বাংলিশ হতে পারে):
${body.prompt}

নির্দেশনাটি বুঝে প্রমিত বাংলায় সম্পূর্ণ ও ব্যবহারোপযোগী দাপ্তরিক চিঠি প্রস্তুত করুন।`;

      const response = await generateContentResilient(ai, {
        model: "gemini-4-hydrogen",
        contents: userPrompt,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subject: {
                type: Type.STRING,
                description: "চিঠির সংক্ষিপ্ত ও সুস্পষ্ট দাপ্তরিক বিষয় (বাংলায়, 'বিষয়:' শব্দটি ছাড়া)।",
              },
              salutation: {
                type: Type.STRING,
                description: "যথাযথ সম্বোধন, যেমন: 'মহোদয়,' বা 'প্রিয় সুধী,'।",
              },
              body: {
                type: Type.STRING,
                description: "চিঠির পূর্ণাঙ্গ মূল বক্তব্য। একাধিক অনুচ্ছেদ হলে \\n\\n দিয়ে আলাদা করুন।",
              },
              closing: {
                type: Type.STRING,
                description: "সমাপ্তি সম্ভাষণ, যেমন: 'বিনীত,' বা 'ধন্যবাদান্তে,' বা 'বিশ্বস্ত,'।",
              },
              attachments: {
                type: Type.STRING,
                description: "যদি সংযুক্তির প্রয়োজন হয় তবে তার সংক্ষিপ্ত বিবরণ, নতুবা খালি স্ট্রিং।",
              },
              refCodeSuffix: {
                type: Type.STRING,
                description: "স্মারক নম্বরের জন্য সংক্ষিপ্ত বাংলা কোড অংশ, যেমন: 'হিসাব/রিবেট' বা 'স্বীকার'।",
              },
            },
            required: ["subject", "salutation", "body", "closing", "attachments", "refCodeSuffix"],
          },
        },
      });

      const rawText = (response.text ?? "{}").trim();
      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (err: unknown) {
      console.error("Error generating letter:", err);
      sendGeminiError(res, err, "চিঠি তৈরি করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।");
    }
  });

  // ================= ADMIN AI ASSISTANT ROUTES =================
  const buildAdminSyncState = () => {
    const db = getDb();
    return {
      revision: db.revision || 0,
      siteConfig: db.siteConfig,
      aiAssistantConfig: db.aiAssistantConfig,
      organization: db.organization,
      departments: db.departments,
      templates: db.templates,
      quickPhrases: db.quickPhrases,
      plugins: db.plugins,
      users: db.users.map(toPublicUser),
      letters: db.letters,
    };
  };

  app.get("/api/admin/ai-assistant/config", requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    res.json({ aiAssistantConfig: db.aiAssistantConfig });
  });

  app.put("/api/admin/ai-assistant/config", requireAuth, requireAdmin, (req, res) => {
    const db = getDb();
    const patch = req.body as Partial<AiAssistantConfig>;
    const cur = db.aiAssistantConfig || DEFAULT_AI_ASSISTANT_CONFIG;
    db.aiAssistantConfig = {
      assistantName:
        typeof patch.assistantName === "string" && patch.assistantName.trim()
          ? patch.assistantName.trim()
          : cur.assistantName,
      personaRole:
        typeof patch.personaRole === "string" && patch.personaRole.trim()
          ? patch.personaRole.trim()
          : cur.personaRole,
      customInstructions:
        typeof patch.customInstructions === "string"
          ? patch.customInstructions.trim()
          : cur.customInstructions,
      autoApplyEdits:
        typeof patch.autoApplyEdits === "boolean"
          ? patch.autoApplyEdits
          : cur.autoApplyEdits,
      enableVoiceInput:
        typeof patch.enableVoiceInput === "boolean"
          ? patch.enableVoiceInput
          : cur.enableVoiceInput,
      preferredTone:
        typeof patch.preferredTone === "string" && patch.preferredTone.trim()
          ? patch.preferredTone.trim()
          : cur.preferredTone,
      reasoningDepth:
        patch.reasoningDepth === "balanced" || patch.reasoningDepth === "deep"
          ? patch.reasoningDepth
          : cur.reasoningDepth || "deep",
      quickCommands: Array.isArray(patch.quickCommands)
        ? patch.quickCommands.map((s) => String(s).trim()).filter(Boolean).slice(0, 8)
        : cur.quickCommands,
    };
    saveDb(db);
    res.json({ aiAssistantConfig: db.aiAssistantConfig });
  });

  app.post("/api/admin/ai-assistant/reset", requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    db.aiAssistantConfig = {
      ...DEFAULT_AI_ASSISTANT_CONFIG,
      quickCommands: [...DEFAULT_AI_ASSISTANT_CONFIG.quickCommands],
    };
    saveDb(db);
    res.json({ aiAssistantConfig: db.aiAssistantConfig });
  });

  app.post(
    "/api/admin/ai-assistant/chat",
    requireAuth,
    requireAdmin,
    async (req: AuthenticatedRequest, res) => {
      try {
        const db = getDb();
        const assistantPlugin = db.plugins.find((p) => p.type === "ai-assistant");
        if (assistantPlugin && !assistantPlugin.enabled) {
          res.status(403).json({
            error: "প্লাগইন স্টুডিও থেকে এআই অ্যাসিস্ট্যান্ট মডিউলটি বর্তমানে নিষ্ক্রিয় করা আছে।",
          });
          return;
        }

        const { message, history } = req.body as {
          message?: string;
          history?: { role: "user" | "assistant"; text: string }[];
        };
        const cleanMessage = (message || "").trim();
        if (!cleanMessage) {
          res.status(400).json({ error: "অনুগ্রহ করে আপনার নির্দেশনা লিখুন বা বলুন।" });
          return;
        }

        const result = await runAdminAssistantTurn(getGeminiClient(), {
          message: cleanMessage,
          history: Array.isArray(history) ? history : [],
          currentUser: req.currentUser!,
        });

        res.json({
          ...result,
          syncState: result.mutated ? buildAdminSyncState() : undefined,
        });
      } catch (err: unknown) {
        console.error("Admin AI Assistant error:", err);
        sendGeminiError(
          res,
          err,
          "এআই অ্যাসিস্ট্যান্ট নির্দেশনা প্রক্রিয়া করতে পারেনি। আবার চেষ্টা করুন।"
        );
      }
    }
  );

  app.post(
    "/api/admin/ai-assistant/apply-proposals",
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res) => {
      const { proposals } = req.body as {
        proposals?: AiAssistantPendingProposal[];
      };
      if (!Array.isArray(proposals) || proposals.length === 0) {
        res.status(400).json({ error: "প্রয়োগ করার মতো কোনো প্রস্তাবনা পাওয়া যায়নি।" });
        return;
      }

      const db = getDb();
      const snapshotId = createAiUndoSnapshot(db);
      const actions: AiAssistantActionLog[] = [];
      let mutated = false;

      for (const prop of proposals) {
        if (!prop || typeof prop.tool !== "string") continue;
        const outcome = executeAssistantTool(
          db,
          req.currentUser!,
          prop.tool,
          (prop.args || {}) as Record<string, unknown>
        );
        if (outcome.mutated) mutated = true;
        actions.push({
          tool: prop.tool,
          labelBn: outcome.labelBn,
          summary: outcome.summary,
        });
      }

      res.json({
        actions,
        snapshotId: mutated ? snapshotId : undefined,
        mutated,
        syncState: buildAdminSyncState(),
      });
    }
  );

  app.post(
    "/api/admin/ai-assistant/undo/:snapshotId",
    requireAuth,
    requireAdmin,
    (req, res) => {
      const restored = restoreAiUndoSnapshot(String(req.params.snapshotId || ""));
      if (!restored) {
        res.status(404).json({
          error: "পূর্বাবস্থায় ফেরার স্ন্যাপশট পাওয়া যায়নি বা মেয়াদ শেষ হয়েছে।",
        });
        return;
      }
      res.json({
        ok: true,
        syncState: buildAdminSyncState(),
      });
    }
  );

  app.post(
    "/api/admin/ai-assistant/transcribe",
    requireAuth,
    requireAdmin,
    async (req, res) => {
      try {
        const { audioBase64, mimeType } = req.body as {
          audioBase64?: string;
          mimeType?: string;
        };
        if (!audioBase64 || typeof audioBase64 !== "string") {
          res.status(400).json({ error: "অডিও ডাটা পাওয়া যায়নি।" });
          return;
        }
        const safeMime =
          typeof mimeType === "string" && mimeType.startsWith("audio/")
            ? mimeType.split(";")[0]
            : "audio/webm";

        const ai = getGeminiClient();
        const response = await generateContentResilient(
          ai,
          {
            model: "gemini-3.5-transcribe",
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: safeMime,
                    data: audioBase64,
                  },
                },
                {
                  text: "Transcribe this spoken Bengali or English command accurately into clean plain text without adding explanations.",
                },
              ],
            },
          },
          { models: ["gemini-3.5-transcribe"], maxAttemptsPerModel: 2 }
        );
        res.json({ text: (response.text || "").trim() });
      } catch (err: unknown) {
        console.error("Audio transcribe error:", err);
        sendGeminiError(res, err, "ভয়েস রেকর্ড লেখা হিসেবে রূপান্তর করা যায়নি।");
      }
    }
  );

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);

    app.get("*", async (req, res, next) => {
      if (req.originalUrl.startsWith("/api")) {
        next();
        return;
      }
      try {
        const fs = await import("fs/promises");
        let html = await fs.readFile(path.resolve(__dirname, "index.html"), "utf-8");
        html = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) {
        next(e);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (req.originalUrl.startsWith("/api")) {
        res.status(404).json({ error: "API রুট পাওয়া যায়নি।" });
        return;
      }
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  }

  const httpServer = http.createServer(app);
  attachLiveVoiceServer(httpServer);

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
