import React, { useEffect, useState } from "react";
import { AlertCircle, Check, RotateCcw, Save, Upload, X } from "lucide-react";
import { BRAND_COLOR_OPTIONS, DEFAULT_ORGANIZATION } from "../data/templates";
import { CrestType, OrganizationProfile } from "../types";
import { CrestIcon } from "./CrestIcon";

interface OrganizationViewProps {
  org: OrganizationProfile;
  canEdit: boolean;
  onSaveOrg: (updated: OrganizationProfile) => Promise<void>;
}

const CREST_OPTIONS: { id: CrestType; label: string }[] = [
  { id: "heritage", label: "ঐতিহ্যবাহী" },
  { id: "academic", label: "শিক্ষা" },
  { id: "corporate", label: "কর্পোরেট" },
  { id: "tech", label: "প্রযুক্তি" },
  { id: "justice", label: "আইন ও ন্যায়" },
  { id: "civic", label: "সামাজিক" },
];

export const OrganizationView: React.FC<OrganizationViewProps> = ({
  org,
  canEdit,
  onSaveOrg,
}) => {
  const [draft, setDraft] = useState<OrganizationProfile>(org);
  const [isSaving, setIsSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    setDraft(org);
  }, [org]);

  const update = <K extends keyof OrganizationProfile>(
    key: K,
    val: OrganizationProfile[K]
  ) => {
    setDraft((prev) => ({ ...prev, [key]: val }));
  };

  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    targetKey: "logoDataUrl" | "signatureDataUrl"
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        update(targetKey, reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setErrorMsg("");
    setIsSaving(true);
    try {
      await onSaveOrg(draft);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2400);
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
    setDraft(DEFAULT_ORGANIZATION);
    if (canEdit) {
      setIsSaving(true);
      try {
        await onSaveOrg(DEFAULT_ORGANIZATION);
        setSavedToast(true);
        setTimeout(() => setSavedToast(false), 2400);
      } catch (err: unknown) {
        setErrorMsg(
          err instanceof Error ? err.message : "রিসেট সংরক্ষণ করা যায়নি।"
        );
      } finally {
        setIsSaving(false);
      }
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-stone-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            প্রতিষ্ঠানের তথ্য ও প্যাড কনফিগারেশন
          </h1>
          <p className="mt-1.5 text-sm text-stone-600">
            এখানে সেট করা নাম, লোগো, ঠিকানা ও স্বাক্ষরের তথ্য সকল ব্যবহারকারীর চিঠির প্যাডে যুক্ত হবে।
          </p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2.5">
            {savedToast && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                <Check className="w-3.5 h-3.5" />
                সফলভাবে সংরক্ষিত
              </span>
            )}
            <button
              type="button"
              onClick={handleResetDefault}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>ডিফল্ট রিসেট</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] disabled:opacity-60 transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? "সংরক্ষণ হচ্ছে..." : "তথ্য সংরক্ষণ করুন"}</span>
            </button>
          </div>
        )}
      </div>

      {!canEdit && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          প্রতিষ্ঠানের প্যাড ও লোগো পরিবর্তন করার অনুমতি বর্তমানে শুধুমাত্র অ্যাডমিনের জন্য সংরক্ষিত।
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
        <fieldset
          disabled={!canEdit}
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
                  onChange={(e) => update("defaultSignatoryName", e.target.value)}
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
                  onChange={(e) => update("defaultSignatoryTitle", e.target.value)}
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
                  onChange={(e) => update("defaultSignatoryDept", e.target.value)}
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
                    <span>স্বাক্ষর আপলোড করুন</span>
                    <input
                      id="org-signature-upload"
                      name="signatureUpload"
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, "signatureDataUrl")}
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
                      {canEdit && (
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

        {/* Right: Branding & Live Header Preview */}
        <div className="lg:col-span-5 space-y-6">
          <fieldset
            disabled={!canEdit}
            className="bg-white border border-stone-200 rounded-xl p-6 space-y-5 disabled:opacity-85"
          >
            <h2 className="text-sm font-semibold text-stone-900">
              লোগো, প্রতীক ও ব্র্যান্ড রঙ
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
                    onClick={() => update("brandColor", c.value)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      draft.brandColor === c.value
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
                নিজস্ব লোগো আপলোড করুন অথবা নিচের প্রতীক বাছুন
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <label
                  htmlFor="org-logo-upload"
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-stone-300 bg-stone-50 text-xs font-medium text-stone-700 hover:bg-stone-100 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>প্রতিষ্ঠানের লোগো আপলোড</span>
                  <input
                    id="org-logo-upload"
                    name="logoUpload"
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e, "logoDataUrl")}
                    className="sr-only"
                  />
                </label>
                {draft.logoDataUrl && (
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-stone-200 bg-white">
                    <img
                      src={draft.logoDataUrl}
                      alt="বর্তমান লোগো"
                      referrerPolicy="no-referrer"
                      className="h-8 w-8 object-contain"
                    />
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => update("logoDataUrl", "")}
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
                    onClick={() => update("crestType", crest.id)}
                    className={`p-3 rounded-lg border flex flex-col items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      draft.crestType === crest.id && !draft.logoDataUrl
                        ? "border-[#1E3A8A] bg-[#1E3A8A]/5 text-[#1E3A8A]"
                        : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                    }`}
                  >
                    <CrestIcon
                      type={crest.id}
                      color={draft.brandColor}
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
              প্যাডের শিরোনাম নমুনা
            </p>
            <div className="border border-stone-200 rounded-lg p-5 bg-white text-center font-letter-serif">
              <div className="flex justify-center mb-2">
                {draft.logoDataUrl ? (
                  <img
                    src={draft.logoDataUrl}
                    alt={draft.nameBn}
                    referrerPolicy="no-referrer"
                    className="h-16 w-16 object-contain"
                  />
                ) : (
                  <CrestIcon
                    type={draft.crestType}
                    color={draft.brandColor}
                    size={46}
                  />
                )}
              </div>
              <h3
                className="text-xl font-bold"
                style={{ color: draft.brandColor }}
              >
                {draft.nameBn || "প্রতিষ্ঠানের নাম"}
              </h3>
              {draft.nameEn && (
                <p className="text-[10px] tracking-[0.16em] uppercase text-stone-500 mt-0.5 font-ui">
                  {draft.nameEn}
                </p>
              )}
              {draft.tagline && (
                <p className="text-xs text-stone-600 mt-1">{draft.tagline}</p>
              )}
              <p className="text-[11px] text-stone-500 mt-1.5 font-ui">
                {draft.address}
              </p>
              <div
                className="mt-3 h-[2px] w-full"
                style={{ backgroundColor: draft.brandColor }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
