import React from "react";
import { ArrowRight, FilePlus2, FileText, LayoutTemplate } from "lucide-react";
import type { SavedLetter } from "../types";
import { toBengaliDigits } from "../utils/bengali";

interface QuickActionsProps {
  primaryColor?: string;
  templatesCount: number;
  recentLettersCount: number;
  latestLetter?: SavedLetter | null;
  onCreateNewLetter: () => void;
  onViewTemplates: () => void;
  onViewRecentDocuments: () => void;
}

export const QuickActions: React.FC<QuickActionsProps> = ({
  primaryColor = "#1E3A8A",
  templatesCount,
  recentLettersCount,
  latestLetter,
  onCreateNewLetter,
  onViewTemplates,
  onViewRecentDocuments,
}) => {
  const latestSubject =
    latestLetter?.subject?.trim() || latestLetter?.templateType?.trim() || "";

  return (
    <section
      data-section="dashboard-quick-actions"
      aria-label="দ্রুত কর্মতালিকা"
    >
      <div className="mb-4">
        <h2 className="text-lg font-bold text-stone-900">দ্রুত কর্মতালিকা</h2>
        <p className="text-xs text-stone-600 mt-0.5">
          দৈনন্দিন দাপ্তরিক কাজ দ্রুত সম্পাদনের জন্য সরাসরি শর্টকাট বেছে নিন।
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          type="button"
          data-action="create-new-letter"
          onClick={onCreateNewLetter}
          className="group bg-white border border-stone-200 rounded-xl p-5 text-left flex flex-col justify-between gap-4 hover:border-stone-300 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A]"
        >
          <div className="flex items-start gap-3.5">
            <span
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-white"
              style={{ backgroundColor: primaryColor }}
            >
              <FilePlus2 className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-stone-900 leading-snug">
                নতুন পত্র তৈরি করুন
              </h3>
              <p className="mt-1 text-xs text-stone-600 leading-relaxed">
                প্রাতিষ্ঠানিক প্যাড ও স্মারক বিন্যাসসহ নতুন দাপ্তরিক পত্র প্রস্তুত করুন।
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-stone-100 flex items-center justify-between gap-2 text-xs">
            <span className="text-stone-500">নতুন খসড়া · তাৎক্ষণিক সম্পাদক</span>
            <span
              className="inline-flex items-center gap-1 font-semibold whitespace-nowrap shrink-0 group-hover:underline"
              style={{ color: primaryColor }}
            >
              <span>শুরু করুন</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </button>

        <button
          type="button"
          data-action="view-templates"
          onClick={onViewTemplates}
          className="group bg-white border border-stone-200 rounded-xl p-5 text-left flex flex-col justify-between gap-4 hover:border-stone-300 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A]"
        >
          <div className="flex items-start gap-3.5">
            <span className="w-10 h-10 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center shrink-0 text-stone-700">
              <LayoutTemplate className="w-5 h-5" style={{ color: primaryColor }} />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-stone-900 leading-snug">
                টেমপ্লেট দেখুন
              </h3>
              <p className="mt-1 text-xs text-stone-600 leading-relaxed">
                আপনার বিভাগের জন্য নির্ধারিত ও প্রমিত চিঠির কাঠামো তালিকা ব্রাউজ করুন।
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-stone-100 flex items-center justify-between gap-2 text-xs">
            <span className="text-stone-500 tabular-nums">
              সক্রিয় কাঠামো: {toBengaliDigits(templatesCount)}টি
            </span>
            <span
              className="inline-flex items-center gap-1 font-semibold whitespace-nowrap shrink-0 group-hover:underline"
              style={{ color: primaryColor }}
            >
              <span>টেমপ্লেট খুলুন</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </button>

        <button
          type="button"
          data-action="view-recent-documents"
          onClick={onViewRecentDocuments}
          className="group bg-white border border-stone-200 rounded-xl p-5 text-left flex flex-col justify-between gap-4 hover:border-stone-300 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A]"
        >
          <div className="flex items-start gap-3.5">
            <span className="w-10 h-10 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center shrink-0 text-stone-700">
              <FileText className="w-5 h-5" style={{ color: primaryColor }} />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-stone-900 leading-snug">
                আমার সাম্প্রতিক নথিপত্র
              </h3>
              <p className="mt-1 text-xs text-stone-600 leading-relaxed line-clamp-2">
                {latestSubject
                  ? `সর্বশেষ সংরক্ষিত: ${latestSubject}`
                  : "ইতিমধ্যে সম্পাদিত ও সংরক্ষিত সকল দাপ্তরিক চিঠিপত্র দেখুন।"}
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-stone-100 flex items-center justify-between gap-2 text-xs">
            <span className="text-stone-500 tabular-nums">
              সংরক্ষিত নথি: {toBengaliDigits(recentLettersCount)}টি
            </span>
            <span
              className="inline-flex items-center gap-1 font-semibold whitespace-nowrap shrink-0 group-hover:underline"
              style={{ color: primaryColor }}
            >
              <span>নথিপত্র দেখুন</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </button>
      </div>
    </section>
  );
};
