import type { LetterData, OfficeFontMode, OrganizationProfile, SavedLetter } from "../types.ts";
import { unicodeToBijoy } from "./bijoy.ts";
import { toBengaliDigits } from "./bengali.ts";

function sanitizeFilename(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\u0980-\u09FFa-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "bangla_letter"
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatOfficeText(text: string, mode: OfficeFontMode): string {
  return mode === "bijoy" ? unicodeToBijoy(text) : text;
}

function convertDomTextNodesToBijoy(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }
  for (const node of textNodes) {
    if (node.nodeValue && node.nodeValue.trim()) {
      node.nodeValue = unicodeToBijoy(node.nodeValue);
    }
  }
}

async function inlineImagesInClone(cloned: HTMLElement): Promise<void> {
  const images = Array.from(cloned.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      try {
        const absoluteUrl = src.startsWith("/") ? `${window.location.origin}${src}` : src;
        const res = await fetch(absoluteUrl);
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        img.setAttribute("src", dataUrl);
      } catch {
        if (src.startsWith("/")) {
          img.setAttribute("src", `${window.location.origin}${src}`);
        }
      }
    })
  );
}

async function renderElementToPng(element: HTMLElement): Promise<string> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const { toPng } = await import("html-to-image");
  const width = element.offsetWidth;
  const height = element.offsetHeight;

  const baseOptions = {
    width,
    height,
    pixelRatio: 2.5,
    backgroundColor: "#ffffff",
    style: {
      margin: "0",
      boxShadow: "none",
    },
  };

  try {
    return await toPng(element, baseOptions);
  } catch {
    return await toPng(element, { ...baseOptions, skipFonts: true });
  }
}

export async function exportLetterToPdf(
  element: HTMLElement | null,
  fileNameBase: string
): Promise<void> {
  if (!element) {
    throw new Error("চিঠির প্রিভিউ পাওয়া যায়নি।");
  }

  const [dataUrl, { jsPDF }] = await Promise.all([
    renderElementToPng(element),
    import("jspdf"),
  ]);

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  pdf.addImage(dataUrl, "PNG", 0, 0, 210, 297, undefined, "FAST");
  pdf.save(`${sanitizeFilename(fileNameBase)}.pdf`);
}

export async function createPrintableHtmlUrl(
  element: HTMLElement | null,
  title: string
): Promise<string> {
  if (!element) {
    throw new Error("চিঠির প্রিভিউ পাওয়া যায়নি।");
  }

  const cloned = element.cloneNode(true) as HTMLElement;
  await inlineImagesInClone(cloned);

  const styleNodes = Array.from(
    document.querySelectorAll('link[rel="stylesheet"], style')
  );
  const headStyles = styleNodes
    .map((node) => {
      if (node.tagName === "LINK") {
        const link = node as HTMLLinkElement;
        const crossAttr = link.crossOrigin
          ? ` crossorigin="${escapeHtml(link.crossOrigin)}"`
          : "";
        return `<link rel="stylesheet" href="${escapeHtml(link.href)}"${crossAttr} />`;
      }
      return `<style>${node.textContent || ""}</style>`;
    })
    .join("\n");

  const safeTitle = escapeHtml(title || "দাপ্তরিক চিঠি প্রিন্ট");

  const html = `<!doctype html>
<html lang="bn">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  ${headStyles}
  <style>
    @page { size: A4 portrait; margin: 0; }
    html, body {
      margin: 0;
      padding: 0;
      background: #f5f4f0;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .print-bar {
      width: 100%;
      background: #1E3A8A;
      color: #ffffff;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: "Hind Siliguri", "Noto Sans Bengali", system-ui, sans-serif;
      font-size: 14px;
      box-sizing: border-box;
    }
    .print-bar button {
      background: #ffffff;
      color: #1E3A8A;
      border: none;
      padding: 7px 16px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
    }
    .sheet-holder {
      margin: 20px auto;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
    }
    @media print {
      html, body {
        background: #ffffff !important;
        display: block !important;
      }
      .print-bar { display: none !important; }
      .sheet-holder {
        margin: 0 !important;
        box-shadow: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <span>এ-৪ মুদ্রণ প্রাকদর্শন — ১ পৃষ্ঠা প্রস্তুত</span>
    <button type="button" id="mdo-print-btn">এখনই মুদ্রণ করুন</button>
  </div>
  <div class="sheet-holder">
    ${cloned.outerHTML}
  </div>
  <script>
    window.addEventListener('DOMContentLoaded', function () {
      var btn = document.getElementById('mdo-print-btn');
      if (btn) {
        btn.addEventListener('click', function () { window.print(); });
      }
    });
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 450);
    });
  </script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  return URL.createObjectURL(blob);
}

export async function exportLetterToWord(
  element: HTMLElement | null,
  fileNameBase: string,
  fontMode: OfficeFontMode = "bijoy"
): Promise<void> {
  if (!element) return;

  const cloned = element.cloneNode(true) as HTMLElement;
  await inlineImagesInClone(cloned);

  if (fontMode === "bijoy") {
    convertDomTextNodesToBijoy(cloned);
  }

  const msoFont = fontMode === "bijoy" ? "SutonnyMJ" : "Noto Serif Bengali";
  const fontStack =
    fontMode === "bijoy"
      ? '"SutonnyMJ", "Times New Roman", serif'
      : '"Noto Serif Bengali", "Tiro Bangla", "Noto Sans Bengali", serif';

  const html = `
<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40" lang="bn">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(fileNameBase)}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page { size: A4; margin: 14mm 18mm; }
    * {
      font-family: ${fontStack} !important;
      mso-ascii-font-family: "${msoFont}";
      mso-hansi-font-family: "${msoFont}";
      mso-bidi-font-family: "${msoFont}";
      mso-cs-font-family: "${msoFont}";
    }
    body {
      font-family: ${fontStack};
      color: #1c1917;
      line-height: 1.65;
      font-size: 13pt;
    }
    p {
      margin: 0 0 8pt 0;
      font-family: ${fontStack};
    }
  </style>
</head>
<body>
  ${cloned.innerHTML}
</body>
</html>`.trim();

  const blob = new Blob(["\ufeff", html], {
    type: "application/msword;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(fileNameBase)}.doc`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportLetterToExcel(
  letter: LetterData,
  org: OrganizationProfile,
  fileNameBase: string,
  fontMode: OfficeFontMode = "bijoy"
): void {
  const f = (val: string) => escapeHtml(formatOfficeText(val || "", fontMode));
  const recipientFull = [
    letter.recipientPrefix ? `${letter.recipientPrefix},` : "",
    letter.recipientName,
    letter.recipientTitle,
    letter.recipientOrg,
    letter.recipientAddress,
  ]
    .filter(Boolean)
    .join(" | ");

  const signatoryFull = [
    letter.signatoryName,
    letter.signatoryTitle,
    letter.signatoryDept,
  ]
    .filter(Boolean)
    .join(" — ");

  const rows: [string, string][] = [
    ["প্রতিষ্ঠানের নাম", org.nameBn],
    ["ঠিকানা ও নিবন্ধন", [org.address, org.regNumber].filter(Boolean).join(" | ")],
    ["পত্রের ধরন", letter.templateType || "দাপ্তরিক পত্র"],
    ["স্মারক নম্বর", letter.refNumber],
    [
      "তারিখ",
      letter.showBanglaDate && letter.banglaDateText
        ? `${letter.dateText} (${letter.banglaDateText})`
        : letter.dateText,
    ],
    ["প্রাপকের বিবরণ", recipientFull],
    ["বিষয়", letter.subject],
    ["সম্বোধন", letter.salutation],
    ["মূল বক্তব্য", letter.body],
    ["সমাপ্তি সম্ভাষণ", letter.closing],
    ["স্বাক্ষরকারী", signatoryFull],
    ["সংযুক্তি", letter.attachments],
    ["অনুলিপি", letter.ccList],
  ];

  const msoFont = fontMode === "bijoy" ? "SutonnyMJ" : "Noto Serif Bengali";
  const fontStack =
    fontMode === "bijoy"
      ? '"SutonnyMJ", "Times New Roman", serif'
      : '"Noto Serif Bengali", "Tiro Bangla", "Noto Sans Bengali", serif';

  const bodyRows = rows
    .map(
      ([label, value]) => `
    <tr>
      <td class="label">${f(label)}</td>
      <td class="val">${f(value).replace(/\n/g, "<br/>")}</td>
    </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40" lang="bn">
<head>
  <meta charset="utf-8" />
  <title>${f(fileNameBase)}</title>
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>Letter_Data</x:Name>
          <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
  <style>
    * {
      font-family: ${fontStack} !important;
      mso-ascii-font-family: "${msoFont}";
      mso-hansi-font-family: "${msoFont}";
      mso-bidi-font-family: "${msoFont}";
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-family: ${fontStack};
      font-size: 13pt;
    }
    th, td {
      border: 1px solid #334155;
      padding: 6px 10px;
      vertical-align: top;
      text-align: left;
      font-family: ${fontStack};
      mso-number-format: "\\@";
    }
    th {
      background-color: #1E3A8A;
      color: #FFFFFF;
      font-weight: bold;
      font-size: 14pt;
    }
    td.label {
      background-color: #F1F5F9;
      font-weight: bold;
      width: 220px;
    }
    td.val {
      width: 540px;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>
        <th colspan="2">${f(org.nameBn)} — ${f("দাপ্তরিক পত্র বিবরণী (SutonnyMJ)")}</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
</body>
</html>`;

  const blob = new Blob(["\ufeff", html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(fileNameBase)}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportSavedLettersToExcel(
  letters: SavedLetter[],
  orgName: string,
  fileNameBase: string,
  fontMode: OfficeFontMode = "bijoy"
): void {
  const f = (val: string) => escapeHtml(formatOfficeText(val || "", fontMode));

  const msoFont = fontMode === "bijoy" ? "SutonnyMJ" : "Noto Serif Bengali";
  const fontStack =
    fontMode === "bijoy"
      ? '"SutonnyMJ", "Times New Roman", serif'
      : '"Noto Serif Bengali", "Tiro Bangla", "Noto Sans Bengali", serif';

  const tableRows = letters
    .map(
      (item, idx) => `
    <tr>
      <td>${f(toBengaliDigits(idx + 1))}</td>
      <td>${f(item.refNumber)}</td>
      <td>${f(item.dateText)}</td>
      <td>${f(item.templateType)}</td>
      <td>${f(item.subject)}</td>
      <td>${f([item.recipientName, item.recipientOrg].filter(Boolean).join(", "))}</td>
      <td>${f(item.signatoryName)}</td>
      <td>${f(item.ownerName || item.ownerUserId || "")}</td>
      <td>${f(item.body)}</td>
    </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40" lang="bn">
<head>
  <meta charset="utf-8" />
  <title>${f(fileNameBase)}</title>
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>Saved_Letters</x:Name>
          <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
  <style>
    * {
      font-family: ${fontStack} !important;
      mso-ascii-font-family: "${msoFont}";
      mso-hansi-font-family: "${msoFont}";
      mso-bidi-font-family: "${msoFont}";
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-family: ${fontStack};
      font-size: 12pt;
    }
    th, td {
      border: 1px solid #334155;
      padding: 6px 8px;
      vertical-align: top;
      text-align: left;
      font-family: ${fontStack};
      mso-number-format: "\\@";
    }
    th {
      background-color: #1E3A8A;
      color: #FFFFFF;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>
        <th colspan="9">${f(orgName)} — ${f("সংরক্ষিত দাপ্তরিক পত্র রেজিস্টার (SutonnyMJ)")}</th>
      </tr>
      <tr>
        <th>${f("ক্রমিক")}</th>
        <th>${f("স্মারক নম্বর")}</th>
        <th>${f("তারিখ")}</th>
        <th>${f("পত্রের ধরন")}</th>
        <th>${f("বিষয়")}</th>
        <th>${f("প্রাপক")}</th>
        <th>${f("স্বাক্ষরকারী")}</th>
        <th>${f("প্রস্তুতকারক")}</th>
        <th>${f("মূল বক্তব্য")}</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
</body>
</html>`;

  const blob = new Blob(["\ufeff", html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(fileNameBase)}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
