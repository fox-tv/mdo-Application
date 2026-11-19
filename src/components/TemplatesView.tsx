import React, { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Copy,
  Edit3,
  Plus,
  Puzzle,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { DepartmentItem, LetterTemplate } from "../types";
import { apiRequest } from "../utils/api";
import { toBengaliDigits } from "../utils/bengali";

interface TemplatesViewProps {
  templates: LetterTemplate[];
  departments: DepartmentItem[];
  isAdmin?: boolean;
  canManageTemplates: boolean;
  templatePluginEnabled: boolean;
  uiTexts?: Record<string, string>;
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
  isAdmin = false,
  canManageTemplates,
  templatePluginEnabled,
  uiTexts,
  onSelectTemplate,
  onTemplatesUpdated,
}) => {
  const [category, setCategory] = useState<string>("সকল");
  const [query, setQuery] = useState("");
  const [pluginManageMode, setPluginManageMode] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<LetterTemplate, "id">>({
    ...EMPTY_FORM,
    category: departments[0]?.name || "প্রশাসনিক ও সাধারণ",
  });
  const [formError, setFormError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const visibleDeptNames =
    isAdmin || canManageTemplates
      ? departments.map((d) => d.name)
      : Array.from(new Set(templates.map((t) => t.category)));
  const categories = ["সকল", ...visibleDeptNames];
  const canUsePluginTools = canManageTemplates && templatePluginEnabled;

  const filtered = templates.filter((tpl) => {
    const matchesCat = category === "সকল" || tpl.category === category;
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      tpl.title.toLowerCase().includes(q) ||
      tpl.summary.toLowerCase().includes(q) ||
      tpl.subject.toLowerCase().includes(q) ||
      tpl.category.toLowerCase().includes(q);
    return matchesCat && matchesQuery;
  });

  const notify = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(""), 2600);
  };

  const handleOpenCreate = () => {
    setFormError("");
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      category:
        category !== "সকল"
          ? category
          : departments[0]?.name || "প্রশাসনিক ও সাধারণ",
    });
    setShowModal(true);
  };

  const handleOpenEdit = (tpl: LetterTemplate) => {
    setFormError("");
    setEditingId(tpl.id);
    const { id: _ignored, ...rest } = tpl;
    setForm(rest);
    setShowModal(true);
  };

  const handleDuplicateTemplate = async (tpl: LetterTemplate) => {
    setFormError("");
    try {
      const { id: _ignored, ...rest } = tpl;
      const res = await apiRequest<{ template: LetterTemplate }>("/api/templates", {
        method: "POST",
        body: JSON.stringify({
          ...rest,
          title: `${tpl.title} (কপি)`,
        }),
      });
      onTemplatesUpdated([res.template, ...templates]);
      notify("টেমপ্লেটের অনুলিপি তৈরি হয়েছে।");
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "টেমপ্লেট অনুলিপি করা যায়নি।"
      );
    }
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!form.title.trim()) {
      setFormError("টেমপ্লেটের শিরোনাম লিখুন।");
      return;
    }

    setIsSaving(true);
    try {
      if (editingId) {
        const res = await apiRequest<{ template: LetterTemplate }>(
          `/api/templates/${editingId}`,
          {
            method: "PUT",
            body: JSON.stringify(form),
          }
        );
        onTemplatesUpdated(
          templates.map((t) => (t.id === res.template.id ? res.template : t))
        );
        notify("টেমপ্লেট সফলভাবে হালনাগাদ করা হয়েছে।");
      } else {
        const res = await apiRequest<{ template: LetterTemplate }>(
          "/api/templates",
          {
            method: "POST",
            body: JSON.stringify(form),
          }
        );
        onTemplatesUpdated([res.template, ...templates]);
        notify("নতুন টেমপ্লেট সফলভাবে যুক্ত করা হয়েছে।");
      }
      setShowModal(false);
      setEditingId(null);
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "টেমপ্লেট সংরক্ষণ করা যায়নি।"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await apiRequest(`/api/templates/${id}`, { method: "DELETE" });
      onTemplatesUpdated(templates.filter((t) => t.id !== id));
      setConfirmDeleteId(null);
      notify("টেমপ্লেটটি মুছে ফেলা হয়েছে।");
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "টেমপ্লেট মুছে ফেলা যায়নি।"
      );
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div
        data-section="templates-header"
        className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-stone-200"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            {uiTexts?.templatesTitle || "প্রাতিষ্ঠানিক দাপ্তরিক পত্রের টেমপ্লেটসমূহ"}
          </h1>
          <p className="mt-1.5 text-sm text-stone-600 max-w-2xl">
            {isAdmin
              ? "হিসাবরক্ষক, অডিট, এইচআর ও আইটি বিভাগ অনুযায়ী সাজানো প্রমিত নমুনা।"
              : "আপনার নির্ধারিত বিভাগ ও অনুমোদিত দাপ্তরিক পত্রের প্রমিত নমুনা।"}{" "}
            মোট টেমপ্লেট:{" "}
            <span className="font-semibold text-stone-900 tabular-nums">
              {toBengaliDigits(templates.length)}টি
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
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

          {canUsePluginTools && (
            <>
              <button
                type="button"
                onClick={() => setPluginManageMode((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  pluginManageMode
                    ? "border-[#1E3A8A]/40 bg-[#1E3A8A]/5 text-[#1E3A8A]"
                    : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
                }`}
              >
                <Puzzle className="w-4 h-4" />
                <span>টেমপ্লেট প্লাগইন: {pluginManageMode ? "চালু" : "লুকানো"}</span>
              </button>

              <button
                type="button"
                onClick={handleOpenCreate}
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>নতুন টেমপ্লেট যুক্ত করুন</span>
              </button>
            </>
          )}
        </div>
      </div>

      {actionNotice && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800"
        >
          {actionNotice}
        </div>
      )}

      {/* Category Filter Tabs */}
      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {categories.map((cat) => {
          const count =
            cat === "সকল"
              ? templates.length
              : templates.filter((t) => t.category === cat).length;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                category === cat
                  ? "bg-[#1E3A8A] text-white"
                  : "bg-white border border-stone-200 text-stone-700 hover:bg-stone-50"
              }`}
            >
              {cat} ({toBengaliDigits(count)})
            </button>
          );
        })}
      </div>

      {/* Templates Grid */}
      {filtered.length === 0 ? (
        <div className="mt-8 bg-white border border-stone-200 rounded-xl p-10 text-center">
          <p className="text-sm text-stone-600">
            আপনার অনুসন্ধানের সাথে সামঞ্জস্যপূর্ণ কোনো টেমপ্লেট পাওয়া যায়নি।
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCategory("সকল");
                setQuery("");
              }}
              className="px-4 py-2 rounded-lg border border-stone-300 text-xs font-medium text-stone-700 hover:bg-stone-50 cursor-pointer"
            >
              সকল টেমপ্লেট দেখুন
            </button>
            {canUsePluginTools && (
              <button
                type="button"
                onClick={handleOpenCreate}
                className="px-4 py-2 rounded-lg bg-[#1E3A8A] text-xs font-medium text-white hover:bg-[#172D6B] cursor-pointer"
              >
                নতুন টেমপ্লেট তৈরি করুন
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          data-section="templates-grid"
          className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {filtered.map((tpl) => (
            <article
              key={tpl.id}
              className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col justify-between hover:border-stone-300 transition-colors"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                    <span className="font-medium text-stone-700">
                      {tpl.category}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>স্মারক: {tpl.refSuffix}</span>
                  </div>

                  {canUsePluginTools && pluginManageMode && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(tpl)}
                        title="টেমপ্লেট সম্পাদনা"
                        aria-label={`${tpl.title} সম্পাদনা করুন`}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-stone-200 text-stone-600 hover:text-[#1E3A8A] hover:bg-stone-50 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDuplicateTemplate(tpl)}
                        title="অনুলিপি তৈরি করুন"
                        aria-label={`${tpl.title} অনুলিপি করুন`}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-stone-200 text-stone-600 hover:text-stone-900 hover:bg-stone-50 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(tpl.id)}
                        title="টেমপ্লেট মুছুন"
                        aria-label={`${tpl.title} মুছে ফেলুন`}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-stone-200 text-stone-600 hover:text-red-700 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <h2 className="text-base font-bold text-stone-900 leading-snug">
                  {tpl.title}
                </h2>
                <p className="mt-2 text-xs text-stone-600 leading-relaxed">
                  {tpl.summary}
                </p>
                <div className="mt-3.5 pt-3 border-t border-stone-100">
                  <p className="text-xs text-stone-500 line-clamp-2">
                    <span className="font-medium text-stone-700">বিষয়: </span>
                    {tpl.subject}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {confirmDeleteId === tpl.id ? (
                  <div className="p-2.5 rounded-lg border border-red-200 bg-red-50 flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-red-900">
                      নিশ্চিতভাবে মুছবেন?
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2.5 py-1 rounded border border-stone-300 bg-white text-stone-700 cursor-pointer"
                      >
                        না
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteTemplate(tpl.id)}
                        className="px-2.5 py-1 rounded bg-red-700 text-white font-semibold cursor-pointer"
                      >
                        হ্যাঁ, মুছুন
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectTemplate(tpl)}
                    className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-stone-300 bg-white text-xs font-semibold text-stone-800 hover:bg-[#1E3A8A] hover:text-white hover:border-[#1E3A8A] transition-colors cursor-pointer"
                  >
                    <span>এই টেমপ্লেট ব্যবহার করুন</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Add / Edit Template Plugin Modal */}
      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tpl-plugin-modal-title"
          className="fixed inset-0 z-50 bg-stone-950/50 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleSaveTemplate}
            className="bg-white border border-stone-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h2
                id="tpl-plugin-modal-title"
                className="text-base font-bold text-stone-900"
              >
                {editingId
                  ? "টেমপ্লেট সম্পাদনা (টেমপ্লেট প্লাগইন)"
                  : "নতুন দাপ্তরিক টেমপ্লেট যুক্ত করুন"}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
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
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="যেমন: অডিট আপত্তি নিষ্পত্তি পত্র"
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
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
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
                  onChange={(e) =>
                    setForm({ ...form, refSuffix: e.target.value })
                  }
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
                  onChange={(e) =>
                    setForm({ ...form, summary: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="tpl-modal-rec-prefix"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  উপসর্গ
                </label>
                <input
                  id="tpl-modal-rec-prefix"
                  name="recipientPrefix"
                  type="text"
                  value={form.recipientPrefix}
                  onChange={(e) =>
                    setForm({ ...form, recipientPrefix: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="tpl-modal-rec-name"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  প্রাপক
                </label>
                <input
                  id="tpl-modal-rec-name"
                  name="recipientName"
                  type="text"
                  value={form.recipientName}
                  onChange={(e) =>
                    setForm({ ...form, recipientName: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="tpl-modal-rec-title"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  পদবি / শাখা
                </label>
                <input
                  id="tpl-modal-rec-title"
                  name="recipientTitle"
                  type="text"
                  value={form.recipientTitle}
                  onChange={(e) =>
                    setForm({ ...form, recipientTitle: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="tpl-modal-rec-org"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  প্রতিষ্ঠান
                </label>
                <input
                  id="tpl-modal-rec-org"
                  name="recipientOrg"
                  type="text"
                  value={form.recipientOrg}
                  onChange={(e) =>
                    setForm({ ...form, recipientOrg: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="tpl-modal-subject"
                className="block text-xs font-medium text-stone-700 mb-1"
              >
                পত্রের বিষয়
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="tpl-modal-salutation"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  সম্বোধন
                </label>
                <input
                  id="tpl-modal-salutation"
                  name="salutation"
                  type="text"
                  value={form.salutation}
                  onChange={(e) =>
                    setForm({ ...form, salutation: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="tpl-modal-closing"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  সমাপ্তি সম্ভাষণ
                </label>
                <input
                  id="tpl-modal-closing"
                  name="closing"
                  type="text"
                  value={form.closing}
                  onChange={(e) =>
                    setForm({ ...form, closing: e.target.value })
                  }
                  className="w-full h-10 rounded-lg border border-stone-300 px-3 text-sm"
                />
              </div>
            </div>

            <div>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="tpl-modal-attachments"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  সংযুক্তি
                </label>
                <textarea
                  id="tpl-modal-attachments"
                  name="attachments"
                  rows={2}
                  value={form.attachments}
                  onChange={(e) =>
                    setForm({ ...form, attachments: e.target.value })
                  }
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="tpl-modal-cc"
                  className="block text-xs font-medium text-stone-700 mb-1"
                >
                  অনুলিপি (CC)
                </label>
                <textarea
                  id="tpl-modal-cc"
                  name="ccList"
                  rows={2}
                  value={form.ccList}
                  onChange={(e) => setForm({ ...form, ccList: e.target.value })}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="h-10 px-4 rounded-lg border border-stone-300 text-xs font-medium text-stone-700 cursor-pointer"
              >
                বাতিল
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="h-10 px-5 rounded-lg bg-[#1E3A8A] text-xs font-semibold text-white hover:bg-[#172D6B] disabled:opacity-60 cursor-pointer"
              >
                {isSaving
                  ? "সংরক্ষণ হচ্ছে..."
                  : editingId
                    ? "হালনাগাদ করুন"
                    : "টেমপ্লেট সংরক্ষণ করুন"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
