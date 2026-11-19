import React, { useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import {
  ArrowUpRight,
  Cloud,
  CopyPlus,
  FileSpreadsheet,
  FileText,
  Search,
  Trash2,
} from "lucide-react";
import { SavedLetter } from "../types";
import { toBengaliDigits } from "../utils/bengali";
import { exportSavedLettersToExcel } from "../utils/export";

interface SavedLettersViewProps {
  letters: SavedLetter[];
  cloudLetters?: SavedLetter[];
  firebaseUser?: FirebaseUser | null;
  orgName?: string;
  uiTexts?: Record<string, string>;
  onLoadLetter: (letter: SavedLetter) => void;
  onDuplicateLetter: (letter: SavedLetter) => void;
  onDeleteLetter: (id: string) => void;
  onStartNew: () => void;
  onConnectGoogleCloud?: () => Promise<void>;
  onSyncAllToCloud?: () => Promise<void>;
}

export const SavedLettersView: React.FC<SavedLettersViewProps> = ({
  letters,
  cloudLetters = [],
  firebaseUser = null,
  orgName = "মডার্ন ডেভেলপমেন্ট অর্গানাইজেশন",
  uiTexts,
  onLoadLetter,
  onDuplicateLetter,
  onDeleteLetter,
  onStartNew,
  onConnectGoogleCloud,
  onSyncAllToCloud,
}) => {
  const [query, setQuery] = useState("");
  const [sourceScope, setSourceScope] = useState<"workspace" | "cloud">("workspace");
  const [syncBusy, setSyncBusy] = useState(false);

  const displayedLetters =
    firebaseUser && sourceScope === "cloud" ? cloudLetters : letters;

  const filtered = displayedLetters.filter((item) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      item.subject.toLowerCase().includes(q) ||
      item.recipientName.toLowerCase().includes(q) ||
      item.refNumber.toLowerCase().includes(q) ||
      item.templateType.toLowerCase().includes(q)
    );
  });

  const formatSavedDate = (iso: string) => {
    try {
      const d = new Date(iso);
      const day = toBengaliDigits(d.getDate());
      const month = toBengaliDigits(d.getMonth() + 1);
      const year = toBengaliDigits(d.getFullYear());
      return `${day}/${month}/${year}`;
    } catch {
      return iso;
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div
        data-section="saved-letters-header"
        className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-stone-200"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            {uiTexts?.savedLettersTitle || "সংরক্ষিত দাপ্তরিক পত্রের নথিভুক্তি"}
          </h1>
          <p className="mt-1.5 text-sm text-stone-600">
            আপনার অ্যাকাউন্টের সংরক্ষিত দাপ্তরিক চিঠিপত্র সার্ভারে নিরাপদে সংরক্ষিত রয়েছে। মোট নথি:{" "}
            <span className="font-semibold tabular-nums text-stone-900">
              {toBengaliDigits(letters.length)}টি
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {firebaseUser ? (
            <>
              <div className="flex items-center gap-1 p-1 bg-stone-200/70 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSourceScope("workspace")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    sourceScope === "workspace"
                      ? "bg-white text-stone-900 shadow-xs"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  দাপ্তরিক ({toBengaliDigits(letters.length)})
                </button>
                <button
                  type="button"
                  onClick={() => setSourceScope("cloud")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    sourceScope === "cloud"
                      ? "bg-white text-stone-900 shadow-xs"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  ক্লাউড ({toBengaliDigits(cloudLetters.length)})
                </button>
              </div>
              {onSyncAllToCloud && letters.length > 0 && (
                <button
                  type="button"
                  disabled={syncBusy}
                  onClick={() => {
                    setSyncBusy(true);
                    void onSyncAllToCloud().finally(() => setSyncBusy(false));
                  }}
                  className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Cloud className="w-4 h-4 text-[#1E3A8A]" />
                  <span>{syncBusy ? "সিঙ্ক হচ্ছে..." : "ক্লাউডে সিঙ্ক"}</span>
                </button>
              )}
            </>
          ) : (
            onConnectGoogleCloud && (
              <button
                type="button"
                disabled={syncBusy}
                onClick={() => {
                  setSyncBusy(true);
                  void onConnectGoogleCloud().finally(() => setSyncBusy(false));
                }}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Cloud className="w-4 h-4 text-[#1E3A8A]" />
                <span>{syncBusy ? "সংযুক্ত হচ্ছে..." : "Google ক্লাউড সিঙ্ক"}</span>
              </button>
            )
          )}

          <div className="relative flex-1 md:w-64">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="saved-letters-search"
              name="savedLettersSearch"
              aria-label="সংরক্ষিত পত্র অনুসন্ধান করুন"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="বিষয়, প্রাপক বা স্মারক নং খুঁজুন..."
              className="w-full h-10 pl-9 pr-3.5 rounded-lg border border-stone-300 bg-white text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-[#1E3A8A]"
            />
          </div>
          {displayedLetters.length > 0 && (
            <button
              type="button"
              onClick={() =>
                exportSavedLettersToExcel(
                  filtered.length > 0 ? filtered : displayedLetters,
                  orgName,
                  "saved_letters_sutonnymj",
                  "bijoy"
                )
              }
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-800 hover:bg-stone-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              <span>এক্সেল (SutonnyMJ)</span>
            </button>
          )}
        </div>
      </div>

      {displayedLetters.length === 0 ? (
        <div className="mt-8 bg-white border border-stone-200 rounded-xl p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-stone-100 mx-auto flex items-center justify-center text-stone-500">
            <FileText className="w-5 h-5" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-stone-900">
            এখনো কোনো দাপ্তরিক পত্র সংরক্ষণ করা হয়নি
          </h2>
          <p className="mt-1.5 text-sm text-stone-600 max-w-md mx-auto">
            সম্পাদক প্যানেল থেকে পত্র প্রস্তুত করে প্রিভিউ টুলবারের "সংরক্ষণ" বোতামে ক্লিক করলে এখানে নথিভুক্ত থাকবে।
          </p>
          <button
            type="button"
            onClick={onStartNew}
            className="mt-5 inline-flex items-center justify-center h-10 px-5 rounded-lg bg-[#1E3A8A] text-xs font-medium text-white hover:bg-[#172D6B] transition-colors cursor-pointer"
          >
            নতুন দাপ্তরিক পত্র প্রস্তুত করুন
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-8 bg-white border border-stone-200 rounded-xl p-10 text-center">
          <p className="text-sm text-stone-600">
            এই অনুসন্ধানের সাথে সামঞ্জস্যপূর্ণ কোনো সংরক্ষিত পত্র পাওয়া যায়নি।
          </p>
        </div>
      ) : (
        <div
          data-section="saved-letters-list"
          className="mt-6 bg-white border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-200"
        >
          {filtered.map((item) => (
            <div
              key={item.id}
              className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-stone-50/70 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500 mb-1">
                  <span className="tabular-nums font-medium text-stone-700">
                    {item.refNumber}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{item.dateText}</span>
                  <span aria-hidden="true">·</span>
                  <span>সংরক্ষিত: {formatSavedDate(item.savedAt)}</span>
                  {item.ownerName && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>প্রস্তুতকারক: {item.ownerName}</span>
                    </>
                  )}
                </div>
                <h2 className="text-base font-semibold text-stone-900 truncate">
                  {item.subject || "শিরোনামহীন পত্র"}
                </h2>
                <p className="text-xs text-stone-600 mt-0.5 truncate">
                  প্রাপক: {item.recipientName || "উল্লেখ নেই"}
                  {item.recipientOrg ? `, ${item.recipientOrg}` : ""}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onLoadLetter(item)}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#1E3A8A] text-xs font-medium text-white hover:bg-[#172D6B] transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>উন্মুক্ত করুন</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="প্রতিলিপি প্রস্তুত করুন"
                  onClick={() => onDuplicateLetter(item)}
                  className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-stone-300 bg-white text-xs font-medium text-stone-700 hover:bg-stone-50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <CopyPlus className="w-3.5 h-3.5" />
                  <span>প্রতিলিপি</span>
                </button>
                <button
                  type="button"
                  title="মুছে ফেলুন"
                  aria-label="চিঠি মুছে ফেলুন"
                  onClick={() => onDeleteLetter(item.id)}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-stone-300 bg-white text-stone-600 hover:text-red-700 hover:border-red-200 hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
