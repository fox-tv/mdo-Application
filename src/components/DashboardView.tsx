import React, { useMemo, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import {
  ArrowRight,
  Cloud,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Pin,
  PinOff,
  Plus,
  Puzzle,
  Search,
  Trash2,
} from "lucide-react";
import type {
  CustomUiBlock,
  LetterTemplate,
  OrganizationProfile,
  PublicUser,
  SavedLetter,
  SitePlugin,
  UserUsageProfile,
} from "../types";
import { apiRequest } from "../utils/api";
import { toBengaliDigits } from "../utils/bengali";
import { exportSavedLettersToExcel } from "../utils/export";
import { UserProfileHeader } from "./UserProfileHeader";
import { QuickActions } from "./QuickActions";
import { CustomBlocksZone, isSafeImageSrc } from "./DynamicUiElements";

interface DashboardViewProps {
  user: PublicUser;
  firebaseUser?: FirebaseUser | null;
  org: OrganizationProfile;
  templates: LetterTemplate[];
  letters: SavedLetter[];
  plugins: SitePlugin[];
  userUsage: UserUsageProfile;
  uiTexts?: Record<string, string>;
  showLiveClock?: boolean;
  showUserAvatar?: boolean;
  dashboardBannerUrl?: string;
  dashboardBannerCaption?: string;
  customBlocks?: CustomUiBlock[];
  primaryColor?: string;
  onUserUpdated?: (updated: PublicUser) => void;
  onConnectGoogleCloud?: () => Promise<void>;
  onStartNew: () => void;
  onSelectTemplate: (tpl: LetterTemplate) => void;
  onTogglePinTemplate: (templateId: string, pinned: boolean) => Promise<void>;
  onLoadLetter: (letter: SavedLetter) => void;
  onDuplicateLetter: (letter: SavedLetter) => Promise<void>;
  onDeleteLetter: (id: string) => Promise<void>;
  onOpenPluginStudio: () => void;
  onViewTemplates?: () => void;
  onViewRecentDocuments?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  user,
  firebaseUser = null,
  org,
  templates,
  letters,
  plugins,
  userUsage,
  uiTexts,
  showUserAvatar = false,
  dashboardBannerUrl = "",
  dashboardBannerCaption = "",
  customBlocks = [],
  primaryColor = "#1E3A8A",
  onUserUpdated,
  onConnectGoogleCloud,
  onStartNew,
  onSelectTemplate,
  onTogglePinTemplate,
  onLoadLetter,
  onDuplicateLetter,
  onDeleteLetter,
  onOpenPluginStudio,
  onViewTemplates,
  onViewRecentDocuments,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [letterScope, setLetterScope] = useState<"mine" | "all">("mine");
  const [downloadingBackup, setDownloadingBackup] = useState(false);
  const [connectingCloud, setConnectingCloud] = useState(false);
  const [backupNotice, setBackupNotice] = useState("");
  const [backupError, setBackupError] = useState("");

  // Separate user's own saved letters vs all org letters (for admin toggle)
  const myLetters = useMemo(
    () =>
      letters.filter(
        (l) => !l.ownerUserId || l.ownerUserId === user.userId
      ),
    [letters, user.userId]
  );

  // Build real usage map combining explicit userUsage counts + saved letters frequency
  const combinedUsageMap = useMemo(() => {
    const counts: Record<string, number> = {
      ...(userUsage?.templateCounts || {}),
    };
    for (const ltr of myLetters) {
      const matched = templates.find((t) => t.title === ltr.templateType);
      if (matched) {
        counts[matched.id] = (counts[matched.id] || 0) + 1;
      }
    }
    return counts;
  }, [userUsage?.templateCounts, myLetters, templates]);

  // Rank frequent & role-relevant shortcut templates (max 6)
  const shortcutTemplates = useMemo(() => {
    const pinnedSet = new Set(userUsage?.pinnedTemplateIds || []);
    const recentOrder = new Map<string, number>();
    (userUsage?.recentTemplateIds || []).forEach((id, idx) =>
      recentOrder.set(id, 10 - idx)
    );

    const scored = templates.map((tpl) => {
      const isPinned = pinnedSet.has(tpl.id) ? 1 : 0;
      const usageCount = combinedUsageMap[tpl.id] || 0;
      const recencyBonus = recentOrder.get(tpl.id) || 0;
      const deptMatch =
        user.department &&
        user.department !== "সকল বিভাগ" &&
        tpl.category === user.department
          ? 2
          : 0;
      return {
        tpl,
        isPinned: Boolean(isPinned),
        usageCount,
        score: isPinned * 1000 + usageCount * 20 + recencyBonus + deptMatch,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 6);
  }, [templates, userUsage, combinedUsageMap, user.department]);

  const activeLetters =
    user.role === "admin" && letterScope === "all" ? letters : myLetters;

  const filteredLetters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeLetters;
    return activeLetters.filter(
      (item) =>
        item.subject.toLowerCase().includes(q) ||
        item.refNumber.toLowerCase().includes(q) ||
        item.recipientName.toLowerCase().includes(q) ||
        item.templateType.toLowerCase().includes(q)
    );
  }, [activeLetters, searchQuery]);

  const dashboardWidgets = useMemo(
    () =>
      plugins.filter(
        (p) => p.enabled && p.type === "dashboard-widget" && (p.config?.heading || p.config?.content)
      ),
    [plugins]
  );

  const enabledPluginsCount = useMemo(
    () => plugins.filter((p) => p.enabled).length,
    [plugins]
  );

  const handleDownloadFullBackup = async () => {
    setBackupError("");
    setBackupNotice("");
    setDownloadingBackup(true);
    try {
      const data = await apiRequest<Record<string, unknown>>("/api/admin/backup");
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `mdo-full-server-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackupNotice(
        "সকল ইউজার আইডি, পাসওয়ার্ড ও সার্ভারের ১০০% ডাটা ব্যাকআপ ডাউনলোড সম্পন্ন হয়েছে।"
      );
      setTimeout(() => setBackupNotice(""), 3200);
    } catch (err: unknown) {
      setBackupError(
        err instanceof Error ? err.message : "ব্যাকআপ ডাউনলোড করা যায়নি।"
      );
    } finally {
      setDownloadingBackup(false);
    }
  };

  const totalWorkDone = Object.values(combinedUsageMap).reduce(
    (sum, n) => sum + n,
    0
  );

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <CustomBlocksZone
        blocks={customBlocks}
        placement="dashboard-top"
        user={user}
        primaryColor={primaryColor}
      />

      {/* USER IDENTITY & WELCOME HEADER */}
      <section
        data-section="dashboard-hero"
        aria-label="ব্যবহারকারীর পরিচিতি ও ড্যাশবোর্ড"
        className="bg-white border border-stone-200 rounded-xl p-6 sm:p-7"
      >
        <UserProfileHeader
          user={user}
          orgNameBn={org.nameBn}
          badgeLabel={uiTexts?.dashboardBadge}
          primaryColor={primaryColor}
          showAvatar={showUserAvatar}
          onUserUpdated={onUserUpdated}
          extraRight={
            <CustomBlocksZone
              blocks={customBlocks}
              placement="dashboard-hero-right"
              user={user}
              primaryColor={primaryColor}
            />
          }
          actions={
            <>
              <button
                type="button"
                onClick={onStartNew}
                style={{ backgroundColor: primaryColor }}
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-xs font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>
                  {uiTexts?.dashboardNewButton || "নতুন দাপ্তরিক পত্র প্রস্তুত করুন"}
                </span>
              </button>

              {user.role === "admin" && (
                <button
                  type="button"
                  onClick={() => void handleDownloadFullBackup()}
                  disabled={downloadingBackup}
                  className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-60 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" style={{ color: primaryColor }} />
                  <span>
                    {downloadingBackup
                      ? "ব্যাকআপ হচ্ছে..."
                      : "১০০% সার্ভার ব্যাকআপ ডাউনলোড"}
                  </span>
                </button>
              )}
            </>
          }
        />

        {isSafeImageSrc(dashboardBannerUrl) && (
          <div
            data-widget="dashboard-banner"
            className="mt-5 rounded-xl overflow-hidden border border-stone-200 bg-stone-50"
          >
            <img
              src={dashboardBannerUrl}
              alt={dashboardBannerCaption || org.nameBn}
              referrerPolicy="no-referrer"
              className="w-full max-h-56 object-cover"
            />
            {dashboardBannerCaption && (
              <p className="px-4 py-2.5 text-xs text-stone-600 border-t border-stone-200 bg-white">
                {dashboardBannerCaption}
              </p>
            )}
          </div>
        )}

        {(backupNotice || backupError) && (
          <div
            role={backupError ? "alert" : "status"}
            className={`mt-4 rounded-lg border px-3.5 py-2.5 text-xs ${
              backupError
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {backupError || backupNotice}
          </div>
        )}

        {user.role === "admin" && !firebaseUser && onConnectGoogleCloud && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-amber-950 space-y-0.5">
              <p className="font-semibold">
                স্থায়ী ক্লাউড ডাটাবেজ সংযুক্ত করুন (রিসেট বা ডাটা হারানো রোধে)
              </p>
              <p className="text-amber-800">
                আপনার তৈরি সকল ইউজার, সাইট কাস্টমাইজেশন, টেমপ্লেট ও চিঠিপত্র দীর্ঘমেয়াদে (৫–১০+ বছর) স্থায়ী রাখতে একবার Google অ্যাকাউন্ট সংযুক্ত করুন।
              </p>
            </div>
            <button
              type="button"
              disabled={connectingCloud}
              onClick={() => {
                setBackupError("");
                setConnectingCloud(true);
                void onConnectGoogleCloud()
                  .catch((err) =>
                    setBackupError(
                      err instanceof Error
                        ? err.message
                        : "Google ক্লাউড সংযুক্ত করা যায়নি।"
                    )
                  )
                  .finally(() => setConnectingCloud(false));
              }}
              style={{ backgroundColor: primaryColor }}
              className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Cloud className="w-4 h-4" />
              <span>
                {connectingCloud
                  ? "সংযুক্ত হচ্ছে..."
                  : "Google ক্লাউড স্থায়ী সংরক্ষণ চালু করুন"}
              </span>
            </button>
          </div>
        )}

        {/* Quiet 4-column metric bar */}
        <div className="mt-6 pt-5 border-t border-stone-200 grid grid-cols-2 sm:grid-cols-4 gap-5">
          <div>
            <p className="text-xs text-stone-500">আপনার সংরক্ষিত পত্র</p>
            <p className="mt-0.5 text-2xl font-bold text-stone-900 tabular-nums">
              {toBengaliDigits(myLetters.length)}টি
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-500">মোট ব্যবহৃত কার্যক্রম</p>
            <p className="mt-0.5 text-2xl font-bold text-stone-900 tabular-nums">
              {toBengaliDigits(totalWorkDone)} বার
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-500">প্রাতিষ্ঠানিক টেমপ্লেট</p>
            <p className="mt-0.5 text-2xl font-bold text-stone-900 tabular-nums">
              {toBengaliDigits(templates.length)}টি
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-500">সক্রিয় ইন-বিল্ট প্লাগইন</p>
            <p className="mt-0.5 text-2xl font-bold text-stone-900 tabular-nums">
              {toBengaliDigits(enabledPluginsCount)}টি
            </p>
          </div>
        </div>
      </section>

      <QuickActions
        primaryColor={primaryColor}
        templatesCount={templates.length}
        recentLettersCount={myLetters.length}
        latestLetter={myLetters[0] || null}
        onCreateNewLetter={onStartNew}
        onViewTemplates={() => {
          if (onViewTemplates) {
            onViewTemplates();
          } else {
            document
              .querySelector('[data-section="dashboard-shortcuts"]')
              ?.scrollIntoView({ behavior: "smooth" });
          }
        }}
        onViewRecentDocuments={() => {
          if (onViewRecentDocuments) {
            onViewRecentDocuments();
          } else {
            document
              .querySelector('[data-section="dashboard-saved"]')
              ?.scrollIntoView({ behavior: "smooth" });
          }
        }}
      />

      {/* ACTIVE DASHBOARD WIDGET PLUGINS */}
      {dashboardWidgets.length > 0 && (
        <section
          data-section="dashboard-widgets"
          aria-label="প্লাগইন নোটিশ ও উইজেট"
          className="space-y-3"
        >
          {dashboardWidgets.map((widget) => (
            <div
              key={widget.id}
              className="bg-white border border-stone-200 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div>
                <p className="text-xs font-semibold text-[#1E3A8A]">
                  {widget.config?.heading || widget.name}
                </p>
                {widget.config?.content && (
                  <p className="mt-1 text-sm text-stone-700 leading-relaxed">
                    {widget.config.content}
                  </p>
                )}
              </div>
              {user.role === "admin" && (
                <button
                  type="button"
                  onClick={onOpenPluginStudio}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-stone-200 text-xs font-medium text-stone-700 hover:bg-stone-50 shrink-0 cursor-pointer"
                >
                  <Puzzle className="w-3.5 h-3.5" />
                  <span>প্লাগইন নিয়ন্ত্রণ</span>
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* FREQUENT WORK SHORTCUTS */}
      <section
        data-section="dashboard-shortcuts"
        aria-label="বেশি ব্যবহৃত কাজের শর্টকাট"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-stone-900">
              {uiTexts?.dashboardShortcutsTitle ||
                "আপনার নিয়মিত ও বেশি ব্যবহৃত কাজের শর্টকাট"}
            </h2>
            <p className="text-xs text-stone-600 mt-0.5">
              {uiTexts?.dashboardShortcutsSubtitle ||
                "আপনার বিভাগ, পূর্ববর্তী কাজ ও পিন করা তালিকার ভিত্তিতে সাজানো — এক ক্লিকেই চিঠি সম্পাদনা শুরু করুন।"}
            </p>
          </div>
          {user.role === "admin" && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onOpenPluginStudio}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-800 hover:bg-stone-50 cursor-pointer"
              >
                <Puzzle className="w-3.5 h-3.5 text-[#1E3A8A]" />
                <span>প্লাগইন স্টুডিও</span>
              </button>
            </div>
          )}
        </div>

        {shortcutTemplates.length === 0 ? (
          <div className="bg-white border border-stone-200 rounded-xl p-8 text-center text-xs text-stone-600">
            আপনার বিভাগের জন্য এখনো কোনো অনুমোদিত টেমপ্লেট নির্ধারিত নেই। প্রয়োজনে প্রধান প্রশাসকের সাথে যোগাযোগ করুন অথবা “নতুন দাপ্তরিক পত্র প্রস্তুত করুন” ব্যবহার করুন।
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {shortcutTemplates.map(({ tpl, isPinned, usageCount }) => (
              <div
                key={tpl.id}
                className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col justify-between hover:border-stone-300 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs text-stone-500 flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-stone-700">
                        {tpl.category}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        ব্যবহৃত: {toBengaliDigits(usageCount)} বার
                      </span>
                      {isPinned && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-[#1E3A8A] font-medium">পিনকৃত</span>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void onTogglePinTemplate(tpl.id, !isPinned)}
                      aria-label={
                        isPinned
                          ? `${tpl.title} শর্টকাট পিন সরান`
                          : `${tpl.title} শর্টকাট হিসেবে পিন করুন`
                      }
                      title={isPinned ? "পিন সরান" : "শর্টকাটে পিন করুন"}
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors shrink-0 cursor-pointer ${
                        isPinned
                          ? "border-[#1E3A8A]/30 bg-[#1E3A8A]/5 text-[#1E3A8A]"
                          : "border-stone-200 text-stone-400 hover:text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      {isPinned ? (
                        <PinOff className="w-3.5 h-3.5" />
                      ) : (
                        <Pin className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  <h3 className="mt-2 text-sm font-bold text-stone-900 leading-snug">
                    {tpl.title}
                  </h3>
                  <p className="mt-1.5 text-xs text-stone-600 line-clamp-2 leading-relaxed">
                    {tpl.summary}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-stone-400 tabular-nums">
                    {tpl.refSuffix}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelectTemplate(tpl)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#1E3A8A] hover:underline cursor-pointer"
                  >
                    <span>কাজ শুরু করুন</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SAVED & EDITED LETTERS LIST */}
      <section
        data-section="dashboard-saved"
        aria-label="আপনার সম্পাদিত ও সংরক্ষিত চিঠিপত্র"
      >
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-stone-900">
              {uiTexts?.dashboardSavedTitle ||
                "আপনার সম্পাদিত ও সংরক্ষিত চিঠিপত্র"}
            </h2>
            <p className="text-xs text-stone-600 mt-0.5">
              {uiTexts?.dashboardSavedSubtitle ||
                "ইতিমধ্যে প্রস্তুতকৃত ও সংরক্ষিত সকল দাপ্তরিক পত্র এখান থেকে সরাসরি খুলতে, প্রতিলিপি করতে বা এক্সেলে নামাতে পারবেন।"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {user.role === "admin" && (
              <div className="flex items-center gap-1 p-1 bg-stone-200/70 rounded-lg">
                <button
                  type="button"
                  onClick={() => setLetterScope("mine")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    letterScope === "mine"
                      ? "bg-white text-stone-900 shadow-xs"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  আমার পত্র ({toBengaliDigits(myLetters.length)})
                </button>
                <button
                  type="button"
                  onClick={() => setLetterScope("all")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    letterScope === "all"
                      ? "bg-white text-stone-900 shadow-xs"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  সকল ({toBengaliDigits(letters.length)})
                </button>
              </div>
            )}

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="dashboard-letters-search"
                name="dashboardLettersSearch"
                aria-label="ড্যাশবোর্ডে সংরক্ষিত পত্র খুঁজুন"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="বিষয় বা স্মারক নং খুঁজুন..."
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-stone-300 bg-white text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-[#1E3A8A]"
              />
            </div>

            {activeLetters.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  exportSavedLettersToExcel(
                    filteredLetters.length > 0 ? filteredLetters : activeLetters,
                    org.nameBn,
                    `${user.userId}_letters_sutonnymj`,
                    "bijoy"
                  )
                }
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-800 hover:bg-stone-50 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                <span>এক্সেল (SutonnyMJ)</span>
              </button>
            )}
          </div>
        </div>

        {activeLetters.length === 0 ? (
          <div className="bg-white border border-stone-200 rounded-xl p-10 text-center">
            <div className="w-11 h-11 rounded-full bg-stone-100 mx-auto flex items-center justify-center text-stone-500">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="mt-3 text-base font-semibold text-stone-900">
              এখনো কোনো পত্র সংরক্ষণ করা হয়নি
            </h3>
            <p className="mt-1 text-sm text-stone-600 max-w-md mx-auto">
              উপরের যেকোনো শর্টকাট বা “নতুন দাপ্তরিক পত্র প্রস্তুত করুন” বোতামে ক্লিক করে কাজ শুরু করুন এবং সংরক্ষণ করলে এখানে তালিকাভুক্ত হবে।
            </p>
          </div>
        ) : filteredLetters.length === 0 ? (
          <div className="bg-white border border-stone-200 rounded-xl p-8 text-center text-sm text-stone-600">
            এই অনুসন্ধানের সাথে সামঞ্জস্যপূর্ণ কোনো পত্র পাওয়া যায়নি।
          </div>
        ) : (
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-200">
            {filteredLetters.map((item) => (
              <div
                key={item.id}
                className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/70 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-stone-500 mb-1">
                    <span className="font-medium text-stone-700">
                      {item.templateType}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{item.refNumber}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.dateText}</span>
                    {item.ownerName && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>প্রস্তুতকারক: {item.ownerName}</span>
                      </>
                    )}
                  </div>
                  <h3 className="text-sm font-bold text-stone-900 truncate">
                    {item.subject || "শিরোনামহীন পত্র"}
                  </h3>
                  {item.recipientName && (
                    <p className="text-xs text-stone-600 mt-0.5 truncate">
                      প্রাপক: {item.recipientName}
                      {item.recipientOrg ? `, ${item.recipientOrg}` : ""}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onLoadLetter(item)}
                    className="h-9 px-3.5 rounded-lg bg-[#1E3A8A] text-xs font-medium text-white hover:bg-[#172D6B] transition-colors cursor-pointer"
                  >
                    উন্মুক্ত করুন
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDuplicateLetter(item)}
                    title="অনুলিপি তৈরি করুন"
                    aria-label="অনুলিপি তৈরি করুন"
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteLetter(item.id)}
                    title="পত্র মুছে ফেলুন"
                    aria-label="পত্র মুছে ফেলুন"
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-stone-300 bg-white text-stone-600 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <CustomBlocksZone
        blocks={customBlocks}
        placement="dashboard-bottom"
        user={user}
        primaryColor={primaryColor}
      />
    </div>
  );
};
