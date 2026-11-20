import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  Plus,
  Puzzle,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { BRAND_COLOR_OPTIONS, DEFAULT_ORGANIZATION } from "../data/templates";
import type {
  BranchPadConfig,
  BranchPadSignatory,
  CrestType,
  DepartmentItem,
  LetterFont,
  LetterheadStyle,
  OrganizationProfile,
  SitePlugin,
  UserRole,
} from "../types";
import { apiRequest } from "../utils/api";
import { toBengaliDigits } from "../utils/bengali";
import {
  createDefaultBranchPadConfig,
  getBranchPadMap,
  isBranchPadPluginEnabled,
} from "../utils/branchPad";
import { CrestIcon } from "./CrestIcon";

interface OrganizationViewProps {
  org: OrganizationProfile;
  departments?: DepartmentItem[];
  plugins?: SitePlugin[];
  canEdit: boolean;
  userRole?: UserRole;
  userDepartment?: string;
  uiTexts?: Record<string, string>;
  onSaveOrg: (updated: OrganizationProfile) => Promise<void>;
  onPluginsUpdated?: (plugins: SitePlugin[]) => void;
  onOpenBranchPadPlugin?: () => void;
}

const CREST_OPTIONS: { id: CrestType; label: string }[] = [
  { id: "heritage", label: "ঐতিহ্যবাহী" },
  { id: "academic", label: "শিক্ষা" },
  { id: "corporate", label: "কর্পোরেট" },
  { id: "tech", label: "প্রযুক্তি" },
  { id: "justice", label: "আইন ও ন্যায়" },
  { id: "civic", label: "সামাজিক" },
];

async function uploadMediaDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("ফাইল পড়া যায়নি।"));
    reader.readAsDataURL(file);
  });
  try {
    const res = await apiRequest<{ url: string }>("/api/media/upload", {
      method: "POST",
      body: JSON.stringify({ dataUrl }),
    });
    return res.url;
  } catch {
    return dataUrl;
  }
}

export const OrganizationView: React.FC<OrganizationViewProps> = ({
  org,
  departments = [],
  plugins = [],
  canEdit,
  userRole = "user",
  userDepartment = "",
  uiTexts,
  onSaveOrg,
  onPluginsUpdated,
  onOpenBranchPadPlugin,
}) => {
  const branchPluginEnabled = isBranchPadPluginEnabled(plugins);
  const branchPadsMap = useMemo(() => getBranchPadMap(plugins), [plugins]);

  const initialScope = useMemo(() => {
    if (
      branchPluginEnabled &&
      userRole !== "admin" &&
      userDepartment &&
      userDepartment !== "সকল বিভাগ" &&
      departments.some((d) => d.name === userDepartment)
    ) {
      return userDepartment;
    }
    return "__global__";
  }, [branchPluginEnabled, userRole, userDepartment, departments]);

  const [selectedScope, setSelectedScope] = useState<string>(initialScope);
  const [draft, setDraft] = useState<OrganizationProfile>(org);
  const [branchDraft, setBranchDraft] = useState<BranchPadConfig>(() =>
    createDefaultBranchPadConfig(
      departments[0]?.name || "হিসাবরক্ষক বিভাগ",
      org
    )
  );
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string>("");
  const [savedToast, setSavedToast] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    setDraft(org);
  }, [org]);

  useEffect(() => {
    if (!branchPluginEnabled && selectedScope !== "__global__") {
      setSelectedScope("__global__");
    }
  }, [branchPluginEnabled, selectedScope]);

  useEffect(() => {
    if (selectedScope === "__global__") return;
    const saved = branchPadsMap[selectedScope];
    if (saved) {
      setBranchDraft({
        ...createDefaultBranchPadConfig(selectedScope, org),
        ...saved,
        signatories: Array.isArray(saved.signatories)
          ? saved.signatories.map((s) => ({ ...s }))
          : [],
      });
    } else {
      setBranchDraft(createDefaultBranchPadConfig(selectedScope, org));
    }
  }, [selectedScope, branchPadsMap, org]);

  const isGlobalScope = selectedScope === "__global__";
  const canEditSelectedScope =
    canEdit &&
    (userRole === "admin" ||
      isGlobalScope ||
      !userDepartment ||
      userDepartment === "সকল বিভাগ" ||
      userDepartment === selectedScope);

  const update = <K extends keyof OrganizationProfile>(
    key: K,
    val: OrganizationProfile[K]
  ) => {
    setDraft((prev) => ({ ...prev, [key]: val }));
  };

  const updateBranch = <K extends keyof BranchPadConfig>(
    key: K,
    val: BranchPadConfig[K]
  ) => {
    setBranchDraft((prev) => ({ ...prev, [key]: val }));
  };

  const handleGlobalImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    targetKey: "logoDataUrl" | "signatureDataUrl"
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingKey(targetKey);
    try {
      const url = await uploadMediaDataUrl(file);
      update(targetKey, url);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "ছবি আপলোড করা যায়নি।"
      );
    } finally {
      setUploadingKey("");
    }
  };

  const handleBranchLogoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingKey("branch-logo");
    try {
      const url = await uploadMediaDataUrl(file);
      updateBranch("logoUrl", url);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "লোগো আপলোড করা যায়নি।"
      );
    } finally {
      setUploadingKey("");
    }
  };

  const handleBranchSigUpload = async (
    sigId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingKey(`sig-${sigId}`);
    try {
      const url = await uploadMediaDataUrl(file);
      setBranchDraft((prev) => ({
        ...prev,
        signatories: prev.signatories.map((s) =>
          s.id === sigId ? { ...s, signatureUrl: url } : s
        ),
      }));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "স্বাক্ষরের ছবি আপলোড করা যায়নি।"
      );
    } finally {
      setUploadingKey("");
    }
  };

  const addBranchSignatory = () => {
    if (branchDraft.signatories.length >= 6) return;
    const item: BranchPadSignatory = {
      id: `sig-${Date.now()}-${branchDraft.signatories.length + 1}`,
      roleLabel: "স্বাক্ষরকারী",
      name: "",
      title: "",
      department: selectedScope,
      signatureUrl: "",
    };
    setBranchDraft((prev) => ({
      ...prev,
      signatories: [...prev.signatories, item],
    }));
  };

  const updateBranchSignatory = (
    sigId: string,
    patch: Partial<BranchPadSignatory>
  ) => {
    setBranchDraft((prev) => ({
      ...prev,
      signatories: prev.signatories.map((s) =>
        s.id === sigId ? { ...s, ...patch } : s
      ),
    }));
  };

  const removeBranchSignatory = (sigId: string) => {
    setBranchDraft((prev) => ({
      ...prev,
      signatories: prev.signatories.filter((s) => s.id !== sigId),
    }));
  };

  const showToast = (msg: string) => {
    setSavedToast(msg);
    setTimeout(() => setSavedToast(""), 2600);
  };

  const handleSave = async () => {
    setErrorMsg("");
    setIsSaving(true);
    try {
      if (isGlobalScope) {
        await onSaveOrg(draft);
        showToast("মূল প্রতিষ্ঠানের তথ্য সফলভাবে সংরক্ষিত");
      } else {
        const res = await apiRequest<{ plugins: SitePlugin[] }>(
          `/api/branch-pads/${encodeURIComponent(selectedScope)}`,
          {
            method: "PUT",
            body: JSON.stringify(branchDraft),
          }
        );
        onPluginsUpdated?.(res.plugins);
        showToast(`“${selectedScope}” সংরক্ষিত`);
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "প্রতিষ্ঠানের তথ্য সংরক্ষণ করা যায়নি।"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefault = async () => {
    setErrorMsg("");
    if (isGlobalScope) {
      setDraft(DEFAULT_ORGANIZATION);
      if (canEditSelectedScope) {
        setIsSaving(true);
        try {
          await onSaveOrg(DEFAULT_ORGANIZATION);
          showToast("মূল তথ্য ডিফল্টে রিসেট হয়েছে");
        } catch (err: unknown) {
          setErrorMsg(
            err instanceof Error ? err.message : "রিসেট সংরক্ষণ করা যায়নি।"
          );
        } finally {
          setIsSaving(false);
        }
      }
      return;
    }

    setIsSaving(true);
    try {
      const res = await apiRequest<{ plugins: SitePlugin[] }>(
        `/api/branch-pads/${encodeURIComponent(selectedScope)}`,
        { method: "DELETE" }
      );
      onPluginsUpdated?.(res.plugins);
      setBranchDraft(createDefaultBranchPadConfig(selectedScope, org));
      showToast(`“${selectedScope}” মূল প্যাডে ফিরেছে`);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "শাখার প্যাড রিসেট করা যায়নি।"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const previewColor = isGlobalScope
    ? draft.brandColor
    : branchDraft.accentColor || org.brandColor;
  const previewNameBn = isGlobalScope
    ? draft.nameBn
    : branchDraft.orgNameOverride?.trim() || org.nameBn;
  const previewBranchTitle = isGlobalScope
    ? ""
    : branchDraft.branchTitleBn?.trim() || selectedScope;
  const previewNameEn = isGlobalScope
    ? draft.nameEn
    : branchDraft.nameEnOverride?.trim() || org.nameEn;
  const previewTagline = isGlobalScope
    ? draft.tagline
    : branchDraft.headerTagline?.trim() || org.tagline;
  const previewAddress = isGlobalScope
    ? draft.address
    : branchDraft.address?.trim() || org.address;
  const previewPhone = isGlobalScope
    ? draft.phone
    : branchDraft.phone?.trim() || org.phone;
  const previewEmail = isGlobalScope
    ? draft.email
    : branchDraft.email?.trim() || org.email;
  const previewLogo = isGlobalScope
    ? draft.logoDataUrl
    : branchDraft.logoUrl?.trim() || org.logoDataUrl;
  const previewCrest = isGlobalScope
    ? draft.crestType
    : branchDraft.crestType || org.crestType;

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div
        data-section="org-profile-header"
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-stone-200"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            {uiTexts?.orgTitle || "প্রতিষ্ঠানের তথ্য ও প্যাড কনফিগারেশন"}
          </h1>
          <p className="mt-1.5 text-sm text-stone-600">
            {branchPluginEnabled
              ? "মূল প্রতিষ্ঠানের পাশাপাশি প্রত্যেকটি শাখার জন্য আলাদা আলাদা প্রতিষ্ঠানের তথ্য, প্যাড কনফিগারেশন ও স্বাক্ষরকারী স্থায়ীভাবে সংরক্ষণ করুন।"
              : "এখানে সেট করা নাম, লোগো, ঠিকানা ও স্বাক্ষরের তথ্য সকল ব্যবহারকারীর চিঠির প্যাডে যুক্ত হবে।"}
          </p>
        </div>

        {canEditSelectedScope && (
          <div className="flex flex-wrap items-center gap-2.5">
            {savedToast && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <Check className="w-3.5 h-3.5" />
                {savedToast}
              </span>
            )}
            <button
              type="button"
              onClick={handleResetDefault}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{isGlobalScope ? "ডিফল্ট রিসেট" : "মূল প্যাডে রিসেট"}</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] disabled:opacity-60 transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {isSaving
                  ? "সংরক্ষণ হচ্ছে..."
                  : isGlobalScope
                    ? "মূল তথ্য সংরক্ষণ করুন"
                    : "শাখার প্যাড সংরক্ষণ করুন"}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Per-Branch Organization & Pad Configuration Switcher (Plugin) */}
      {branchPluginEnabled && departments.length > 0 && (
        <div
          data-section="org-branch-plugin-bar"
          className="mt-5 bg-white border border-stone-200 rounded-xl p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#1E3A8A]" />
              <span className="text-xs font-semibold text-stone-900">
                শাখাভিত্তিক প্রতিষ্ঠানের তথ্য ও প্যাড প্লাগইন
              </span>
              <span className="text-[11px] text-emerald-700 font-semibold">
                · সক্রিয়
              </span>
            </div>
            {userRole === "admin" && onOpenBranchPadPlugin && (
              <button
                type="button"
                onClick={onOpenBranchPadPlugin}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1E3A8A] hover:underline cursor-pointer self-start sm:self-auto"
              >
                <Puzzle className="w-3.5 h-3.5" />
                <span>শাখা প্যাড স্টুডিও (পূর্ণ A4 প্রিভিউ)</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => setSelectedScope("__global__")}
              className={`text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                selectedScope === "__global__"
                  ? "border-[#1E3A8A] bg-[#1E3A8A]/5 text-[#1E3A8A]"
                  : "border-stone-200 bg-stone-50/50 text-stone-700 hover:bg-stone-50"
              }`}
            >
              <p className="text-xs font-semibold truncate">
                মূল প্রতিষ্ঠানের তথ্য (ডিফল্ট)
              </p>
              <p className="text-[11px] text-stone-500 mt-0.5 truncate">
                {org.nameBn}
              </p>
            </button>

            {departments.map((dept) => {
              const savedPad = branchPadsMap[dept.name];
              const isCustomized = Boolean(
                savedPad && savedPad.enabled !== false
              );
              const isSelected = selectedScope === dept.name;
              return (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => setSelectedScope(dept.name)}
                  className={`text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                    isSelected
                      ? "border-[#1E3A8A] bg-[#1E3A8A]/5 text-[#1E3A8A]"
                      : "border-stone-200 bg-white text-stone-800 hover:bg-stone-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-semibold truncate">
                      {dept.name}
                    </span>
                    <span
                      className={`text-[10px] font-semibold shrink-0 ${
                        isCustomized ? "text-emerald-700" : "text-stone-400"
                      }`}
                    >
                      {isCustomized ? "আলাদা সেভ করা" : "ডিফল্ট"}
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-500 mt-0.5 truncate tabular-nums">
                    {isCustomized
                      ? `স্বাক্ষরকারী: ${toBengaliDigits(
                          savedPad.signatories?.length || 0
                        )} জন`
                      : "নিজস্ব তথ্য ও প্যাড সেট করুন"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!canEditSelectedScope && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          {canEdit
            ? "আপনি শুধুমাত্র আপনার নিজস্ব নির্ধারিত শাখার তথ্য ও প্যাড পরিবর্তন করতে পারবেন।"
            : "প্রতিষ্ঠানের প্যাড ও লোগো পরিবর্তন করার অনুমতি বর্তমানে শুধুমাত্র অ্যাডমিনের জন্য সংরক্ষিত।"}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="mt-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Form */}
        {isGlobalScope ? (
          <fieldset
            disabled={!canEditSelectedScope}
            className="lg:col-span-7 bg-white border border-stone-200 rounded-xl p-6 space-y-6 disabled:opacity-85"
          >
            <div>
              <h2 className="text-sm font-semibold text-stone-900 mb-4">
                মৌলিক পরিচয়
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="org-name-bn"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    প্রতিষ্ঠানের নাম (বাংলায়)
                  </label>
                  <input
                    id="org-name-bn"
                    name="nameBn"
                    type="text"
                    value={draft.nameBn}
                    onChange={(e) => update("nameBn", e.target.value)}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="org-name-en"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    প্রতিষ্ঠানের নাম (ইংরেজি - ঐচ্ছিক)
                  </label>
                  <input
                    id="org-name-en"
                    name="nameEn"
                    type="text"
                    value={draft.nameEn}
                    onChange={(e) => update("nameEn", e.target.value)}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="org-tagline"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    স্লোগান / প্রতিষ্ঠানের ধরন
                  </label>
                  <input
                    id="org-tagline"
                    name="tagline"
                    type="text"
                    value={draft.tagline}
                    onChange={(e) => update("tagline", e.target.value)}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="org-reg-number"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    নিবন্ধন / ইআইআইএন / লাইসেন্স নম্বর
                  </label>
                  <input
                    id="org-reg-number"
                    name="regNumber"
                    type="text"
                    value={draft.regNumber}
                    onChange={(e) => update("regNumber", e.target.value)}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="org-ref-prefix"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    স্মারক নম্বরের সংক্ষিপ্ত প্রিফিক্স
                  </label>
                  <input
                    id="org-ref-prefix"
                    name="refPrefix"
                    type="text"
                    value={draft.refPrefix}
                    onChange={(e) => update("refPrefix", e.target.value)}
                    placeholder="যেমন: মডেঅ/প্রশা"
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
              </div>
            </div>

            <div className="pt-5 border-t border-stone-200">
              <h2 className="text-sm font-semibold text-stone-900 mb-4">
                যোগাযোগ ও ঠিকানা
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="org-address"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    কার্যালয়ের পূর্ণ ঠিকানা
                  </label>
                  <input
                    id="org-address"
                    name="address"
                    type="text"
                    value={draft.address}
                    onChange={(e) => update("address", e.target.value)}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="org-phone"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    ফোন / মোবাইল নম্বর
                  </label>
                  <input
                    id="org-phone"
                    name="phone"
                    type="text"
                    value={draft.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm tabular-nums text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="org-email"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    ইমেইল ঠিকানা
                  </label>
                  <input
                    id="org-email"
                    name="email"
                    type="email"
                    value={draft.email}
                    onChange={(e) => update("email", e.target.value)}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="org-website"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    ওয়েবসাইট
                  </label>
                  <input
                    id="org-website"
                    name="website"
                    type="text"
                    value={draft.website}
                    onChange={(e) => update("website", e.target.value)}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
              </div>
            </div>

            <div className="pt-5 border-t border-stone-200">
              <h2 className="text-sm font-semibold text-stone-900 mb-4">
                ডিফল্ট স্বাক্ষরকারী ও ডিজিটাল স্বাক্ষর
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="org-signatory-name"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    স্বাক্ষরকারীর নাম
                  </label>
                  <input
                    id="org-signatory-name"
                    name="defaultSignatoryName"
                    type="text"
                    value={draft.defaultSignatoryName}
                    onChange={(e) =>
                      update("defaultSignatoryName", e.target.value)
                    }
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="org-signatory-title"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    পদবি
                  </label>
                  <input
                    id="org-signatory-title"
                    name="defaultSignatoryTitle"
                    type="text"
                    value={draft.defaultSignatoryTitle}
                    onChange={(e) =>
                      update("defaultSignatoryTitle", e.target.value)
                    }
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="org-signatory-dept"
                    className="block text-xs font-medium text-stone-700 mb-1.5"
                  >
                    বিভাগ / শাখা
                  </label>
                  <input
                    id="org-signatory-dept"
                    name="defaultSignatoryDept"
                    type="text"
                    value={draft.defaultSignatoryDept}
                    onChange={(e) =>
                      update("defaultSignatoryDept", e.target.value)
                    }
                    className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900 focus:outline-none focus:border-[#1E3A8A]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <span className="block text-xs font-medium text-stone-700 mb-1.5">
                    স্বাক্ষরের ছবি (স্বচ্ছ PNG হলে ভালো হয়)
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    <label
                      htmlFor="org-signature-upload"
                      className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-stone-300 bg-stone-50 text-xs font-medium text-stone-700 hover:bg-stone-100 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {uploadingKey === "signatureDataUrl"
                          ? "আপলোড হচ্ছে..."
                          : "স্বাক্ষর আপলোড করুন"}
                      </span>
                      <input
                        id="org-signature-upload"
                        name="signatureUpload"
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          void handleGlobalImageUpload(e, "signatureDataUrl")
                        }
                        className="sr-only"
                      />
                    </label>
                    {draft.signatureDataUrl && (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-stone-200 bg-white">
                        <img
                          src={draft.signatureDataUrl}
                          alt="স্বাক্ষর প্রিভিউ"
                          referrerPolicy="no-referrer"
                          className="h-7 object-contain"
                        />
                        {canEditSelectedScope && (
                          <button
                            type="button"
                            onClick={() => update("signatureDataUrl", "")}
                            className="text-stone-400 hover:text-red-600 cursor-pointer"
                            aria-label="স্বাক্ষর মুছুন"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </fieldset>
        ) : (
          <fieldset
            disabled={!canEditSelectedScope}
            className="lg:col-span-7 bg-white border border-stone-200 rounded-xl p-6 space-y-6 disabled:opacity-85"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-stone-200">
              <div>
                <h2 className="text-sm font-bold text-stone-900">
                  {selectedScope} — আলাদা প্রতিষ্ঠানের তথ্য ও প্যাড
                </h2>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  খালি রাখা ঘরগুলো স্বয়ংক্রিয়ভাবে মূল প্রতিষ্ঠানের তথ্য অনুসরণ করবে।
                </p>
              </div>
              <label
                htmlFor="org-branch-enabled"
                className="inline-flex items-center gap-2 text-xs font-medium text-stone-800 cursor-pointer"
              >
                <input
                  id="org-branch-enabled"
                  type="checkbox"
                  checked={branchDraft.enabled !== false}
                  onChange={(e) => updateBranch("enabled", e.target.checked)}
                  className="w-4 h-4 accent-[#1E3A8A]"
                />
                <span>এই শাখার নিজস্ব প্যাড চালু</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="org-branch-title"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  শাখার শিরোনাম (প্যাডের শীর্ষে প্রদর্শিত)
                </label>
                <input
                  id="org-branch-title"
                  type="text"
                  value={branchDraft.branchTitleBn || ""}
                  onChange={(e) => updateBranch("branchTitleBn", e.target.value)}
                  placeholder={selectedScope}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900"
                />
              </div>
              <div>
                <label
                  htmlFor="org-branch-name-bn"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  শাখার প্রতিষ্ঠানের নাম (বাংলায় - ঐচ্ছিক)
                </label>
                <input
                  id="org-branch-name-bn"
                  type="text"
                  value={branchDraft.orgNameOverride || ""}
                  onChange={(e) =>
                    updateBranch("orgNameOverride", e.target.value)
                  }
                  placeholder={org.nameBn}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900"
                />
              </div>
              <div>
                <label
                  htmlFor="org-branch-name-en"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  ইংরেজি নাম (ঐচ্ছিক)
                </label>
                <input
                  id="org-branch-name-en"
                  type="text"
                  value={branchDraft.nameEnOverride || ""}
                  onChange={(e) =>
                    updateBranch("nameEnOverride", e.target.value)
                  }
                  placeholder={org.nameEn}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900"
                />
              </div>
              <div>
                <label
                  htmlFor="org-branch-tagline"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  স্লোগান / উপ-শিরোনাম
                </label>
                <input
                  id="org-branch-tagline"
                  type="text"
                  value={branchDraft.headerTagline || ""}
                  onChange={(e) =>
                    updateBranch("headerTagline", e.target.value)
                  }
                  placeholder={org.tagline}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900"
                />
              </div>
              <div>
                <label
                  htmlFor="org-branch-reg"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  নিবন্ধন / লাইসেন্স নম্বর
                </label>
                <input
                  id="org-branch-reg"
                  type="text"
                  value={branchDraft.regNumber || ""}
                  onChange={(e) => updateBranch("regNumber", e.target.value)}
                  placeholder={org.regNumber}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900"
                />
              </div>
              <div>
                <label
                  htmlFor="org-branch-ref"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  স্মারক নম্বরের প্রিফিক্স
                </label>
                <input
                  id="org-branch-ref"
                  type="text"
                  value={branchDraft.refPrefix || ""}
                  onChange={(e) => updateBranch("refPrefix", e.target.value)}
                  placeholder={org.refPrefix}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-stone-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label
                  htmlFor="org-branch-address"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  শাখা কার্যালয়ের ঠিকানা
                </label>
                <input
                  id="org-branch-address"
                  type="text"
                  value={branchDraft.address || ""}
                  onChange={(e) => updateBranch("address", e.target.value)}
                  placeholder={org.address}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900"
                />
              </div>
              <div>
                <label
                  htmlFor="org-branch-phone"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  শাখার ফোন / মোবাইল
                </label>
                <input
                  id="org-branch-phone"
                  type="text"
                  value={branchDraft.phone || ""}
                  onChange={(e) => updateBranch("phone", e.target.value)}
                  placeholder={org.phone}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm tabular-nums text-stone-900"
                />
              </div>
              <div>
                <label
                  htmlFor="org-branch-email"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  শাখার ইমেইল
                </label>
                <input
                  id="org-branch-email"
                  type="text"
                  value={branchDraft.email || ""}
                  onChange={(e) => updateBranch("email", e.target.value)}
                  placeholder={org.email}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900"
                />
              </div>
              <div>
                <label
                  htmlFor="org-branch-website"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  ওয়েবসাইট
                </label>
                <input
                  id="org-branch-website"
                  type="text"
                  value={branchDraft.website || ""}
                  onChange={(e) => updateBranch("website", e.target.value)}
                  placeholder={org.website}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900"
                />
              </div>
              <div>
                <label
                  htmlFor="org-branch-footer"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  প্যাডের নিচের ফুটার বার্তা
                </label>
                <input
                  id="org-branch-footer"
                  type="text"
                  value={branchDraft.footerNote || ""}
                  onChange={(e) => updateBranch("footerNote", e.target.value)}
                  placeholder="যেমন: শাখা দাপ্তরিক ও হিসাব নথি"
                  className="w-full h-10 rounded-lg border border-stone-300 px-3.5 text-sm text-stone-900"
                />
              </div>
              <div>
                <label
                  htmlFor="org-branch-style"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  প্যাডের লেআউট শৈলী
                </label>
                <select
                  id="org-branch-style"
                  value={branchDraft.letterheadStyle || "classic"}
                  onChange={(e) =>
                    updateBranch(
                      "letterheadStyle",
                      e.target.value as LetterheadStyle
                    )
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900"
                >
                  <option value="classic">ক্লাসিক দাপ্তরিক</option>
                  <option value="modern">আধুনিক কর্পোরেট</option>
                  <option value="archival">ঐতিহ্যবাহী স্মারক</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="org-branch-font"
                  className="block text-xs font-medium text-stone-700 mb-1.5"
                >
                  প্যাডের মুদ্রণ ফন্ট
                </label>
                <select
                  id="org-branch-font"
                  value={branchDraft.letterFont || "sutonnymj"}
                  onChange={(e) =>
                    updateBranch("letterFont", e.target.value as LetterFont)
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900"
                >
                  <option value="sutonnymj">SutonnyMJ / ছাপা</option>
                  <option value="serif">তিরো বাংলা (সেরিফ)</option>
                </select>
              </div>
            </div>

            {/* Branch Bottom Signatories */}
            <div className="pt-4 border-t border-stone-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-stone-900">
                    শাখার নিচের স্বাক্ষরকারীগণ ({toBengaliDigits(branchDraft.signatories.length)} জন)
                  </h3>
                  <p className="text-[11px] text-stone-500">
                    প্যাডের নিচে বাম থেকে ডান দিকে একাধিক স্বাক্ষরকারী সেট করুন।
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addBranchSignatory}
                  disabled={branchDraft.signatories.length >= 6}
                  className="inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] disabled:opacity-50 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>স্বাক্ষরকারী যোগ</span>
                </button>
              </div>

              {branchDraft.signatories.length === 0 ? (
                <p className="text-xs text-stone-500 bg-stone-50 border border-dashed border-stone-300 rounded-lg p-3">
                  কোনো শাখা-নির্দিষ্ট স্বাক্ষরকারী নেই; চিঠিতে সাধারণ একক স্বাক্ষর ব্লক দেখানো হবে।
                </p>
              ) : (
                <div className="space-y-2.5">
                  {branchDraft.signatories.map((sig, idx) => (
                    <div
                      key={sig.id}
                      className="rounded-lg border border-stone-200 bg-stone-50/70 p-3 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-stone-800 tabular-nums">
                          স্বাক্ষরকারী #{toBengaliDigits(idx + 1)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeBranchSignatory(sig.id)}
                          className="text-stone-400 hover:text-red-700 cursor-pointer"
                          aria-label="স্বাক্ষরকারী মুছুন"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                        <input
                          type="text"
                          value={sig.roleLabel || ""}
                          onChange={(e) =>
                            updateBranchSignatory(sig.id, {
                              roleLabel: e.target.value,
                            })
                          }
                          placeholder="ভূমিকা (যেমন: প্রস্তুতকারী)"
                          className="h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900"
                        />
                        <input
                          type="text"
                          value={sig.name}
                          onChange={(e) =>
                            updateBranchSignatory(sig.id, {
                              name: e.target.value,
                            })
                          }
                          placeholder="স্বাক্ষরকারীর নাম"
                          className="h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900"
                        />
                        <input
                          type="text"
                          value={sig.title}
                          onChange={(e) =>
                            updateBranchSignatory(sig.id, {
                              title: e.target.value,
                            })
                          }
                          placeholder="পদবি"
                          className="h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900"
                        />
                        <input
                          type="text"
                          value={sig.department || ""}
                          onChange={(e) =>
                            updateBranchSignatory(sig.id, {
                              department: e.target.value,
                            })
                          }
                          placeholder="শাখা"
                          className="h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-stone-300 bg-white text-[11px] font-medium text-stone-700 hover:bg-stone-50 cursor-pointer">
                          <Upload className="w-3 h-3" />
                          <span>
                            {uploadingKey === `sig-${sig.id}`
                              ? "আপলোড হচ্ছে..."
                              : "স্বাক্ষরের ছবি"}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) =>
                              void handleBranchSigUpload(sig.id, e)
                            }
                            className="sr-only"
                          />
                        </label>
                        {sig.signatureUrl && (
                          <>
                            <img
                              src={sig.signatureUrl}
                              alt="স্বাক্ষর"
                              className="h-7 object-contain bg-white border border-stone-200 rounded px-1"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateBranchSignatory(sig.id, {
                                  signatureUrl: "",
                                })
                              }
                              className="text-[11px] text-red-700 hover:underline cursor-pointer"
                            >
                              মুছুন
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </fieldset>
        )}

        {/* Right: Branding & Live Header Preview */}
        <div className="lg:col-span-5 space-y-6">
          <fieldset
            disabled={!canEditSelectedScope}
            className="bg-white border border-stone-200 rounded-xl p-6 space-y-5 disabled:opacity-85"
          >
            <h2 className="text-sm font-semibold text-stone-900">
              {isGlobalScope
                ? "লোগো, প্রতীক ও ব্র্যান্ড রঙ"
                : `${selectedScope} — লোগো, প্রতীক ও রঙ`}
            </h2>

            <div>
              <p className="text-xs font-medium text-stone-700 mb-2">
                প্রাতিষ্ঠানিক রঙ নির্বাচন
              </p>
              <div className="flex flex-wrap gap-2.5">
                {BRAND_COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() =>
                      isGlobalScope
                        ? update("brandColor", c.value)
                        : updateBranch("accentColor", c.value)
                    }
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      previewColor === c.value
                        ? "border-stone-900 bg-stone-50 text-stone-900"
                        : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50"
                    }`}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0"
                      style={{ backgroundColor: c.value }}
                    />
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-xs font-medium text-stone-700 mb-2">
                {isGlobalScope
                  ? "নিজস্ব লোগো আপলোড করুন অথবা নিচের প্রতীক বাছুন"
                  : "শাখার নিজস্ব লোগো আপলোড (খালি রাখলে মূল লোগো)"}
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <label
                  htmlFor="org-logo-upload"
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-stone-300 bg-stone-50 text-xs font-medium text-stone-700 hover:bg-stone-100 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {uploadingKey === "logoDataUrl" ||
                    uploadingKey === "branch-logo"
                      ? "আপলোড হচ্ছে..."
                      : isGlobalScope
                        ? "প্রতিষ্ঠানের লোগো আপলোড"
                        : "শাখার লোগো আপলোড"}
                  </span>
                  <input
                    id="org-logo-upload"
                    name="logoUpload"
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      isGlobalScope
                        ? void handleGlobalImageUpload(e, "logoDataUrl")
                        : void handleBranchLogoUpload(e)
                    }
                    className="sr-only"
                  />
                </label>
                {(isGlobalScope ? draft.logoDataUrl : branchDraft.logoUrl) && (
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-stone-200 bg-white">
                    <img
                      src={
                        isGlobalScope
                          ? draft.logoDataUrl
                          : branchDraft.logoUrl
                      }
                      alt="বর্তমান লোগো"
                      referrerPolicy="no-referrer"
                      className="h-8 w-8 object-contain"
                    />
                    {canEditSelectedScope && (
                      <button
                        type="button"
                        onClick={() =>
                          isGlobalScope
                            ? update("logoDataUrl", "")
                            : updateBranch("logoUrl", "")
                        }
                        className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-800 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>লোগো সরান</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-stone-700 mb-2">
                বিল্ট-ইন প্রাতিষ্ঠানিক প্রতীক
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                {CREST_OPTIONS.map((crest) => (
                  <button
                    key={crest.id}
                    type="button"
                    onClick={() =>
                      isGlobalScope
                        ? update("crestType", crest.id)
                        : updateBranch("crestType", crest.id)
                    }
                    className={`p-3 rounded-lg border flex flex-col items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      previewCrest === crest.id &&
                      !(isGlobalScope ? draft.logoDataUrl : branchDraft.logoUrl)
                        ? "border-[#1E3A8A] bg-[#1E3A8A]/5 text-[#1E3A8A]"
                        : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    <CrestIcon
                      type={crest.id}
                      color={previewColor}
                      size={32}
                    />
                    <span>{crest.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </fieldset>

          {/* Mini Letterhead Preview */}
          <div className="bg-white border border-stone-200 rounded-xl p-6">
            <p className="text-xs font-medium text-stone-500 mb-3">
              {isGlobalScope
                ? "প্যাডের শিরোনাম নমুনা"
                : `${selectedScope} — প্যাডের শিরোনাম ও স্বাক্ষর নমুনা`}
            </p>
            <div className="border border-stone-200 rounded-lg p-5 bg-white text-center font-letter-serif">
              <div className="flex justify-center mb-2">
                {previewLogo ? (
                  <img
                    src={previewLogo}
                    alt={previewNameBn}
                    referrerPolicy="no-referrer"
                    className="h-16 w-16 object-contain"
                  />
                ) : (
                  <CrestIcon
                    type={previewCrest}
                    color={previewColor}
                    size={46}
                  />
                )}
              </div>
              <h3
                className="text-xl font-bold"
                style={{ color: previewColor }}
              >
                {previewNameBn || "প্রতিষ্ঠানের নাম"}
              </h3>
              {previewBranchTitle && (
                <p
                  className="text-xs font-bold mt-1 inline-block px-3 py-0.5 border-y"
                  style={{
                    color: previewColor,
                    borderColor: `${previewColor}33`,
                  }}
                >
                  {previewBranchTitle}
                </p>
              )}
              {previewNameEn && (
                <p className="text-[10px] tracking-[0.16em] uppercase text-stone-500 mt-0.5 font-ui">
                  {previewNameEn}
                </p>
              )}
              {previewTagline && (
                <p className="text-xs text-stone-600 mt-1">{previewTagline}</p>
              )}
              <p className="text-[11px] text-stone-500 mt-1.5 font-ui">
                {previewAddress}
              </p>
              {(previewPhone || previewEmail) && (
                <p className="text-[10px] text-stone-500 mt-0.5 font-ui tabular-nums">
                  {[previewPhone, previewEmail].filter(Boolean).join(" · ")}
                </p>
              )}
              <div
                className="mt-3 h-[2px] w-full"
                style={{ backgroundColor: previewColor }}
              />

              {!isGlobalScope && branchDraft.signatories.length > 0 && (
                <div className="mt-5 pt-4 border-t border-dashed border-stone-200 grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
                  {branchDraft.signatories.map((sig) => (
                    <div key={sig.id} className="text-[10px] leading-snug">
                      {sig.roleLabel && (
                        <p
                          className="font-semibold mb-1"
                          style={{ color: previewColor }}
                        >
                          {sig.roleLabel}
                        </p>
                      )}
                      {sig.signatureUrl ? (
                        <img
                          src={sig.signatureUrl}
                          alt={sig.name}
                          className="h-6 mx-auto object-contain mb-0.5"
                        />
                      ) : (
                        <div className="w-16 mx-auto border-b border-stone-400 h-5 mb-0.5" />
                      )}
                      <p className="font-bold text-stone-900">
                        {sig.name || "স্বাক্ষরকারী"}
                      </p>
                      {sig.title && (
                        <p className="text-stone-600">{sig.title}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
