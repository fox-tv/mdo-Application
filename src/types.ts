export type AppTab = "editor" | "templates" | "saved" | "organization" | "admin";

export type LetterheadStyle = "classic" | "modern" | "archival";

export type LetterFont = "serif" | "sans";

export type CrestType = "academic" | "corporate" | "heritage" | "justice" | "tech" | "civic";

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
  createdAt: string;
  lastLoginAt?: string;
}

export interface NavLabelsConfig {
  editor: string;
  templates: string;
  saved: string;
  organization: string;
  admin: string;
}

export interface CustomNavLink {
  id: string;
  label: string;
  url: string;
}

export interface SiteConfig {
  websiteName: string;
  websiteSubtitle: string;
  footerText: string;
  announcementText: string;
  primaryColor: string;
  surfaceBgColor: string;
  uiFont: "hind" | "tiro" | "serif";
  defaultLetterheadStyle: LetterheadStyle;
  defaultLetterFont: LetterFont;
  navLabels: NavLabelsConfig;
  customLinks: CustomNavLink[];
  customCss: string;
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

export interface WorkspacePayload {
  user: PublicUser;
  siteConfig: SiteConfig;
  organization: OrganizationProfile;
  departments: DepartmentItem[];
  templates: LetterTemplate[];
  quickPhrases: QuickPhrase[];
  letters: SavedLetter[];
}
