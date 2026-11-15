import React, { useState } from "react";
import { ArrowRight, Plus, Search, X, AlertCircle } from "lucide-react";
import { DepartmentItem, LetterTemplate } from "../types";
import { apiRequest } from "../utils/api";

interface TemplatesViewProps {
  templates: LetterTemplate[];
  departments: DepartmentItem[];
  canManageTemplates: boolean;
  onSelectTemplate: (template: LetterTemplate) => void;
  onTemplatesUpdated: (templates: LetterTemplate[]) => void;
}

const EMPTY_FORM: Omit<LetterTemplate, "id"> = {
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

export const TemplatesView: React.FC<TemplatesViewProps> = ({
  templates,
  departments,
  canManageTemplates,
  onSelectTemplate,
  onTemplatesUpdated,
}) => {
  const [category, setCategory] = useState<string>("সকল");
  const [query, setQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState<Omit<LetterTemplate, "id">>({
    ...EMPTY_FORM,
    category: departments[0]?.name || "প্রশাসনিক ও সাধারণ",
  });
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const categories = ["সকল", ...departments.map((d) => d.name)];

  const filtered = templates.filter((tpl) => {
    const matchesCat = category === "সকল" || tpl.category === category;
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      tpl.title.toLowerCase().includes(q) ||
      tpl.summary.toLowerCase().includes(q) ||
      tpl.subject.toLowerCase().includes(q);
    return matchesCat && matchesQuery;
  });

  const handleOpenCreate = () => {
    setFormError("");
    setForm({
      ...EMPTY_FORM,
      category:
        category !== "সকল"
          ? category
          : departments[0]?.name || "প্রশাসনিক ও সাধারণ",
    });
    setShowCreateModal(true);
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!form.title.trim()) {
      setFormError("টেমপ্লেটের শিরোনাম লিখুন।");
      return;
    }

    setIsSaving(true);
    try {
      const res = await apiRequest<{ template: LetterTemplate }>("/api/templates", {
        method: "POST",
        body: JSON.stringify(form),
      });
      onTemplatesUpdated([res.template, ...templates]);
      setShowCreateModal(false);
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "টেমপ্লেট যুক্ত করা যায়নি।"
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-stone-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            প্রাতিষ্ঠানিক চিঠির টেমপ্লেটসমূহ
          </h1>
          <p className="mt-1.5 text-sm text-stone-600 max-w-2xl">
            বিভাগ অনুযায়ী সাজানো প্রমিত দাপ্তরিক নমুনা। যেকোনো একটি নির্বাচন করে সরাসরি সম্পাদনা ও প্রিন্ট করুন।
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="templates-search"
              name="templatesSearch"
              aria-label="টেমপ্লেট খুঁজুন"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="টেমপ্লেট খুঁজুন..."
              className="w-full h-10 pl-9 pr-3.5 rounded-lg border border-stone-300 bg-white text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-[#1E3A8A]"
            />
          </div>

          {canManageTemplates && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>নতুন টেমপ্লেট</span>
            </button>
          )}
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              category === cat
                ? "bg-[#1E3A8A] text-white"
                : "bg-white border border-stone-200 text-stone-700 hover:bg-stone-50"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Templates Grid */}
      {filtered.length === 0 ? (
        <div className="mt-8 bg-white border border-stone-200 rounded-xl p-10 text-center">
          <p className="text-sm text-stone-600">
            আপনার অনুসন্ধানের সাথে মিলে এমন কোনো টেমপ্লেট পাওয়া যায়নি।
          </p>
          <button
            type="button"
            onClick={() => {
              setCategory("সকল");
              setQuery("");
            }}
            className="mt-3 px-4 py-2 rounded-lg border border-stone-300 text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
          >
            সকল টেমপ্লেট দেখুন
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((tpl) => (
            <article
              key={tpl.id}
              className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col justify-between hover:border-stone-300 transition-colors"
            >
              <div>
                <div className="flex items-center gap-2 text-xs text-stone-500 mb-2">
                  <span>{tpl.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>স্মারক কোড: {tpl.refSuffix}</span>
                </div>
                <h2 className="text-lg font-semibold text-stone-900">
                  {tpl.title}
                </h2>
                <p className="mt-2 text-sm text-stone-600 leading-relaxed">
                  {tpl.summary}
                </p>
                <div className="mt-4 pt-3 border-t border-stone-100">
                  <p className="text-xs text-stone-500 line-clamp-2">
                    <span className="font-medium text-stone-700">বিষয়: </span>
                    {tpl.subject}
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => onSelectTemplate(tpl)}
                  className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-800 hover:bg-[#1E3A8A] hover:text-white hover:border-[#1E3A8A] transition-colors cursor-pointer"
                >
                  <span>এই টেমপ্লেট ব্যবহার করুন</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tpl-create-modal-title"
          className="fixed inset-0 z-50 bg-stone-950/50 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleCreateTemplate}
            className="bg-white border border-stone-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h2
                id="tpl-create-modal-title"
                className="text-base font-bold text-stone-900"
              >
                নতুন চিঠির টেমপ্লেট যুক্ত করুন
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                aria-label="বন্ধ করুন"
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label
                  htmlFor="tpl-modal-title"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  টেমপ্লেটের শিরোনাম
                </label>
                <input
                  id="tpl-modal-title"
                  name="title"
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="যেমন: ঋণ মওকুফ আবেদনপত্র"
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="tpl-modal-category"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  বিভাগ
                </label>
                <select
                  id="tpl-modal-category"
                  name="category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="tpl-modal-ref"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  স্মারক কোড
                </label>
                <input
                  id="tpl-modal-ref"
                  name="refSuffix"
                  type="text"
                  value={form.refSuffix}
                  onChange={(e) => setForm({ ...form, refSuffix: e.target.value })}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="tpl-modal-summary"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  সংক্ষিপ্ত বিবরণ
                </label>
                <input
                  id="tpl-modal-summary"
                  name="summary"
                  type="text"
                  value={form.summary}
                  onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="tpl-modal-subject"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  চিঠির বিষয়
                </label>
                <input
                  id="tpl-modal-subject"
                  name="subject"
                  type="text"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="tpl-modal-body"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  মূল বক্তব্য
                </label>
                <textarea
                  id="tpl-modal-body"
                  name="body"
                  rows={6}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="h-10 px-4 rounded-lg border border-stone-300 text-xs font-medium text-stone-700 cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="h-10 px-5 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] disabled:opacity-60 cursor-pointer"
              >
                {isSaving ? "সংরক্ষণ হচ্ছে..." : "টেমপ্লেট সংরক্ষণ করুন"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
