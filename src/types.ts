export type AppTab =
  | "dashboard"
  | "editor"
  | "templates"
  | "saved"
  | "voice"
  | "organization"
  | "admin";

export type LetterheadStyle = "classic" | "modern" | "archival";

export type LetterFont = "sutonnymj" | "serif" | "sans";

export type OfficeFontMode = "bijoy" | "unicode";

export type CrestType =
  | "academic"
  | "corporate"
  | "heritage"
  | "justice"
  | "tech"
  | "civic";

export type TemplateCategory = string;

export type UserRole = "admin" | "user";

export interface PublicUser {
  id: string;
  userId: string;
  fullName: string;
  designation: string;
  department: string;
  role: UserRole;
  isActive: boolean;
  avatarDataUrl?: string;
  avatarUrl?: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface NavLabelsConfig {
  dashboard: string;
  editor: string;
  templates: string;
  saved: string;
  voice?: string;
  organization: string;
  admin: string;
}

export interface CustomNavLink {
  id: string;
  label: string;
  url: string;
}

export type UiBlockPlacement =
  | "login-top"
  | "login-bottom"
  | "dashboard-top"
  | "dashboard-hero-side"
  | "dashboard-hero-right"
  | "dashboard-after-shortcuts"
  | "dashboard-bottom"
  | "header-right";

export type UiBlockKind =
  | "clock"
  | "user-profile"
  | "user-card"
  | "image-banner"
  | "image"
  | "info-card"
  | "notice"
  | "html-card";

export interface CustomUiBlock {
  id: string;
  kind: UiBlockKind;
  placement: UiBlockPlacement;
  title: string;
  subtitle?: string;
  content?: string;
  htmlContent?: string;
  imageUrl?: string;
  accentColor?: string;
  ctaLabel?: string;
  ctaTab?: AppTab;
  ctaUrl?: string;
  enabled: boolean;
  createdAt?: string;
}

export interface SiteConfig {
  websiteName: string;
  websiteSubtitle: string;
  footerText: string;
  announcementText: string;
  primaryColor: string;
  surfaceBgColor: string;
  uiFont: "sutonnymj" | "hind" | "tiro" | "serif";
  defaultLetterheadStyle: LetterheadStyle;
  defaultLetterFont: LetterFont;
  navLabels: NavLabelsConfig;
  customLinks: CustomNavLink[];
  customCss: string;
  uiTexts?: Record<string, string>;
  showUserAvatar?: boolean;
  showLiveClock?: boolean;
  dashboardBannerUrl?: string;
  dashboardBannerTitle?: string;
  dashboardBannerCaption?: string;
  loginBannerUrl?: string;
  loginHeroImageUrl?: string;
  loginHeroCaption?: string;
  uiBlocks?: CustomUiBlock[];
  customBlocks?: CustomUiBlock[];
  allowUserOrgEdit: boolean;
  allowUserTemplateCreate: boolean;
  allowAiDrafting: boolean;
  showLoginLogo: boolean;
  adminPasswordChanged: boolean;
}

export interface DepartmentItem {
  id: string;
  name: string;
}

export interface QuickPhrase {
  id: string;
  text: string;
}

export type PluginType =
  | "template-manager"
  | "site-customizer"
  | "department-manager"
  | "backup-manager"
  | "template-access"
  | "branch-pad-designer"
  | "ai-assistant"
  | "dashboard-widget"
  | "letter-snippet"
  | "custom-css";

export type TemplateAccessMode = "department" | "custom" | "all";

export interface UserTemplateAccessRule {
  mode: TemplateAccessMode;
  allowedCategories?: string[];
  allowedTemplateIds?: string[];
}

export interface BranchPadSignatory {
  id: string;
  roleLabel?: string;
  name: string;
  title: string;
  department?: string;
  signatureUrl?: string;
}

export interface BranchPadConfig {
  enabled: boolean;
  branchTitleBn?: string;
  orgNameOverride?: string;
  headerTagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  refPrefix?: string;
  accentColor?: string;
  letterheadStyle?: LetterheadStyle;
  letterFont?: LetterFont;
  logoUrl?: string;
  footerNote?: string;
  signatories: BranchPadSignatory[];
}

export interface PluginConfigData {
  heading?: string;
  content?: string;
  css?: string;
  insertText?: string;
  accentColor?: string;
  enforceDepartmentDefault?: boolean;
  userTemplateRules?: Record<string, UserTemplateAccessRule>;
  branchPads?: Record<string, BranchPadConfig>;
}

export interface SitePlugin {
  id: string;
  name: string;
  description: string;
  type: PluginType;
  enabled: boolean;
  builtIn: boolean;
  config: PluginConfigData;
  createdAt: string;
}

export interface UserUsageProfile {
  templateCounts: Record<string, number>;
  pinnedTemplateIds: string[];
  recentTemplateIds: string[];
}

export interface OrganizationProfile {
  nameBn: string;
  nameEn: string;
  tagline: string;
  regNumber: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  refPrefix: string;
  brandColor: string;
  crestType: CrestType;
  logoDataUrl: string;
  defaultSignatoryName: string;
  defaultSignatoryTitle: string;
  defaultSignatoryDept: string;
  signatureDataUrl: string;
}

export interface LetterData {
  id: string;
  templateType: string;
  refNumber: string;
  dateText: string;
  showBanglaDate: boolean;
  banglaDateText: string;
  recipientPrefix: string;
  recipientName: string;
  recipientTitle: string;
  recipientOrg: string;
  recipientAddress: string;
  subject: string;
  salutation: string;
  body: string;
  closing: string;
  signatoryName: string;
  signatoryTitle: string;
  signatoryDept: string;
  attachments: string;
  ccList: string;
  letterheadStyle: LetterheadStyle;
  letterFont: LetterFont;
  showWatermark: boolean;
  showSealPlaceholder: boolean;
  branchPadDepartment?: string;
}

export interface SavedLetter extends LetterData {
  savedAt: string;
  ownerUserId?: string;
  ownerName?: string;
  department?: string;
}

export interface LetterTemplate {
  id: string;
  title: string;
  category: string;
  summary: string;
  refSuffix: string;
  recipientPrefix: string;
  recipientName: string;
  recipientTitle: string;
  recipientOrg: string;
  recipientAddress: string;
  subject: string;
  salutation: string;
  body: string;
  closing: string;
  attachments: string;
  ccList: string;
}

export interface AiAssistantActionLog {
  tool: string;
  labelBn: string;
  summary: string;
}

export interface AiAssistantPendingProposal {
  id: string;
  tool: string;
  labelBn: string;
  summary: string;
  args: Record<string, unknown>;
}

export interface AiAssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  actions?: AiAssistantActionLog[];
  pendingProposals?: AiAssistantPendingProposal[];
  proposalsResolved?: "applied" | "dismissed";
  snapshotId?: string;
  undone?: boolean;
}

export interface AiAssistantConfig {
  assistantName: string;
  personaRole: string;
  customInstructions: string;
  autoApplyEdits: boolean;
  enableVoiceInput: boolean;
  preferredTone: string;
  reasoningDepth?: "deep" | "balanced";
  quickCommands: string[];
}

export interface WorkspacePayload {
  revision?: number;
  user: PublicUser;
  siteConfig: SiteConfig;
  organization: OrganizationProfile;
  departments: DepartmentItem[];
  templates: LetterTemplate[];
  quickPhrases: QuickPhrase[];
  plugins: SitePlugin[];
  userUsage: UserUsageProfile;
  letters: SavedLetter[];
}

export type LiveVoiceName = "Zephyr" | "Kore" | "Puck" | "Charon" | "Fenrir";

export interface VoiceTranscriptTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface CloudVoiceSession {
  id: string;
  ownerUid: string;
  title: string;
  voiceName: LiveVoiceName;
  turns: VoiceTranscriptTurn[];
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
}
