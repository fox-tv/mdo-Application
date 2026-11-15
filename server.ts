import "dotenv/config";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import {
  getDb,
  hashPassword,
  saveDb,
  signSessionToken,
  toPublicUser,
  verifyPassword,
  verifySessionToken,
} from "./server/store.ts";
import type { StoredUser } from "./server/store.ts";
import { DEFAULT_SITE_CONFIG } from "./src/data/templates.ts";
import type {
  CustomNavLink,
  LetterTemplate,
  OrganizationProfile,
  SavedLetter,
  SiteConfig,
  UserRole,
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

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
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
  app.use(express.json({ limit: "6mb" }));

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
      showDefaultAdminHint: !db.siteConfig.adminPasswordChanged,
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

    res.json({
      authenticated: true,
      publicBranding,
      workspace: {
        user: toPublicUser(user),
        siteConfig: db.siteConfig,
        organization: db.organization,
        departments: db.departments,
        templates: db.templates,
        quickPhrases: db.quickPhrases,
        letters: visibleLetters,
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
    saveDb(db);

    const token = signSessionToken(found);
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax`
    );

    res.json({
      token,
      user: toPublicUser(found),
    });
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
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

    saveDb(db);
    res.json({ letter: entry });
  });

  app.delete("/api/letters/:id", requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const user = req.currentUser!;
    const target = db.letters.find((l) => l.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: "চিঠি খুঁজে পাওয়া যায়নি।" });
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

    db.letters = db.letters.filter((l) => l.id !== req.params.id);
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

    const created: LetterTemplate = {
      id: `tpl-${Date.now()}`,
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

  app.delete("/api/templates/:id", requireAuth, requireAdmin, (req, res) => {
    const db = getDb();
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
    const { userId, password, fullName, designation, department, role } =
      req.body as {
        userId?: string;
        password?: string;
        fullName?: string;
        designation?: string;
        department?: string;
        role?: UserRole;
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

      const { fullName, designation, department, role, isActive, newPassword } =
        req.body as {
          fullName?: string;
          designation?: string;
          department?: string;
          role?: UserRole;
          isActive?: boolean;
          newPassword?: string;
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
      saveDb(db);
      res.json({ ok: true });
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
      adminPasswordChanged: db.siteConfig.adminPasswordChanged,
    };
    saveDb(db);
    res.json({ siteConfig: db.siteConfig });
  });

  app.get("/api/admin/backup", requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      siteConfig: db.siteConfig,
      organization: db.organization,
      departments: db.departments,
      templates: db.templates,
      quickPhrases: db.quickPhrases,
      letters: db.letters,
    });
  });

  app.post("/api/admin/restore", requireAuth, requireAdmin, (req, res) => {
    const payload = req.body as {
      siteConfig?: Partial<SiteConfig>;
      organization?: Partial<OrganizationProfile>;
      departments?: { id: string; name: string }[];
      templates?: LetterTemplate[];
      quickPhrases?: { id: string; text: string }[];
      letters?: SavedLetter[];
    };

    if (!payload || typeof payload !== "object") {
      res.status(400).json({ error: "সঠিক ব্যাকআপ JSON ফাইল প্রদান করুন।" });
      return;
    }

    const db = getDb();
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
        adminPasswordChanged: db.siteConfig.adminPasswordChanged,
      };
    }
    if (payload.organization) {
      db.organization = { ...db.organization, ...payload.organization };
    }
    if (Array.isArray(payload.departments) && payload.departments.length > 0) {
      db.departments = payload.departments;
    }
    if (Array.isArray(payload.templates) && payload.templates.length > 0) {
      db.templates = payload.templates;
    }
    if (Array.isArray(payload.quickPhrases)) {
      db.quickPhrases = payload.quickPhrases;
    }
    if (Array.isArray(payload.letters)) {
      db.letters = payload.letters;
    }

    saveDb(db);
    res.json({
      siteConfig: db.siteConfig,
      organization: db.organization,
      departments: db.departments,
      templates: db.templates,
      quickPhrases: db.quickPhrases,
      letters: db.letters,
    });
  });

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
        "আপনি বাংলাদেশের একটি এনজিও ও ক্ষুদ্রঋণ উন্নয়ন সংস্থার অভিজ্ঞ শাখা হিসাবরক্ষক ও প্রশাসনিক পত্রলেখক।",
        "আপনার কাজ হলো শুদ্ধ বাংলা বানান, প্রমিত দাপ্তরিক ও হিসাবরক্ষণ পরিভাষা (যেমন: ঋণ প্রোডাক্টের রিবেট, সার্ভিস চার্জ সমন্বয়, প্রাপ্তি স্বীকারপত্র, কেনাকাটা ও মেরামত ভাউচার, অনুষ্ঠানের চাঁদা/অনুদান রসিদ, শাখা হিসাব সংক্রান্ত চিঠিপত্র) অনুসরণ করে চিঠির বিষয়, সম্বোধন, মূল বক্তব্য ও সমাপ্তি সম্ভাষণ রচনা করা।",
        "ব্যবহৃত বাংলা হবে স্বাভাবিক, সুস্পষ্ট, মর্যাদাপূর্ণ এবং বাংলাদেশের এনজিও ও দাপ্তরিক হিসাব রীতির সাথে সামঞ্জস্যপূর্ণ।",
        "সর্বদা প্রদত্ত JSON স্কিমা অনুযায়ী আউটপুট দেবেন। মূল বক্তব্যে প্রতিটি অনুচ্ছেদ দুটি নতুন লাইন (\\n\\n) দিয়ে পৃথক করবেন।",
        "কোনো মার্কডাউন চিহ্ন (*, #, **) বা অতিরিক্ত ব্র্যাকেট প্লেসহোল্ডার ব্যবহার করবেন না; প্রাসঙ্গিক স্থানে স্পষ্ট ও মার্জিত দাপ্তরিক বাক্য ব্যবহার করুন।",
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

      const response = await ai.models.generateContent({
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
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes("GEMINI_API_KEY_MISSING")) {
        res.status(503).json({
          error:
            "সার্ভারে Gemini API কী কনফিগার করা নেই। অনুগ্রহ করে Settings > Secrets প্যানেল থেকে API কী যাচাই করুন।",
        });
        return;
      }

      if (message.includes("403") || message.includes("PERMISSION_DENIED") || message.includes("API_KEY_INVALID")) {
        res.status(403).json({
          error:
            "API কী অনুমোদিত নয় বা সঠিক নয়। অনুগ্রহ করে Settings > Secrets প্যানেল থেকে API কী পরীক্ষা করুন।",
        });
        return;
      }

      if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
        res.status(429).json({
          error: "অনুরোধের সীমা অতিক্রম করেছে। কিছুক্ষণ পর আবার চেষ্টা করুন।",
        });
        return;
      }

      res.status(500).json({
        error: "চিঠি তৈরি করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।",
      });
    }
  });

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
