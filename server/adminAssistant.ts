import {
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
  type GoogleGenAI,
  type Part,
} from "@google/genai";
import { generateContentResilient } from "./geminiClient.ts";
import { DEFAULT_AI_ASSISTANT_CONFIG } from "../src/data/templates.ts";
import type {
  AiAssistantActionLog,
  AiAssistantConfig,
  AiAssistantPendingProposal,
  CustomNavLink,
  CustomUiBlock,
  LetterFont,
  LetterheadStyle,
  LetterTemplate,
  PluginConfigData,
  PluginType,
  SitePlugin,
  TemplateAccessMode,
  UiBlockPlacement,
  UserRole,
} from "../src/types.ts";
import {
  createAiUndoSnapshot,
  getDb,
  hashPassword,
  saveDb,
  toPublicUser,
  type AppDatabase,
  type StoredUser,
} from "./store.ts";

const READ_ONLY_TOOLS = new Set([
  "get_system_overview",
  "inspect_ui_architecture",
  "get_template_details",
  "list_saved_letters",
]);

function sanitizeCustomLinks(links: unknown): CustomNavLink[] {
  if (!Array.isArray(links)) return [];
  return links
    .filter((item): item is CustomNavLink => {
      return (
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as CustomNavLink).label === "string" &&
        typeof (item as CustomNavLink).url === "string"
      );
    })
    .map((item) => {
      const rawUrl = item.url.trim();
      const lower = rawUrl.toLowerCase();
      if (
        lower.startsWith("javascript:") ||
        lower.startsWith("data:") ||
        lower.startsWith("vbscript:")
      ) {
        return null;
      }
      const safeUrl =
        rawUrl.startsWith("http://") ||
        rawUrl.startsWith("https://") ||
        rawUrl.startsWith("/")
          ? rawUrl
          : `https://${rawUrl}`;
      return {
        id: typeof item.id === "string" && item.id ? item.id : `lnk-${Date.now()}`,
        label: item.label.trim(),
        url: safeUrl,
      };
    })
    .filter((item): item is CustomNavLink => Boolean(item && item.label && item.url));
}

function sanitizeCss(raw: string): string {
  return raw.replace(/<\/?style[^>]*>/gi, "").replace(/<\/?script[^>]*>/gi, "");
}

function sanitizeSafeHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<\/?(meta|link|base|form)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\b(javascript|vbscript|data:text\/html)\s*:/gi, "blocked:");
}

function sanitizeSvgToDataUrl(rawSvg: string): string {
  const cleaned = sanitizeSafeHtml(rawSvg).trim();
  const match = cleaned.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) return "";
  let svg = match[0];
  if (!/\bxmlns=/.test(svg)) {
    svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function resolveImageValue(
  raw: unknown,
  db: AppDatabase,
  attachedImageDataUrl?: string,
  svgCode?: unknown
): string | undefined {
  if (typeof svgCode === "string" && svgCode.trim()) {
    const svgUri = sanitizeSvgToDataUrl(svgCode);
    if (svgUri) return svgUri;
  }
  if (typeof raw !== "string") return undefined;
  const val = raw.trim();
  if (!val) return "";
  if (val === "{{ATTACHED_IMAGE}}") {
    return attachedImageDataUrl || db.organization.logoDataUrl || "";
  }
  if (val === "org-logo") {
    return db.organization.logoDataUrl || "";
  }
  if (
    val.startsWith("https://") ||
    val.startsWith("http://") ||
    val.startsWith("/") ||
    /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);/i.test(val)
  ) {
    return val;
  }
  return undefined;
}

const ADMIN_TOOLS: FunctionDeclaration[] = [
  {
    name: "get_system_overview",
    description:
      "Read current siteConfig, organization profile, departments, template list (metadata), quickPhrases, plugins, users (safe public fields), letter count, and AI assistant config.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        includeTemplates: {
          type: Type.BOOLEAN,
          description: "Set true to include the full list of template IDs, titles, and categories.",
        },
      },
    },
  },
  {
    name: "inspect_ui_architecture",
    description:
      "Inspect the exact live UI DOM sections ([data-section='...']), CSS variables, A4 print sheet classes, and all customizable UI text keys/defaults before making deep layout, typography, CSS, or text edits.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        focusArea: {
          type: Type.STRING,
          description: "Optional focus area: all, login, header, dashboard, editor, templates, saved, organization",
        },
      },
    },
  },
  {
    name: "get_template_details",
    description:
      "Read the complete content of one or more letter templates by templateId or search query.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        templateId: { type: Type.STRING, description: "Exact template ID." },
        query: { type: Type.STRING, description: "Title or category keyword to search." },
      },
    },
  },
  {
    name: "list_saved_letters",
    description: "Search or list saved letters stored on the server.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Keyword in subject, refNumber, or recipient." },
        ownerUserId: { type: Type.STRING, description: "Filter by creator userId." },
        limit: { type: Type.NUMBER, description: "Max items to return (default 15)." },
      },
    },
  },
  {
    name: "update_site_config",
    description:
      "Update website name, subtitle, footer, announcement banner, theme colors, fonts, default letterhead style, nav labels, custom links, or user permissions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        websiteName: { type: Type.STRING },
        websiteSubtitle: { type: Type.STRING },
        footerText: { type: Type.STRING },
        announcementText: { type: Type.STRING },
        primaryColor: { type: Type.STRING, description: "Hex color like #1E3A8A or #14532D" },
        surfaceBgColor: { type: Type.STRING, description: "Hex color like #F6F5F1 or #FFFFFF" },
        uiFont: {
          type: Type.STRING,
          description: "One of: sutonnymj, hind, tiro, serif",
        },
        defaultLetterheadStyle: {
          type: Type.STRING,
          description: "One of: classic, modern, archival",
        },
        defaultLetterFont: {
          type: Type.STRING,
          description: "One of: sutonnymj, serif, sans",
        },
        navLabels: {
          type: Type.OBJECT,
          properties: {
            dashboard: { type: Type.STRING },
            editor: { type: Type.STRING },
            templates: { type: Type.STRING },
            saved: { type: Type.STRING },
            organization: { type: Type.STRING },
            admin: { type: Type.STRING },
          },
        },
        allowUserOrgEdit: { type: Type.BOOLEAN },
        allowUserTemplateCreate: { type: Type.BOOLEAN },
        allowAiDrafting: { type: Type.BOOLEAN },
        showLoginLogo: { type: Type.BOOLEAN },
        showLiveClock: {
          type: Type.BOOLEAN,
          description: "Show real-time Bengali clock & date in Dashboard & Login Home.",
        },
        showUserAvatar: {
          type: Type.BOOLEAN,
          description: "Show user profile photo avatar in Dashboard Hero & Header.",
        },
        dashboardBannerUrl: {
          type: Type.STRING,
          description: "Image URL, data URI, {{ATTACHED_IMAGE}}, or org-logo for Dashboard banner (empty string to clear).",
        },
        dashboardBannerCaption: { type: Type.STRING },
        dashboardBannerSvgCode: {
          type: Type.STRING,
          description: "Optional clean inline <svg>...</svg> markup to generate an institutional banner image directly if no external photo was provided.",
        },
        loginHeroImageUrl: {
          type: Type.STRING,
          description: "Image URL, data URI, {{ATTACHED_IMAGE}}, or org-logo for Home/Login page banner (empty string to clear).",
        },
        loginHeroCaption: { type: Type.STRING },
        loginHeroSvgCode: {
          type: Type.STRING,
          description: "Optional clean inline <svg>...</svg> markup for the Home/Login page banner image.",
        },
        customLinks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              url: { type: Type.STRING },
            },
            required: ["label", "url"],
          },
        },
      },
    },
  },
  {
    name: "update_custom_css",
    description:
      "Perform deep UI, typography, layout, header, card, button, or A4 print-sheet styling edits using custom CSS applied globally across the app.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        mode: {
          type: Type.STRING,
          description: "One of: append, replace, clear",
        },
        css: {
          type: Type.STRING,
          description: "Valid CSS rules to inject (omit if mode is clear).",
        },
        descriptionBn: {
          type: Type.STRING,
          description: "Short Bengali summary of what this CSS modifies.",
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "update_organization_profile",
    description:
      "Update organization letterhead details: Bengali/English names, tagline, registration number, address, phone, email, website, refPrefix, brandColor, crestType, or default signatory.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        nameBn: { type: Type.STRING },
        nameEn: { type: Type.STRING },
        tagline: { type: Type.STRING },
        regNumber: { type: Type.STRING },
        address: { type: Type.STRING },
        phone: { type: Type.STRING },
        email: { type: Type.STRING },
        website: { type: Type.STRING },
        refPrefix: { type: Type.STRING },
        brandColor: { type: Type.STRING },
        crestType: {
          type: Type.STRING,
          description: "One of: academic, corporate, heritage, justice, tech, civic",
        },
        defaultSignatoryName: { type: Type.STRING },
        defaultSignatoryTitle: { type: Type.STRING },
        defaultSignatoryDept: { type: Type.STRING },
      },
    },
  },
  {
    name: "create_template",
    description:
      "Create a new Bangladeshi official letter template in a department. Automatically creates the department if it does not exist yet.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        category: { type: Type.STRING, description: "Department name, e.g. অডিট বিভাগ" },
        summary: { type: Type.STRING },
        refSuffix: { type: Type.STRING },
        recipientPrefix: { type: Type.STRING },
        recipientName: { type: Type.STRING },
        recipientTitle: { type: Type.STRING },
        recipientOrg: { type: Type.STRING },
        recipientAddress: { type: Type.STRING },
        subject: { type: Type.STRING },
        salutation: { type: Type.STRING },
        body: { type: Type.STRING },
        closing: { type: Type.STRING },
        attachments: { type: Type.STRING },
        ccList: { type: Type.STRING },
      },
      required: ["title", "category", "subject", "body"],
    },
  },
  {
    name: "update_template",
    description:
      "Edit an existing letter template's title, department category, subject, body, recipient, or other fields.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        templateId: { type: Type.STRING, description: "Target template ID." },
        titleMatch: {
          type: Type.STRING,
          description: "Exact or partial title if templateId is unknown.",
        },
        title: { type: Type.STRING },
        category: { type: Type.STRING },
        summary: { type: Type.STRING },
        refSuffix: { type: Type.STRING },
        recipientPrefix: { type: Type.STRING },
        recipientName: { type: Type.STRING },
        recipientTitle: { type: Type.STRING },
        recipientOrg: { type: Type.STRING },
        recipientAddress: { type: Type.STRING },
        subject: { type: Type.STRING },
        salutation: { type: Type.STRING },
        body: { type: Type.STRING },
        closing: { type: Type.STRING },
        attachments: { type: Type.STRING },
        ccList: { type: Type.STRING },
      },
    },
  },
  {
    name: "delete_template",
    description: "Delete a letter template by templateId or titleMatch.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        templateId: { type: Type.STRING },
        titleMatch: { type: Type.STRING },
      },
    },
  },
  {
    name: "manage_department",
    description: "Create, rename (cascading templates and users), or delete a department.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "One of: create, rename, delete" },
        departmentId: { type: Type.STRING },
        name: { type: Type.STRING },
        newName: { type: Type.STRING },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_quick_phrases",
    description: "Add or delete official quick phrases used in the letter editor.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "One of: add, delete" },
        text: { type: Type.STRING },
        phraseId: { type: Type.STRING },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_user",
    description:
      "Create, update (name, designation, department, role, active state, password, or profile avatar photo), or delete a user account.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "One of: create, update, delete" },
        userId: { type: Type.STRING, description: "Login ID (or 'self' for the currently logged-in admin)." },
        password: { type: Type.STRING, description: "At least 4 characters (for create or reset)." },
        fullName: { type: Type.STRING },
        designation: { type: Type.STRING },
        department: { type: Type.STRING },
        role: { type: Type.STRING, description: "admin or user" },
        isActive: { type: Type.BOOLEAN },
        avatarUrl: {
          type: Type.STRING,
          description: "User photo URL, data URI, {{ATTACHED_IMAGE}}, org-logo, or empty string to clear.",
        },
        avatarSvgCode: {
          type: Type.STRING,
          description: "Optional clean inline <svg>...</svg> portrait avatar markup if no photo file was uploaded.",
        },
      },
      required: ["action", "userId"],
    },
  },
  {
    name: "set_user_template_access",
    description:
      "Control which templates or departments a specific user can access via the Template Access Control plugin.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetUserId: { type: Type.STRING },
        mode: { type: Type.STRING, description: "One of: department, custom, all" },
        allowedCategories: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        allowedTemplateIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        pluginEnabled: { type: Type.BOOLEAN },
      },
    },
  },
  {
    name: "manage_plugin",
    description:
      "Create, edit, toggle enable/disable, or delete an in-built or custom plugin (dashboard-widget, letter-snippet, custom-css).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "One of: create, update, toggle, delete" },
        pluginId: { type: Type.STRING },
        name: { type: Type.STRING },
        description: { type: Type.STRING },
        type: {
          type: Type.STRING,
          description: "For create: dashboard-widget, letter-snippet, or custom-css",
        },
        enabled: { type: Type.BOOLEAN },
        heading: { type: Type.STRING },
        content: { type: Type.STRING },
        insertText: { type: Type.STRING },
        css: { type: Type.STRING },
      },
      required: ["action"],
    },
  },
  {
    name: "update_ui_texts",
    description:
      "Customize or reset any visible UI heading, button label, subtitle, or badge text across Login, Header, Dashboard, Editor, Templates, Saved Letters, and Organization views.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        mode: {
          type: Type.STRING,
          description: "One of: merge, reset_keys, clear_all",
        },
        entries: {
          type: Type.ARRAY,
          description: "List of { key, value } text overrides. Use exact allowed key names from inspect_ui_architecture.",
          items: {
            type: Type.OBJECT,
            properties: {
              key: {
                type: Type.STRING,
                enum: [
                  "newLetterHeaderButton",
                  "loginUserIdLabel",
                  "loginPasswordLabel",
                  "loginButton",
                  "dashboardBadge",
                  "dashboardNewButton",
                  "dashboardShortcutsTitle",
                  "dashboardShortcutsSubtitle",
                  "dashboardSavedTitle",
                  "dashboardSavedSubtitle",
                  "templatesTitle",
                  "savedLettersTitle",
                  "orgTitle",
                ],
              },
              value: { type: Type.STRING },
            },
            required: ["key", "value"],
          },
        },
        keysToReset: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "manage_saved_letter",
    description:
      "Inspect full details, edit subject/body/recipient/refNumber, or delete a saved letter on the server.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "One of: get, update, delete" },
        letterId: { type: Type.STRING, description: "Target saved letter ID." },
        subject: { type: Type.STRING },
        body: { type: Type.STRING },
        refNumber: { type: Type.STRING },
        recipientName: { type: Type.STRING },
        recipientTitle: { type: Type.STRING },
        recipientOrg: { type: Type.STRING },
      },
      required: ["action", "letterId"],
    },
  },
  {
    name: "manage_ui_block",
    description:
      "Add, update, or remove dynamic UI blocks (photos, live Bengali clock, user profile card, notice cards, or rich HTML/SVG cards) on Home/Login page, Dashboard, or Header.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "One of: create, update, delete, clear_all" },
        blockId: { type: Type.STRING },
        placement: {
          type: Type.STRING,
          enum: [
            "dashboard-top",
            "dashboard-hero-right",
            "dashboard-bottom",
            "login-top",
            "login-bottom",
            "header-right",
          ],
        },
        kind: {
          type: Type.STRING,
          enum: ["image", "clock", "user-card", "notice", "html-card"],
        },
        title: { type: Type.STRING },
        subtitle: { type: Type.STRING },
        imageUrl: {
          type: Type.STRING,
          description: "Photo URL, data URI, {{ATTACHED_IMAGE}}, or org-logo.",
        },
        svgCode: {
          type: Type.STRING,
          description: "Optional clean inline <svg>...</svg> graphic converted into an image block.",
        },
        htmlContent: {
          type: Type.STRING,
          description: "Sanitized HTML fragment for custom html-card blocks.",
        },
        accentColor: { type: Type.STRING },
        enabled: { type: Type.BOOLEAN },
      },
      required: ["action"],
    },
  },
  {
    name: "update_ai_assistant_settings",
    description:
      "Customize this AI assistant's own name, personaRole, customInstructions, autoApplyEdits, enableVoiceInput, preferredTone, reasoningDepth (deep or balanced), or quickCommands.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        assistantName: { type: Type.STRING },
        personaRole: { type: Type.STRING },
        customInstructions: { type: Type.STRING },
        autoApplyEdits: { type: Type.BOOLEAN },
        enableVoiceInput: { type: Type.BOOLEAN },
        preferredTone: { type: Type.STRING },
        reasoningDepth: {
          type: Type.STRING,
          description: "One of: deep, balanced",
        },
        quickCommands: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
    },
  },
];

const TOOL_LABELS_BN: Record<string, string> = {
  get_system_overview: "সিস্টেম তথ্য পর্যালোচনা",
  inspect_ui_architecture: "সফটওয়্যার UI ও কোড কাঠামো বিশ্লেষণ",
  get_template_details: "টেমপ্লেট বিবরণ পাঠ",
  list_saved_letters: "সংরক্ষিত পত্র অনুসন্ধান",
  update_site_config: "সাইট, থিম, ছবি ও সময় কনফিগারেশন হালনাগাদ",
  update_custom_css: "ডিপ ডিজাইন / কাস্টম CSS পরিবর্তন",
  update_ui_texts: "সফটওয়্যার ইন্টারফেস লেখা ও বাটন কাস্টমাইজ",
  update_organization_profile: "প্রতিষ্ঠানের প্যাড ও তথ্য হালনাগাদ",
  create_template: "নতুন টেমপ্লেট তৈরি",
  update_template: "টেমপ্লেট সম্পাদনা",
  delete_template: "টেমপ্লেট অপসারণ",
  manage_department: "বিভাগ ব্যবস্থাপনা",
  manage_quick_phrases: "দ্রুত দাপ্তরিক বাক্য পরিবর্তন",
  manage_user: "ব্যবহারকারী ও প্রোফাইল ছবি পরিচালনা",
  set_user_template_access: "ইউজারভিত্তিক টেমপ্লেট অনুমতি নির্ধারণ",
  manage_plugin: "প্লাগইন ব্যবস্থাপনা",
  manage_saved_letter: "সংরক্ষিত পত্র পরিচালনা",
  manage_ui_block: "হোম ও ড্যাশবোর্ডে ডাইনামিক ছবি/সময়/ব্লক যুক্ত ও নিয়ন্ত্রণ",
  update_ai_assistant_settings: "এআই অ্যাসিস্ট্যান্ট কাস্টমাইজেশন",
};

interface ToolExecutionOutcome {
  mutated: boolean;
  labelBn: string;
  summary: string;
  response: Record<string, unknown>;
}

export function executeAssistantTool(
  db: AppDatabase,
  currentUser: StoredUser,
  toolName: string,
  args: Record<string, unknown>,
  attachedImageDataUrl?: string
): ToolExecutionOutcome {
  const labelBn = TOOL_LABELS_BN[toolName] || toolName;

  switch (toolName) {
    case "get_system_overview": {
      const includeTemplates = args.includeTemplates !== false;
      return {
        mutated: false,
        labelBn,
        summary: "সিস্টেমের বর্তমান অবস্থা পড়া হয়েছে।",
        response: {
          siteConfig: db.siteConfig,
          aiAssistantConfig: db.aiAssistantConfig,
          organization: {
            ...db.organization,
            logoDataUrl: db.organization.logoDataUrl ? "[configured]" : "",
            signatureDataUrl: db.organization.signatureDataUrl ? "[configured]" : "",
          },
          departments: db.departments,
          templates: includeTemplates
            ? db.templates.map((t) => ({
                id: t.id,
                title: t.title,
                category: t.category,
                refSuffix: t.refSuffix,
                summary: t.summary,
              }))
            : { total: db.templates.length },
          quickPhrases: db.quickPhrases,
          plugins: db.plugins,
          users: db.users.map(toPublicUser),
          totalLetters: db.letters.length,
        },
      };
    }

    case "inspect_ui_architecture": {
      return {
        mutated: false,
        labelBn,
        summary: "সফটওয়্যারের DOM সেকশন, CSS ভেরিয়েবল ও টেক্সট কী পর্যালোচনা করা হয়েছে।",
        response: {
          domSections: {
            appAnnouncement: '[data-section="app-announcement"]',
            appHeader: '[data-section="app-header"]',
            appFooter: '[data-section="app-footer"]',
            loginCard: '[data-section="login-card"]',
            dashboardHero: '[data-section="dashboard-hero"]',
            dashboardWidgets: '[data-section="dashboard-widgets"]',
            dashboardShortcuts: '[data-section="dashboard-shortcuts"]',
            dashboardSaved: '[data-section="dashboard-saved"]',
            editorControls: '[data-section="editor-controls"]',
            editorPreview: '[data-section="editor-preview"]',
            a4PrintSheet: ".a4-sheet",
            templatesHeader: '[data-section="templates-header"]',
            templatesGrid: '[data-section="templates-grid"]',
            savedLettersHeader: '[data-section="saved-letters-header"]',
            savedLettersList: '[data-section="saved-letters-list"]',
            orgProfileHeader: '[data-section="org-profile-header"]',
          },
          cssVariables: {
            "--site-primary": db.siteConfig.primaryColor,
            "--site-bg": db.siteConfig.surfaceBgColor,
            "--font-ui": "UI Font Family",
            "--font-letter-sutonny": "Letter Sutonny/Serif",
          },
          customizableUiTextKeys: {
            newLetterHeaderButton: { default: "নতুন চিঠি", current: db.siteConfig.uiTexts?.newLetterHeaderButton },
            loginUserIdLabel: { default: "ইউজার আইডি", current: db.siteConfig.uiTexts?.loginUserIdLabel },
            loginPasswordLabel: { default: "পাসওয়ার্ড", current: db.siteConfig.uiTexts?.loginPasswordLabel },
            loginButton: { default: "সফটওয়্যারে প্রবেশ করুন", current: db.siteConfig.uiTexts?.loginButton },
            dashboardBadge: { default: "স্বাগতম · ব্যবহারকারী ড্যাশবোর্ড", current: db.siteConfig.uiTexts?.dashboardBadge },
            dashboardNewButton: { default: "নতুন দাপ্তরিক পত্র প্রস্তুত করুন", current: db.siteConfig.uiTexts?.dashboardNewButton },
            dashboardShortcutsTitle: { default: "আপনার নিয়মিত ও বেশি ব্যবহৃত কাজের শর্টকাট", current: db.siteConfig.uiTexts?.dashboardShortcutsTitle },
            dashboardShortcutsSubtitle: { default: "আপনার বিভাগ, পূর্ববর্তী কাজ ও পিন করা তালিকার ভিত্তিতে সাজানো — এক ক্লিকেই চিঠি সম্পাদনা শুরু করুন।", current: db.siteConfig.uiTexts?.dashboardShortcutsSubtitle },
            dashboardSavedTitle: { default: "আপনার সম্পাদিত ও সংরক্ষিত চিঠিপত্র", current: db.siteConfig.uiTexts?.dashboardSavedTitle },
            dashboardSavedSubtitle: { default: "ইতিমধ্যে প্রস্তুতকৃত ও সংরক্ষিত সকল দাপ্তরিক পত্র এখান থেকে সরাসরি খুলতে, প্রতিলিপি করতে বা এক্সেলে নামাতে পারবেন।", current: db.siteConfig.uiTexts?.dashboardSavedSubtitle },
            templatesTitle: { default: "দাপ্তরিক চিঠির টেমপ্লেট", current: db.siteConfig.uiTexts?.templatesTitle },
            savedLettersTitle: { default: "সংরক্ষিত দাপ্তরিক পত্রের নথিভুক্তি", current: db.siteConfig.uiTexts?.savedLettersTitle },
            orgTitle: { default: "প্রতিষ্ঠানের তথ্য ও প্যাড কনফিগারেশন", current: db.siteConfig.uiTexts?.orgTitle },
          },
          currentVisualFeatures: {
            showLiveClock: Boolean(db.siteConfig.showLiveClock),
            showUserAvatar: Boolean(db.siteConfig.showUserAvatar),
            hasDashboardBanner: Boolean(db.siteConfig.dashboardBannerUrl),
            hasLoginHeroImage: Boolean(db.siteConfig.loginHeroImageUrl),
            currentUserHasAvatar: Boolean(currentUser.avatarDataUrl || currentUser.avatarUrl),
            customBlocksCount: (db.siteConfig.customBlocks || []).length,
            customBlocks: (db.siteConfig.customBlocks || []).map((b) => ({
              id: b.id,
              placement: b.placement,
              kind: b.kind,
              title: b.title,
              enabled: b.enabled,
            })),
            hasAttachedImageInTurn: Boolean(attachedImageDataUrl),
          },
          currentCustomCss: db.siteConfig.customCss || "",
          currentUiTexts: db.siteConfig.uiTexts || {},
        },
      };
    }

    case "get_template_details": {
      const id = String(args.templateId || "").trim();
      const q = String(args.query || "").trim().toLowerCase();
      const matches = db.templates.filter((t) => {
        if (id) return t.id === id;
        if (!q) return false;
        return (
          t.title.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q)
        );
      });
      return {
        mutated: false,
        labelBn,
        summary: `${matches.length}টি টেমপ্লেট পাওয়া গেছে।`,
        response: { templates: matches.slice(0, 6) },
      };
    }

    case "list_saved_letters": {
      const q = String(args.query || "").trim().toLowerCase();
      const owner = String(args.ownerUserId || "").trim().toLowerCase();
      const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 30);
      const filtered = db.letters
        .filter((l) => {
          if (owner && (l.ownerUserId || "").toLowerCase() !== owner) return false;
          if (!q) return true;
          return (
            l.subject.toLowerCase().includes(q) ||
            l.refNumber.toLowerCase().includes(q) ||
            l.recipientName.toLowerCase().includes(q) ||
            l.templateType.toLowerCase().includes(q)
          );
        })
        .slice(0, limit)
        .map((l) => ({
          id: l.id,
          subject: l.subject,
          refNumber: l.refNumber,
          templateType: l.templateType,
          ownerUserId: l.ownerUserId,
          ownerName: l.ownerName,
          dateText: l.dateText,
        }));
      return {
        mutated: false,
        labelBn,
        summary: `${filtered.length}টি সংরক্ষিত পত্র পাওয়া গেছে।`,
        response: { letters: filtered, totalAll: db.letters.length },
      };
    }

    case "update_site_config": {
      const changes: string[] = [];
      const s = db.siteConfig;
      if (typeof args.websiteName === "string" && args.websiteName.trim()) {
        s.websiteName = args.websiteName.trim();
        changes.push(`ওয়েবসাইটের নাম: ${s.websiteName}`);
      }
      if (typeof args.websiteSubtitle === "string") {
        s.websiteSubtitle = args.websiteSubtitle.trim();
        changes.push("সাবটাইটেল হালনাগাদ");
      }
      if (typeof args.footerText === "string") {
        s.footerText = args.footerText.trim();
        changes.push("ফুটার বার্তা হালনাগাদ");
      }
      if (typeof args.announcementText === "string") {
        s.announcementText = args.announcementText.trim();
        changes.push(s.announcementText ? "শীর্ষ নোটিশ যুক্ত" : "শীর্ষ নোটিশ অপসারণ");
      }
      if (typeof args.primaryColor === "string" && /^#[0-9a-fA-F]{6}$/.test(args.primaryColor.trim())) {
        s.primaryColor = args.primaryColor.trim();
        changes.push(`মূল রঙ: ${s.primaryColor}`);
      }
      if (typeof args.surfaceBgColor === "string" && /^#[0-9a-fA-F]{6}$/.test(args.surfaceBgColor.trim())) {
        s.surfaceBgColor = args.surfaceBgColor.trim();
        changes.push(`পৃষ্ঠের রঙ: ${s.surfaceBgColor}`);
      }
      if (
        args.uiFont === "sutonnymj" ||
        args.uiFont === "hind" ||
        args.uiFont === "tiro" ||
        args.uiFont === "serif"
      ) {
        s.uiFont = args.uiFont;
        changes.push(`UI ফন্ট: ${args.uiFont}`);
      }
      if (
        args.defaultLetterheadStyle === "classic" ||
        args.defaultLetterheadStyle === "modern" ||
        args.defaultLetterheadStyle === "archival"
      ) {
        s.defaultLetterheadStyle = args.defaultLetterheadStyle as LetterheadStyle;
        changes.push(`প্যাড নকশা: ${args.defaultLetterheadStyle}`);
      }
      if (
        args.defaultLetterFont === "sutonnymj" ||
        args.defaultLetterFont === "serif" ||
        args.defaultLetterFont === "sans"
      ) {
        s.defaultLetterFont = args.defaultLetterFont as LetterFont;
        changes.push(`চিঠির ফন্ট: ${args.defaultLetterFont}`);
      }
      if (args.navLabels && typeof args.navLabels === "object") {
        const nl = args.navLabels as Record<string, unknown>;
        for (const key of ["dashboard", "editor", "templates", "saved", "organization", "admin"] as const) {
          if (typeof nl[key] === "string" && nl[key].trim()) {
            s.navLabels[key] = nl[key].trim();
          }
        }
        changes.push("মেনু শিরোনাম হালনাগাদ");
      }
      if (typeof args.allowUserOrgEdit === "boolean") {
        s.allowUserOrgEdit = args.allowUserOrgEdit;
        changes.push("প্রতিষ্ঠান সম্পাদনা অনুমতি পরিবর্তন");
      }
      if (typeof args.allowUserTemplateCreate === "boolean") {
        s.allowUserTemplateCreate = args.allowUserTemplateCreate;
        changes.push("ইউজার টেমপ্লেট তৈরি অনুমতি পরিবর্তন");
      }
      if (typeof args.allowAiDrafting === "boolean") {
        s.allowAiDrafting = args.allowAiDrafting;
        changes.push("এআই চিঠি রচনা অনুমতি পরিবর্তন");
      }
      if (typeof args.showLoginLogo === "boolean") {
        s.showLoginLogo = args.showLoginLogo;
        changes.push("লগইন লোগো দৃশ্যমানতা পরিবর্তন");
      }
      if (typeof args.showLiveClock === "boolean") {
        s.showLiveClock = args.showLiveClock;
        changes.push(args.showLiveClock ? "লাইভ বাংলা সময় ও তারিখ চালু" : "লাইভ সময় বন্ধ");
      }
      if (typeof args.showUserAvatar === "boolean") {
        s.showUserAvatar = args.showUserAvatar;
        changes.push(args.showUserAvatar ? "ব্যবহারকারীর প্রোফাইল ছবি প্রদর্শন চালু" : "ব্যবহারকারীর ছবি প্রদর্শন বন্ধ");
      }
      const dashBanner = resolveImageValue(
        args.dashboardBannerUrl,
        db,
        attachedImageDataUrl,
        args.dashboardBannerSvgCode
      );
      if (dashBanner !== undefined) {
        s.dashboardBannerUrl = dashBanner;
        changes.push(dashBanner ? "ড্যাশবোর্ডে ছবি/ব্যানার সংযুক্ত" : "ড্যাশবোর্ড ব্যানার অপসারণ");
      }
      if (typeof args.dashboardBannerCaption === "string") {
        s.dashboardBannerCaption = args.dashboardBannerCaption.trim();
        changes.push("ড্যাশবোর্ড ছবির ক্যাপশন হালনাগাদ");
      }
      const loginBanner = resolveImageValue(
        args.loginHeroImageUrl,
        db,
        attachedImageDataUrl,
        args.loginHeroSvgCode
      );
      if (loginBanner !== undefined) {
        s.loginHeroImageUrl = loginBanner;
        changes.push(loginBanner ? "হোম পেজে (লগইন পাতায়) ছবি সংযুক্ত" : "হোম পেজের ছবি অপসারণ");
      }
      if (typeof args.loginHeroCaption === "string") {
        s.loginHeroCaption = args.loginHeroCaption.trim();
        changes.push("হোম পেজের ছবির ক্যাপশন হালনাগাদ");
      }
      if (Array.isArray(args.customLinks)) {
        s.customLinks = sanitizeCustomLinks(args.customLinks);
        changes.push("ফুটার কাস্টম লিংক হালনাগাদ");
      }
      if (changes.length === 0) {
        return {
          mutated: false,
          labelBn,
          summary: "কোনো পরিবর্তনের তথ্য পাওয়া যায়নি।",
          response: { ok: false, message: "No valid siteConfig fields provided." },
        };
      }
      saveDb(db);
      return {
        mutated: true,
        labelBn,
        summary: changes.join(", "),
        response: { ok: true, siteConfig: db.siteConfig },
      };
    }

    case "update_custom_css": {
      const mode = String(args.mode || "append").toLowerCase();
      const rawCss = typeof args.css === "string" ? sanitizeCss(args.css).trim() : "";
      if (mode === "clear") {
        db.siteConfig.customCss = "";
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: "সকল কাস্টম CSS মুছে পরিষ্কার করা হয়েছে।",
          response: { ok: true, customCss: "" },
        };
      }
      if (!rawCss) {
        return {
          mutated: false,
          labelBn,
          summary: "CSS কোড খালি ছিল।",
          response: { ok: false, error: "CSS content required unless mode is clear." },
        };
      }
      if (mode === "replace") {
        db.siteConfig.customCss = rawCss;
      } else {
        db.siteConfig.customCss = db.siteConfig.customCss
          ? `${db.siteConfig.customCss.trim()}\n\n${rawCss}`
          : rawCss;
      }
      saveDb(db);
      const summary =
        typeof args.descriptionBn === "string" && args.descriptionBn.trim()
          ? args.descriptionBn.trim()
          : mode === "replace"
            ? "নতুন কাস্টম CSS প্রতিস্থাপন করা হয়েছে।"
            : "কাস্টম CSS কোড যুক্ত করা হয়েছে।";
      return {
        mutated: true,
        labelBn,
        summary,
        response: { ok: true, customCssLength: db.siteConfig.customCss.length },
      };
    }

    case "update_organization_profile": {
      const org = db.organization;
      const fields = [
        "nameBn",
        "nameEn",
        "tagline",
        "regNumber",
        "address",
        "phone",
        "email",
        "website",
        "refPrefix",
        "brandColor",
        "defaultSignatoryName",
        "defaultSignatoryTitle",
        "defaultSignatoryDept",
      ] as const;
      const updatedFields: string[] = [];
      for (const f of fields) {
        if (typeof args[f] === "string") {
          org[f] = (args[f] as string).trim();
          updatedFields.push(f);
        }
      }
      if (
        args.crestType === "academic" ||
        args.crestType === "corporate" ||
        args.crestType === "heritage" ||
        args.crestType === "justice" ||
        args.crestType === "tech" ||
        args.crestType === "civic"
      ) {
        org.crestType = args.crestType;
        updatedFields.push("crestType");
      }
      if (updatedFields.length === 0) {
        return {
          mutated: false,
          labelBn,
          summary: "প্রতিষ্ঠানের কোনো তথ্য পরিবর্তন করা হয়নি।",
          response: { ok: false },
        };
      }
      saveDb(db);
      return {
        mutated: true,
        labelBn,
        summary: `প্রতিষ্ঠানের তথ্য হালনাগাদ: ${updatedFields.join(", ")}`,
        response: { ok: true, organization: db.organization },
      };
    }

    case "create_template": {
      const title = String(args.title || "").trim();
      const category = String(args.category || "প্রশাসনিক ও সাধারণ").trim();
      const subject = String(args.subject || "").trim();
      const body = String(args.body || "").trim();
      if (!title || !subject || !body) {
        return {
          mutated: false,
          labelBn,
          summary: "টেমপ্লেটের শিরোনাম, বিষয় ও মূল বক্তব্য আবশ্যক।",
          response: { ok: false, error: "title, subject, and body are required." },
        };
      }
      if (!db.departments.some((d) => d.name === category)) {
        db.departments.push({ id: `dept-${Date.now()}`, name: category });
      }
      const created: LetterTemplate = {
        id: `tpl-${Date.now()}`,
        title,
        category,
        summary: String(args.summary || subject).trim(),
        refSuffix: String(args.refSuffix || "পত্র").trim(),
        recipientPrefix: String(args.recipientPrefix || "বরাবর").trim(),
        recipientName: String(args.recipientName || "").trim(),
        recipientTitle: String(args.recipientTitle || "").trim(),
        recipientOrg: String(args.recipientOrg || db.organization.nameBn).trim(),
        recipientAddress: String(args.recipientAddress || "").trim(),
        subject,
        salutation: String(args.salutation || "মহোদয়,").trim(),
        body,
        closing: String(args.closing || "বিনীত,").trim(),
        attachments: String(args.attachments || "").trim(),
        ccList: String(args.ccList || "").trim(),
      };
      db.templates.unshift(created);
      saveDb(db);
      return {
        mutated: true,
        labelBn,
        summary: `“${created.title}” (${created.category}) তৈরি হয়েছে।`,
        response: { ok: true, template: created },
      };
    }

    case "update_template": {
      const id = String(args.templateId || "").trim();
      const match = String(args.titleMatch || "").trim().toLowerCase();
      const idx = db.templates.findIndex((t) =>
        id ? t.id === id : match ? t.title.toLowerCase().includes(match) : false
      );
      if (idx === -1) {
        return {
          mutated: false,
          labelBn,
          summary: "নির্দিষ্ট টেমপ্লেট খুঁজে পাওয়া যায়নি।",
          response: { ok: false, error: "Template not found." },
        };
      }
      const target = db.templates[idx];
      const fields = [
        "title",
        "category",
        "summary",
        "refSuffix",
        "recipientPrefix",
        "recipientName",
        "recipientTitle",
        "recipientOrg",
        "recipientAddress",
        "subject",
        "salutation",
        "body",
        "closing",
        "attachments",
        "ccList",
      ] as const;
      for (const f of fields) {
        if (typeof args[f] === "string") {
          target[f] = (args[f] as string).trim();
        }
      }
      if (target.category && !db.departments.some((d) => d.name === target.category)) {
        db.departments.push({ id: `dept-${Date.now()}`, name: target.category });
      }
      saveDb(db);
      return {
        mutated: true,
        labelBn,
        summary: `“${target.title}” টেমপ্লেট হালনাগাদ করা হয়েছে।`,
        response: { ok: true, template: target },
      };
    }

    case "delete_template": {
      const id = String(args.templateId || "").trim();
      const match = String(args.titleMatch || "").trim().toLowerCase();
      const target = db.templates.find((t) =>
        id ? t.id === id : match ? t.title.toLowerCase() === match || t.title.toLowerCase().includes(match) : false
      );
      if (!target) {
        return {
          mutated: false,
          labelBn,
          summary: "মুছে ফেলার জন্য টেমপ্লেট পাওয়া যায়নি।",
          response: { ok: false, error: "Template not found." },
        };
      }
      db.templates = db.templates.filter((t) => t.id !== target.id);
      saveDb(db);
      return {
        mutated: true,
        labelBn,
        summary: `“${target.title}” টেমপ্লেট মুছে ফেলা হয়েছে।`,
        response: { ok: true, deletedId: target.id, deletedTitle: target.title },
      };
    }

    case "manage_department": {
      const action = String(args.action || "").toLowerCase();
      if (action === "create") {
        const name = String(args.name || "").trim();
        if (!name) {
          return { mutated: false, labelBn, summary: "বিভাগের নাম দিন।", response: { ok: false } };
        }
        if (db.departments.some((d) => d.name === name)) {
          return {
            mutated: false,
            labelBn,
            summary: `“${name}” বিভাগটি আগে থেকেই রয়েছে।`,
            response: { ok: true, alreadyExists: true },
          };
        }
        const dept = { id: `dept-${Date.now()}`, name };
        db.departments.push(dept);
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `নতুন বিভাগ “${name}” যুক্ত হয়েছে।`,
          response: { ok: true, department: dept },
        };
      }
      if (action === "rename") {
        const oldName = String(args.name || "").trim();
        const deptId = String(args.departmentId || "").trim();
        const newName = String(args.newName || "").trim();
        const dept = db.departments.find((d) => (deptId ? d.id === deptId : d.name === oldName));
        if (!dept || !newName) {
          return {
            mutated: false,
            labelBn,
            summary: "বিভাগ বা নতুন নাম পাওয়া যায়নি।",
            response: { ok: false },
          };
        }
        const prevName = dept.name;
        dept.name = newName;
        db.templates = db.templates.map((t) =>
          t.category === prevName ? { ...t, category: newName } : t
        );
        db.users = db.users.map((u) =>
          u.department === prevName ? { ...u, department: newName } : u
        );
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `“${prevName}” বিভাগের নাম বদলে “${newName}” করা হয়েছে।`,
          response: { ok: true, department: dept },
        };
      }
      if (action === "delete") {
        const name = String(args.name || "").trim();
        const deptId = String(args.departmentId || "").trim();
        const dept = db.departments.find((d) => (deptId ? d.id === deptId : d.name === name));
        if (!dept) {
          return {
            mutated: false,
            labelBn,
            summary: "বিভাগ পাওয়া যায়নি।",
            response: { ok: false },
          };
        }
        if (db.departments.length <= 1) {
          return {
            mutated: false,
            labelBn,
            summary: "অন্তত একটি বিভাগ থাকা আবশ্যক।",
            response: { ok: false },
          };
        }
        db.departments = db.departments.filter((d) => d.id !== dept.id);
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `“${dept.name}” বিভাগ সরানো হয়েছে।`,
          response: { ok: true },
        };
      }
      return { mutated: false, labelBn, summary: "অজানা বিভাগ অ্যাকশন।", response: { ok: false } };
    }

    case "manage_quick_phrases": {
      const action = String(args.action || "").toLowerCase();
      if (action === "add") {
        const text = String(args.text || "").trim();
        if (!text) {
          return { mutated: false, labelBn, summary: "বাক্য লিখুন।", response: { ok: false } };
        }
        const item = { id: `qp-${Date.now()}`, text };
        db.quickPhrases.push(item);
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `নতুন দ্রুত বাক্য যুক্ত: “${text}”`,
          response: { ok: true, quickPhrase: item },
        };
      }
      if (action === "delete") {
        const phraseId = String(args.phraseId || "").trim();
        const text = String(args.text || "").trim();
        const before = db.quickPhrases.length;
        db.quickPhrases = db.quickPhrases.filter((p) =>
          phraseId ? p.id !== phraseId : p.text !== text
        );
        if (db.quickPhrases.length === before) {
          return {
            mutated: false,
            labelBn,
            summary: "বাক্যটি খুঁজে পাওয়া যায়নি।",
            response: { ok: false },
          };
        }
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: "দ্রুত বাক্য মুছে ফেলা হয়েছে।",
          response: { ok: true },
        };
      }
      return { mutated: false, labelBn, summary: "অজানা অ্যাকশন।", response: { ok: false } };
    }

    case "manage_user": {
      const action = String(args.action || "").toLowerCase();
      const rawUserId = String(args.userId || "").trim();
      const userId =
        rawUserId.toLowerCase() === "self" ? currentUser.userId : rawUserId;
      if (!userId) {
        return { mutated: false, labelBn, summary: "ইউজার আইডি প্রয়োজন।", response: { ok: false } };
      }

      const resolvedAvatar = resolveImageValue(
        args.avatarUrl,
        db,
        attachedImageDataUrl,
        args.avatarSvgCode
      );

      if (action === "create") {
        if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(userId)) {
          return {
            mutated: false,
            labelBn,
            summary: "ইউজার আইডি ৩-৩২ অক্ষরের ইংরেজি/সংখ্যা হতে হবে।",
            response: { ok: false },
          };
        }
        const password = String(args.password || "").trim();
        const fullName = String(args.fullName || "").trim();
        if (password.length < 4 || !fullName) {
          return {
            mutated: false,
            labelBn,
            summary: "পূর্ণ নাম ও কমপক্ষে ৪ অক্ষরের পাসওয়ার্ড প্রয়োজন।",
            response: { ok: false },
          };
        }
        if (db.users.some((u) => u.userId.toLowerCase() === userId.toLowerCase())) {
          return {
            mutated: false,
            labelBn,
            summary: `“${userId}” আইডিটি আগে থেকেই রয়েছে।`,
            response: { ok: false },
          };
        }
        const created: StoredUser = {
          id: `usr-${Date.now()}`,
          userId,
          passwordHash: hashPassword(password),
          fullName,
          designation: String(args.designation || "").trim(),
          department: String(args.department || "সকল বিভাগ").trim(),
          role: args.role === "admin" ? "admin" : "user",
          isActive: args.isActive !== false,
          avatarDataUrl: resolvedAvatar || "",
          avatarUrl: resolvedAvatar || "",
          createdAt: new Date().toISOString(),
        };
        db.users.push(created);
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `নতুন ইউজার “${created.fullName}” (${created.userId}) তৈরি হয়েছে।`,
          response: { ok: true, user: toPublicUser(created) },
        };
      }

      const target = db.users.find(
        (u) => u.userId.toLowerCase() === userId.toLowerCase() || u.id === userId
      );
      if (!target) {
        return {
          mutated: false,
          labelBn,
          summary: `ইউজার “${userId}” পাওয়া যায়নি।`,
          response: { ok: false },
        };
      }

      if (action === "update") {
        if (target.id === currentUser.id) {
          if (args.isActive === false || args.role === "user") {
            return {
              mutated: false,
              labelBn,
              summary: "নিজের অ্যাডমিন অ্যাকাউন্ট নিষ্ক্রিয় বা ভূমিকা অবনমন করা যাবে না।",
              response: { ok: false },
            };
          }
        }
        if (typeof args.fullName === "string" && args.fullName.trim()) {
          target.fullName = args.fullName.trim();
        }
        if (typeof args.designation === "string") {
          target.designation = args.designation.trim();
        }
        if (typeof args.department === "string" && args.department.trim()) {
          target.department = args.department.trim();
        }
        if (args.role === "admin" || args.role === "user") {
          target.role = args.role as UserRole;
        }
        if (typeof args.isActive === "boolean") {
          target.isActive = args.isActive;
        }
        if (resolvedAvatar !== undefined) {
          target.avatarDataUrl = resolvedAvatar;
          target.avatarUrl = resolvedAvatar;
        }
        if (typeof args.password === "string" && args.password.length >= 4) {
          target.passwordHash = hashPassword(args.password);
          if (target.userId === "admin") {
            db.siteConfig.adminPasswordChanged = true;
          }
        }
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `ইউজার “${target.fullName}” (${target.userId}) হালনাগাদ হয়েছে।`,
          response: { ok: true, user: toPublicUser(target) },
        };
      }

      if (action === "delete") {
        if (target.id === currentUser.id) {
          return {
            mutated: false,
            labelBn,
            summary: "নিজের অ্যাকাউন্ট মুছে ফেলা যাবে না।",
            response: { ok: false },
          };
        }
        if (
          target.role === "admin" &&
          db.users.filter((u) => u.role === "admin" && u.isActive).length <= 1
        ) {
          return {
            mutated: false,
            labelBn,
            summary: "অন্তত একজন সক্রিয় অ্যাডমিন থাকা আবশ্যক।",
            response: { ok: false },
          };
        }
        db.users = db.users.filter((u) => u.id !== target.id);
        const accessPlg = db.plugins.find((p) => p.type === "template-access");
        if (accessPlg?.config?.userTemplateRules) {
          delete accessPlg.config.userTemplateRules[target.userId];
        }
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `ইউজার “${target.fullName}” (${target.userId}) মুছে ফেলা হয়েছে।`,
          response: { ok: true },
        };
      }

      return { mutated: false, labelBn, summary: "অজানা ইউজার অ্যাকশন।", response: { ok: false } };
    }

    case "set_user_template_access": {
      const accessPlg = db.plugins.find((p) => p.type === "template-access");
      if (!accessPlg) {
        return {
          mutated: false,
          labelBn,
          summary: "টেমপ্লেট অনুমতি প্লাগইন পাওয়া যায়নি।",
          response: { ok: false },
        };
      }
      if (typeof args.pluginEnabled === "boolean") {
        accessPlg.enabled = args.pluginEnabled;
      }
      const targetUserId = String(args.targetUserId || "").trim();
      if (targetUserId) {
        const target = db.users.find(
          (u) => u.userId.toLowerCase() === targetUserId.toLowerCase()
        );
        if (!target) {
          return {
            mutated: false,
            labelBn,
            summary: `ইউজার “${targetUserId}” পাওয়া যায়নি।`,
            response: { ok: false },
          };
        }
        if (!accessPlg.config) accessPlg.config = {};
        if (!accessPlg.config.userTemplateRules) accessPlg.config.userTemplateRules = {};
        const mode: TemplateAccessMode =
          args.mode === "custom" || args.mode === "all" ? args.mode : "department";
        accessPlg.config.userTemplateRules[target.userId] = {
          mode,
          allowedCategories: Array.isArray(args.allowedCategories)
            ? (args.allowedCategories as unknown[]).map(String)
            : [],
          allowedTemplateIds: Array.isArray(args.allowedTemplateIds)
            ? (args.allowedTemplateIds as unknown[]).map(String)
            : [],
        };
      }
      saveDb(db);
      return {
        mutated: true,
        labelBn,
        summary: targetUserId
          ? `“${targetUserId}” এর টেমপ্লেট প্রবেশাধিকার হালনাগাদ হয়েছে।`
          : "টেমপ্লেট অনুমতি প্লাগইন অবস্থা হালনাগাদ হয়েছে।",
        response: { ok: true, plugin: accessPlg },
      };
    }

    case "manage_plugin": {
      const action = String(args.action || "").toLowerCase();
      if (action === "create") {
        const name = String(args.name || "").trim();
        if (!name) {
          return { mutated: false, labelBn, summary: "প্লাগইনের নাম দিন।", response: { ok: false } };
        }
        const safeType: PluginType =
          args.type === "letter-snippet" || args.type === "custom-css"
            ? args.type
            : "dashboard-widget";
        const cfg: PluginConfigData = {};
        if (typeof args.heading === "string") cfg.heading = args.heading.trim();
        if (typeof args.content === "string") cfg.content = args.content.trim();
        if (typeof args.insertText === "string") cfg.insertText = args.insertText.trim();
        if (typeof args.css === "string") cfg.css = sanitizeCss(args.css).trim();

        const created: SitePlugin = {
          id: `plg-${Date.now()}`,
          name,
          description: String(args.description || "").trim(),
          type: safeType,
          enabled: args.enabled !== false,
          builtIn: false,
          config: cfg,
          createdAt: new Date().toISOString(),
        };
        db.plugins.push(created);
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `নতুন প্লাগইন “${name}” তৈরি ও সক্রিয় হয়েছে।`,
          response: { ok: true, plugin: created },
        };
      }

      const id = String(args.pluginId || "").trim();
      const nameSearch = String(args.name || "").trim().toLowerCase();
      const plg = db.plugins.find((p) =>
        id ? p.id === id : nameSearch ? p.name.toLowerCase().includes(nameSearch) : false
      );
      if (!plg) {
        return {
          mutated: false,
          labelBn,
          summary: "প্লাগইন পাওয়া যায়নি।",
          response: { ok: false },
        };
      }

      if (action === "toggle") {
        plg.enabled = typeof args.enabled === "boolean" ? args.enabled : !plg.enabled;
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `“${plg.name}” ${plg.enabled ? "সক্রিয়" : "নিষ্ক্রিয়"} করা হয়েছে।`,
          response: { ok: true, plugin: plg },
        };
      }

      if (action === "update") {
        if (typeof args.name === "string" && args.name.trim()) plg.name = args.name.trim();
        if (typeof args.description === "string") plg.description = args.description.trim();
        if (typeof args.enabled === "boolean") plg.enabled = args.enabled;
        if (!plg.config) plg.config = {};
        if (typeof args.heading === "string") plg.config.heading = args.heading.trim();
        if (typeof args.content === "string") plg.config.content = args.content.trim();
        if (typeof args.insertText === "string") plg.config.insertText = args.insertText.trim();
        if (typeof args.css === "string") plg.config.css = sanitizeCss(args.css).trim();
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `“${plg.name}” প্লাগইন হালনাগাদ হয়েছে।`,
          response: { ok: true, plugin: plg },
        };
      }

      if (action === "delete") {
        if (plg.builtIn) {
          return {
            mutated: false,
            labelBn,
            summary: "মূল সিস্টেম প্লাগইন মুছে ফেলা যাবে না (শুধু নিষ্ক্রিয় করা যাবে)।",
            response: { ok: false },
          };
        }
        db.plugins = db.plugins.filter((p) => p.id !== plg.id);
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `“${plg.name}” প্লাগইন মুছে ফেলা হয়েছে।`,
          response: { ok: true },
        };
      }

      return { mutated: false, labelBn, summary: "অজানা প্লাগইন অ্যাকশন।", response: { ok: false } };
    }

    case "update_ui_texts": {
      const mode = String(args.mode || "merge").toLowerCase();
      if (!db.siteConfig.uiTexts) db.siteConfig.uiTexts = {};
      if (mode === "clear_all") {
        db.siteConfig.uiTexts = {};
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: "সকল কাস্টম UI লেখা ডিফল্ট অবস্থায় ফিরিয়ে আনা হয়েছে।",
          response: { ok: true, uiTexts: {} },
        };
      }
      if (mode === "reset_keys" && Array.isArray(args.keysToReset)) {
        for (const k of args.keysToReset) {
          delete db.siteConfig.uiTexts[String(k)];
        }
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: "নির্বাচিত UI লেখাগুলো ডিফল্ট অবস্থায় ফিরিয়ে আনা হয়েছে।",
          response: { ok: true, uiTexts: db.siteConfig.uiTexts },
        };
      }
      const VALID_UI_TEXT_KEYS = new Set([
        "newLetterHeaderButton",
        "loginUserIdLabel",
        "loginPasswordLabel",
        "loginButton",
        "dashboardBadge",
        "dashboardNewButton",
        "dashboardShortcutsTitle",
        "dashboardShortcutsSubtitle",
        "dashboardSavedTitle",
        "dashboardSavedSubtitle",
        "templatesTitle",
        "savedLettersTitle",
        "orgTitle",
      ]);
      const UI_KEY_ALIASES: Record<string, string> = {
        "dashboard.new_letter_button": "dashboardNewButton",
        "dashboard.newButton": "dashboardNewButton",
        "dashboard_new_button": "dashboardNewButton",
        "header.new_letter_button": "newLetterHeaderButton",
        "new_letter_header_button": "newLetterHeaderButton",
        "login.button": "loginButton",
        "login_button": "loginButton",
        "templates.title": "templatesTitle",
        "saved_letters.title": "savedLettersTitle",
        "org.title": "orgTitle",
      };
      if (Array.isArray(args.entries) && args.entries.length > 0) {
        const updated: string[] = [];
        for (const entry of args.entries) {
          if (entry && typeof entry === "object") {
            const rawK = String((entry as { key?: unknown }).key || "").trim();
            const k = VALID_UI_TEXT_KEYS.has(rawK) ? rawK : UI_KEY_ALIASES[rawK] || "";
            const v = String((entry as { value?: unknown }).value || "").trim();
            if (k && v) {
              db.siteConfig.uiTexts[k] = v;
              updated.push(`${k} → ${v}`);
            }
          }
        }
        if (updated.length > 0) {
          saveDb(db);
          return {
            mutated: true,
            labelBn,
            summary: `UI লেখা হালনাগাদ: ${updated.join(", ")}`,
            response: { ok: true, uiTexts: db.siteConfig.uiTexts },
          };
        }
      }
      return {
        mutated: false,
        labelBn,
        summary: "UI লেখা পরিবর্তনের কোনো সঠিক তথ্য পাওয়া যায়নি।",
        response: { ok: false },
      };
    }

    case "manage_saved_letter": {
      const action = String(args.action || "").toLowerCase();
      const letterId = String(args.letterId || "").trim();
      const idx = db.letters.findIndex((l) => l.id === letterId);
      if (idx === -1) {
        return {
          mutated: false,
          labelBn,
          summary: "নির্দিষ্ট সংরক্ষিত পত্র খুঁজে পাওয়া যায়নি।",
          response: { ok: false },
        };
      }
      if (action === "get") {
        return {
          mutated: false,
          labelBn,
          summary: `“${db.letters[idx].subject}” পত্রের পূর্ণাঙ্গ বিবরণ পড়া হয়েছে।`,
          response: { letter: db.letters[idx] },
        };
      }
      if (action === "update") {
        const target = db.letters[idx];
        for (const f of ["subject", "body", "refNumber", "recipientName", "recipientTitle", "recipientOrg"] as const) {
          if (typeof args[f] === "string") {
            target[f] = (args[f] as string).trim();
          }
        }
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `সংরক্ষিত পত্র “${target.subject}” হালনাগাদ হয়েছে।`,
          response: { ok: true, letter: target },
        };
      }
      if (action === "delete") {
        const removed = db.letters[idx];
        db.letters = db.letters.filter((l) => l.id !== letterId);
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `সংরক্ষিত পত্র “${removed.subject}” মুছে ফেলা হয়েছে।`,
          response: { ok: true },
        };
      }
      return { mutated: false, labelBn, summary: "অজানা অ্যাকশন।", response: { ok: false } };
    }

    case "manage_ui_block": {
      const action = String(args.action || "").toLowerCase();
      if (!Array.isArray(db.siteConfig.customBlocks)) {
        db.siteConfig.customBlocks = [];
      }
      const VALID_PLACEMENTS = new Set<UiBlockPlacement>([
        "dashboard-top",
        "dashboard-hero-right",
        "dashboard-bottom",
        "login-top",
        "login-bottom",
        "header-right",
      ]);
      const VALID_KINDS = new Set<CustomUiBlock["kind"]>([
        "image",
        "clock",
        "user-card",
        "notice",
        "html-card",
      ]);

      if (action === "clear_all") {
        db.siteConfig.customBlocks = [];
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: "সকল কাস্টম UI ব্লক অপসারণ করা হয়েছে।",
          response: { ok: true, customBlocks: [] },
        };
      }

      if (action === "create") {
        const placementRaw = String(args.placement || "dashboard-top") as UiBlockPlacement;
        const placement: UiBlockPlacement = VALID_PLACEMENTS.has(placementRaw)
          ? placementRaw
          : "dashboard-top";
        const kindRaw = String(args.kind || "image") as CustomUiBlock["kind"];
        const kind: CustomUiBlock["kind"] = VALID_KINDS.has(kindRaw) ? kindRaw : "image";
        const resolvedImg = resolveImageValue(
          args.imageUrl,
          db,
          attachedImageDataUrl,
          args.svgCode
        );
        const newBlock: CustomUiBlock = {
          id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          placement,
          kind,
          title: typeof args.title === "string" ? args.title.trim() : "",
          subtitle: typeof args.subtitle === "string" ? args.subtitle.trim() : "",
          imageUrl: resolvedImg || "",
          htmlContent:
            typeof args.htmlContent === "string"
              ? sanitizeSafeHtml(args.htmlContent)
              : "",
          accentColor:
            typeof args.accentColor === "string" && args.accentColor.trim()
              ? args.accentColor.trim()
              : db.siteConfig.primaryColor,
          enabled: args.enabled !== false,
        };
        db.siteConfig.customBlocks.push(newBlock);
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: `নতুন কাস্টম ব্লক (${placement} · ${kind}) যুক্ত হয়েছে।`,
          response: { ok: true, block: { ...newBlock, imageUrl: newBlock.imageUrl ? "[configured]" : "" } },
        };
      }

      const blockId = String(args.blockId || "").trim();
      const targetIdx = db.siteConfig.customBlocks.findIndex((b) => b.id === blockId);
      if (targetIdx === -1) {
        return {
          mutated: false,
          labelBn,
          summary: "নির্দিষ্ট UI ব্লক পাওয়া যায়নি।",
          response: { ok: false },
        };
      }

      if (action === "delete") {
        db.siteConfig.customBlocks.splice(targetIdx, 1);
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: "কাস্টম UI ব্লকটি মুছে ফেলা হয়েছে।",
          response: { ok: true },
        };
      }

      if (action === "update") {
        const blk = db.siteConfig.customBlocks[targetIdx];
        if (typeof args.placement === "string" && VALID_PLACEMENTS.has(args.placement as UiBlockPlacement)) {
          blk.placement = args.placement as UiBlockPlacement;
        }
        if (typeof args.kind === "string" && VALID_KINDS.has(args.kind as CustomUiBlock["kind"])) {
          blk.kind = args.kind as CustomUiBlock["kind"];
        }
        if (typeof args.title === "string") blk.title = args.title.trim();
        if (typeof args.subtitle === "string") blk.subtitle = args.subtitle.trim();
        const resolvedImg = resolveImageValue(
          args.imageUrl,
          db,
          attachedImageDataUrl,
          args.svgCode
        );
        if (resolvedImg !== undefined) blk.imageUrl = resolvedImg;
        if (typeof args.htmlContent === "string") {
          blk.htmlContent = sanitizeSafeHtml(args.htmlContent);
        }
        if (typeof args.accentColor === "string" && args.accentColor.trim()) {
          blk.accentColor = args.accentColor.trim();
        }
        if (typeof args.enabled === "boolean") blk.enabled = args.enabled;
        saveDb(db);
        return {
          mutated: true,
          labelBn,
          summary: "কাস্টম UI ব্লকটি হালনাগাদ হয়েছে।",
          response: { ok: true },
        };
      }

      return { mutated: false, labelBn, summary: "অজানা UI ব্লক অ্যাকশন।", response: { ok: false } };
    }

    case "update_ai_assistant_settings": {
      const cfg: AiAssistantConfig = db.aiAssistantConfig || {
        ...DEFAULT_AI_ASSISTANT_CONFIG,
      };
      if (typeof args.assistantName === "string" && args.assistantName.trim()) {
        cfg.assistantName = args.assistantName.trim();
      }
      if (typeof args.personaRole === "string" && args.personaRole.trim()) {
        cfg.personaRole = args.personaRole.trim();
      }
      if (typeof args.customInstructions === "string") {
        cfg.customInstructions = args.customInstructions.trim();
      }
      if (typeof args.autoApplyEdits === "boolean") {
        cfg.autoApplyEdits = args.autoApplyEdits;
      }
      if (typeof args.enableVoiceInput === "boolean") {
        cfg.enableVoiceInput = args.enableVoiceInput;
      }
      if (typeof args.preferredTone === "string" && args.preferredTone.trim()) {
        cfg.preferredTone = args.preferredTone.trim();
      }
      if (args.reasoningDepth === "deep" || args.reasoningDepth === "balanced") {
        cfg.reasoningDepth = args.reasoningDepth;
      }
      if (Array.isArray(args.quickCommands)) {
        cfg.quickCommands = (args.quickCommands as unknown[])
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 8);
      }
      db.aiAssistantConfig = cfg;
      saveDb(db);
      return {
        mutated: true,
        labelBn,
        summary: "এআই অ্যাসিস্ট্যান্টের নিজস্ব সেটিংস হালনাগাদ হয়েছে।",
        response: { ok: true, aiAssistantConfig: cfg },
      };
    }

    default:
      return {
        mutated: false,
        labelBn,
        summary: "অজানা টুল।",
        response: { ok: false, error: `Unknown tool ${toolName}` },
      };
  }
}

export interface AssistantTurnInput {
  message: string;
  history: { role: "user" | "assistant"; text: string }[];
  currentUser: StoredUser;
  attachedImageDataUrl?: string;
}

export interface AssistantTurnResult {
  reply: string;
  actions: AiAssistantActionLog[];
  pendingProposals: AiAssistantPendingProposal[];
  snapshotId?: string;
  mutated: boolean;
}

export async function runAdminAssistantTurn(
  ai: GoogleGenAI,
  input: AssistantTurnInput
): Promise<AssistantTurnResult> {
  const db = getDb();
  const cfg = db.aiAssistantConfig || DEFAULT_AI_ASSISTANT_CONFIG;

  const systemInstruction = [
    `আপনার নাম: "${cfg.assistantName}". আপনার ভূমিকা: ${cfg.personaRole}.`,
    `পছন্দনীয় ভাষা ও সুর: ${cfg.preferredTone}.`,
    `অ্যাডমিনের কাস্টম নির্দেশনাবলি: ${cfg.customInstructions || "সর্বদা প্রমিত বাংলায় পরিষ্কার উত্তর দিন।"}`,
    "",
    "আপনি এই সফটওয়্যারের সিনিয়র সফটওয়্যার ইঞ্জিনিয়ার ও পূর্ণ-ক্ষমতাসম্পন্ন ডিপ-কাস্টমাইজেশন ইঞ্জিন।",
    "অ্যাডমিন বাংলা, বাংলিশ বা ইংরেজিতে যেকোনো কমান্ড দিলে—সেটি ছোট রঙ/লেখা পরিবর্তন হোক বা হোম পেজ/ড্যাশবোর্ডে ছবি, ব্যবহারকারীর প্রোফাইল ছবি, লাইভ বাংলা সময় ও তারিখ, ডাইনামিক UI ব্লক/কার্ড, নতুন বিভাগ ও টেমপ্লেট, ইউজার রোল/অনুমতি, প্লাগইন তৈরি, কিংবা ডিপ CSS রিডিজাইন হোক—আপনি সিনিয়র ইঞ্জিনিয়ারের মতো চিন্তা করে নির্ভুলভাবে বাস্তবায়ন করবেন।",
    "",
    "সফটওয়্যারের প্রকৃত UI, ছবি, সময় ও ডিজাইন আর্কিটেকচার:",
    "- সেকশন সিলেক্টর: `[data-section=\"app-announcement\"]`, `[data-section=\"app-header\"]`, `[data-section=\"login-card\"]`, `[data-section=\"dashboard-hero\"]`, `[data-section=\"dashboard-widgets\"]`, `[data-section=\"dashboard-shortcuts\"]`, `[data-section=\"dashboard-saved\"]`, `[data-section=\"editor-controls\"]`, `[data-section=\"editor-preview\"]`, `[data-section=\"templates-header\"]`, `[data-section=\"templates-grid\"]`, `[data-section=\"saved-letters-header\"]`, `[data-section=\"saved-letters-list\"]`, `[data-section=\"org-profile-header\"]`, `[data-section=\"app-footer\"]`",
    "- লাইভ সময় ও তারিখ: `update_site_config` টুলে `showLiveClock: true` করলে হোম পেজ (লগইন পাতা) ও ড্যাশবোর্ডে রিয়েল-টাইম বাংলা সময় ও তারিখ চালু হয়; অথবা `manage_ui_block` (`kind: \"clock\"`) দিয়ে নির্দিষ্ট পজিশনে বসানো যায়।",
    "- ব্যবহারকারীর ছবি (Avatar): `update_site_config` টুলে `showUserAvatar: true` করলে ড্যাশবোর্ড ও হেডারে ব্যবহারকারীর প্রোফাইল ছবি দেখানো শুরু হয়। নির্দিষ্ট ইউজারের ছবি যোগ করতে `manage_user` (`action: \"update\"`, `userId: \"self\"` বা নির্দিষ্ট আইডি, এবং `avatarUrl` বা `avatarSvgCode`) ব্যবহার করুন।",
    "- হোম পেজ / ড্যাশবোর্ডের ছবি ও ডাইনামিক ব্লক: `update_site_config` টুলে `dashboardBannerUrl` / `loginHeroImageUrl` (অথবা `dashboardBannerSvgCode` / `loginHeroSvgCode`) এবং যেকোনো স্থানে ছবি/কার্ড/ব্যানার/HTML ব্লক যোগ করতে `manage_ui_block` ব্যবহার করুন।",
    (input.attachedImageDataUrl
      ? "- বিশেষ তথ্য: অ্যাডমিন এই বার্তার সাথে একটি আসল ছবি সংযুক্ত করেছেন। ছবিটি যেকোনো জায়গায় বসাতে `avatarUrl`, `dashboardBannerUrl`, `loginHeroImageUrl` বা `imageUrl` ফিল্ডে হুবহু `{{ATTACHED_IMAGE}}` টোকেন দিন।"
      : "- যদি অ্যাডমিন ছবি আপলোড না করেই হোম পেজে বা ড্যাশবোর্ডে/ইউজারের ছবি বসাতে বলেন, তবে কল্পিত বা ভাঙা কোনো বাইরের URL লিখবেন না; বরং পরিচ্ছন্ন, পেশাদার বাংলাদেশি প্রাতিষ্ঠানিক SVG গ্রাফিক/পোর্ট্রেট তৈরি করে `dashboardBannerSvgCode`, `loginHeroSvgCode`, `avatarSvgCode`, অথবা `manage_ui_block.svgCode`-এ প্রদান করুন (অথবা প্রতিষ্ঠানের লোগো চাইলে `org-logo` ব্যবহার করুন)।"),
    "- A4 প্রিন্ট শিট: `.a4-sheet` (প্রিন্ট ঠিক রাখতে স্ক্রিনের ডিজাইন বদলাতে `@media screen { ... }` ব্যবহার করুন, যাতে 210mm x 297mm প্রিন্ট কখনোই ভেঙে না যায়)।",
    "- বর্তমান ওয়েবসাইটের নাম: " + db.siteConfig.websiteName + " | মূল রঙ: " + db.siteConfig.primaryColor + " | পৃষ্ঠের রঙ: " + db.siteConfig.surfaceBgColor,
    `- বর্তমান লাইভ সময়: ${Boolean(db.siteConfig.showLiveClock)} | ব্যবহারকারীর ছবি প্রদর্শন: ${Boolean(db.siteConfig.showUserAvatar)} | কাস্টম UI ব্লক: ${(db.siteConfig.customBlocks || []).length}টি`,
    `- বর্তমান লগইনকৃত অ্যাডমিন: ${input.currentUser.fullName} (userId: ${input.currentUser.userId})`,
    "- বর্তমান বিভাগসমূহ: " + db.departments.map((d) => d.name).join(", "),
    `- মোট টেমপ্লেট: ${db.templates.length}টি, মোট ইউজার: ${db.users.length} জন, মোট প্লাগইন: ${db.plugins.length}টি, সংরক্ষিত পত্র: ${db.letters.length}টি।`,
    "",
    "প্রকৌশল কার্যপ্রণালী (Workflow):",
    "১. ডিপ ডিজাইন, লেখা, ছবি, সময়, টেমপ্লেট বা ইউজার নিয়ে কাজ করার আগে প্রয়োজনে `inspect_ui_architecture` বা `get_system_overview` টুল দিয়ে আসল অবস্থা দেখে নিন।",
    "২. জটিল বা একাধিক উপাদানের নির্দেশনায় (যেমন হোম পেজ/ড্যাশবোর্ডে ছবি + ব্যবহারকারীর ছবি + সময় একসাথে চাওয়া হলে) একসাথে প্রয়োজনীয় সবগুলো টুল সমন্বিতভাবে কল করে পুরো কাজটি সম্পূর্ণ করুন।",
    "৩. যেকোনো UI বাটন, শিরোনাম বা লেবেলের লেখা বদলাতে `update_ui_texts` (এবং মেনুর জন্য `update_site_config.navLabels`); স্টাইল/লেআউট বদলাতে `update_custom_css`; ছবি/সময়/ইউজার কার্ড/কাস্টম HTML কার্ড যোগ করতে `manage_ui_block` ও `update_site_config` ব্যবহার করুন।",
    "৪. " +
      (cfg.autoApplyEdits
        ? "সরাসরি প্রয়োগ মোড (Auto-Execute) চালু আছে: পরিবর্তনের নির্দেশ পেলে সংশ্লিষ্ট টুল কল করুন এবং তা তাৎক্ষণিক কার্যকর হবে।"
        : "অনুমোদন সাপেক্ষ মোড (Proposal Mode) চালু আছে: পরিবর্তনের নির্দেশ পেলে আপনি অবশ্যই সংশ্লিষ্ট ফাংশন টুলগুলো কল করবেন; সিস্টেম স্বয়ংক্রিয়ভাবে সেগুলোকে তাৎক্ষণিক প্রয়োগ না করে অ্যাডমিনের অনুমোদনের প্রস্তাবনা হিসেবে জমা করবে। শুধু টেক্সটে জিজ্ঞেস করে থামবেন না, অবশ্যই টুল কল করুন।"),
    "৫. চিঠি বা টেমপ্লেট লিখতে হলে সর্বদা বাংলাদেশি প্রমিত দাপ্তরিক বাংলা এবং SutonnyMJ-বান্ধব শুদ্ধ পরিভাষা ব্যবহার করবেন।",
    "৬. উত্তর বাংলায় প্রমিত ও স্পষ্টভাবে দিন; কোনো ফাইল পাথ বা অভ্যন্তরীণ সিস্টেম আইডি উল্লেখ না করে কী কী পরিবর্তন করা হলো তা বুলেট পয়েন্টে গুছিয়ে লিখুন।",
  ].join("\n");

  const contents: Content[] = [];
  const recentHistory = (input.history || []).slice(-10);
  for (const h of recentHistory) {
    if (!h.text?.trim()) continue;
    contents.push({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.text.trim() }],
    });
  }
  const userMessageText = input.attachedImageDataUrl
    ? `${input.message.trim()}\n\n[অ্যাডমিন একটি ছবি সংযুক্ত করেছেন; প্রয়োগ করতে {{ATTACHED_IMAGE}} ব্যবহার করুন।]`
    : input.message.trim();
  contents.push({
    role: "user",
    parts: [{ text: userMessageText }],
  });

  const actions: AiAssistantActionLog[] = [];
  const pendingProposals: AiAssistantPendingProposal[] = [];
  let snapshotId: string | undefined;
  let mutated = false;
  let finalReply = "";

  const MAX_ROUNDS = 12;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const thinkingLevel =
      cfg.reasoningDepth === "balanced" || round >= 2
        ? ThinkingLevel.HIGH
        : ThinkingLevel.XHIGH;
    const response = await generateContentResilient(ai, {
      model: "gemini-4-hydrogen",
      contents,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel },
        tools: [{ functionDeclarations: ADMIN_TOOLS }],
      },
    });

    const candidateContent = response.candidates?.[0]?.content;
    const functionCalls = response.functionCalls;

    if (!functionCalls || functionCalls.length === 0) {
      finalReply = (response.text || "").trim();
      break;
    }

    if (candidateContent) {
      contents.push(candidateContent);
    }

    const responseParts: Part[] = [];
    for (const call of functionCalls) {
      const toolName = call.name || "";
      const args = (call.args || {}) as Record<string, unknown>;
      const isReadOnly = READ_ONLY_TOOLS.has(toolName);

      if (!isReadOnly && !cfg.autoApplyEdits) {
        const labelBn = TOOL_LABELS_BN[toolName] || toolName;
        // Resolve {{ATTACHED_IMAGE}} inside staged proposal args so later Apply works cleanly
        const hydratedArgs: Record<string, unknown> = { ...args };
        if (input.attachedImageDataUrl) {
          for (const k of ["avatarUrl", "dashboardBannerUrl", "loginHeroImageUrl", "imageUrl"]) {
            if (hydratedArgs[k] === "{{ATTACHED_IMAGE}}") {
              hydratedArgs[k] = input.attachedImageDataUrl;
            }
          }
        }
        const proposal: AiAssistantPendingProposal = {
          id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tool: toolName,
          labelBn,
          summary: `${labelBn} পরিবর্তনের প্রস্তাবনা`,
          args: hydratedArgs,
        };
        pendingProposals.push(proposal);
        responseParts.push({
          functionResponse: {
            id: call.id,
            name: toolName,
            response: {
              stagedForApproval: true,
              message: "এই পরিবর্তনটি অ্যাডমিনের অনুমোদনের জন্য প্রস্তাবনা হিসেবে সংযুক্ত করা হয়েছে।",
            },
          },
        });
        continue;
      }

      if (!isReadOnly && !snapshotId) {
        snapshotId = createAiUndoSnapshot(db);
      }

      const outcome = executeAssistantTool(
        db,
        input.currentUser,
        toolName,
        args,
        input.attachedImageDataUrl
      );
      if (outcome.mutated) {
        mutated = true;
      }
      if (!isReadOnly) {
        actions.push({
          tool: toolName,
          labelBn: outcome.labelBn,
          summary: outcome.summary,
        });
      }

      responseParts.push({
        functionResponse: {
          id: call.id,
          name: toolName,
          response: outcome.response,
        },
      });
    }

    contents.push({
      role: "user",
      parts: responseParts,
    });
  }

  if (!finalReply) {
    if (actions.length > 0) {
      finalReply =
        "আপনার নির্দেশনা অনুযায়ী পরিবর্তনসমূহ সফলভাবে কার্যকর করা হয়েছে:\n" +
        actions.map((a) => `• ${a.labelBn}: ${a.summary}`).join("\n");
    } else if (pendingProposals.length > 0) {
      finalReply =
        "আপনার নির্দেশনা অনুযায়ী নিচের পরিবর্তনগুলো প্রস্তাব করা হলো। অনুগ্রহ করে ‘প্রয়োগ করুন’ বোতামে ক্লিক করে নিশ্চিত করুন।";
    } else {
      finalReply = "অনুরোধটি প্রক্রিয়া সম্পন্ন হয়েছে।";
    }
  }

  return {
    reply: finalReply,
    actions,
    pendingProposals,
    snapshotId: mutated ? snapshotId : undefined,
    mutated,
  };
}
