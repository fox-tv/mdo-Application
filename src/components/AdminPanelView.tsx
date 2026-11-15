import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  Code2,
  Download,
  Edit3,
  KeyRound,
  Palette,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  UserPlus,
  X,
  ArrowUpRight,
} from "lucide-react";
import {
  CustomNavLink,
  DepartmentItem,
  LetterFont,
  LetterheadStyle,
  LetterTemplate,
  OrganizationProfile,
  PublicUser,
  QuickPhrase,
  SavedLetter,
  SiteConfig,
  UserRole,
} from "../types";
import { apiRequest } from "../utils/api";
import { toBengaliDigits } from "../utils/bengali";

export type AdminTab =
  | "site"
  | "users"
  | "templates"
  | "departments"
  | "developer"
  | "security";

interface AdminPanelViewProps {
  currentUser: PublicUser;
  siteConfig: SiteConfig;
  departments: DepartmentItem[];
  templates: LetterTemplate[];
  quickPhrases: QuickPhrase[];
  allLetters: SavedLetter[];
  initialTab?: AdminTab;
  onSiteConfigUpdated: (next: SiteConfig) => void;
  onDepartmentsUpdated: (depts: DepartmentItem[], tpls?: LetterTemplate[]) => void;
  onTemplatesUpdated: (tpls: LetterTemplate[]) => void;
  onPhrasesUpdated: (phrases: QuickPhrase[]) => void;
  onFullRestore?: (payload: {
    siteConfig: SiteConfig;
    organization: OrganizationProfile;
    departments: DepartmentItem[];
    templates: LetterTemplate[];
    quickPhrases: QuickPhrase[];
    letters: SavedLetter[];
  }) => void;
  onOpenOrgTab?: () => void;
  onOpenLetter: (letter: SavedLetter) => void;
  onDeleteLetter: (id: string) => Promise<void>;
}

const PRIMARY_COLOR_PRESETS = [
  { label: "রয়েল নীল", value: "#1E3A8A" },
  { label: "চিরসবুজ", value: "#14532D" },
  { label: "গভীর টিল", value: "#0F766E" },
  { label: "মেরুন লাল", value: "#7F1D1D" },
  { label: "অ্যান্টিক চারকোল", value: "#1C1917" },
];

const BG_COLOR_PRESETS = [
  { label: "উষ্ণ কাগজ", value: "#F6F5F1" },
  { label: "শীতল স্লেট", value: "#F8FAFC" },
  { label: "নিউট্রাল স্টোন", value: "#F4F4F5" },
  { label: "সাদা ক্যানভাস", value: "#FFFFFF" },
];

function normalizeHexColor(value: string | undefined, fallback: string): string {
  const v = (value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

const EMPTY_TEMPLATE_FORM: Omit<LetterTemplate, "id"> = {
  title: "",
  category: "",
  summary: "",
  refSuffix: "পত্র",
  recipientPrefix: "বরাবর",
  recipientName: "",
  recipientTitle: "",
  recipientOrg: "",
  recipientAddress: "",
  subject: "",
  salutation: "মহোদয়,",
  body: "",
  closing: "বিনীত,",
  attachments: "",
  ccList: "",
};

export const AdminPanelView: React.FC<AdminPanelViewProps> = ({
  currentUser,
  siteConfig,
  departments,
  templates,
  quickPhrases,
  allLetters,
  initialTab = "site",
  onSiteConfigUpdated,
  onDepartmentsUpdated,
  onTemplatesUpdated,
  onPhrasesUpdated,
  onFullRestore,
  onOpenOrgTab,
  onOpenLetter,
  onDeleteLetter,
}) => {
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const [feedback, setFeedback] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Users state
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [newUserId, setNewUserId] = useState("");
  const [newUserPass, setNewUserPass] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserDesig, setNewUserDesig] = useState("");
  const [newUserDept, setNewUserDept] = useState("সকল বিভাগ");
  const [newUserRole, setNewUserRole] = useState<UserRole>("user");

  const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
  const [editUserPassword, setEditUserPassword] = useState("");

  // Templates state
  const [tplFilter, setTplFilter] = useState("সকল");
  const [editingTplId, setEditingTplId] = useState<string | null>(null);
  const [showTplForm, setShowTplForm] = useState(false);
  const [tplForm, setTplForm] = useState<Omit<LetterTemplate, "id">>({
    ...EMPTY_TEMPLATE_FORM,
    category: departments[0]?.name || "প্রশাসনিক ও সাধারণ",
  });

  // Departments & phrases state
  const [newDeptName, setNewDeptName] = useState("");
  const [renamingDeptId, setRenamingDeptId] = useState<string | null>(null);
  const [renamingDeptVal, setRenamingDeptVal] = useState("");
  const [newPhraseText, setNewPhraseText] = useState("");

  // Site config form & custom links
  const [siteForm, setSiteForm] = useState<SiteConfig>(siteConfig);
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);

  // Own password change
  const [curPass, setCurPass] = useState("");
  const [nextPass, setNextPass] = useState("");

  useEffect(() => {
    setSiteForm(siteConfig);
  }, [siteConfig]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const showSuccess = (msg: string) => {
    setErrorMsg("");
    setFeedback(msg);
    setTimeout(() => setFeedback(""), 2600);
  };

  const showErr = (err: unknown) => {
    setFeedback("");
    setErrorMsg(
      err instanceof Error ? err.message : "কাজটি সম্পন্ন করতে সমস্যা হয়েছে।"
    );
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await apiRequest<{ users: PublicUser[] }>("/api/admin/users");
      setUsers(res.users);
    } catch (err) {
      showErr(err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    void fetchUsers();
  }, []);

  // ================= USER HANDLERS =================
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ user: PublicUser }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          userId: newUserId,
          password: newUserPass,
          fullName: newUserName,
          designation: newUserDesig,
          department: newUserDept,
          role: newUserRole,
        }),
      });
      setUsers((prev) => [...prev, res.user]);
      setNewUserId("");
      setNewUserPass("");
      setNewUserName("");
      setNewUserDesig("");
      setNewUserRole("user");
      showSuccess("নতুন ইউজার সফলভাবে তৈরি হয়েছে।");
    } catch (err) {
      showErr(err);
    }
  };

  const handleSaveEditedUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      const res = await apiRequest<{ user: PublicUser }>(
        `/api/admin/users/${editingUser.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            fullName: editingUser.fullName,
            designation: editingUser.designation,
            department: editingUser.department,
            role: editingUser.role,
            isActive: editingUser.isActive,
            newPassword: editUserPassword || undefined,
          }),
        }
      );
      setUsers((prev) =>
        prev.map((u) => (u.id === res.user.id ? res.user : u))
      );
      setEditingUser(null);
      setEditUserPassword("");
      showSuccess("ইউজারের তথ্য ও পাসওয়ার্ড হালনাগাদ হয়েছে।");
    } catch (err) {
      showErr(err);
    }
  };

  const handleToggleUserActive = async (u: PublicUser) => {
    try {
      const res = await apiRequest<{ user: PublicUser }>(
        `/api/admin/users/${u.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ isActive: !u.isActive }),
        }
      );
      setUsers((prev) =>
        prev.map((item) => (item.id === res.user.id ? res.user : item))
      );
      showSuccess(
        res.user.isActive ? "ইউজার সক্রিয় করা হয়েছে।" : "ইউজার নিষ্ক্রিয় করা হয়েছে।"
      );
    } catch (err) {
      showErr(err);
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await apiRequest(`/api/admin/users/${id}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((u) => u.id !== id));
      showSuccess("ইউজার মুছে ফেলা হয়েছে।");
    } catch (err) {
      showErr(err);
    }
  };

  // ================= TEMPLATE HANDLERS =================
  const openCreateTemplate = () => {
    setEditingTplId(null);
    setTplForm({
      ...EMPTY_TEMPLATE_FORM,
      category: departments[0]?.name || "প্রশাসনিক ও সাধারণ",
    });
    setShowTplForm(true);
  };

  const openEditTemplate = (tpl: LetterTemplate) => {
    setEditingTplId(tpl.id);
    const { id: _id, ...rest } = tpl;
    setTplForm(rest);
    setShowTplForm(true);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingTplId) {
        const res = await apiRequest<{ template: LetterTemplate }>(
          `/api/templates/${editingTplId}`,
          {
            method: "PUT",
            body: JSON.stringify(tplForm),
          }
        );
        onTemplatesUpdated(
          templates.map((t) => (t.id === res.template.id ? res.template : t))
        );
        showSuccess("টেমপ্লেট হালনাগাদ করা হয়েছে।");
      } else {
        const res = await apiRequest<{ template: LetterTemplate }>(
          "/api/templates",
          {
            method: "POST",
            body: JSON.stringify(tplForm),
          }
        );
        onTemplatesUpdated([res.template, ...templates]);
        showSuccess("নতুন টেমপ্লেট যুক্ত করা হয়েছে।");
      }
      setShowTplForm(false);
      setEditingTplId(null);
    } catch (err) {
      showErr(err);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await apiRequest(`/api/templates/${id}`, { method: "DELETE" });
      onTemplatesUpdated(templates.filter((t) => t.id !== id));
      showSuccess("টেমপ্লেট মুছে ফেলা হয়েছে।");
    } catch (err) {
      showErr(err);
    }
  };

  // ================= DEPARTMENT & PHRASE HANDLERS =================
  const handleAddDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ departments: DepartmentItem[] }>(
        "/api/admin/departments",
        {
          method: "POST",
          body: JSON.stringify({ name: newDeptName }),
        }
      );
      onDepartmentsUpdated(res.departments);
      setNewDeptName("");
      showSuccess("নতুন বিভাগ যোগ করা হয়েছে।");
    } catch (err) {
      showErr(err);
    }
  };

  const handleRenameDepartment = async (id: string) => {
    try {
      const res = await apiRequest<{
        departments: DepartmentItem[];
        templates: LetterTemplate[];
      }>(`/api/admin/departments/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name: renamingDeptVal }),
      });
      onDepartmentsUpdated(res.departments, res.templates);
      setRenamingDeptId(null);
      setRenamingDeptVal("");
      showSuccess("বিভাগের নাম পরিবর্তন করা হয়েছে।");
    } catch (err) {
      showErr(err);
    }
  };

  const handleDeleteDepartment = async (id: string) => {
    try {
      const res = await apiRequest<{ departments: DepartmentItem[] }>(
        `/api/admin/departments/${id}`,
        { method: "DELETE" }
      );
      onDepartmentsUpdated(res.departments);
      showSuccess("বিভাগ মুছে ফেলা হয়েছে।");
    } catch (err) {
      showErr(err);
    }
  };

  const handleAddPhrase = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ quickPhrases: QuickPhrase[] }>(
        "/api/admin/phrases",
        {
          method: "POST",
          body: JSON.stringify({ text: newPhraseText }),
        }
      );
      onPhrasesUpdated(res.quickPhrases);
      setNewPhraseText("");
      showSuccess("দ্রুত বাক্য যুক্ত হয়েছে।");
    } catch (err) {
      showErr(err);
    }
  };

  const handleDeletePhrase = async (id: string) => {
    try {
      const res = await apiRequest<{ quickPhrases: QuickPhrase[] }>(
        `/api/admin/phrases/${id}`,
        { method: "DELETE" }
      );
      onPhrasesUpdated(res.quickPhrases);
      showSuccess("বাক্যটি সরানো হয়েছে।");
    } catch (err) {
      showErr(err);
    }
  };

  // ================= SITE CONFIG, DEVELOPER & BACKUP =================
  const saveSiteConfigPatch = async (nextConfig: SiteConfig, msg: string) => {
    try {
      const res = await apiRequest<{ siteConfig: SiteConfig }>(
        "/api/admin/site-config",
        {
          method: "PUT",
          body: JSON.stringify(nextConfig),
        }
      );
      onSiteConfigUpdated(res.siteConfig);
      showSuccess(msg);
    } catch (err) {
      showErr(err);
    }
  };

  const handleSaveSiteConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveSiteConfigPatch(
      siteForm,
      "ওয়েবসাইটের থিম, নাম ও অনুমতি সফলভাবে সংরক্ষণ ও প্রয়োগ হয়েছে।"
    );
  };

  const handleResetSiteConfig = async () => {
    try {
      const res = await apiRequest<{ siteConfig: SiteConfig }>(
        "/api/admin/reset-site-config",
        { method: "POST" }
      );
      setSiteForm(res.siteConfig);
      onSiteConfigUpdated(res.siteConfig);
      showSuccess("ওয়েবসাইটের ডিজাইন ও কাস্টমাইজেশন ডিফল্ট অবস্থায় ফিরিয়ে আনা হয়েছে।");
    } catch (err) {
      showErr(err);
    }
  };

  const handleAddCustomLink = () => {
    const label = newLinkLabel.trim();
    const url = newLinkUrl.trim();
    if (!label || !url) {
      showErr(new Error("লিংকের নাম ও ঠিকানা (URL) উভয়ই লিখুন।"));
      return;
    }
    if (/^\s*(javascript|data|vbscript):/i.test(url)) {
      showErr(new Error("অনুগ্রহ করে সঠিক http বা https লিংক দিন।"));
      return;
    }
    const item: CustomNavLink = {
      id: `lnk-${Date.now()}`,
      label,
      url: url.startsWith("http") || url.startsWith("/") ? url : `https://${url}`,
    };
    const next = {
      ...siteForm,
      customLinks: [...(siteForm.customLinks || []), item],
    };
    setSiteForm(next);
    setNewLinkLabel("");
    setNewLinkUrl("");
  };

  const handleRemoveCustomLink = (id: string) => {
    setSiteForm({
      ...siteForm,
      customLinks: (siteForm.customLinks || []).filter((l) => l.id !== id),
    });
  };

  const handleDownloadBackup = async () => {
    setIsExportingBackup(true);
    try {
      const data = await apiRequest<Record<string, unknown>>("/api/admin/backup");
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mdo-site-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccess("সম্পূর্ণ সাইট ও ডাটা ব্যাকআপ ডাউনলোড হয়েছে।");
    } catch (err) {
      showErr(err);
    } finally {
      setIsExportingBackup(false);
    }
  };

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setIsRestoringBackup(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await apiRequest<{
        siteConfig: SiteConfig;
        organization: OrganizationProfile;
        departments: DepartmentItem[];
        templates: LetterTemplate[];
        quickPhrases: QuickPhrase[];
        letters: SavedLetter[];
      }>("/api/admin/restore", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      setSiteForm(res.siteConfig);
      if (onFullRestore) {
        onFullRestore(res);
      } else {
        onSiteConfigUpdated(res.siteConfig);
        onDepartmentsUpdated(res.departments, res.templates);
        onPhrasesUpdated(res.quickPhrases);
      }
      showSuccess("ব্যাকআপ ফাইল থেকে সম্পূর্ণ সাইট সফলভাবে রিস্টোর হয়েছে।");
    } catch (err) {
      showErr(err);
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
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
      setCurPass("");
      setNextPass("");
      if (res.adminPasswordChanged) {
        onSiteConfigUpdated({ ...siteConfig, adminPasswordChanged: true });
      }
      showSuccess("আপনার পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।");
    } catch (err) {
      showErr(err);
    }
  };

  const filteredTemplates =
    tplFilter === "সকল"
      ? templates
      : templates.filter((t) => t.category === tplFilter);

  const subTabs: { id: AdminTab; label: string }[] = [
    { id: "site", label: "সাইট ও থিম কাস্টমাইজ" },
    { id: "users", label: "ইউজার ও পাসওয়ার্ড" },
    { id: "templates", label: "টেমপ্লেট কাস্টমাইজ" },
    { id: "departments", label: "বিভাগ ও বাক্য" },
    { id: "developer", label: "ডেভেলপার ও ব্যাকআপ" },
    { id: "security", label: "নথি ও নিরাপত্তা" },
  ];

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-stone-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            সাইট কাস্টমাইজ, ডেভেলপমেন্ট ও অ্যাডমিন প্যানেল
          </h1>
          <p className="mt-1.5 text-sm text-stone-600">
            ওয়েবসাইটের থিম, রঙ, মেনু, কাস্টম CSS, ব্যাকআপ/রিস্টোর, ইউজার আইডি-পাসওয়ার্ড এবং চিঠির টেমপ্লেট এখান থেকে সরাসরি নিয়ন্ত্রণ করুন।
          </p>
        </div>
        <div className="text-xs text-stone-500 tabular-nums">
          <span>মোট ইউজার: {toBengaliDigits(users.length)}</span>
          <span className="mx-2" aria-hidden="true">·</span>
          <span>টেমপ্লেট: {toBengaliDigits(templates.length)}</span>
          <span className="mx-2" aria-hidden="true">·</span>
          <span>নথি: {toBengaliDigits(allLetters.length)}</span>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="mt-5 flex flex-wrap gap-1.5">
        {subTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setErrorMsg("");
            }}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              tab === item.id
                ? "bg-[#1E3A8A] text-white"
                : "bg-white border border-stone-200 text-stone-700 hover:bg-stone-50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Feedback banners */}
      {feedback && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          <Check className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}
      {errorMsg && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* TAB 1: USERS & PASSWORDS */}
      {tab === "users" && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleCreateUser}
            className="lg:col-span-4 bg-white border border-stone-200 rounded-xl p-5 space-y-3.5"
          >
            <div className="flex items-center gap-2 pb-3 border-b border-stone-200">
              <UserPlus className="w-4 h-4 text-[#1E3A8A]" />
              <h2 className="text-sm font-semibold text-stone-900">
                নতুন ইউজার তৈরি করুন
              </h2>
            </div>

            <div>
              <label
                htmlFor="admin-new-user-id"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                ইউজার আইডি (ইংরেজিতে)
              </label>
              <input
                id="admin-new-user-id"
                name="newUserId"
                type="text"
                autoComplete="off"
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
                placeholder="যেমন: accountant1"
                className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
              />
            </div>

            <div>
              <label
                htmlFor="admin-new-user-pass"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                পাসওয়ার্ড
              </label>
              <input
                id="admin-new-user-pass"
                name="newUserPass"
                type="text"
                autoComplete="off"
                value={newUserPass}
                onChange={(e) => setNewUserPass(e.target.value)}
                placeholder="কমপক্ষে ৪ অক্ষর"
                className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
              />
            </div>

            <div>
              <label
                htmlFor="admin-new-user-name"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                কর্মকর্তার পূর্ণ নাম
              </label>
              <input
                id="admin-new-user-name"
                name="newUserName"
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="যেমন: মো. করিম উদ্দিন"
                className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
              />
            </div>

            <div>
              <label
                htmlFor="admin-new-user-desig"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                পদবি
              </label>
              <input
                id="admin-new-user-desig"
                name="newUserDesig"
                type="text"
                value={newUserDesig}
                onChange={(e) => setNewUserDesig(e.target.value)}
                placeholder="যেমন: শাখা হিসাবরক্ষক"
                className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="admin-new-user-dept"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  বিভাগ
                </label>
                <select
                  id="admin-new-user-dept"
                  name="newUserDept"
                  value={newUserDept}
                  onChange={(e) => setNewUserDept(e.target.value)}
                  className="w-full h-10 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                >
                  <option value="সকল বিভাগ">সকল বিভাগ</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="admin-new-user-role"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  ভূমিকা
                </label>
                <select
                  id="admin-new-user-role"
                  name="newUserRole"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                  className="w-full h-10 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                >
                  <option value="user">ব্যবহারকারী</option>
                  <option value="admin">অ্যাডমিন</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full h-10 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] transition-colors cursor-pointer"
            >
              ইউজার তৈরি করুন
            </button>
          </form>

          <div className="lg:col-span-8 bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-900">
                নিবন্ধিত ইউজার তালিকা
              </h2>
              <span className="text-xs text-stone-500 tabular-nums">
                মোট {toBengaliDigits(users.length)} জন
              </span>
            </div>

            {loadingUsers ? (
              <div className="p-8 text-center text-xs text-stone-500">
                লোড হচ্ছে...
              </div>
            ) : (
              <div className="divide-y divide-stone-200">
                {users.map((u) => (
                  <div
                    key={u.id}
                    className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-0.5">
                        <span className="font-mono-tabular font-semibold text-stone-800">
                          {u.userId}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{u.role === "admin" ? "অ্যাডমিন" : "ব্যবহারকারী"}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            u.isActive ? "text-emerald-700 font-medium" : "text-red-700 font-medium"
                          }
                        >
                          {u.isActive ? "সক্রিয়" : "নিষ্ক্রিয়"}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-stone-900">
                        {u.fullName}
                      </p>
                      <p className="text-xs text-stone-600">
                        {u.designation ? `${u.designation} · ` : ""}
                        {u.department}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUser({ ...u });
                          setEditUserPassword("");
                        }}
                        className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>তথ্য / পাসওয়ার্ড</span>
                      </button>

                      {u.id !== currentUser.id && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleToggleUserActive(u)}
                            className="h-9 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
                          >
                            {u.isActive ? "নিষ্ক্রিয় করুন" : "সক্রিয় করুন"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u.id)}
                            aria-label="ইউজার মুছুন"
                            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-stone-300 bg-white text-stone-600 hover:text-red-700 hover:border-red-200 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: TEMPLATES CUSTOMIZATION */}
      {tab === "templates" && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-stone-200 rounded-xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="admin-tpl-filter"
                name="templateCategoryFilter"
                aria-label="বিভাগ অনুযায়ী টেমপ্লেট ফিল্টার"
                value={tplFilter}
                onChange={(e) => setTplFilter(e.target.value)}
                className="h-10 rounded-lg border border-stone-300 bg-white px-3 text-xs font-medium text-stone-800 focus:outline-none focus:border-[#1E3A8A]"
              >
                <option value="সকল">সকল বিভাগ ({toBengaliDigits(templates.length)})</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={openCreateTemplate}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>নতুন টেমপ্লেট যুক্ত করুন</span>
            </button>
          </div>

          <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-200 overflow-hidden">
            {filteredTemplates.map((tpl) => (
              <div
                key={tpl.id}
                className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-stone-500 mb-0.5">
                    <span>{tpl.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>স্মারক: {tpl.refSuffix}</span>
                  </div>
                  <h3 className="text-sm font-semibold text-stone-900">
                    {tpl.title}
                  </h3>
                  <p className="text-xs text-stone-600 line-clamp-1 mt-0.5">
                    {tpl.subject}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditTemplate(tpl)}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>সম্পাদনা</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTemplate(tpl.id)}
                    aria-label="টেমপ্লেট মুছুন"
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-stone-300 bg-white text-stone-600 hover:text-red-700 hover:border-red-200 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: DEPARTMENTS & QUICK PHRASES */}
      {tab === "departments" && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Departments */}
          <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-stone-900">
              বিভাগ সমূহ (নতুন বিভাগ যোগ ও পরিবর্তন)
            </h2>

            <form onSubmit={handleAddDepartment} className="flex gap-2">
              <input
                id="admin-new-dept"
                name="newDepartmentName"
                aria-label="নতুন বিভাগের নাম"
                type="text"
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                placeholder="নতুন বিভাগের নাম (যেমন: অডিট বিভাগ)"
                className="flex-1 h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] whitespace-nowrap cursor-pointer"
              >
                যোগ করুন
              </button>
            </form>

            <div className="divide-y divide-stone-200 border border-stone-200 rounded-lg">
              {departments.map((d) => (
                <div
                  key={d.id}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-2"
                >
                  {renamingDeptId === d.id ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        id={`admin-rename-dept-${d.id}`}
                        name="renameDepartmentName"
                        aria-label="বিভাগের নতুন নাম"
                        type="text"
                        value={renamingDeptVal}
                        onChange={(e) => setRenamingDeptVal(e.target.value)}
                        className="flex-1 h-9 rounded border border-stone-300 px-2.5 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => handleRenameDepartment(d.id)}
                        className="h-9 px-3 rounded bg-[#1E3A8A] text-xs text-white cursor-pointer"
                      >
                        সেভ
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingDeptId(null)}
                        className="h-9 px-2 text-xs text-stone-600 cursor-pointer"
                      >
                        বাতিল
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-stone-800">
                        {d.name}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingDeptId(d.id);
                            setRenamingDeptVal(d.name);
                          }}
                          className="h-8 px-2.5 rounded border border-stone-200 text-xs text-stone-700 hover:bg-stone-50 cursor-pointer"
                        >
                          নাম বদলান
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDepartment(d.id)}
                          aria-label="বিভাগ মুছুন"
                          className="h-8 w-8 inline-flex items-center justify-center rounded border border-stone-200 text-stone-500 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Quick Phrases */}
          <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-stone-900">
              দাপ্তরিক দ্রুত বাক্য (সম্পাদকে দ্রুত ব্যবহারের জন্য)
            </h2>

            <form onSubmit={handleAddPhrase} className="flex gap-2">
              <input
                id="admin-new-phrase"
                name="newQuickPhrase"
                aria-label="নতুন দাপ্তরিক দ্রুত বাক্য"
                type="text"
                value={newPhraseText}
                onChange={(e) => setNewPhraseText(e.target.value)}
                placeholder="নতুন দাপ্তরিক বাক্য লিখুন..."
                className="flex-1 h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] whitespace-nowrap cursor-pointer"
              >
                যোগ করুন
              </button>
            </form>

            <div className="divide-y divide-stone-200 border border-stone-200 rounded-lg">
              {quickPhrases.map((p) => (
                <div
                  key={p.id}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                >
                  <span className="text-xs text-stone-800">{p.text}</span>
                  <button
                    type="button"
                    onClick={() => handleDeletePhrase(p.id)}
                    aria-label="বাক্য মুছুন"
                    className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded border border-stone-200 text-stone-500 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SITE & THEME CUSTOMIZATION */}
      {tab === "site" && (
        <form onSubmit={handleSaveSiteConfig} className="mt-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left column: Identity, Labels & Links */}
            <div className="lg:col-span-7 space-y-6">
              <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-stone-200">
                  <h2 className="text-sm font-semibold text-stone-900">
                    ওয়েবসাইটের নাম, ঘোষণা ও ফুটার
                  </h2>
                  {onOpenOrgTab && (
                    <button
                      type="button"
                      onClick={onOpenOrgTab}
                      className="text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer"
                    >
                      লোগো ও প্রতিষ্ঠানের প্যাড পরিবর্তন
                    </button>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="admin-site-name"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    ওয়েবসাইটের নাম (হেডার ও ব্রাউজার টাইটেল)
                  </label>
                  <input
                    id="admin-site-name"
                    name="websiteName"
                    type="text"
                    value={siteForm.websiteName}
                    onChange={(e) =>
                      setSiteForm({ ...siteForm, websiteName: e.target.value })
                    }
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-site-subtitle"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    ওয়েবসাইটের সাবটাইটেল (লগইন স্ক্রিনে প্রদর্শিত)
                  </label>
                  <input
                    id="admin-site-subtitle"
                    name="websiteSubtitle"
                    type="text"
                    value={siteForm.websiteSubtitle}
                    onChange={(e) =>
                      setSiteForm({ ...siteForm, websiteSubtitle: e.target.value })
                    }
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-announcement-text"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    সকল পাতার শীর্ষ নোটিশ / ঘোষণা (খালি রাখলে দেখাবে না)
                  </label>
                  <input
                    id="admin-announcement-text"
                    name="announcementText"
                    type="text"
                    value={siteForm.announcementText || ""}
                    onChange={(e) =>
                      setSiteForm({
                        ...siteForm,
                        announcementText: e.target.value,
                      })
                    }
                    placeholder="যেমন: আগামী ২৫ তারিখের মধ্যে সকল শাখার মাসিক রিবেট হিসাব জমা দিন।"
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-footer-text"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    ফুটার বার্তা
                  </label>
                  <input
                    id="admin-footer-text"
                    name="footerText"
                    type="text"
                    value={siteForm.footerText}
                    onChange={(e) =>
                      setSiteForm({ ...siteForm, footerText: e.target.value })
                    }
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
              </div>

              {/* Navigation Menu Labels */}
              <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-stone-900 pb-3 border-b border-stone-200">
                  মেনু ও ট্যাবের নাম কাস্টমাইজ করুন
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label
                      htmlFor="admin-nav-editor"
                      className="block text-xs font-medium text-stone-700 mb-1"
                    >
                      ১ম ট্যাব (চিঠি সম্পাদক)
                    </label>
                    <input
                      id="admin-nav-editor"
                      name="navLabelEditor"
                      type="text"
                      value={siteForm.navLabels?.editor || "সম্পাদক"}
                      onChange={(e) =>
                        setSiteForm({
                          ...siteForm,
                          navLabels: {
                            ...siteForm.navLabels,
                            editor: e.target.value,
                          },
                        })
                      }
                      className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="admin-nav-templates"
                      className="block text-xs font-medium text-stone-700 mb-1"
                    >
                      ২য় ট্যাব (টেমপ্লেট)
                    </label>
                    <input
                      id="admin-nav-templates"
                      name="navLabelTemplates"
                      type="text"
                      value={siteForm.navLabels?.templates || "টেমপ্লেট"}
                      onChange={(e) =>
                        setSiteForm({
                          ...siteForm,
                          navLabels: {
                            ...siteForm.navLabels,
                            templates: e.target.value,
                          },
                        })
                      }
                      className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="admin-nav-saved"
                      className="block text-xs font-medium text-stone-700 mb-1"
                    >
                      ৩য় ট্যাব (সংরক্ষিত নথি)
                    </label>
                    <input
                      id="admin-nav-saved"
                      name="navLabelSaved"
                      type="text"
                      value={siteForm.navLabels?.saved || "সংরক্ষিত"}
                      onChange={(e) =>
                        setSiteForm({
                          ...siteForm,
                          navLabels: {
                            ...siteForm.navLabels,
                            saved: e.target.value,
                          },
                        })
                      }
                      className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="admin-nav-organization"
                      className="block text-xs font-medium text-stone-700 mb-1"
                    >
                      ৪র্থ ট্যাব (প্রতিষ্ঠান)
                    </label>
                    <input
                      id="admin-nav-organization"
                      name="navLabelOrganization"
                      type="text"
                      value={siteForm.navLabels?.organization || "প্রতিষ্ঠান"}
                      onChange={(e) =>
                        setSiteForm({
                          ...siteForm,
                          navLabels: {
                            ...siteForm.navLabels,
                            organization: e.target.value,
                          },
                        })
                      }
                      className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="admin-nav-admin"
                      className="block text-xs font-medium text-stone-700 mb-1"
                    >
                      ৫ম ট্যাব (অ্যাডমিন ও কাস্টমাইজ স্টুডিও)
                    </label>
                    <input
                      id="admin-nav-admin"
                      name="navLabelAdmin"
                      type="text"
                      value={siteForm.navLabels?.admin || "সাইট কাস্টমাইজ"}
                      onChange={(e) =>
                        setSiteForm({
                          ...siteForm,
                          navLabels: {
                            ...siteForm.navLabels,
                            admin: e.target.value,
                          },
                        })
                      }
                      className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Custom Footer Resource Links */}
              <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-semibold text-stone-900 pb-3 border-b border-stone-200">
                  ফুটারে কাস্টম ওয়েবসাইট / পোর্টাল লিংক যুক্ত করুন
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <input
                    id="admin-new-link-label"
                    name="newLinkLabel"
                    aria-label="লিংকের নাম"
                    type="text"
                    value={newLinkLabel}
                    onChange={(e) => setNewLinkLabel(e.target.value)}
                    placeholder="লিংকের নাম (যেমন: মূল ওয়েবসাইট)"
                    className="sm:col-span-5 h-10 rounded-lg border border-stone-300 px-3 text-sm"
                  />
                  <input
                    id="admin-new-link-url"
                    name="newLinkUrl"
                    aria-label="লিংকের ঠিকানা"
                    type="text"
                    value={newLinkUrl}
                    onChange={(e) => setNewLinkUrl(e.target.value)}
                    placeholder="https://example.org"
                    className="sm:col-span-5 h-10 rounded-lg border border-stone-300 px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomLink}
                    className="sm:col-span-2 h-10 rounded-lg border border-stone-300 bg-stone-50 text-xs font-semibold text-stone-800 hover:bg-stone-100 cursor-pointer"
                  >
                    যুক্ত করুন
                  </button>
                </div>

                {(siteForm.customLinks || []).length > 0 && (
                  <div className="divide-y divide-stone-200 border border-stone-200 rounded-lg">
                    {(siteForm.customLinks || []).map((lnk) => (
                      <div
                        key={lnk.id}
                        className="px-3.5 py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-stone-900">
                            {lnk.label}
                          </span>
                          <span className="mx-2 text-stone-400">·</span>
                          <span className="text-stone-500 truncate">{lnk.url}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomLink(lnk.id)}
                          aria-label="লিংক মুছুন"
                          className="text-stone-400 hover:text-red-700 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right column: Theme, Colors, Typography & Permissions */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-5">
                <div className="flex items-center gap-2 pb-3 border-b border-stone-200">
                  <Palette className="w-4 h-4 text-[#1E3A8A]" />
                  <h2 className="text-sm font-semibold text-stone-900">
                    থিম, রঙ ও ফন্ট ডিজাইন
                  </h2>
                </div>

                <div>
                  <p className="text-xs font-medium text-stone-700 mb-2">
                    ওয়েবসাইটের মূল থিম রঙ
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {PRIMARY_COLOR_PRESETS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() =>
                          setSiteForm({ ...siteForm, primaryColor: c.value })
                        }
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                          siteForm.primaryColor === c.value
                            ? "border-stone-900 bg-stone-50 text-stone-900"
                            : "border-stone-200 bg-white text-stone-600"
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: c.value }}
                        />
                        <span>{c.label}</span>
                      </button>
                    ))}
                    <label
                      htmlFor="admin-primary-color"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-stone-200 text-xs text-stone-700 cursor-pointer"
                    >
                      <input
                        id="admin-primary-color"
                        name="primaryColor"
                        type="color"
                        value={normalizeHexColor(siteForm.primaryColor, "#1E3A8A")}
                        onChange={(e) =>
                          setSiteForm({ ...siteForm, primaryColor: e.target.value })
                        }
                        className="w-5 h-5 border-0 bg-transparent p-0 cursor-pointer"
                      />
                      <span>কাস্টম</span>
                    </label>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-stone-700 mb-2">
                    ওয়েবসাইটের ব্যাকগ্রাউন্ড রঙ
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {BG_COLOR_PRESETS.map((bg) => (
                      <button
                        key={bg.value}
                        type="button"
                        onClick={() =>
                          setSiteForm({ ...siteForm, surfaceBgColor: bg.value })
                        }
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                          siteForm.surfaceBgColor === bg.value
                            ? "border-stone-900 bg-stone-50 text-stone-900"
                            : "border-stone-200 bg-white text-stone-600"
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full border border-stone-300"
                          style={{ backgroundColor: bg.value }}
                        />
                        <span>{bg.label}</span>
                      </button>
                    ))}
                    <label
                      htmlFor="admin-surface-bg-color"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-stone-200 text-xs text-stone-700 cursor-pointer"
                    >
                      <input
                        id="admin-surface-bg-color"
                        name="surfaceBgColor"
                        type="color"
                        value={normalizeHexColor(siteForm.surfaceBgColor, "#F6F5F1")}
                        onChange={(e) =>
                          setSiteForm({
                            ...siteForm,
                            surfaceBgColor: e.target.value,
                          })
                        }
                        className="w-5 h-5 border-0 bg-transparent p-0 cursor-pointer"
                      />
                      <span>কাস্টম</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="admin-ui-font"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    ওয়েবসাইটের মূল বাংলা ফন্ট
                  </label>
                  <select
                    id="admin-ui-font"
                    name="uiFont"
                    value={siteForm.uiFont || "hind"}
                    onChange={(e) =>
                      setSiteForm({
                        ...siteForm,
                        uiFont: e.target.value as "hind" | "tiro" | "serif",
                      })
                    }
                    className="w-full h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm"
                  >
                    <option value="hind">হিন্দ শিলিগুড়ি (আধুনিক ও স্পষ্ট)</option>
                    <option value="tiro">তিরো বাংলা (ক্লাসিক ও দাপ্তরিক)</option>
                    <option value="serif">নোটো সেরিফ বাংলা (ঐতিহ্যবাহী)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="admin-default-letterhead"
                      className="block text-xs font-medium text-stone-700 mb-1.5"
                    >
                      নতুন চিঠির ডিফল্ট প্যাড
                    </label>
                    <select
                      id="admin-default-letterhead"
                      name="defaultLetterheadStyle"
                      value={siteForm.defaultLetterheadStyle || "classic"}
                      onChange={(e) =>
                        setSiteForm({
                          ...siteForm,
                          defaultLetterheadStyle: e.target.value as LetterheadStyle,
                        })
                      }
                      className="w-full h-10 rounded-lg border border-stone-300 bg-white px-2.5 text-xs"
                    >
                      <option value="classic">ক্লাসিক দাপ্তরিক</option>
                      <option value="modern">আধুনিক কর্পোরেট</option>
                      <option value="archival">ঐতিহ্যবাহী স্মারক</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="admin-default-letter-font"
                      className="block text-xs font-medium text-stone-700 mb-1.5"
                    >
                      চিঠির ডিফল্ট ফন্ট
                    </label>
                    <select
                      id="admin-default-letter-font"
                      name="defaultLetterFont"
                      value={siteForm.defaultLetterFont || "serif"}
                      onChange={(e) =>
                        setSiteForm({
                          ...siteForm,
                          defaultLetterFont: e.target.value as LetterFont,
                        })
                      }
                      className="w-full h-10 rounded-lg border border-stone-300 bg-white px-2.5 text-xs"
                    >
                      <option value="serif">তিরো বাংলা (সেরিফ)</option>
                      <option value="sans">হিন্দ শিলিগুড়ি</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-3">
                <p className="text-sm font-semibold text-stone-900 pb-2 border-b border-stone-200">
                  ব্যবহারকারী অনুমতি ও ফিচার নিয়ন্ত্রণ
                </p>

                <label
                  htmlFor="admin-allow-user-org"
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-stone-50 border border-stone-200 cursor-pointer"
                >
                  <span className="text-xs font-medium text-stone-800">
                    সাধারণ ইউজার প্রতিষ্ঠানের প্যাড ও লোগো বদলাতে পারবে
                  </span>
                  <input
                    id="admin-allow-user-org"
                    name="allowUserOrgEdit"
                    type="checkbox"
                    checked={siteForm.allowUserOrgEdit}
                    onChange={(e) =>
                      setSiteForm({
                        ...siteForm,
                        allowUserOrgEdit: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-[#1E3A8A]"
                  />
                </label>

                <label
                  htmlFor="admin-allow-user-tpl"
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-stone-50 border border-stone-200 cursor-pointer"
                >
                  <span className="text-xs font-medium text-stone-800">
                    সাধারণ ইউজার নতুন টেমপ্লেট তৈরি করতে পারবে
                  </span>
                  <input
                    id="admin-allow-user-tpl"
                    name="allowUserTemplateCreate"
                    type="checkbox"
                    checked={siteForm.allowUserTemplateCreate}
                    onChange={(e) =>
                      setSiteForm({
                        ...siteForm,
                        allowUserTemplateCreate: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-[#1E3A8A]"
                  />
                </label>

                <label
                  htmlFor="admin-allow-ai"
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-stone-50 border border-stone-200 cursor-pointer"
                >
                  <span className="text-xs font-medium text-stone-800">
                    এআই (AI) চিঠি রচনা সুবিধা চালু রাখুন
                  </span>
                  <input
                    id="admin-allow-ai"
                    name="allowAiDrafting"
                    type="checkbox"
                    checked={siteForm.allowAiDrafting}
                    onChange={(e) =>
                      setSiteForm({
                        ...siteForm,
                        allowAiDrafting: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-[#1E3A8A]"
                  />
                </label>

                <label
                  htmlFor="admin-show-login-logo"
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-stone-50 border border-stone-200 cursor-pointer"
                >
                  <span className="text-xs font-medium text-stone-800">
                    লগইন পেজে প্রতিষ্ঠানের লোগো প্রদর্শন করুন
                  </span>
                  <input
                    id="admin-show-login-logo"
                    name="showLoginLogo"
                    type="checkbox"
                    checked={siteForm.showLoginLogo !== false}
                    onChange={(e) =>
                      setSiteForm({
                        ...siteForm,
                        showLoginLogo: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-[#1E3A8A]"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="flex-1 h-11 px-6 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] transition-colors cursor-pointer"
                >
                  কাস্টমাইজেশন সংরক্ষণ ও প্রয়োগ করুন
                </button>
                <button
                  type="button"
                  onClick={handleResetSiteConfig}
                  className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>ডিফল্ট রিসেট</span>
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* TAB 5: DEVELOPER STUDIO & FULL BACKUP/RESTORE */}
      {tab === "developer" && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSaveSiteConfig}
            className="lg:col-span-7 bg-white border border-stone-200 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-stone-200">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-[#1E3A8A]" />
                <h2 className="text-sm font-semibold text-stone-900">
                  ডেভেলপার কাস্টম CSS এডিটর
                </h2>
              </div>
              <span className="text-xs text-stone-500">
                সরাসরি পুরো ওয়েবসাইটে প্রয়োগ হবে
              </span>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              আপনি চাইলে নিজের প্রয়োজনমতো ওয়েবসাইটের ফন্ট, বাটন, কার্ড বা লেআউটের যেকোনো কাস্টম CSS কোড এখানে লিখতে পারবেন।
            </p>

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setSiteForm({
                    ...siteForm,
                    customCss:
                      (siteForm.customCss ? siteForm.customCss + "\n\n" : "") +
                      "/* কার্ডের বর্ডার আরও গোলাকার করা */\n.rounded-xl { border-radius: 1rem; }",
                  })
                }
                className="px-2.5 py-1 rounded border border-stone-200 bg-stone-50 text-[11px] text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                + গোলাকার কার্ড স্নিপেট
              </button>
              <button
                type="button"
                onClick={() =>
                  setSiteForm({
                    ...siteForm,
                    customCss:
                      (siteForm.customCss ? siteForm.customCss + "\n\n" : "") +
                      "/* বডি ফন্ট সাইজ বড় করা */\nbody { font-size: 15px; }",
                  })
                }
                className="px-2.5 py-1 rounded border border-stone-200 bg-stone-50 text-[11px] text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                + বড় ফন্ট স্নিপেট
              </button>
              {siteForm.customCss && (
                <button
                  type="button"
                  onClick={() => setSiteForm({ ...siteForm, customCss: "" })}
                  className="px-2.5 py-1 rounded border border-red-200 bg-red-50 text-[11px] text-red-700 hover:bg-red-100 cursor-pointer"
                >
                  কোড পরিষ্কার করুন
                </button>
              )}
            </div>

            <textarea
              id="admin-custom-css"
              name="customCss"
              aria-label="কাস্টম CSS কোড"
              rows={10}
              value={siteForm.customCss || ""}
              onChange={(e) =>
                setSiteForm({ ...siteForm, customCss: e.target.value })
              }
              placeholder="/* উদাহরণ: */\nheader { box-shadow: 0 2px 10px rgba(0,0,0,0.04); }"
              className="w-full rounded-lg border border-stone-300 bg-stone-950 text-stone-100 font-mono-tabular p-4 text-xs leading-relaxed focus:outline-none focus:border-[#1E3A8A]"
            />

            <button
              type="submit"
              className="h-10 px-5 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] cursor-pointer"
            >
              CSS সংরক্ষণ ও প্রয়োগ করুন
            </button>
          </form>

          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-stone-900 pb-3 border-b border-stone-200">
                পূর্ণাঙ্গ সিস্টেম ব্যাকআপ ও রিস্টোর
              </h2>
              <p className="text-xs text-stone-600 leading-relaxed">
                আপনার প্রতিষ্ঠানের সকল টেমপ্লেট, বিভাগ, সেটিংস, প্যাড কনফিগারেশন ও সংরক্ষিত চিঠিপত্র একটি JSON ফাইলে সংরক্ষণ করুন এবং প্রয়োজনে যেকোনো সময় রিস্টোর করুন।
              </p>

              <button
                type="button"
                onClick={handleDownloadBackup}
                disabled={isExportingBackup}
                className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] disabled:opacity-60 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>
                  {isExportingBackup
                    ? "ব্যাকআপ প্রস্তুত হচ্ছে..."
                    : "সম্পূর্ণ সাইট ব্যাকআপ ডাউনলোড (.json)"}
                </span>
              </button>

              <label
                htmlFor="admin-restore-backup"
                className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-stone-300 bg-stone-50 text-xs font-semibold text-stone-800 hover:bg-stone-100 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>
                  {isRestoringBackup
                    ? "রিস্টোর হচ্ছে..."
                    : "ব্যাকআপ ফাইল থেকে রিস্টোর করুন (.json)"}
                </span>
                <input
                  id="admin-restore-backup"
                  name="restoreBackup"
                  type="file"
                  accept="application/json,.json"
                  onChange={handleRestoreBackup}
                  disabled={isRestoringBackup}
                  className="sr-only"
                />
              </label>
            </div>

            <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-3">
              <h2 className="text-sm font-semibold text-stone-900">
                দ্রুত ডেভেলপমেন্ট অ্যাক্সেস
              </h2>
              <p className="text-xs text-stone-600">
                প্রতিষ্ঠানের লোগো, ডিজিটাল স্বাক্ষর বা প্যাড হেডার বদলাতে নিচের বাটনে ক্লিক করুন।
              </p>
              {onOpenOrgTab && (
                <button
                  type="button"
                  onClick={onOpenOrgTab}
                  className="w-full h-10 px-4 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer"
                >
                  প্রতিষ্ঠান ও প্যাড কনফিগারেশনে যান
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: ALL LETTERS OVERVIEW & OWN PASSWORD */}
      {tab === "security" && (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleChangeOwnPassword}
            className="lg:col-span-4 bg-white border border-stone-200 rounded-xl p-5 space-y-4"
          >
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={currentUser.userId}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
            <h2 className="text-sm font-semibold text-stone-900">
              অ্যাডমিন পাসওয়ার্ড পরিবর্তন
            </h2>
            <div>
              <label
                htmlFor="admin-cur-pass"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                বর্তমান পাসওয়ার্ড
              </label>
              <input
                id="admin-cur-pass"
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
                htmlFor="admin-next-pass"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                নতুন পাসওয়ার্ড
              </label>
              <input
                id="admin-next-pass"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                value={nextPass}
                onChange={(e) => setNextPass(e.target.value)}
                className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full h-10 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] cursor-pointer"
            >
              পাসওয়ার্ড আপডেট করুন
            </button>
          </form>

          <div className="lg:col-span-8 bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-900">
                সকল ইউজারের সংরক্ষিত চিঠিপত্র
              </h2>
              <span className="text-xs text-stone-500 tabular-nums">
                মোট {toBengaliDigits(allLetters.length)}টি
              </span>
            </div>

            {allLetters.length === 0 ? (
              <div className="p-8 text-center text-xs text-stone-500">
                এখনো কোনো ইউজার চিঠি সংরক্ষণ করেননি।
              </div>
            ) : (
              <div className="divide-y divide-stone-200">
                {allLetters.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-0.5">
                        <span className="tabular-nums font-medium text-stone-700">
                          {item.refNumber}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>তৈরিকারী: {item.ownerName || item.ownerUserId || "অ্যাডমিন"}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.dateText}</span>
                      </div>
                      <p className="text-sm font-semibold text-stone-900 truncate">
                        {item.subject || "শিরোনামহীন"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenLetter(item)}
                        className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-stone-300 text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
                      >
                        <span>খুলুন</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteLetter(item.id)}
                        aria-label="নথি মুছুন"
                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-stone-300 text-stone-600 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* EDIT USER MODAL */}
      {editingUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-edit-user-title"
          className="fixed inset-0 z-50 bg-stone-950/50 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSaveEditedUser}
            className="bg-white border border-stone-200 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2
                id="admin-edit-user-title"
                className="text-base font-bold text-stone-900"
              >
                ইউজার সম্পাদনা ({editingUser.userId})
              </h2>
              <button
                type="button"
                aria-label="বন্ধ করুন"
                onClick={() => setEditingUser(null)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label
                htmlFor="admin-edit-user-fullname"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                পূর্ণ নাম
              </label>
              <input
                id="admin-edit-user-fullname"
                name="editUserFullName"
                type="text"
                value={editingUser.fullName}
                onChange={(e) =>
                  setEditingUser({ ...editingUser, fullName: e.target.value })
                }
                className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
              />
            </div>

            <div>
              <label
                htmlFor="admin-edit-user-desig"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                পদবি
              </label>
              <input
                id="admin-edit-user-desig"
                name="editUserDesignation"
                type="text"
                value={editingUser.designation}
                onChange={(e) =>
                  setEditingUser({
                    ...editingUser,
                    designation: e.target.value,
                  })
                }
                className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="admin-edit-user-dept"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  বিভাগ
                </label>
                <select
                  id="admin-edit-user-dept"
                  name="editUserDepartment"
                  value={editingUser.department}
                  onChange={(e) =>
                    setEditingUser({
                      ...editingUser,
                      department: e.target.value,
                    })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 bg-white px-2.5 text-xs"
                >
                  <option value="সকল বিভাগ">সকল বিভাগ</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="admin-edit-user-role"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  ভূমিকা
                </label>
                <select
                  id="admin-edit-user-role"
                  name="editUserRole"
                  value={editingUser.role}
                  disabled={editingUser.id === currentUser.id}
                  onChange={(e) =>
                    setEditingUser({
                      ...editingUser,
                      role: e.target.value as UserRole,
                    })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 bg-white px-2.5 text-xs disabled:opacity-60"
                >
                  <option value="user">ব্যবহারকারী</option>
                  <option value="admin">অ্যাডমিন</option>
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="admin-edit-user-pass"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                নতুন পাসওয়ার্ড সেট করুন (পরিবর্তন না করলে খালি রাখুন)
              </label>
              <input
                id="admin-edit-user-pass"
                name="editUserPassword"
                type="text"
                autoComplete="off"
                value={editUserPassword}
                onChange={(e) => setEditUserPassword(e.target.value)}
                placeholder="নতুন পাসওয়ার্ড লিখুন"
                className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="h-10 px-4 rounded-lg border border-stone-300 text-xs font-medium text-stone-700 cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="submit"
                className="h-10 px-5 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] cursor-pointer"
              >
                সংরক্ষণ করুন
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ADD / EDIT TEMPLATE MODAL */}
      {showTplForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-tpl-modal-title"
          className="fixed inset-0 z-50 bg-stone-950/50 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSaveTemplate}
            className="bg-white border border-stone-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <h2
                id="admin-tpl-modal-title"
                className="text-base font-bold text-stone-900"
              >
                {editingTplId ? "টেমপ্লেট সম্পাদনা" : "নতুন চিঠির টেমপ্লেট তৈরি"}
              </h2>
              <button
                type="button"
                aria-label="বন্ধ করুন"
                onClick={() => setShowTplForm(false)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="admin-tpl-title"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  টেমপ্লেটের শিরোনাম
                </label>
                <input
                  id="admin-tpl-title"
                  name="tplTitle"
                  type="text"
                  required
                  value={tplForm.title}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, title: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="admin-tpl-category"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  বিভাগ
                </label>
                <select
                  id="admin-tpl-category"
                  name="tplCategory"
                  value={tplForm.category}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, category: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label
                  htmlFor="admin-tpl-summary"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  সংক্ষিপ্ত বিবরণ
                </label>
                <input
                  id="admin-tpl-summary"
                  name="tplSummary"
                  type="text"
                  value={tplForm.summary}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, summary: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="admin-tpl-ref-suffix"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  স্মারক কোড
                </label>
                <input
                  id="admin-tpl-ref-suffix"
                  name="tplRefSuffix"
                  type="text"
                  value={tplForm.refSuffix}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, refSuffix: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="admin-tpl-rec-prefix"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  প্রাপক উপসর্গ
                </label>
                <input
                  id="admin-tpl-rec-prefix"
                  name="tplRecipientPrefix"
                  type="text"
                  value={tplForm.recipientPrefix}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, recipientPrefix: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="admin-tpl-rec-name"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  প্রাপকের নাম/পদ
                </label>
                <input
                  id="admin-tpl-rec-name"
                  name="tplRecipientName"
                  type="text"
                  value={tplForm.recipientName}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, recipientName: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="admin-tpl-rec-title"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  পদবি / শাখা
                </label>
                <input
                  id="admin-tpl-rec-title"
                  name="tplRecipientTitle"
                  type="text"
                  value={tplForm.recipientTitle}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, recipientTitle: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="admin-tpl-rec-org"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  প্রতিষ্ঠান
                </label>
                <input
                  id="admin-tpl-rec-org"
                  name="tplRecipientOrg"
                  type="text"
                  value={tplForm.recipientOrg}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, recipientOrg: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="admin-tpl-subject"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                চিঠির বিষয়
              </label>
              <input
                id="admin-tpl-subject"
                name="tplSubject"
                type="text"
                value={tplForm.subject}
                onChange={(e) =>
                  setTplForm({ ...tplForm, subject: e.target.value })
                }
                className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="admin-tpl-salutation"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  সম্বোধন
                </label>
                <input
                  id="admin-tpl-salutation"
                  name="tplSalutation"
                  type="text"
                  value={tplForm.salutation}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, salutation: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="admin-tpl-closing"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  সমাপ্তি সম্ভাষণ
                </label>
                <input
                  id="admin-tpl-closing"
                  name="tplClosing"
                  type="text"
                  value={tplForm.closing}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, closing: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="admin-tpl-body"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                মূল বক্তব্য
              </label>
              <textarea
                id="admin-tpl-body"
                name="tplBody"
                rows={6}
                value={tplForm.body}
                onChange={(e) =>
                  setTplForm({ ...tplForm, body: e.target.value })
                }
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="admin-tpl-attachments"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  সংযুক্তি
                </label>
                <textarea
                  id="admin-tpl-attachments"
                  name="tplAttachments"
                  rows={2}
                  value={tplForm.attachments}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, attachments: e.target.value })
                  }
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="admin-tpl-cc"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  অনুলিপি (CC)
                </label>
                <textarea
                  id="admin-tpl-cc"
                  name="tplCcList"
                  rows={2}
                  value={tplForm.ccList}
                  onChange={(e) =>
                    setTplForm({ ...tplForm, ccList: e.target.value })
                  }
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTplForm(false)}
                className="h-10 px-4 rounded-lg border border-stone-300 text-xs font-medium text-stone-700 cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="submit"
                className="h-10 px-5 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] cursor-pointer"
              >
                {editingTplId ? "হালনাগাদ করুন" : "টেমপ্লেট সেভ করুন"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
