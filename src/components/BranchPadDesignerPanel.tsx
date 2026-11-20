import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileSignature,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  BranchPadConfig,
  BranchPadSignatory,
  CrestType,
  DepartmentItem,
  LetterData,
  LetterFont,
  LetterheadStyle,
  OrganizationProfile,
  SitePlugin,
} from "../types";
import { apiRequest } from "../utils/api";
import {
  formatBanglaCalendarDate,
  formatBengaliDate,
  generateNextRefNumber,
  toBengaliDigits,
} from "../utils/bengali";
import { createDefaultBranchPadConfig } from "../utils/branchPad";
import { CrestIcon } from "./CrestIcon";
import { LetterPreview } from "./LetterPreview";

const CREST_OPTIONS: { id: CrestType; label: string }[] = [
  { id: "heritage", label: "ঐতিহ্যবাহী" },
  { id: "academic", label: "শিক্ষা" },
  { id: "corporate", label: "কর্পোরেট" },
  { id: "tech", label: "প্রযুক্তি" },
  { id: "justice", label: "আইন ও ন্যায়" },
  { id: "civic", label: "সামাজিক" },
];

interface BranchPadDesignerPanelProps {
  org: OrganizationProfile;
  departments: DepartmentItem[];
  plugins: SitePlugin[];
  onPluginsUpdated: (plugins: SitePlugin[]) => void;
  onTogglePlugin: (plugin: SitePlugin) => Promise<void>;
  onShowSuccess: (msg: string) => void;
  onShowError: (err: unknown) => void;
}

const ACCENT_PRESETS = [
  { label: "রয়েল নীল", value: "#1E3A8A" },
  { label: "চিরসবুজ", value: "#14532D" },
  { label: "গভীর টিল", value: "#0F766E" },
  { label: "মেরুন লাল", value: "#7F1D1D" },
  { label: "চারকোল", value: "#1C1917" },
];

async function uploadImageFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("ফাইল পড়া যায়নি।"));
    reader.readAsDataURL(file);
  });
  const res = await apiRequest<{ url: string }>("/api/media/upload", {
    method: "POST",
    body: JSON.stringify({ dataUrl }),
  });
  return res.url;
}

export const BranchPadDesignerPanel: React.FC<BranchPadDesignerPanelProps> = ({
  org,
  departments,
  plugins,
  onPluginsUpdated,
  onTogglePlugin,
  onShowSuccess,
  onShowError,
}) => {
  const padPlugin = plugins.find((p) => p.type === "branch-pad-designer");
  const pluginEnabled = padPlugin ? padPlugin.enabled : true;
  const branchPadsMap = padPlugin?.config?.branchPads || {};

  const [selectedDept, setSelectedDept] = useState<string>(
    departments[0]?.name || "হিসাবরক্ষক বিভাগ"
  );
  const [draft, setDraft] = useState<BranchPadConfig>(() =>
    branchPadsMap[departments[0]?.name || "হিসাবরক্ষক বিভাগ"]
      ? {
          ...branchPadsMap[departments[0]?.name || "হিসাবরক্ষক বিভাগ"],
          signatories: [
            ...(branchPadsMap[departments[0]?.name || "হিসাবরক্ষক বিভাগ"]
              .signatories || []),
          ],
        }
      : createDefaultBranchPadConfig(
          departments[0]?.name || "হিসাবরক্ষক বিভাগ",
          org
        )
  );
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingSigId, setUploadingSigId] = useState<string | null>(null);

  useEffect(() => {
    if (departments.length === 0) return;
    if (!departments.some((d) => d.name === selectedDept)) {
      setSelectedDept(departments[0].name);
    }
  }, [departments, selectedDept]);

  useEffect(() => {
    if (!selectedDept) return;
    const saved = branchPadsMap[selectedDept];
    if (saved) {
      setDraft({
        ...createDefaultBranchPadConfig(selectedDept, org),
        ...saved,
        signatories: Array.isArray(saved.signatories)
          ? saved.signatories.map((s) => ({ ...s }))
          : [],
      });
    } else {
      setDraft(createDefaultBranchPadConfig(selectedDept, org));
    }
  }, [selectedDept, plugins]);

  const isSavedCustomized = Boolean(branchPadsMap[selectedDept]);

  const sampleLetter: LetterData = useMemo(() => {
    const now = new Date();
    const lastSig =
      draft.signatories.length > 0
        ? draft.signatories[draft.signatories.length - 1]
        : undefined;
    return {
      id: "preview-branch-pad",
      templateType: selectedDept,
      refNumber: generateNextRefNumber(
        draft.refPrefix?.trim() || org.refPrefix,
        "নমুনা",
        101
      ),
      dateText: formatBengaliDate(now),
      showBanglaDate: true,
      banglaDateText: formatBanglaCalendarDate(now),
      recipientPrefix: "বরাবর",
      recipientName: "সংশ্লিষ্ট কর্মকর্তা / কর্তৃপক্ষ",
      recipientTitle: selectedDept,
      recipientOrg: draft.orgNameOverride?.trim() || org.nameBn,
      recipientAddress: draft.address?.trim() || org.address,
      subject: `${draft.branchTitleBn || selectedDept} এর দাপ্তরিক প্যাড ও স্বাক্ষর নমুনা প্রসঙ্গে।`,
      salutation: "মহোদয়,",
      body: `সাদর সম্ভাষণ। এটি “${draft.branchTitleBn || selectedDept}”-এর জন্য নির্ধারিত স্বতন্ত্র দাপ্তরিক প্যাডের সরাসরি প্রিভিউ।\n\nএই শাখা প্যাডে প্রতিষ্ঠানের হেডার, রঙ, স্মারক উপসর্গ এবং নিচের অংশে নির্ধারিত সকল স্বাক্ষরকারীর পদবি ও স্বাক্ষর একত্রে প্রদর্শিত হচ্ছে।`,
      closing: "বিনীত,",
      signatoryName: lastSig?.name || org.defaultSignatoryName,
      signatoryTitle: lastSig?.title || org.defaultSignatoryTitle,
      signatoryDept: lastSig?.department || draft.branchTitleBn || selectedDept,
      attachments: "",
      ccList: "",
      letterheadStyle: draft.letterheadStyle || "classic",
      letterFont: draft.letterFont || "sutonnymj",
      showWatermark: true,
      showSealPlaceholder: true,
      branchPadDepartment: selectedDept,
    };
  }, [draft, org, selectedDept]);

  const handleSaveBranchPad = async () => {
    if (!selectedDept) return;
    setSaving(true);
    try {
      const res = await apiRequest<{ plugins: SitePlugin[] }>(
        `/api/admin/branch-pads/${encodeURIComponent(selectedDept)}`,
        {
          method: "PUT",
          body: JSON.stringify(draft),
        }
      );
      onPluginsUpdated(res.plugins);
      onShowSuccess(
        `“${selectedDept}”-এর প্যাড ও স্বাক্ষরকারী নকশা সফলভাবে সংরক্ষণ করা হয়েছে।`
      );
    } catch (err) {
      onShowError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleResetBranchPad = async () => {
    if (!selectedDept) return;
    setSaving(true);
    try {
      const res = await apiRequest<{ plugins: SitePlugin[] }>(
        `/api/admin/branch-pads/${encodeURIComponent(selectedDept)}`,
        { method: "DELETE" }
      );
      onPluginsUpdated(res.plugins);
      setDraft(createDefaultBranchPadConfig(selectedDept, org));
      onShowSuccess(
        `“${selectedDept}” এখন মূল প্রাতিষ্ঠানিক প্যাড অনুসরণ করবে।`
      );
    } catch (err) {
      onShowError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingLogo(true);
    try {
      const url = await uploadImageFile(file);
      setDraft((prev) => ({ ...prev, logoUrl: url }));
    } catch (err) {
      onShowError(err);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSignatoryImageUpload = async (
    sigId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingSigId(sigId);
    try {
      const url = await uploadImageFile(file);
      setDraft((prev) => ({
        ...prev,
        signatories: prev.signatories.map((s) =>
          s.id === sigId ? { ...s, signatureUrl: url } : s
        ),
      }));
    } catch (err) {
      onShowError(err);
    } finally {
      setUploadingSigId(null);
    }
  };

  const addSignatory = () => {
    if (draft.signatories.length >= 6) return;
    const nextItem: BranchPadSignatory = {
      id: `sig-${Date.now()}-${draft.signatories.length + 1}`,
      roleLabel: "স্বাক্ষরকারী",
      name: "",
      title: "",
      department: selectedDept,
      signatureUrl: "",
    };
    setDraft((prev) => ({
      ...prev,
      signatories: [...prev.signatories, nextItem],
    }));
  };

  const applySignatoryPreset = (count: 1 | 2 | 3) => {
    const now = Date.now();
    if (count === 1) {
      setDraft((prev) => ({
        ...prev,
        signatories: [
          {
            id: `sig-${now}-1`,
            roleLabel: "",
            name: org.defaultSignatoryName || "",
            title: org.defaultSignatoryTitle || "শাখা কর্মকর্তা",
            department: selectedDept,
            signatureUrl: "",
          },
        ],
      }));
    } else if (count === 2) {
      setDraft((prev) => ({
        ...prev,
        signatories: [
          {
            id: `sig-${now}-1`,
            roleLabel: "প্রস্তুতকারী",
            name: "",
            title: "শাখা হিসাবরক্ষক / কর্মকর্তা",
            department: selectedDept,
            signatureUrl: "",
          },
          {
            id: `sig-${now}-2`,
            roleLabel: "অনুমোদনকারী",
            name: org.defaultSignatoryName || "",
            title: org.defaultSignatoryTitle || "শাখা ব্যবস্থাপক",
            department: selectedDept,
            signatureUrl: "",
          },
        ],
      }));
    } else {
      setDraft((prev) => ({
        ...prev,
        signatories: [
          {
            id: `sig-${now}-1`,
            roleLabel: "প্রস্তুতকারী",
            name: "",
            title: "অফিস সহকারী / কর্মকর্তা",
            department: selectedDept,
            signatureUrl: "",
          },
          {
            id: `sig-${now}-2`,
            roleLabel: "যাচাইকারী",
            name: "",
            title: "শাখা হিসাবরক্ষক / অডিটর",
            department: selectedDept,
            signatureUrl: "",
          },
          {
            id: `sig-${now}-3`,
            roleLabel: "অনুমোদনকারী",
            name: org.defaultSignatoryName || "",
            title: org.defaultSignatoryTitle || "শাখা ব্যবস্থাপক",
            department: selectedDept,
            signatureUrl: "",
          },
        ],
      }));
    }
  };

  const updateSignatory = (
    sigId: string,
    patch: Partial<BranchPadSignatory>
  ) => {
    setDraft((prev) => ({
      ...prev,
      signatories: prev.signatories.map((s) =>
        s.id === sigId ? { ...s, ...patch } : s
      ),
    }));
  };

  const moveSignatory = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= draft.signatories.length) return;
    setDraft((prev) => {
      const next = [...prev.signatories];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return { ...prev, signatories: next };
    });
  };

  const removeSignatory = (sigId: string) => {
    setDraft((prev) => ({
      ...prev,
      signatories: prev.signatories.filter((s) => s.id !== sigId),
    }));
  };

  return (
    <div className="mt-6 space-y-6">
      {/* Plugin Status Header */}
      <div className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSignature className="w-4 h-4 text-[#1E3A8A]" />
            <h2 className="text-sm font-semibold text-stone-900">
              শাখাভিত্তিক প্যাড ও স্বাক্ষরকারী ডিজাইন প্লাগইন
            </h2>
            <span
              className={`text-xs font-semibold ${
                pluginEnabled ? "text-emerald-700" : "text-stone-500"
              }`}
            >
              · {pluginEnabled ? "সক্রিয়" : "নিষ্ক্রিয়"}
            </span>
          </div>
          <p className="mt-1 text-xs text-stone-600 leading-relaxed max-w-3xl">
            প্রত্যেকটি শাখা ও বিভাগের জন্য আলাদা হেডার প্যাড, রঙ, লোগো, স্মারক উপসর্গ এবং প্যাডের নিচে একাধিক স্বাক্ষরকারীর (যেমন প্রস্তুতকারী, যাচাইকারী ও অনুমোদনকারী) সারি ডিজাইন করুন। সংশ্লিষ্ট শাখার ইউজার চিঠি লিখলে স্বয়ংক্রিয়ভাবে সেই শাখার প্যাড ও স্বাক্ষরকারী যুক্ত হবে।
          </p>
        </div>
        {padPlugin && (
          <button
            type="button"
            onClick={() => void onTogglePlugin(padPlugin)}
            className={`h-10 px-4 rounded-lg border text-xs font-semibold shrink-0 cursor-pointer ${
              pluginEnabled
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                : "border-stone-300 bg-stone-50 text-stone-700 hover:bg-stone-100"
            }`}
          >
            {pluginEnabled ? "প্লাগইন চালু আছে (নিষ্ক্রিয় করুন)" : "প্লাগইন চালু করুন"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Branch/Department Selector */}
        <div className="lg:col-span-4 bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3.5 border-b border-stone-200 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-stone-900">
              শাখা / বিভাগ নির্বাচন করুন
            </h3>
            <span className="text-xs text-stone-500 tabular-nums">
              {toBengaliDigits(departments.length)}টি
            </span>
          </div>
          <div className="divide-y divide-stone-200">
            {departments.map((dept) => {
              const cfg = branchPadsMap[dept.name];
              const isSelected = selectedDept === dept.name;
              const sigCount = cfg?.signatories?.length || 0;
              return (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => setSelectedDept(dept.name)}
                  className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-[#1E3A8A]/5 border-l-4 border-[#1E3A8A]"
                      : "hover:bg-stone-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-stone-900 truncate">
                      {dept.name}
                    </span>
                    {cfg && cfg.enabled !== false ? (
                      <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                        কাস্টম প্যাড
                      </span>
                    ) : (
                      <span className="text-[11px] text-stone-400 shrink-0">
                        ডিফল্ট
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-stone-500 mt-0.5 tabular-nums">
                    {cfg
                      ? `স্বাক্ষরকারী: ${toBengaliDigits(sigCount)} জন · শৈলী: ${
                          cfg.letterheadStyle === "modern"
                            ? "আধুনিক"
                            : cfg.letterheadStyle === "archival"
                              ? "ঐতিহ্যবাহী"
                              : "ক্লাসিক"
                        }`
                      : "প্রতিষ্ঠানের মূল প্যাড প্রযোজ্য"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Branch Pad Designer & Live Preview */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white border border-stone-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-stone-200">
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  {selectedDept} — প্যাড ডিজাইনার
                </h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  {isSavedCustomized
                    ? "এই শাখার কাস্টম প্যাড ও নিচের স্বাক্ষরকারী সংরক্ষিত রয়েছে।"
                    : "এখন খসড়া তৈরি করে সংরক্ষণ করলেই এই শাখার নিজস্ব প্যাড চালু হবে।"}
                </p>
              </div>
              <label
                htmlFor="branch-pad-enabled"
                className="inline-flex items-center gap-2 text-xs font-medium text-stone-800 cursor-pointer shrink-0"
              >
                <input
                  id="branch-pad-enabled"
                  type="checkbox"
                  checked={draft.enabled !== false}
                  onChange={(e) =>
                    setDraft({ ...draft, enabled: e.target.checked })
                  }
                  className="w-4 h-4 accent-[#1E3A8A]"
                />
                <span>এই শাখার কাস্টম প্যাড চালু</span>
              </label>
            </div>

            {/* Header Overrides */}
            <div className="space-y-3.5">
              <p className="text-xs font-semibold text-stone-800">
                ১. প্যাডের উপরিভাগ, ঠিকানা ও রঙ
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="bp-branch-title"
                    className="block text-xs font-medium text-stone-700 mb-1"
                  >
                    শাখার শিরোনাম (প্যাডের শীর্ষে প্রদর্শিত)
                  </label>
                  <input
                    id="bp-branch-title"
                    type="text"
                    value={draft.branchTitleBn || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, branchTitleBn: e.target.value })
                    }
                    placeholder="যেমন: অডিট ও পরিদর্শন শাখা"
                    className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bp-ref-prefix"
                    className="block text-xs font-medium text-stone-700 mb-1"
                  >
                    শাখার স্মারক উপসর্গ
                  </label>
                  <input
                    id="bp-ref-prefix"
                    type="text"
                    value={draft.refPrefix || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, refPrefix: e.target.value })
                    }
                    placeholder={org.refPrefix || "যেমন: মডেঅ/অডিট"}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="bp-org-override"
                    className="block text-xs font-medium text-stone-700 mb-1"
                  >
                    আলাদা প্রতিষ্ঠান/অফিস নাম (খালি রাখলে মূল নাম)
                  </label>
                  <input
                    id="bp-org-override"
                    type="text"
                    value={draft.orgNameOverride || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, orgNameOverride: e.target.value })
                    }
                    placeholder={org.nameBn}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bp-name-en"
                    className="block text-xs font-medium text-stone-700 mb-1"
                  >
                    প্রতিষ্ঠানের ইংরেজি নাম (ঐচ্ছিক)
                  </label>
                  <input
                    id="bp-name-en"
                    type="text"
                    value={draft.nameEnOverride || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, nameEnOverride: e.target.value })
                    }
                    placeholder={org.nameEn}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bp-tagline"
                    className="block text-xs font-medium text-stone-700 mb-1"
                  >
                    শাখার উপ-শিরোনাম / ট্যাগলাইন
                  </label>
                  <input
                    id="bp-tagline"
                    type="text"
                    value={draft.headerTagline || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, headerTagline: e.target.value })
                    }
                    placeholder={org.tagline}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bp-reg-number"
                    className="block text-xs font-medium text-stone-700 mb-1"
                  >
                    নিবন্ধন / লাইসেন্স নম্বর
                  </label>
                  <input
                    id="bp-reg-number"
                    type="text"
                    value={draft.regNumber || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, regNumber: e.target.value })
                    }
                    placeholder={org.regNumber}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm text-stone-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label
                    htmlFor="bp-address"
                    className="block text-xs font-medium text-stone-700 mb-1"
                  >
                    শাখার ঠিকানা
                  </label>
                  <input
                    id="bp-address"
                    type="text"
                    value={draft.address || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, address: e.target.value })
                    }
                    placeholder={org.address}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3 text-xs text-stone-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bp-phone"
                    className="block text-xs font-medium text-stone-700 mb-1"
                  >
                    শাখার ফোন
                  </label>
                  <input
                    id="bp-phone"
                    type="text"
                    value={draft.phone || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, phone: e.target.value })
                    }
                    placeholder={org.phone}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3 text-xs text-stone-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bp-email"
                    className="block text-xs font-medium text-stone-700 mb-1"
                  >
                    শাখার ইমেইল
                  </label>
                  <input
                    id="bp-email"
                    type="text"
                    value={draft.email || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, email: e.target.value })
                    }
                    placeholder={org.email}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3 text-xs text-stone-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bp-website"
                    className="block text-xs font-medium text-stone-700 mb-1"
                  >
                    শাখার ওয়েবসাইট
                  </label>
                  <input
                    id="bp-website"
                    type="text"
                    value={draft.website || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, website: e.target.value })
                    }
                    placeholder={org.website}
                    className="w-full h-10 rounded-lg border border-stone-300 px-3 text-xs text-stone-900"
                  />
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-stone-700 mb-1.5">
                  শাখার প্রাতিষ্ঠানিক প্রতীক (নিজস্ব লোগো না থাকলে প্রদর্শিত)
                </p>
                <div className="flex flex-wrap gap-2">
                  {CREST_OPTIONS.map((crest) => (
                    <button
                      key={crest.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, crestType: crest.id })}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                        (draft.crestType || org.crestType) === crest.id
                          ? "border-[#1E3A8A] bg-[#1E3A8A]/5 text-[#1E3A8A]"
                          : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      <CrestIcon
                        type={crest.id}
                        color={draft.accentColor || org.brandColor}
                        size={18}
                      />
                      <span>{crest.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-stone-700 mb-1.5">
                    প্যাডের শৈলী ও ফন্ট
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      aria-label="শাখা প্যাডের লেআউট শৈলী"
                      value={draft.letterheadStyle || "classic"}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          letterheadStyle: e.target.value as LetterheadStyle,
                        })
                      }
                      className="h-10 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900"
                    >
                      <option value="classic">ক্লাসিক দাপ্তরিক</option>
                      <option value="modern">আধুনিক কর্পোরেট</option>
                      <option value="archival">ঐতিহ্যবাহী স্মারক</option>
                    </select>
                    <select
                      aria-label="শাখা প্যাডের ফন্ট"
                      value={draft.letterFont || "sutonnymj"}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          letterFont: e.target.value as LetterFont,
                        })
                      }
                      className="h-10 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900"
                    >
                      <option value="sutonnymj">SutonnyMJ / ছাপা</option>
                      <option value="serif">তিরো বাংলা (সেরিফ)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-stone-700 mb-1.5">
                    শাখা প্যাডের রঙ
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {ACCENT_PRESETS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        title={c.label}
                        onClick={() =>
                          setDraft({ ...draft, accentColor: c.value })
                        }
                        className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                          (draft.accentColor || org.brandColor) === c.value
                            ? "border-stone-900 scale-110"
                            : "border-white shadow-xs"
                        }`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                    <input
                      type="color"
                      aria-label="প্যাডের রঙ নির্বাচন করুন"
                      value={draft.accentColor || org.brandColor || "#1E3A8A"}
                      onChange={(e) =>
                        setDraft({ ...draft, accentColor: e.target.value })
                      }
                      className="w-9 h-8 rounded border border-stone-300 bg-white cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="bp-footer-note"
                    className="block text-xs font-medium text-stone-700 mb-1"
                  >
                    প্যাডের নিচের ফুটার বার্তা (ঐচ্ছিক)
                  </label>
                  <input
                    id="bp-footer-note"
                    type="text"
                    value={draft.footerNote || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, footerNote: e.target.value })
                    }
                    placeholder="যেমন: অভ্যন্তরীণ নিরীক্ষা ও হিসাব নথি"
                    className="w-full h-10 rounded-lg border border-stone-300 px-3 text-xs text-stone-900"
                  />
                </div>
                <div>
                  <p className="text-xs font-medium text-stone-700 mb-1">
                    শাখার নিজস্ব লোগো (ঐচ্ছিক)
                  </p>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {uploadingLogo ? "আপলোড হচ্ছে..." : "লোগো আপলোড"}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handleLogoUpload(e)}
                        disabled={uploadingLogo}
                        className="sr-only"
                      />
                    </label>
                    {draft.logoUrl && (
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, logoUrl: "" })}
                        className="h-10 px-3 rounded-lg border border-stone-200 text-xs text-red-700 hover:bg-red-50 cursor-pointer"
                      >
                        মূল লোগো রাখুন
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Signatories Builder */}
            <div className="pt-5 border-t border-stone-200 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-stone-900">
                    ২. প্যাডের নিচের স্বাক্ষরকারীগণ ({toBengaliDigits(draft.signatories.length)} জন)
                  </p>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    প্যাডের নিচে বাম থেকে ডান দিকে পাশাপাশি সর্বোচ্চ ৬ জন স্বাক্ষরকারী (যেমন প্রস্তুতকারী, যাচাইকারী, অনুমোদনকারী) যুক্ত করা যাবে।
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addSignatory}
                  disabled={draft.signatories.length >= 6}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>স্বাক্ষরকারী যোগ করুন</span>
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => applySignatoryPreset(1)}
                  className="px-2.5 py-1.5 rounded-lg border border-stone-200 bg-stone-50 text-[11px] font-medium text-stone-700 hover:bg-stone-100 cursor-pointer"
                >
                  ১ জন স্বাক্ষরকারী টেমপ্লেট
                </button>
                <button
                  type="button"
                  onClick={() => applySignatoryPreset(2)}
                  className="px-2.5 py-1.5 rounded-lg border border-stone-200 bg-stone-50 text-[11px] font-medium text-stone-700 hover:bg-stone-100 cursor-pointer"
                >
                  ২ জন (প্রস্তুতকারী + অনুমোদনকারী)
                </button>
                <button
                  type="button"
                  onClick={() => applySignatoryPreset(3)}
                  className="px-2.5 py-1.5 rounded-lg border border-stone-200 bg-stone-50 text-[11px] font-medium text-stone-700 hover:bg-stone-100 cursor-pointer"
                >
                  ৩ জন (প্রস্তুতকারী + যাচাইকারী + অনুমোদনকারী)
                </button>
              </div>

              {draft.signatories.length === 0 ? (
                <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-5 text-center text-xs text-stone-600">
                  কোনো অতিরিক্ত স্বাক্ষরকারী যুক্ত না থাকলে চিঠির সাধারণ একক স্বাক্ষর ব্লক প্রদর্শিত হবে। একাধিক স্বাক্ষরকারী রাখতে উপরের “স্বাক্ষরকারী যোগ করুন” বা টেমপ্লেট বাটনে ক্লিক করুন।
                </div>
              ) : (
                <div className="space-y-3">
                  {draft.signatories.map((sig, idx) => (
                    <div
                      key={sig.id}
                      className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-stone-800 tabular-nums">
                          স্বাক্ষরকারী #{toBengaliDigits(idx + 1)}{" "}
                          {sig.roleLabel ? `· ${sig.roleLabel}` : ""}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => moveSignatory(idx, -1)}
                            disabled={idx === 0}
                            aria-label="বামে/উপরে নিন"
                            className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-40 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSignatory(idx, 1)}
                            disabled={idx === draft.signatories.length - 1}
                            aria-label="ডানে/নিচে নিন"
                            className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-40 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSignatory(sig.id)}
                            aria-label="স্বাক্ষরকারী সরান"
                            className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-medium text-stone-600 mb-1">
                            উপরের ভূমিকা (ঐচ্ছিক)
                          </label>
                          <input
                            type="text"
                            value={sig.roleLabel || ""}
                            onChange={(e) =>
                              updateSignatory(sig.id, { roleLabel: e.target.value })
                            }
                            placeholder="যেমন: প্রস্তুতকারী"
                            className="w-full h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-stone-600 mb-1">
                            স্বাক্ষরকারীর নাম
                          </label>
                          <input
                            type="text"
                            value={sig.name}
                            onChange={(e) =>
                              updateSignatory(sig.id, { name: e.target.value })
                            }
                            placeholder="যেমন: মো. করিম উদ্দিন"
                            className="w-full h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-stone-600 mb-1">
                            পদবি
                          </label>
                          <input
                            type="text"
                            value={sig.title}
                            onChange={(e) =>
                              updateSignatory(sig.id, { title: e.target.value })
                            }
                            placeholder="যেমন: শাখা হিসাবরক্ষক"
                            className="w-full h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-stone-600 mb-1">
                            শাখা / বিভাগ
                          </label>
                          <input
                            type="text"
                            value={sig.department || ""}
                            onChange={(e) =>
                              updateSignatory(sig.id, { department: e.target.value })
                            }
                            placeholder={selectedDept}
                            className="w-full h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-xs text-stone-900"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-stone-300 bg-white text-[11px] font-medium text-stone-700 hover:bg-stone-50 cursor-pointer">
                            <Upload className="w-3.5 h-3.5" />
                            <span>
                              {uploadingSigId === sig.id
                                ? "আপলোড হচ্ছে..."
                                : sig.signatureUrl
                                  ? "স্বাক্ষর ছবি বদলান"
                                  : "স্বাক্ষর ছবি আপলোড"}
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) =>
                                void handleSignatoryImageUpload(sig.id, e)
                              }
                              disabled={uploadingSigId === sig.id}
                              className="sr-only"
                            />
                          </label>
                          {sig.signatureUrl && (
                            <>
                              <img
                                src={sig.signatureUrl}
                                alt="স্বাক্ষর প্রিভিউ"
                                className="h-8 max-w-[90px] object-contain border border-stone-200 rounded bg-white px-1"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  updateSignatory(sig.id, { signatureUrl: "" })
                                }
                                className="text-[11px] text-red-700 hover:underline cursor-pointer"
                              >
                                ছবি সরান
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Save Actions */}
            <div className="pt-4 border-t border-stone-200 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void handleResetBranchPad()}
                disabled={saving || !isSavedCustomized}
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>মূল প্যাডে ফিরিয়ে নিন</span>
              </button>

              <button
                type="button"
                onClick={() => void handleSaveBranchPad()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] disabled:opacity-60 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>
                  {saving ? "সংরক্ষণ হচ্ছে..." : "শাখা প্যাড ও স্বাক্ষরকারী সংরক্ষণ করুন"}
                </span>
              </button>
            </div>
          </div>

          {/* Live A4 Branch Pad Preview */}
          <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-stone-900">
                লাইভ শাখা প্যাড প্রিভিউ ({selectedDept})
              </h4>
              <span className="text-[11px] text-stone-500">
                নমুনা এ-৪ প্রদর্শন
              </span>
            </div>
            <div className="rounded-xl bg-[#EAE8E1] border border-stone-200 p-4 overflow-x-auto flex justify-center">
              <div
                style={{
                  width: "calc(210mm * 0.58)",
                  height: "calc(297mm * 0.58)",
                }}
              >
                <div
                  className="origin-top-left shadow-md border border-stone-200"
                  style={{
                    transform: "scale(0.58)",
                    width: "210mm",
                    height: "297mm",
                  }}
                >
                  <LetterPreview
                    letter={sampleLetter}
                    org={org}
                    branchPad={draft}
                    autoFitOnePage={false}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
