import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  Cloud,
  Code2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mic,
  Palette,
  Plus,
  Puzzle,
  Users,
  X,
} from "lucide-react";
import {
  DEFAULT_DEPARTMENTS,
  DEFAULT_ORGANIZATION,
  DEFAULT_PLUGINS,
  DEFAULT_QUICK_PHRASES,
  DEFAULT_SITE_CONFIG,
  LETTER_TEMPLATES,
  createLetterFromTemplate,
} from "./data/templates";
import {
  AppTab,
  DepartmentItem,
  LetterData,
  LetterTemplate,
  OrganizationProfile,
  PublicUser,
  QuickPhrase,
  SavedLetter,
  SiteConfig,
  SitePlugin,
  UserUsageProfile,
  WorkspacePayload,
} from "./types";
import { apiRequest, setAuthToken } from "./utils/api";
import {
  formatBanglaCalendarDate,
  formatBengaliDate,
  generateNextRefNumber,
} from "./utils/bengali";
import {
  isBranchPadPluginEnabled,
  isUserSelfPadCustomizeEnabled,
  resolveActivePadForUser,
} from "./utils/branchPad";
import { buildAppPath, getAppBasePath, parseAppRoute } from "./utils/router";
import {
  auth,
  deleteLetterFromCloud,
  sanitizeFirestoreId,
  saveLetterToCloud,
  signInWithGoogleCloud,
  signOutGoogleCloud,
  subscribeCloudLetters,
  syncFirebaseUserProfile,
} from "./lib/firebase";
import {
  deleteWorkspaceLetterFromVault,
  getCloudWorkspaceRevision,
  loadFullWorkspaceFromFirestore,
  loadLocalSafetySnapshot,
  loadUserLettersSafetySnapshot,
  loadUserTemplatesSafetySnapshot,
  saveFullWorkspaceToFirestore,
  saveLocalSafetySnapshot,
  saveUserLettersSafetySnapshot,
  saveUserTemplatesSafetySnapshot,
  type FullWorkspaceBackup,
} from "./lib/workspaceVault";
import { EditorView } from "./components/EditorView";
import type { AdminTab } from "./components/AdminPanelView";
import { LoginView, PublicBranding } from "./components/LoginView";

const DashboardView = lazy(() =>
  import("./components/DashboardView").then((m) => ({
    default: m.DashboardView,
  }))
);
const TemplatesView = lazy(() =>
  import("./components/TemplatesView").then((m) => ({ default: m.TemplatesView }))
);
const SavedLettersView = lazy(() =>
  import("./components/SavedLettersView").then((m) => ({
    default: m.SavedLettersView,
  }))
);
const LiveVoiceView = lazy(() =>
  import("./components/LiveVoiceView").then((m) => ({
    default: m.LiveVoiceView,
  }))
);
const OrganizationView = lazy(() =>
  import("./components/OrganizationView").then((m) => ({
    default: m.OrganizationView,
  }))
);
const AdminPanelView = lazy(() =>
  import("./components/AdminPanelView").then((m) => ({
    default: m.AdminPanelView,
  }))
);

const DEFAULT_PUBLIC_BRANDING: PublicBranding = {
  websiteName: DEFAULT_SITE_CONFIG.websiteName,
  websiteSubtitle: DEFAULT_SITE_CONFIG.websiteSubtitle,
  footerText: DEFAULT_SITE_CONFIG.footerText,
  orgNameBn: DEFAULT_ORGANIZATION.nameBn,
  logoDataUrl: DEFAULT_ORGANIZATION.logoDataUrl,
  primaryColor: DEFAULT_SITE_CONFIG.primaryColor,
  surfaceBgColor: DEFAULT_SITE_CONFIG.surfaceBgColor,
  showLoginLogo: DEFAULT_SITE_CONFIG.showLoginLogo,
  showLiveClock: DEFAULT_SITE_CONFIG.showLiveClock,
  loginHeroImageUrl: "",
  loginHeroCaption: "",
  customBlocks: [],
  uiTexts: DEFAULT_SITE_CONFIG.uiTexts || {},
};

const ADMIN_CLOUD_EMAIL = "bipulmdmehedihasan@gmail.com";

function isVerifiedCloudAdmin(fbUser: FirebaseUser | null): boolean {
  return Boolean(
    fbUser &&
      fbUser.emailVerified &&
      fbUser.email?.toLowerCase() === ADMIN_CLOUD_EMAIL
  );
}

interface StoredEditorDraft {
  letter: LetterData;
  dirty: boolean;
  updatedAt: number;
}

const VALID_APP_TABS: AppTab[] = [
  "dashboard",
  "editor",
  "templates",
  "saved",
  "voice",
  "organization",
  "admin",
];

function saveLocalEditorDraft(
  userId: string,
  letter: LetterData,
  dirty: boolean
): void {
  if (!userId) return;
  try {
    const payload: StoredEditorDraft = {
      letter,
      dirty,
      updatedAt: Date.now(),
    };
    localStorage.setItem(
      `mdo_editor_draft_v1_${userId}`,
      JSON.stringify(payload)
    );
  } catch {
    // Ignore storage quota / private mode errors
  }
}

function loadLocalEditorDraft(userId: string): StoredEditorDraft | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`mdo_editor_draft_v1_${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredEditorDraft>;
    if (
      parsed &&
      parsed.letter &&
      typeof parsed.letter === "object" &&
      typeof parsed.letter.id === "string"
    ) {
      return {
        letter: parsed.letter,
        dirty: Boolean(parsed.dirty),
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function clearLocalEditorDraft(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(`mdo_editor_draft_v1_${userId}`);
  } catch {
    // Ignore storage errors
  }
}

function saveActiveTabPreference(userId: string, tab: AppTab): void {
  if (!userId) return;
  try {
    localStorage.setItem(`mdo_active_tab_v1_${userId}`, tab);
  } catch {
    // Ignore storage errors
  }
}

function loadActiveTabPreference(
  userId: string,
  role: string,
  allowUserOrgEdit: boolean
): AppTab | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(`mdo_active_tab_v1_${userId}`) as AppTab | null;
    if (!raw || !VALID_APP_TABS.includes(raw)) return null;
    if (raw === "admin" && role !== "admin") return "dashboard";
    if (raw === "organization" && role !== "admin" && !allowUserOrgEdit) {
      return "dashboard";
    }
    return raw;
  } catch {
    return null;
  }
}

export default function App() {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [publicBranding, setPublicBranding] = useState<PublicBranding>(
    DEFAULT_PUBLIC_BRANDING
  );

  const [user, setUser] = useState<PublicUser | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [cloudLetters, setCloudLetters] = useState<SavedLetter[]>([]);
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [org, setOrg] = useState<OrganizationProfile>(DEFAULT_ORGANIZATION);
  const [departments, setDepartments] =
    useState<DepartmentItem[]>(DEFAULT_DEPARTMENTS);
  const [templates, setTemplates] =
    useState<LetterTemplate[]>(LETTER_TEMPLATES);
  const [quickPhrases, setQuickPhrases] =
    useState<QuickPhrase[]>(DEFAULT_QUICK_PHRASES);
  const [plugins, setPlugins] = useState<SitePlugin[]>(DEFAULT_PLUGINS);
  const [userUsage, setUserUsage] = useState<UserUsageProfile>({
    templateCounts: {},
    pinnedTemplateIds: [],
    recentTemplateIds: [],
  });
  const [savedLetters, setSavedLetters] = useState<SavedLetter[]>([]);

  const initialParsedRoute =
    typeof window !== "undefined"
      ? parseAppRoute(window.location.pathname)
      : { tab: null };
  const [activeTab, setActiveTab] = useState<AppTab>(
    initialParsedRoute.tab || "dashboard"
  );
  const [adminInitialTab, setAdminInitialTab] = useState<AdminTab>(
    initialParsedRoute.adminTab || "site"
  );
  const [currentLetter, setCurrentLetter] = useState<LetterData>(() =>
    createLetterFromTemplate(LETTER_TEMPLATES[0], DEFAULT_ORGANIZATION)
  );
  const [draftNeedsSync, setDraftNeedsSync] = useState(false);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [curPass, setCurPass] = useState("");
  const [nextPass, setNextPass] = useState("");
  const [passMsg, setPassMsg] = useState("");
  const [passErr, setPassErr] = useState("");
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [cloudSyncError, setCloudSyncError] = useState("");
  const [cloudConnecting, setCloudConnecting] = useState(false);
  const [reconcileNonce, setReconcileNonce] = useState(0);

  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const serverRevisionRef = useRef<number>(0);
  const lastSyncedRevisionRef = useRef<number>(-1);
  const reconcileKeyRef = useRef<string>("");
  const localRestoreTriedRef = useRef<boolean>(false);
  const userLettersRestoredRef = useRef<string>("");
  const userTemplatesRestoredRef = useRef<string>("");
  const autoResumeTriedRef = useRef<boolean>(false);
  const syncTimerRef = useRef<number | null>(null);
  const userRef = useRef<PublicUser | null>(null);
  const firebaseUserRef = useRef<FirebaseUser | null>(null);
  const cloudLettersRef = useRef<SavedLetter[]>([]);
  userRef.current = user;
  firebaseUserRef.current = firebaseUser;
  cloudLettersRef.current = cloudLetters;

  const syncCurrentWorkspaceToVault = useCallback(async () => {
    const activeUser = userRef.current;
    if (!activeUser || activeUser.role !== "admin") return;
    try {
      const backup = await apiRequest<FullWorkspaceBackup>("/api/admin/backup");
      const rev = backup.revision || 0;
      serverRevisionRef.current = rev;
      await saveLocalSafetySnapshot(backup);
      if (isVerifiedCloudAdmin(firebaseUserRef.current)) {
        await saveFullWorkspaceToFirestore(backup);
        lastSyncedRevisionRef.current = rev;
        setCloudSyncError("");
      }
    } catch (err) {
      console.error("Workspace vault sync error:", err);
      if (isVerifiedCloudAdmin(firebaseUserRef.current)) {
        setCloudSyncError("ক্লাউড ডাটা সিঙ্ক করতে সমস্যা হয়েছে।");
      }
    }
  }, []);

  const scheduleVaultSync = useCallback(() => {
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      void syncCurrentWorkspaceToVault();
    }, 150);
  }, [syncCurrentWorkspaceToVault]);

  useEffect(() => {
    const flushPendingVaultSync = () => {
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
        void syncCurrentWorkspaceToVault();
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushPendingVaultSync();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", flushPendingVaultSync);
    window.addEventListener("beforeunload", flushPendingVaultSync);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", flushPendingVaultSync);
      window.removeEventListener("beforeunload", flushPendingVaultSync);
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
      }
    };
  }, [syncCurrentWorkspaceToVault]);

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await apiRequest<{
        authenticated: boolean;
        publicBranding: PublicBranding;
        workspace?: WorkspacePayload;
      }>("/api/bootstrap");

      if (data.publicBranding) {
        setPublicBranding(data.publicBranding);
      }

      if (data.authenticated && data.workspace) {
        const ws = data.workspace;
        serverRevisionRef.current = ws.revision ?? 0;

        // If server restarted cleanly (revision === 0) and admin has a newer safety snapshot,
        // auto-recover immediately before/alongside Cloud Firestore reconciliation
        if (
          ws.user.role === "admin" &&
          (ws.revision ?? 0) === 0 &&
          !localRestoreTriedRef.current
        ) {
          localRestoreTriedRef.current = true;
          const localSnap = await loadLocalSafetySnapshot();
          if (
            localSnap &&
            (localSnap.revision > 0 ||
              (localSnap.users?.length || 0) > 1 ||
              (localSnap.letters?.length || 0) > 0 ||
              (localSnap.templates?.length || 0) !== LETTER_TEMPLATES.length ||
              localSnap.siteConfig?.adminPasswordChanged)
          ) {
            try {
              await apiRequest("/api/admin/restore", {
                method: "POST",
                body: JSON.stringify({
                  ...localSnap,
                  fromCloudRestore: true,
                }),
              });
              const refreshed = await apiRequest<{
                authenticated: boolean;
                publicBranding: PublicBranding;
                workspace?: WorkspacePayload;
              }>("/api/bootstrap");
              if (refreshed.authenticated && refreshed.workspace) {
                Object.assign(ws, refreshed.workspace);
                if (refreshed.publicBranding) {
                  setPublicBranding(refreshed.publicBranding);
                }
                serverRevisionRef.current = refreshed.workspace.revision ?? 0;
              }
            } catch {
              // Ignore recovery failure and continue with current workspace
            }
          }
        }

        // Recover branch user's saved letters from local safety mirror if server was wiped,
        // while strictly honoring deletedLetterIds so intentionally deleted letters never return
        let resolvedLetters = ws.letters;
        const deletedLetterSet = new Set(
          Array.isArray(ws.deletedLetterIds) ? ws.deletedLetterIds : []
        );
        if (ws.user.role === "user") {
          if (userLettersRestoredRef.current !== ws.user.userId) {
            userLettersRestoredRef.current = ws.user.userId;
            const cachedLetters = await loadUserLettersSafetySnapshot(
              ws.user.userId
            );
            const existingIds = new Set(ws.letters.map((l) => l.id));
            const missingLetters = cachedLetters.filter(
              (item) =>
                item &&
                item.id &&
                !existingIds.has(item.id) &&
                !deletedLetterSet.has(item.id)
            );
            if (
              missingLetters.length > 0 &&
              ((ws.revision ?? 0) === 0 || ws.letters.length === 0)
            ) {
              const recovered: SavedLetter[] = [];
              for (const item of missingLetters.slice(0, 100)) {
                try {
                  const res = await apiRequest<{ letter: SavedLetter }>(
                    "/api/letters",
                    {
                      method: "POST",
                      body: JSON.stringify(item),
                    }
                  );
                  recovered.push(res.letter);
                } catch {
                  // Skip individual letter failures
                }
              }
              if (recovered.length > 0) {
                resolvedLetters = [...recovered, ...ws.letters];
              }
            }
          }
          void saveUserLettersSafetySnapshot(ws.user.userId, resolvedLetters);
        }

        let resolvedTemplates = ws.templates;
        if (
          ws.user.role === "user" &&
          (ws.revision ?? 0) === 0 &&
          ws.siteConfig.allowUserTemplateCreate &&
          userTemplatesRestoredRef.current !== ws.user.userId
        ) {
          userTemplatesRestoredRef.current = ws.user.userId;
          const cachedTemplates = await loadUserTemplatesSafetySnapshot(
            ws.user.userId
          );
          const existingIds = new Set(ws.templates.map((t) => t.id));
          const missingTpls = cachedTemplates.filter(
            (t) =>
              t &&
              t.id &&
              !existingIds.has(t.id) &&
              !ws.templates.some(
                (ex) => ex.title === t.title && ex.category === t.category
              )
          );
          if (missingTpls.length > 0) {
            const newlyRestored: LetterTemplate[] = [];
            for (const tpl of missingTpls.slice(0, 50)) {
              try {
                const res = await apiRequest<{ template: LetterTemplate }>(
                  "/api/templates",
                  {
                    method: "POST",
                    body: JSON.stringify(tpl),
                  }
                );
                newlyRestored.push(res.template);
              } catch {
                // Ignore individual template recovery errors
              }
            }
            if (newlyRestored.length > 0) {
              resolvedTemplates = [...newlyRestored, ...ws.templates];
            }
          }
        } else if (ws.user.role === "user" && ws.templates.length > 0) {
          void saveUserTemplatesSafetySnapshot(ws.user.userId, ws.templates);
        }

        setUser(ws.user);
        setSiteConfig(ws.siteConfig);
        setOrg(ws.organization);
        setDepartments(ws.departments);
        setTemplates(resolvedTemplates);
        setQuickPhrases(ws.quickPhrases);
        const resolvedPlugins = Array.isArray(ws.plugins)
          ? ws.plugins
          : DEFAULT_PLUGINS;
        setPlugins(resolvedPlugins);
        setUserUsage(
          ws.userUsage || {
            templateCounts: {},
            pinnedTemplateIds: [],
            recentTemplateIds: [],
          }
        );
        setSavedLetters(resolvedLetters);

        const preferredDept =
          ws.user.department && ws.user.department !== "সকল বিভাগ"
            ? ws.user.department
            : ws.templates[0]?.category;
        const resolvedActivePad = resolveActivePadForUser({
          plugins: resolvedPlugins,
          userId: ws.user.userId,
          preferredDepartment: preferredDept,
          userDepartment: ws.user.department,
        });
        const defaultBranchPad = resolvedActivePad.config;
        const branchDeptForFirst = resolvedActivePad.scopeKey;
        const activeFirstSignatory =
          defaultBranchPad?.signatories &&
          defaultBranchPad.signatories.length > 0
            ? defaultBranchPad.signatories[
                defaultBranchPad.signatories.length - 1
              ]
            : undefined;

        const firstLetter: LetterData =
          ws.templates.length > 0
            ? createLetterFromTemplate(
                ws.templates[0],
                ws.organization,
                defaultBranchPad,
                branchDeptForFirst
              )
            : {
                id: `ltr-${Date.now()}`,
                templateType: "সাধারণ দাপ্তরিক পত্র",
                refNumber: generateNextRefNumber(
                  defaultBranchPad?.refPrefix?.trim() || ws.organization.refPrefix,
                  "পত্র"
                ),
                dateText: formatBengaliDate(new Date()),
                showBanglaDate: true,
                banglaDateText: formatBanglaCalendarDate(new Date()),
                recipientPrefix: "বরাবর",
                recipientName: "",
                recipientTitle: "",
                recipientOrg: "",
                recipientAddress: "",
                subject: "",
                salutation: "মহোদয়,",
                body: "",
                closing: "বিনীত,",
                signatoryName:
                  activeFirstSignatory?.name ||
                  ws.organization.defaultSignatoryName,
                signatoryTitle:
                  activeFirstSignatory?.title ||
                  ws.organization.defaultSignatoryTitle,
                signatoryDept:
                  activeFirstSignatory?.department ||
                  defaultBranchPad?.branchTitleBn ||
                  ws.organization.defaultSignatoryDept,
                attachments: "",
                ccList: "",
                letterheadStyle:
                  defaultBranchPad?.letterheadStyle ||
                  ws.siteConfig.defaultLetterheadStyle ||
                  "classic",
                letterFont:
                  defaultBranchPad?.letterFont ||
                  ws.siteConfig.defaultLetterFont ||
                  "sutonnymj",
                showWatermark: true,
                showSealPlaceholder: false,
                ...(branchDeptForFirst
                  ? { branchPadDepartment: branchDeptForFirst }
                  : {}),
              };
        if (!defaultBranchPad) {
          firstLetter.letterheadStyle =
            ws.siteConfig.defaultLetterheadStyle || "classic";
          firstLetter.letterFont =
            ws.siteConfig.defaultLetterFont || "sutonnymj";
        }

        const userSelfPadEnabled =
          isBranchPadPluginEnabled(resolvedPlugins) &&
          isUserSelfPadCustomizeEnabled(resolvedPlugins);
        const canOpenOrgOnBoot =
          ws.user.role === "admin" ||
          Boolean(ws.siteConfig.allowUserOrgEdit) ||
          userSelfPadEnabled;

        const routeNow = parseAppRoute(window.location.pathname);
        let initialMatchedLetter: SavedLetter | undefined;
        if (routeNow.tab === "editor" && routeNow.letterId) {
          initialMatchedLetter = resolvedLetters.find(
            (l) => l.id === routeNow.letterId
          );
        }

        if (initialMatchedLetter) {
          setCurrentLetter({ ...initialMatchedLetter });
          setDraftNeedsSync(false);
          saveLocalEditorDraft(ws.user.userId, initialMatchedLetter, false);
        } else {
          const restoredDraft = loadLocalEditorDraft(ws.user.userId);
          if (restoredDraft) {
            setCurrentLetter(restoredDraft.letter);
            setDraftNeedsSync(restoredDraft.dirty);
          } else {
            setCurrentLetter(firstLetter);
            setDraftNeedsSync(false);
          }
        }

        let targetTab: AppTab = "dashboard";
        let targetAdminTab: AdminTab | undefined;
        if (routeNow.tab) {
          if (routeNow.tab === "admin" && ws.user.role !== "admin") {
            targetTab = "dashboard";
          } else if (routeNow.tab === "organization" && !canOpenOrgOnBoot) {
            targetTab = "dashboard";
          } else {
            targetTab = routeNow.tab;
            targetAdminTab = routeNow.adminTab;
          }
        } else {
          const restoredTab = loadActiveTabPreference(
            ws.user.userId,
            ws.user.role,
            canOpenOrgOnBoot
          );
          if (restoredTab) {
            targetTab = restoredTab;
          }
        }

        setActiveTab(targetTab);
        if (targetTab === "admin" && targetAdminTab) {
          setAdminInitialTab(targetAdminTab);
        }
        const canonicalPath = buildAppPath(targetTab, {
          adminTab: targetTab === "admin" ? targetAdminTab : undefined,
          letterId:
            targetTab === "editor" && initialMatchedLetter
              ? initialMatchedLetter.id
              : undefined,
        });
        if (window.location.pathname !== canonicalPath) {
          window.history.replaceState(null, "", canonicalPath);
        }
      } else {
        setUser(null);
        setAuthToken("");
      }
    } catch {
      setUser(null);
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      setFirebaseUser(fbUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (firebaseUser && user?.role === "admin") {
      void syncFirebaseUserProfile(firebaseUser, user).catch(() => {});
    }
  }, [firebaseUser, user]);

  // Auto-resume admin session cleanly if Cloud Run container restarted (sessionSecret reset)
  // while Firebase Google Admin Auth remains signed in (and user did not explicitly log out)
  useEffect(() => {
    if (bootstrapping || user || autoResumeTriedRef.current) return;
    if (!isVerifiedCloudAdmin(firebaseUser) || !firebaseUser) return;
    let explicitLogout = false;
    try {
      explicitLogout = sessionStorage.getItem("mdo_explicit_logout") === "1";
    } catch {
      // Ignore storage error
    }
    if (explicitLogout) return;

    autoResumeTriedRef.current = true;
    void (async () => {
      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await apiRequest<{ token: string; user: PublicUser }>(
          "/api/auth/firebase-login",
          {
            method: "POST",
            body: JSON.stringify({ idToken }),
          }
        );
        setAuthToken(res.token);
        await loadBootstrap();
      } catch {
        // User can sign in normally
      }
    })();
  }, [bootstrapping, user, firebaseUser, loadBootstrap]);

  // Bidirectional Firestore Cloud Vault reconciliation for verified admin
  useEffect(() => {
    if (bootstrapping || !user || user.role !== "admin") return;
    if (!isVerifiedCloudAdmin(firebaseUser) || !firebaseUser) return;

    const key = `${user.id}:${firebaseUser.uid}`;
    if (reconcileKeyRef.current === key) return;

    let cancelled = false;
    void (async () => {
      try {
        const cloudRev = await getCloudWorkspaceRevision();
        if (cancelled) return;
        const srvRev = serverRevisionRef.current || 0;

        if (cloudRev !== null && cloudRev > srvRev) {
          const cloudBackup = await loadFullWorkspaceFromFirestore();
          if (cancelled) return;
          if (cloudBackup) {
            const restoreRes = await apiRequest<{
              ok: boolean;
              revision?: number;
            }>("/api/admin/restore", {
              method: "POST",
              body: JSON.stringify({
                ...cloudBackup,
                fromCloudRestore: true,
              }),
            });
            const mergedRev = restoreRes.revision ?? cloudBackup.revision ?? cloudRev;
            serverRevisionRef.current = mergedRev;
            lastSyncedRevisionRef.current = cloudBackup.revision || cloudRev;
            await saveLocalSafetySnapshot(cloudBackup);
            reconcileKeyRef.current = key;
            setCloudSyncError("");
            await loadBootstrap();
            // If server merged un-synced branch user letters/items, push merged state back to Firestore
            if (mergedRev > (cloudBackup.revision || cloudRev)) {
              void syncCurrentWorkspaceToVault();
            }
            return;
          }
        }

        if (cloudRev === null || srvRev > cloudRev) {
          const backup = await apiRequest<FullWorkspaceBackup>("/api/admin/backup");
          if (cancelled) return;
          const rev = backup.revision || 0;
          serverRevisionRef.current = rev;
          await saveLocalSafetySnapshot(backup);
          await saveFullWorkspaceToFirestore(backup);
          lastSyncedRevisionRef.current = rev;
        } else {
          lastSyncedRevisionRef.current = srvRev;
        }

        reconcileKeyRef.current = key;
        setCloudSyncError("");
      } catch (err) {
        console.error("Workspace cloud reconciliation error:", err);
        if (!cancelled) {
          setCloudSyncError(
            "ক্লাউড ফায়ারস্টোরের সাথে সিঙ্ক করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করে পুনরায় চেষ্টা করুন।"
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootstrapping, user, firebaseUser, reconcileNonce, loadBootstrap, syncCurrentWorkspaceToVault]);

  // Keep admin's Cloud Firestore & local vault in sync with edits made by branch users
  useEffect(() => {
    if (!user || user.role !== "admin") return;

    let checking = false;
    const checkServerRevisionAndSync = async () => {
      if (checking) return;
      if (userRef.current?.role !== "admin") return;
      checking = true;
      try {
        const res = await apiRequest<{
          authenticated: boolean;
          workspace?: WorkspacePayload;
        }>("/api/bootstrap");
        if (!res.authenticated || !res.workspace) return;
        const srvRev = res.workspace.revision ?? 0;
        if (srvRev > serverRevisionRef.current) {
          serverRevisionRef.current = srvRev;
          setSavedLetters(res.workspace.letters);
          setTemplates(res.workspace.templates);
          setOrg(res.workspace.organization);
          if (Array.isArray(res.workspace.plugins)) {
            setPlugins(res.workspace.plugins);
          }
        }
        const activeUser = userRef.current;
        const fbUser = firebaseUserRef.current;
        const expectedKey =
          activeUser && fbUser ? `${activeUser.id}:${fbUser.uid}` : "";
        if (
          activeUser?.role === "admin" &&
          isVerifiedCloudAdmin(fbUser) &&
          expectedKey &&
          reconcileKeyRef.current === expectedKey &&
          lastSyncedRevisionRef.current >= 0 &&
          srvRev > lastSyncedRevisionRef.current
        ) {
          await syncCurrentWorkspaceToVault();
        }
      } catch {
        // Non-blocking background sync check
      } finally {
        checking = false;
      }
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        void checkServerRevisionAndSync();
      }
    };
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkServerRevisionAndSync();
      }
    }, 45000);

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
    };
  }, [user, syncCurrentWorkspaceToVault]);

  // Retry cloud reconciliation automatically when network comes back online
  useEffect(() => {
    const handleOnline = () => {
      if (userRef.current?.role === "admin" && isVerifiedCloudAdmin(firebaseUserRef.current)) {
        reconcileKeyRef.current = "";
        setReconcileNonce((n) => n + 1);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  useEffect(() => {
    if (!firebaseUser || !firebaseUser.emailVerified || user?.role !== "admin") {
      setCloudLetters([]);
      return;
    }
    const unsubscribe = subscribeCloudLetters(firebaseUser.uid, (list) => {
      setCloudLetters(list);
    });
    return () => unsubscribe();
  }, [firebaseUser, user?.role]);

  // Apply live site theme variables (colors & typography)
  useEffect(() => {
    const primary = user
      ? siteConfig.primaryColor
      : publicBranding.primaryColor || "#1E3A8A";
    const bg = user
      ? siteConfig.surfaceBgColor
      : publicBranding.surfaceBgColor || "#F6F5F1";

    const root = document.documentElement;
    root.style.setProperty("--site-primary", primary || "#1E3A8A");
    root.style.setProperty("--site-bg", bg || "#F6F5F1");

    const fontMap = {
      sutonnymj:
        '"Hind Siliguri", "Noto Sans Bengali", system-ui, -apple-system, sans-serif',
      hind: '"Hind Siliguri", "Noto Sans Bengali", system-ui, -apple-system, sans-serif',
      tiro: '"Tiro Bangla", "Noto Serif Bengali", Georgia, serif',
      serif: '"Noto Serif Bengali", "Tiro Bangla", Georgia, serif',
    };
    root.style.setProperty(
      "--font-ui",
      fontMap[siteConfig.uiFont || "sutonnymj"] || fontMap.sutonnymj
    );
  }, [
    user,
    siteConfig.primaryColor,
    siteConfig.surfaceBgColor,
    siteConfig.uiFont,
    publicBranding.primaryColor,
    publicBranding.surfaceBgColor,
  ]);

  // Inject live custom CSS + active custom-css plugins inside document.head cleanly
  useEffect(() => {
    const pluginCssParts = plugins
      .filter((p) => p.enabled && p.type === "custom-css" && p.config?.css?.trim())
      .map((p) => p.config.css!.trim());
    const combinedCss = [
      siteConfig.customCss?.trim() || "",
      ...pluginCssParts,
    ]
      .filter(Boolean)
      .join("\n\n");

    const existing = document.getElementById("mdo-custom-css");
    if (combinedCss) {
      const styleEl =
        existing ||
        (() => {
          const el = document.createElement("style");
          el.id = "mdo-custom-css";
          document.head.appendChild(el);
          return el;
        })();
      styleEl.textContent = combinedCss;
    } else if (existing) {
      existing.remove();
    }
  }, [siteConfig.customCss, plugins]);

  useEffect(() => {
    const title = user
      ? `${siteConfig.websiteName} — ${org.nameBn}`
      : `${publicBranding.websiteName} — ${publicBranding.orgNameBn}`;
    document.title = title;
  }, [
    user,
    siteConfig.websiteName,
    org.nameBn,
    publicBranding.websiteName,
    publicBranding.orgNameBn,
  ]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Ensure activeTab remains valid if admin restricts permissions
  useEffect(() => {
    if (!user) return;
    const allowSelfPad =
      isBranchPadPluginEnabled(plugins) &&
      isUserSelfPadCustomizeEnabled(plugins);
    if (activeTab === "admin" && user.role !== "admin") {
      setActiveTab("dashboard");
      window.history.replaceState(null, "", buildAppPath("dashboard"));
    }
    if (
      activeTab === "organization" &&
      user.role !== "admin" &&
      !siteConfig.allowUserOrgEdit &&
      !allowSelfPad
    ) {
      setActiveTab("dashboard");
      window.history.replaceState(null, "", buildAppPath("dashboard"));
    }
  }, [activeTab, user, siteConfig.allowUserOrgEdit, plugins]);

  const navigateTo = useCallback(
    (
      nextTab: AppTab,
      options?: { adminTab?: AdminTab; letterId?: string; replace?: boolean }
    ) => {
      const allowSelfPad =
        isBranchPadPluginEnabled(plugins) &&
        isUserSelfPadCustomizeEnabled(plugins);
      let resolvedTab = nextTab;
      if (resolvedTab === "admin" && user?.role !== "admin") {
        resolvedTab = "dashboard";
      }
      if (
        resolvedTab === "organization" &&
        user?.role !== "admin" &&
        !siteConfig.allowUserOrgEdit &&
        !allowSelfPad
      ) {
        resolvedTab = "dashboard";
      }

      if (resolvedTab === "admin" && options?.adminTab) {
        setAdminInitialTab(options.adminTab);
      }
      setActiveTab(resolvedTab);

      if (user) {
        const nextUrl = buildAppPath(resolvedTab, {
          adminTab:
            resolvedTab === "admin"
              ? options?.adminTab || adminInitialTab
              : undefined,
          letterId: resolvedTab === "editor" ? options?.letterId : undefined,
        });
        if (window.location.pathname !== nextUrl) {
          if (options?.replace) {
            window.history.replaceState(null, "", nextUrl);
          } else {
            window.history.pushState(null, "", nextUrl);
          }
        }
      }
    },
    [user, plugins, siteConfig.allowUserOrgEdit, adminInitialTab]
  );

  // Sync browser Back / Forward navigation with clean slash URLs
  useEffect(() => {
    if (!user) return;
    const handlePopState = () => {
      const parsed = parseAppRoute(window.location.pathname);
      const allowSelfPad =
        isBranchPadPluginEnabled(plugins) &&
        isUserSelfPadCustomizeEnabled(plugins);
      let nextTab: AppTab = parsed.tab || "dashboard";
      if (nextTab === "admin" && user.role !== "admin") {
        nextTab = "dashboard";
      }
      if (
        nextTab === "organization" &&
        user.role !== "admin" &&
        !siteConfig.allowUserOrgEdit &&
        !allowSelfPad
      ) {
        nextTab = "dashboard";
      }
      if (nextTab === "admin" && parsed.adminTab) {
        setAdminInitialTab(parsed.adminTab);
      }
      if (nextTab === "editor" && parsed.letterId) {
        const found = savedLetters.find((l) => l.id === parsed.letterId);
        if (found) {
          setCurrentLetter({ ...found });
          setDraftNeedsSync(false);
          saveLocalEditorDraft(user.userId, found, false);
        }
      }
      setActiveTab(nextTab);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [user, plugins, siteConfig.allowUserOrgEdit, savedLetters]);

  // Persist active tab per user so reload returns user directly to EditorView
  useEffect(() => {
    if (!user) return;
    saveActiveTabPreference(user.userId, activeTab);
  }, [user, activeTab]);

  const handleLogout = async () => {
    setUserMenuOpen(false);
    const prevUserId = user?.userId;
    if (prevUserId) {
      try {
        localStorage.removeItem(`mdo_active_tab_v1_${prevUserId}`);
      } catch {
        // Ignore storage errors
      }
    }
    try {
      sessionStorage.setItem("mdo_explicit_logout", "1");
    } catch {
      // Ignore storage error
    }
    reconcileKeyRef.current = "";
    autoResumeTriedRef.current = false;
    localRestoreTriedRef.current = false;
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore network errors during logout
    }
    setAuthToken("");
    setUser(null);
    setActiveTab("dashboard");
    setDraftNeedsSync(false);
    try {
      window.history.replaceState(null, "", getAppBasePath() || "/");
    } catch {
      // Ignore history error
    }
    try {
      sessionStorage.removeItem("mdo_admin_ai_messages");
    } catch {
      // Ignore storage error
    }
    await loadBootstrap();
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassErr("");
    setPassMsg("");
    if (!curPass || nextPass.length < 4) {
      setPassErr("বর্তমান পাসওয়ার্ড ও কমপক্ষে ৪ অক্ষরের নতুন পাসওয়ার্ড দিন।");
      return;
    }

    setIsChangingPass(true);
    try {
      const res = await apiRequest<{ adminPasswordChanged?: boolean }>(
        "/api/auth/change-password",
        {
          method: "POST",
          body: JSON.stringify({
            currentPassword: curPass,
            newPassword: nextPass,
          }),
        }
      );
      if (res.adminPasswordChanged) {
        setSiteConfig((prev) => ({ ...prev, adminPasswordChanged: true }));
      }
      scheduleVaultSync();
      setCurPass("");
      setNextPass("");
      setPassMsg("পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।");
      setTimeout(() => {
        setShowPasswordModal(false);
        setPassMsg("");
      }, 1500);
    } catch (err: unknown) {
      setPassErr(
        err instanceof Error ? err.message : "পাসওয়ার্ড পরিবর্তন করা যায়নি।"
      );
    } finally {
      setIsChangingPass(false);
    }
  };

  const handleSaveOrg = async (updatedOrg: OrganizationProfile) => {
    const res = await apiRequest<{ organization: OrganizationProfile }>(
      "/api/organization",
      {
        method: "PUT",
        body: JSON.stringify(updatedOrg),
      }
    );
    const saved = res.organization;
    setCurrentLetter((prev) => ({
      ...prev,
      signatoryName:
        prev.signatoryName === org.defaultSignatoryName
          ? saved.defaultSignatoryName
          : prev.signatoryName,
      signatoryTitle:
        prev.signatoryTitle === org.defaultSignatoryTitle
          ? saved.defaultSignatoryTitle
          : prev.signatoryTitle,
      signatoryDept:
        prev.signatoryDept === org.defaultSignatoryDept
          ? saved.defaultSignatoryDept
          : prev.signatoryDept,
    }));
    setOrg(saved);
    setPublicBranding((prev) => ({
      ...prev,
      orgNameBn: saved.nameBn,
      logoDataUrl: saved.logoDataUrl,
    }));
    scheduleVaultSync();
  };

  const handleCurrentLetterChange = useCallback(
    (updated: LetterData) => {
      setCurrentLetter(updated);
      if (userRef.current) {
        saveLocalEditorDraft(userRef.current.userId, updated, true);
      }
    },
    []
  );

  const handleSelectTemplate = (template: LetterTemplate) => {
    const resolved = resolveActivePadForUser({
      plugins,
      userId: user?.userId,
      preferredDepartment: template.category,
      userDepartment: user?.department,
    });
    const resolvedPad = resolved.config;
    const resolvedDept = resolved.scopeKey;
    const next = createLetterFromTemplate(
      template,
      org,
      resolvedPad,
      resolvedDept
    );
    if (!resolvedPad) {
      next.letterheadStyle = currentLetter.letterheadStyle;
      next.letterFont = currentLetter.letterFont;
    }
    setCurrentLetter(next);
    setDraftNeedsSync(false);
    if (user) {
      saveLocalEditorDraft(user.userId, next, false);
    }
    navigateTo("editor");

    void apiRequest<{ userUsage: UserUsageProfile }>("/api/usage/track", {
      method: "POST",
      body: JSON.stringify({ templateId: template.id, action: "use" }),
    })
      .then((res) => {
        setUserUsage(res.userUsage);
        scheduleVaultSync();
      })
      .catch(() => {
        // Non-blocking usage tracking
      });
  };

  const handleTogglePinTemplate = async (
    templateId: string,
    pinned: boolean
  ) => {
    try {
      const res = await apiRequest<{ userUsage: UserUsageProfile }>(
        "/api/usage/track",
        {
          method: "POST",
          body: JSON.stringify({
            templateId,
            action: pinned ? "pin" : "unpin",
          }),
        }
      );
      setUserUsage(res.userUsage);
      scheduleVaultSync();
    } catch {
      // Ignore transient error
    }
  };

  const handleApplyTemplateById = (templateId: string) => {
    const found = templates.find((t) => t.id === templateId);
    if (found) {
      handleSelectTemplate(found);
    }
  };

  const handleStartNewLetter = () => {
    const today = new Date();
    const resolved = resolveActivePadForUser({
      plugins,
      userId: user?.userId,
      userDepartment: user?.department,
    });
    const branchPad = resolved.config;
    const resolvedScope = resolved.scopeKey;
    const primarySig =
      branchPad?.signatories && branchPad.signatories.length > 0
        ? branchPad.signatories[branchPad.signatories.length - 1]
        : undefined;
    const nextDraft: LetterData = {
      id: `ltr-${Date.now()}`,
      templateType: "সাধারণ দাপ্তরিক পত্র",
      refNumber: generateNextRefNumber(
        branchPad?.refPrefix?.trim() || org.refPrefix,
        "পত্র"
      ),
      dateText: formatBengaliDate(today),
      showBanglaDate: true,
      banglaDateText: formatBanglaCalendarDate(today),
      recipientPrefix: "বরাবর",
      recipientName: "",
      recipientTitle: "",
      recipientOrg: "",
      recipientAddress: "",
      subject: "",
      salutation: "মহোদয়,",
      body: "",
      closing: "বিনীত,",
      signatoryName: primarySig?.name || org.defaultSignatoryName,
      signatoryTitle: primarySig?.title || org.defaultSignatoryTitle,
      signatoryDept:
        primarySig?.department ||
        branchPad?.branchTitleBn ||
        org.defaultSignatoryDept,
      attachments: "",
      ccList: "",
      letterheadStyle:
        branchPad?.letterheadStyle ||
        siteConfig.defaultLetterheadStyle ||
        currentLetter.letterheadStyle,
      letterFont:
        branchPad?.letterFont ||
        siteConfig.defaultLetterFont ||
        currentLetter.letterFont,
      showWatermark: currentLetter.showWatermark,
      showSealPlaceholder: currentLetter.showSealPlaceholder,
      ...(resolvedScope ? { branchPadDepartment: resolvedScope } : {}),
    };
    setCurrentLetter(nextDraft);
    setDraftNeedsSync(false);
    if (user) {
      saveLocalEditorDraft(user.userId, nextDraft, false);
    }
    navigateTo("editor");
  };

  const handleSaveLetter = async (
    letter: LetterData,
    options?: { keepalive?: boolean }
  ) => {
    const res = await apiRequest<{ letter: SavedLetter }>("/api/letters", {
      method: "POST",
      body: JSON.stringify(letter),
      keepalive: options?.keepalive,
    });
    const entry = res.letter;
    setSavedLetters((prev) => {
      const idx = prev.findIndex((item) => item.id === entry.id);
      const nextList =
        idx >= 0
          ? prev.map((item, i) => (i === idx ? entry : item))
          : [entry, ...prev];
      if (user?.role === "user") {
        void saveUserLettersSafetySnapshot(user.userId, nextList);
      }
      return nextList;
    });
    if (userRef.current) {
      const currentStored = loadLocalEditorDraft(userRef.current.userId);
      if (!currentStored || currentStored.letter.id === letter.id) {
        saveLocalEditorDraft(userRef.current.userId, letter, false);
      }
    }
    setDraftNeedsSync(false);
    if (activeTab === "editor" && !options?.keepalive) {
      const savedPath = buildAppPath("editor", { letterId: entry.id });
      if (window.location.pathname !== savedPath) {
        window.history.replaceState(null, "", savedPath);
      }
    }
    if (firebaseUser && user?.role === "admin") {
      void saveLetterToCloud(entry, firebaseUser.uid, user.fullName).catch(() => {});
    }
    scheduleVaultSync();
  };

  const handleLoadSaved = (saved: SavedLetter) => {
    const copy = { ...saved };
    setCurrentLetter(copy);
    setDraftNeedsSync(false);
    if (user) {
      saveLocalEditorDraft(user.userId, copy, false);
    }
    navigateTo("editor", { letterId: saved.id });
  };

  const handleDuplicateSaved = async (saved: SavedLetter) => {
    const copyDraft: LetterData = {
      ...saved,
      id: `ltr-${Date.now()}`,
      refNumber: generateNextRefNumber(org.refPrefix, "অনু"),
    };
    try {
      await handleSaveLetter(copyDraft);
    } catch {
      // Handled gracefully
    }
  };

  const handleDeleteSaved = async (id: string) => {
    await apiRequest(`/api/letters/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    setSavedLetters((prev) => {
      const nextList = prev.filter((item) => item.id !== id);
      if (user?.role === "user") {
        void saveUserLettersSafetySnapshot(user.userId, nextList);
      }
      return nextList;
    });
    if (user && currentLetter.id === id) {
      clearLocalEditorDraft(user.userId);
      setDraftNeedsSync(false);
    }
    const activeFbUser = firebaseUserRef.current;
    if (activeFbUser && userRef.current?.role === "admin") {
      const safeTargetId = sanitizeFirestoreId(id);
      const existsInCloudLetters = cloudLettersRef.current.some(
        (item) =>
          item.id === id || sanitizeFirestoreId(item.id) === safeTargetId
      );
      if (existsInCloudLetters) {
        await deleteLetterFromCloud(id);
        setCloudLetters((prev) =>
          prev.filter(
            (item) =>
              item.id !== id && sanitizeFirestoreId(item.id) !== safeTargetId
          )
        );
      }
      if (isVerifiedCloudAdmin(activeFbUser)) {
        await deleteWorkspaceLetterFromVault(id);
      }
    }
    scheduleVaultSync();
  };

  const handleConnectGoogleCloud = async () => {
    setCloudConnecting(true);
    setCloudSyncError("");
    try {
      await signInWithGoogleCloud(user);
      reconcileKeyRef.current = "";
      setReconcileNonce((n) => n + 1);
    } catch (err) {
      setCloudSyncError(
        err instanceof Error
          ? err.message
          : "Google ক্লাউড সংযুক্ত করা যায়নি।"
      );
    } finally {
      setCloudConnecting(false);
    }
  };

  const handleSyncAllToCloud = async () => {
    if (!firebaseUser) return;
    for (const item of savedLetters.slice(0, 30)) {
      await saveLetterToCloud(item, firebaseUser.uid, user?.fullName || "");
    }
    if (user?.role === "admin") {
      await syncCurrentWorkspaceToVault();
    }
  };

  const handleCreateLetterFromVoice = (contentText: string, titleHint?: string) => {
    const today = new Date();
    const resolved = resolveActivePadForUser({
      plugins,
      userId: user?.userId,
      userDepartment: user?.department,
    });
    const branchPad = resolved.config;
    const resolvedScope = resolved.scopeKey;
    const primarySig =
      branchPad?.signatories && branchPad.signatories.length > 0
        ? branchPad.signatories[branchPad.signatories.length - 1]
        : undefined;
    const voiceDraft: LetterData = {
      id: `ltr-${Date.now()}`,
      templateType: "ভয়েস সহায়তায় খসড়া পত্র",
      refNumber: generateNextRefNumber(
        branchPad?.refPrefix?.trim() || org.refPrefix,
        "পত্র"
      ),
      dateText: formatBengaliDate(today),
      showBanglaDate: true,
      banglaDateText: formatBanglaCalendarDate(today),
      recipientPrefix: "বরাবর",
      recipientName: "",
      recipientTitle: "",
      recipientOrg: "",
      recipientAddress: "",
      subject: titleHint || "দাপ্তরিক পত্র",
      salutation: "মহোদয়,",
      body: contentText,
      closing: "বিনীত,",
      signatoryName: primarySig?.name || org.defaultSignatoryName,
      signatoryTitle: primarySig?.title || org.defaultSignatoryTitle,
      signatoryDept:
        primarySig?.department ||
        branchPad?.branchTitleBn ||
        org.defaultSignatoryDept,
      attachments: "",
      ccList: "",
      letterheadStyle:
        branchPad?.letterheadStyle ||
        siteConfig.defaultLetterheadStyle ||
        currentLetter.letterheadStyle,
      letterFont:
        branchPad?.letterFont ||
        siteConfig.defaultLetterFont ||
        currentLetter.letterFont,
      showWatermark: currentLetter.showWatermark,
      showSealPlaceholder: currentLetter.showSealPlaceholder,
      ...(resolvedScope ? { branchPadDepartment: resolvedScope } : {}),
    };
    setCurrentLetter(voiceDraft);
    setDraftNeedsSync(true);
    if (user) {
      saveLocalEditorDraft(user.userId, voiceDraft, true);
    }
    navigateTo("editor");
  };

  const openAdminSection = (subTab: AdminTab) => {
    navigateTo("admin", { adminTab: subTab });
    setUserMenuOpen(false);
  };

  if (bootstrapping) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ backgroundColor: publicBranding.surfaceBgColor || "#F6F5F1" }}
      >
        <div className="text-center space-y-2">
          <p
            className="text-lg font-bold font-letter-serif"
            style={{ color: publicBranding.primaryColor || "#1E3A8A" }}
          >
            {publicBranding.websiteName}
          </p>
          <p className="text-xs text-stone-500">তথ্যসমূহ উপস্থাপিত হচ্ছে...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView branding={publicBranding} onLoginSuccess={loadBootstrap} />
    );
  }

  const primaryColor = siteConfig.primaryColor || "#1E3A8A";
  const surfaceBgColor = siteConfig.surfaceBgColor || "#F6F5F1";
  const labels = siteConfig.navLabels || DEFAULT_SITE_CONFIG.navLabels;

  const canEditOrg = user.role === "admin" || siteConfig.allowUserOrgEdit;
  const userSelfPadActive =
    isBranchPadPluginEnabled(plugins) &&
    isUserSelfPadCustomizeEnabled(plugins);
  const canOpenOrgTab = canEditOrg || userSelfPadActive;
  const canManageTemplates =
    user.role === "admin" || siteConfig.allowUserTemplateCreate;

  const templatePluginEnabled = plugins.some(
    (p) => p.type === "template-manager" && p.enabled
  );
  const pluginSnippets = plugins
    .filter(
      (p) =>
        p.enabled && p.type === "letter-snippet" && p.config?.insertText?.trim()
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      text: p.config.insertText!.trim(),
    }));

  const navItems: { id: AppTab; label: string }[] = [
    { id: "dashboard", label: labels.dashboard || "ড্যাশবোর্ড" },
    { id: "editor", label: labels.editor || "সম্পাদক" },
    { id: "templates", label: labels.templates || "টেমপ্লেট" },
    { id: "saved", label: labels.saved || "সংরক্ষিত" },
    { id: "voice", label: labels.voice || "ভয়েস এআই" },
  ];
  if (canOpenOrgTab) {
    navItems.push({
      id: "organization",
      label: canEditOrg ? labels.organization || "প্রতিষ্ঠান" : "আমার প্যাড",
    });
  }
  if (user.role === "admin") {
    navItems.push({ id: "admin", label: labels.admin || "সাইট কাস্টমাইজ" });
  }

  return (
    <div
      className="print-reset-container min-h-screen flex flex-col text-[#1C1917]"
      style={{ backgroundColor: surfaceBgColor }}
    >
      {/* TOP BAR: Strictly 3 Zones */}
      <header
        data-section="app-header"
        className="no-print sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-stone-200"
      >
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => navigateTo("dashboard")}
            style={{ color: primaryColor }}
            className="text-base sm:text-xl font-bold tracking-tight font-letter-serif truncate min-w-0 cursor-pointer text-left"
          >
            {siteConfig.websiteName}
          </button>

          {/* Zone 2: Single-line Text Navigation Links */}
          <nav
            aria-label="প্রধান নেভিগেশন"
            className="hidden md:flex items-center gap-4 lg:gap-6 text-sm font-medium"
          >
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTo(item.id)}
                  style={isActive ? { borderColor: primaryColor } : undefined}
                  className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                    isActive
                      ? "text-stone-950 font-semibold"
                      : "border-transparent text-stone-600 hover:text-stone-950 hover:border-stone-300"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary Action & Account Menu */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleStartNewLetter}
              style={{ backgroundColor: primaryColor }}
              className="inline-flex items-center gap-1 sm:gap-1.5 h-9 sm:h-10 px-2.5 sm:px-4 rounded-lg text-xs font-medium text-white hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>{siteConfig.uiTexts?.newLetterHeaderButton || "নতুন চিঠি"}</span>
            </button>

            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                className="inline-flex items-center gap-1 sm:gap-1.5 h-9 sm:h-10 px-2 sm:px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-800 hover:bg-stone-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span className="max-w-[74px] sm:max-w-[120px] truncate">{user.fullName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-stone-500 shrink-0" />
              </button>

              {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-68 max-w-[calc(100vw-1.5rem)] bg-white border border-stone-200 rounded-xl shadow-lg py-2 z-50"
                >
                  <div className="px-4 py-2.5 border-b border-stone-200">
                    <p className="text-xs font-semibold text-stone-900 truncate">
                      {user.fullName}
                    </p>
                    <p className="text-[11px] text-stone-600 mt-0.5 truncate">
                      {user.designation ||
                        (user.role === "admin" ? "অ্যাডমিন" : "ব্যবহারকারী")}
                      {" · "}
                      {user.department || "সকল বিভাগ"}
                    </p>
                    <p className="text-[11px] text-stone-400 mt-0.5 font-mono-tabular truncate">
                      আইডি: {user.userId}
                    </p>
                  </div>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      navigateTo("dashboard");
                    }}
                    className="w-full px-4 py-2.5 text-left text-xs font-medium text-stone-800 hover:bg-stone-50 flex items-center gap-2 cursor-pointer"
                  >
                    <LayoutDashboard className="w-3.5 h-3.5 text-stone-500" />
                    <span>আমার ইউজার ড্যাশবোর্ড</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      navigateTo("voice");
                    }}
                    className="w-full px-4 py-2.5 text-left text-xs font-medium text-stone-800 hover:bg-stone-50 flex items-center gap-2 cursor-pointer"
                  >
                    <Mic className="w-3.5 h-3.5 text-stone-500" />
                    <span>রিয়েল-টাইম ভয়েস কথোপকথন</span>
                  </button>

                  {user.role === "admin" && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setUserMenuOpen(false);
                        if (firebaseUser) {
                          void signOutGoogleCloud();
                        } else {
                          void handleConnectGoogleCloud();
                        }
                      }}
                      className="w-full px-4 py-2.5 text-left text-xs font-medium text-stone-800 hover:bg-stone-50 flex items-center gap-2 border-b border-stone-200 cursor-pointer"
                    >
                      <Cloud className="w-3.5 h-3.5 text-stone-500" />
                      <span>
                        {firebaseUser
                          ? `ক্লাউড সংযুক্ত (${firebaseUser.email || "Google"}) · বিচ্ছিন্ন করুন`
                          : "Google ক্লাউড সিঙ্ক যুক্ত করুন"}
                      </span>
                    </button>
                  )}

                  {user.role === "admin" && (
                    <div className="py-1 border-b border-stone-200">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openAdminSection("ai-assistant")}
                        className="w-full px-4 py-2.5 text-left text-xs font-semibold text-[#1E3A8A] hover:bg-stone-50 flex items-center gap-2 cursor-pointer"
                      >
                        <Bot className="w-3.5 h-3.5" />
                        <span>এআই অ্যাসিস্ট্যান্ট (ডিপ এডিট)</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openAdminSection("site")}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-stone-800 hover:bg-stone-50 flex items-center gap-2 cursor-pointer"
                      >
                        <Palette className="w-3.5 h-3.5 text-stone-500" />
                        <span>সাইট ও থিম কাস্টমাইজ</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openAdminSection("plugins")}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-stone-800 hover:bg-stone-50 flex items-center gap-2 cursor-pointer"
                      >
                        <Puzzle className="w-3.5 h-3.5 text-stone-500" />
                        <span>প্লাগইন স্টুডিও</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openAdminSection("developer")}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-stone-800 hover:bg-stone-50 flex items-center gap-2 cursor-pointer"
                      >
                        <Code2 className="w-3.5 h-3.5 text-stone-500" />
                        <span>১০০% ব্যাকআপ ও কাস্টম CSS</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openAdminSection("users")}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-stone-800 hover:bg-stone-50 flex items-center gap-2 cursor-pointer"
                      >
                        <Users className="w-3.5 h-3.5 text-stone-500" />
                        <span>ইউজার ও পাসওয়ার্ড নিয়ন্ত্রণ</span>
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setPassErr("");
                      setPassMsg("");
                      setShowPasswordModal(true);
                    }}
                    className="w-full px-4 py-2.5 text-left text-xs font-medium text-stone-700 hover:bg-stone-50 flex items-center gap-2 cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-stone-500" />
                    <span>পাসওয়ার্ড পরিবর্তন</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    className="w-full px-4 py-2.5 text-left text-xs font-medium text-red-700 hover:bg-red-50 flex items-center gap-2 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>লগআউট</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Compact Nav */}
        <nav
          aria-label="মোবাইল নেভিগেশন"
          className="md:hidden border-t border-stone-200 px-2 flex items-center justify-around overflow-x-auto bg-white"
        >
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                style={
                  isActive
                    ? { borderColor: primaryColor, color: primaryColor }
                    : undefined
                }
                className={`h-11 px-2.5 text-xs font-medium border-b-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  isActive
                    ? "font-semibold"
                    : "border-transparent text-stone-600"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Persistent Admin Cloud Connection / Sync Recovery Notice */}
      {user.role === "admin" && (!isVerifiedCloudAdmin(firebaseUser) || cloudSyncError) && (
        <div className="no-print bg-amber-50 border-b border-amber-200">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
            <div className="flex items-center gap-2 min-w-0">
              <Cloud className="w-4 h-4 text-amber-700 shrink-0" />
              <span className="truncate">
                {cloudSyncError
                  ? cloudSyncError
                  : "সার্ভার রিস্টার্ট হলেও চিঠি, টেমপ্লেট, ইউজার ও কাস্টমাইজেশন স্থায়ীভাবে সংরক্ষিত রাখতে Google ক্লাউড সংযুক্ত করুন।"}
              </span>
            </div>
            {cloudSyncError && isVerifiedCloudAdmin(firebaseUser) ? (
              <button
                type="button"
                onClick={() => {
                  reconcileKeyRef.current = "";
                  setReconcileNonce((n) => n + 1);
                  void syncCurrentWorkspaceToVault();
                }}
                className="shrink-0 h-7 px-3 rounded-md bg-amber-800 text-white font-semibold hover:bg-amber-900 transition-colors cursor-pointer"
              >
                পুনরায় সিঙ্ক করুন
              </button>
            ) : (
              <button
                type="button"
                disabled={cloudConnecting}
                onClick={() => void handleConnectGoogleCloud()}
                className="shrink-0 h-7 px-3 rounded-md bg-amber-800 text-white font-semibold hover:bg-amber-900 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {cloudConnecting ? "সংযুক্ত হচ্ছে..." : "Google ক্লাউড সংযুক্ত করুন"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Optional Site-Wide Announcement Bar */}
      {siteConfig.announcementText && siteConfig.announcementText.trim() && (
        <div
          data-section="app-announcement"
          className="no-print bg-white border-b border-stone-200"
        >
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-2 text-xs text-stone-700 text-center">
            {siteConfig.announcementText}
          </div>
        </div>
      )}

      {/* MAIN VIEWPORT */}
      <main className="print-reset-container flex-1">
        {activeTab === "editor" && (
          <EditorView
            letter={currentLetter}
            org={org}
            templates={templates}
            departments={departments}
            quickPhrases={quickPhrases}
            plugins={plugins}
            userDepartment={user.department}
            currentUserId={user.userId}
            pluginSnippets={pluginSnippets}
            allowAiDrafting={siteConfig.allowAiDrafting}
            isSavedOnServer={savedLetters.some((l) => l.id === currentLetter.id)}
            initialNeedsSync={draftNeedsSync}
            onChange={handleCurrentLetterChange}
            onSaveLetter={handleSaveLetter}
            onDraftSynced={() => setDraftNeedsSync(false)}
            onApplyTemplate={handleApplyTemplateById}
            onOpenPadCustomizer={
              canOpenOrgTab ? () => navigateTo("organization") : undefined
            }
          />
        )}
        <Suspense
          fallback={
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center text-sm text-stone-500">
              লোড হচ্ছে...
            </div>
          }
        >
          {activeTab === "dashboard" && (
            <DashboardView
              user={user}
              firebaseUser={user.role === "admin" ? firebaseUser : null}
              org={org}
              templates={templates}
              letters={savedLetters}
              plugins={plugins}
              userUsage={userUsage}
              uiTexts={siteConfig.uiTexts}
              showLiveClock={Boolean(siteConfig.showLiveClock)}
              showUserAvatar={Boolean(siteConfig.showUserAvatar)}
              dashboardBannerUrl={siteConfig.dashboardBannerUrl || ""}
              dashboardBannerCaption={siteConfig.dashboardBannerCaption || ""}
              customBlocks={siteConfig.customBlocks || siteConfig.uiBlocks || []}
              primaryColor={primaryColor}
              onUserUpdated={(updatedUser) => {
                setUser(updatedUser);
                scheduleVaultSync();
              }}
              onConnectGoogleCloud={
                user.role === "admin" ? handleConnectGoogleCloud : undefined
              }
              onStartNew={handleStartNewLetter}
              onSelectTemplate={handleSelectTemplate}
              onTogglePinTemplate={handleTogglePinTemplate}
              onLoadLetter={handleLoadSaved}
              onDuplicateLetter={handleDuplicateSaved}
              onDeleteLetter={handleDeleteSaved}
              onOpenPluginStudio={() => openAdminSection("plugins")}
              onViewTemplates={() => navigateTo("templates")}
              onViewRecentDocuments={() => navigateTo("saved")}
            />
          )}
          {activeTab === "templates" && (
            <TemplatesView
              templates={templates}
              departments={departments}
              isAdmin={user.role === "admin"}
              canManageTemplates={canManageTemplates}
              templatePluginEnabled={templatePluginEnabled}
              uiTexts={siteConfig.uiTexts}
              onSelectTemplate={handleSelectTemplate}
              onTemplatesUpdated={(nextTpls) => {
                setTemplates(nextTpls);
                if (user.role === "user") {
                  void saveUserTemplatesSafetySnapshot(user.userId, nextTpls);
                } else {
                  scheduleVaultSync();
                }
              }}
            />
          )}
          {activeTab === "saved" && (
            <SavedLettersView
              letters={savedLetters}
              cloudLetters={user.role === "admin" ? cloudLetters : []}
              firebaseUser={user.role === "admin" ? firebaseUser : null}
              isAdmin={user.role === "admin"}
              orgName={org.nameBn}
              uiTexts={siteConfig.uiTexts}
              onLoadLetter={handleLoadSaved}
              onDuplicateLetter={handleDuplicateSaved}
              onDeleteLetter={handleDeleteSaved}
              onStartNew={handleStartNewLetter}
              onConnectGoogleCloud={
                user.role === "admin" ? handleConnectGoogleCloud : undefined
              }
              onSyncAllToCloud={
                user.role === "admin" ? handleSyncAllToCloud : undefined
              }
            />
          )}
          {activeTab === "voice" && (
            <LiveVoiceView
              user={user}
              org={org}
              firebaseUser={user.role === "admin" ? firebaseUser : null}
              isAdmin={user.role === "admin"}
              primaryColor={primaryColor}
              onConnectGoogleCloud={
                user.role === "admin" ? handleConnectGoogleCloud : undefined
              }
              onCreateLetterFromVoice={handleCreateLetterFromVoice}
            />
          )}
          {activeTab === "organization" && canOpenOrgTab && (
            <OrganizationView
              org={org}
              departments={departments}
              plugins={plugins}
              canEdit={canEditOrg}
              userRole={user.role}
              userDepartment={user.department}
              currentUserId={user.userId}
              currentUserFullName={user.fullName}
              currentUserDesignation={user.designation}
              uiTexts={siteConfig.uiTexts}
              onSaveOrg={handleSaveOrg}
              onPluginsUpdated={(nextPlugins) => {
                setPlugins(nextPlugins);
                scheduleVaultSync();
              }}
              onOpenBranchPadPlugin={() => openAdminSection("branch-pads")}
            />
          )}
          {activeTab === "admin" && user.role === "admin" && (
            <AdminPanelView
              currentUser={user}
              firebaseUser={firebaseUser}
              org={org}
              siteConfig={siteConfig}
              departments={departments}
              templates={templates}
              quickPhrases={quickPhrases}
              plugins={plugins}
              allLetters={savedLetters}
              initialTab={adminInitialTab}
              onConnectGoogleCloud={handleConnectGoogleCloud}
              onWorkspaceMutated={scheduleVaultSync}
              onSiteConfigUpdated={(next) => {
                setSiteConfig(next);
                setPublicBranding((prev) => ({
                  ...prev,
                  websiteName: next.websiteName,
                  websiteSubtitle: next.websiteSubtitle,
                  footerText: next.footerText,
                  primaryColor: next.primaryColor,
                  surfaceBgColor: next.surfaceBgColor,
                  showLoginLogo: next.showLoginLogo,
                  showLiveClock: Boolean(next.showLiveClock),
                  loginHeroImageUrl: next.loginHeroImageUrl || next.loginBannerUrl || "",
                  loginHeroCaption: next.loginHeroCaption || "",
                  customBlocks: (next.customBlocks || next.uiBlocks || []).filter(
                    (b) =>
                      b.enabled &&
                      (b.placement === "login-top" || b.placement === "login-bottom")
                  ),
                  uiTexts: next.uiTexts || {},
                }));
                scheduleVaultSync();
              }}
              onDepartmentsUpdated={(depts, maybeTpls) => {
                setDepartments(depts);
                if (maybeTpls) setTemplates(maybeTpls);
                scheduleVaultSync();
              }}
              onTemplatesUpdated={(nextTpls) => {
                setTemplates(nextTpls);
                scheduleVaultSync();
              }}
              onPhrasesUpdated={(nextPhrases) => {
                setQuickPhrases(nextPhrases);
                scheduleVaultSync();
              }}
              onPluginsUpdated={(nextPlugins) => {
                setPlugins(nextPlugins);
                scheduleVaultSync();
              }}
              onFullRestore={(restored) => {
                setSiteConfig(restored.siteConfig);
                setPublicBranding((prev) => ({
                  ...prev,
                  websiteName: restored.siteConfig.websiteName,
                  websiteSubtitle: restored.siteConfig.websiteSubtitle,
                  footerText: restored.siteConfig.footerText,
                  orgNameBn: restored.organization.nameBn,
                  logoDataUrl: restored.organization.logoDataUrl,
                  primaryColor: restored.siteConfig.primaryColor,
                  surfaceBgColor: restored.siteConfig.surfaceBgColor,
                  showLoginLogo: restored.siteConfig.showLoginLogo,
                  showLiveClock: Boolean(restored.siteConfig.showLiveClock),
                  loginHeroImageUrl:
                    restored.siteConfig.loginHeroImageUrl ||
                    restored.siteConfig.loginBannerUrl ||
                    "",
                  loginHeroCaption: restored.siteConfig.loginHeroCaption || "",
                  customBlocks: (
                    restored.siteConfig.customBlocks ||
                    restored.siteConfig.uiBlocks ||
                    []
                  ).filter(
                    (b) =>
                      b.enabled &&
                      (b.placement === "login-top" || b.placement === "login-bottom")
                  ),
                  uiTexts: restored.siteConfig.uiTexts || {},
                }));
                if (Array.isArray(restored.users) && user) {
                  const updatedSelf = restored.users.find((u) => u.id === user.id);
                  if (updatedSelf) setUser(updatedSelf);
                }
                setOrg(restored.organization);
                setDepartments(restored.departments);
                setTemplates(restored.templates);
                setQuickPhrases(restored.quickPhrases);
                if (Array.isArray(restored.plugins)) {
                  setPlugins(restored.plugins);
                }
                setSavedLetters(restored.letters);
                scheduleVaultSync();
              }}
              onOpenOrgTab={() => navigateTo("organization")}
              onNavigateTab={(t) => navigateTo(t)}
              onTabChange={(subTab) =>
                navigateTo("admin", { adminTab: subTab })
              }
              onOpenLetter={handleLoadSaved}
              onDeleteLetter={handleDeleteSaved}
            />
          )}
        </Suspense>
      </main>

      {/* QUIET FOOTER */}
      <footer
        data-section="app-footer"
        className="no-print border-t border-stone-200 bg-white mt-12"
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
          <span>{siteConfig.footerText}</span>
          <div className="flex flex-wrap items-center gap-4">
            {(siteConfig.customLinks || [])
              .filter(
                (lnk) =>
                  !/^\s*(javascript|data|vbscript):/i.test(lnk.url || "")
              )
              .map((lnk) => (
                <a
                  key={lnk.id}
                  href={lnk.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-stone-600 hover:text-stone-900 underline underline-offset-2"
                >
                  {lnk.label}
                </a>
              ))}
            <span>
              {org.nameBn} · {user.fullName}
            </span>
          </div>
        </div>
      </footer>

      {/* User Self Password Change Modal */}
      {showPasswordModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-pass-title"
          className="no-print fixed inset-0 z-50 bg-stone-950/50 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handlePasswordSubmit}
            className="bg-white border border-stone-200 rounded-xl max-w-sm w-full p-6 space-y-4 shadow-xl"
          >
            <input
              id="self-password-username"
              type="text"
              name="username"
              autoComplete="username"
              value={user.userId}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h2
                id="change-pass-title"
                className="text-base font-bold text-stone-900"
              >
                পাসওয়ার্ড পরিবর্তন
              </h2>
              <button
                type="button"
                onClick={() => setShowPasswordModal(false)}
                aria-label="বন্ধ করুন"
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {passMsg && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <Check className="w-4 h-4 shrink-0" />
                <span>{passMsg}</span>
              </div>
            )}
            {passErr && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{passErr}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="self-current-password"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                বর্তমান পাসওয়ার্ড
              </label>
              <input
                id="self-current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                value={curPass}
                onChange={(e) => setCurPass(e.target.value)}
                className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="self-new-password"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                নতুন পাসওয়ার্ড
              </label>
              <input
                id="self-new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                value={nextPass}
                onChange={(e) => setNextPass(e.target.value)}
                placeholder="কমপক্ষে ৪ অক্ষর"
                className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPasswordModal(false)}
                className="h-10 px-4 rounded-lg border border-stone-300 text-xs font-medium text-stone-700 cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="submit"
                disabled={isChangingPass}
                style={{ backgroundColor: primaryColor }}
                className="h-10 px-5 rounded-lg text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60 cursor-pointer"
              >
                {isChangingPass ? "আপডেট হচ্ছে..." : "সংরক্ষণ করুন"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
