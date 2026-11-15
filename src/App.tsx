import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Code2,
  KeyRound,
  LogOut,
  Palette,
  Plus,
  Users,
  X,
} from "lucide-react";
import {
  DEFAULT_DEPARTMENTS,
  DEFAULT_ORGANIZATION,
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
  WorkspacePayload,
} from "./types";
import { apiRequest, setAuthToken } from "./utils/api";
import {
  formatBanglaCalendarDate,
  formatBengaliDate,
  generateNextRefNumber,
} from "./utils/bengali";
import { EditorView } from "./components/EditorView";
import type { AdminTab } from "./components/AdminPanelView";
import { LoginView, PublicBranding } from "./components/LoginView";

const TemplatesView = lazy(() =>
  import("./components/TemplatesView").then((m) => ({ default: m.TemplatesView }))
);
const SavedLettersView = lazy(() =>
  import("./components/SavedLettersView").then((m) => ({
    default: m.SavedLettersView,
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
  showDefaultAdminHint: true,
};

export default function App() {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [publicBranding, setPublicBranding] = useState<PublicBranding>(
    DEFAULT_PUBLIC_BRANDING
  );

  const [user, setUser] = useState<PublicUser | null>(null);
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [org, setOrg] = useState<OrganizationProfile>(DEFAULT_ORGANIZATION);
  const [departments, setDepartments] =
    useState<DepartmentItem[]>(DEFAULT_DEPARTMENTS);
  const [templates, setTemplates] =
    useState<LetterTemplate[]>(LETTER_TEMPLATES);
  const [quickPhrases, setQuickPhrases] =
    useState<QuickPhrase[]>(DEFAULT_QUICK_PHRASES);
  const [savedLetters, setSavedLetters] = useState<SavedLetter[]>([]);

  const [activeTab, setActiveTab] = useState<AppTab>("editor");
  const [adminInitialTab, setAdminInitialTab] = useState<AdminTab>("site");
  const [currentLetter, setCurrentLetter] = useState<LetterData>(() =>
    createLetterFromTemplate(LETTER_TEMPLATES[0], DEFAULT_ORGANIZATION)
  );

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [curPass, setCurPass] = useState("");
  const [nextPass, setNextPass] = useState("");
  const [passMsg, setPassMsg] = useState("");
  const [passErr, setPassErr] = useState("");
  const [isChangingPass, setIsChangingPass] = useState(false);

  const userMenuRef = useRef<HTMLDivElement | null>(null);

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
        setUser(ws.user);
        setSiteConfig(ws.siteConfig);
        setOrg(ws.organization);
        setDepartments(ws.departments);
        setTemplates(ws.templates);
        setQuickPhrases(ws.quickPhrases);
        setSavedLetters(ws.letters);

        const initialTemplates =
          ws.templates.length > 0 ? ws.templates : LETTER_TEMPLATES;
        const firstLetter = createLetterFromTemplate(
          initialTemplates[0],
          ws.organization
        );
        firstLetter.letterheadStyle =
          ws.siteConfig.defaultLetterheadStyle || "classic";
        firstLetter.letterFont = ws.siteConfig.defaultLetterFont || "serif";
        setCurrentLetter(firstLetter);
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
      hind: '"Hind Siliguri", system-ui, -apple-system, sans-serif',
      tiro: '"Tiro Bangla", "Noto Serif Bengali", Georgia, serif',
      serif: '"Noto Serif Bengali", "Tiro Bangla", Georgia, serif',
    };
    root.style.setProperty("--font-ui", fontMap[siteConfig.uiFont || "hind"]);
  }, [
    user,
    siteConfig.primaryColor,
    siteConfig.surfaceBgColor,
    siteConfig.uiFont,
    publicBranding.primaryColor,
    publicBranding.surfaceBgColor,
  ]);

  // Inject live custom CSS inside document.head cleanly (valid HTML5)
  useEffect(() => {
    const existing = document.getElementById("mdo-custom-css");
    if (siteConfig.customCss && siteConfig.customCss.trim()) {
      const styleEl =
        existing ||
        (() => {
          const el = document.createElement("style");
          el.id = "mdo-custom-css";
          document.head.appendChild(el);
          return el;
        })();
      styleEl.textContent = siteConfig.customCss;
    } else if (existing) {
      existing.remove();
    }
  }, [siteConfig.customCss]);

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
    if (activeTab === "admin" && user.role !== "admin") {
      setActiveTab("editor");
    }
    if (
      activeTab === "organization" &&
      user.role !== "admin" &&
      !siteConfig.allowUserOrgEdit
    ) {
      setActiveTab("editor");
    }
  }, [activeTab, user, siteConfig.allowUserOrgEdit]);

  const handleLogout = async () => {
    setUserMenuOpen(false);
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore network errors during logout
    }
    setAuthToken("");
    setUser(null);
    setActiveTab("editor");
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
  };

  const handleSelectTemplate = (template: LetterTemplate) => {
    const next = createLetterFromTemplate(template, org);
    next.letterheadStyle = currentLetter.letterheadStyle;
    next.letterFont = currentLetter.letterFont;
    setCurrentLetter(next);
    setActiveTab("editor");
  };

  const handleApplyTemplateById = (templateId: string) => {
    const found = templates.find((t) => t.id === templateId);
    if (found) {
      handleSelectTemplate(found);
    }
  };

  const handleStartNewLetter = () => {
    const today = new Date();
    setCurrentLetter({
      id: `ltr-${Date.now()}`,
      templateType: "সাধারণ দাপ্তরিক পত্র",
      refNumber: generateNextRefNumber(org.refPrefix, "পত্র"),
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
      signatoryName: org.defaultSignatoryName,
      signatoryTitle: org.defaultSignatoryTitle,
      signatoryDept: org.defaultSignatoryDept,
      attachments: "",
      ccList: "",
      letterheadStyle:
        siteConfig.defaultLetterheadStyle || currentLetter.letterheadStyle,
      letterFont: siteConfig.defaultLetterFont || currentLetter.letterFont,
      showWatermark: currentLetter.showWatermark,
      showSealPlaceholder: currentLetter.showSealPlaceholder,
    });
    setActiveTab("editor");
  };

  const handleSaveLetter = async (letter: LetterData) => {
    const res = await apiRequest<{ letter: SavedLetter }>("/api/letters", {
      method: "POST",
      body: JSON.stringify(letter),
    });
    const entry = res.letter;
    setSavedLetters((prev) => {
      const idx = prev.findIndex((item) => item.id === entry.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = entry;
        return copy;
      }
      return [entry, ...prev];
    });
  };

  const handleLoadSaved = (saved: SavedLetter) => {
    setCurrentLetter({ ...saved });
    setActiveTab("editor");
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
    await apiRequest(`/api/letters/${id}`, { method: "DELETE" });
    setSavedLetters((prev) => prev.filter((item) => item.id !== id));
  };

  const openAdminSection = (subTab: AdminTab) => {
    setAdminInitialTab(subTab);
    setActiveTab("admin");
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
          <p className="text-xs text-stone-500">তথ্য লোড হচ্ছে...</p>
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
  const canManageTemplates =
    user.role === "admin" || siteConfig.allowUserTemplateCreate;

  const navItems: { id: AppTab; label: string }[] = [
    { id: "editor", label: labels.editor || "সম্পাদক" },
    { id: "templates", label: labels.templates || "টেমপ্লেট" },
    { id: "saved", label: labels.saved || "সংরক্ষিত" },
  ];
  if (canEditOrg) {
    navItems.push({
      id: "organization",
      label: labels.organization || "প্রতিষ্ঠান",
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
      <header className="no-print sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-stone-200">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab("editor")}
            style={{ color: primaryColor }}
            className="text-lg sm:text-xl font-bold tracking-tight font-letter-serif whitespace-nowrap shrink-0 cursor-pointer"
          >
            {siteConfig.websiteName}
          </button>

          {/* Zone 2: Single-line Text Navigation Links */}
          <nav
            aria-label="প্রধান নেভিগেশন"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
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
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleStartNewLetter}
              style={{ backgroundColor: primaryColor }}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 sm:px-4 rounded-lg text-xs font-medium text-white hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>নতুন চিঠি</span>
            </button>

            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-800 hover:bg-stone-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span className="max-w-[110px] truncate">{user.fullName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-stone-500" />
              </button>

              {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-64 bg-white border border-stone-200 rounded-xl shadow-lg py-2 z-50"
                >
                  <div className="px-4 py-2.5 border-b border-stone-200">
                    <p className="text-xs font-semibold text-stone-900 truncate">
                      {user.fullName}
                    </p>
                    <p className="text-[11px] text-stone-500 mt-0.5 truncate">
                      {user.designation ||
                        (user.role === "admin" ? "অ্যাডমিন" : "ব্যবহারকারী")}
                      {" · "}
                      <span className="font-mono-tabular">{user.userId}</span>
                    </p>
                  </div>

                  {user.role === "admin" && (
                    <div className="py-1 border-b border-stone-200">
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
                        onClick={() => openAdminSection("developer")}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-stone-800 hover:bg-stone-50 flex items-center gap-2 cursor-pointer"
                      >
                        <Code2 className="w-3.5 h-3.5 text-stone-500" />
                        <span>ডেভেলপার CSS ও ব্যাকআপ</span>
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
                onClick={() => setActiveTab(item.id)}
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

      {/* Optional Site-Wide Announcement Bar */}
      {siteConfig.announcementText && siteConfig.announcementText.trim() && (
        <div className="no-print bg-white border-b border-stone-200">
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
            allowAiDrafting={siteConfig.allowAiDrafting}
            onChange={setCurrentLetter}
            onSaveLetter={handleSaveLetter}
            onApplyTemplate={handleApplyTemplateById}
          />
        )}
        <Suspense
          fallback={
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center text-sm text-stone-500">
              লোড হচ্ছে...
            </div>
          }
        >
          {activeTab === "templates" && (
            <TemplatesView
              templates={templates}
              departments={departments}
              canManageTemplates={canManageTemplates}
              onSelectTemplate={handleSelectTemplate}
              onTemplatesUpdated={setTemplates}
            />
          )}
          {activeTab === "saved" && (
            <SavedLettersView
              letters={savedLetters}
              onLoadLetter={handleLoadSaved}
              onDuplicateLetter={handleDuplicateSaved}
              onDeleteLetter={handleDeleteSaved}
              onStartNew={handleStartNewLetter}
            />
          )}
          {activeTab === "organization" && canEditOrg && (
            <OrganizationView
              org={org}
              canEdit={canEditOrg}
              onSaveOrg={handleSaveOrg}
            />
          )}
          {activeTab === "admin" && user.role === "admin" && (
            <AdminPanelView
              currentUser={user}
              siteConfig={siteConfig}
              departments={departments}
              templates={templates}
              quickPhrases={quickPhrases}
              allLetters={savedLetters}
              initialTab={adminInitialTab}
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
                  showDefaultAdminHint: !next.adminPasswordChanged,
                }));
              }}
              onDepartmentsUpdated={(depts, maybeTpls) => {
                setDepartments(depts);
                if (maybeTpls) setTemplates(maybeTpls);
              }}
              onTemplatesUpdated={setTemplates}
              onPhrasesUpdated={setQuickPhrases}
              onFullRestore={(restored) => {
                setSiteConfig(restored.siteConfig);
                setOrg(restored.organization);
                setDepartments(restored.departments);
                setTemplates(restored.templates);
                setQuickPhrases(restored.quickPhrases);
                setSavedLetters(restored.letters);
              }}
              onOpenOrgTab={() => setActiveTab("organization")}
              onOpenLetter={handleLoadSaved}
              onDeleteLetter={handleDeleteSaved}
            />
          )}
        </Suspense>
      </main>

      {/* QUIET FOOTER */}
      <footer className="no-print border-t border-stone-200 bg-white mt-12">
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
