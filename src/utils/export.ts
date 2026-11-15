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
      font-family: "Hind Siliguri", system-ui, sans-serif;
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
    <span>এ-৪ প্রিন্ট প্রিভিউ — ১ পেজ প্রস্তুত</span>
    <button type="button" id="mdo-print-btn">এখনই প্রিন্ট করুন</button>
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
  fileNameBase: string
): Promise<void> {
  if (!element) return;

  const cloned = element.cloneNode(true) as HTMLElement;
  await inlineImagesInClone(cloned);

  const html = `
<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40" lang="bn">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(fileNameBase)}</title>
  <style>
    @page { size: A4; margin: 14mm 18mm; }
    body {
      font-family: "Tiro Bangla", "Kalpurush", "Nikosh", "Vrinda", "SolaimanLipi", serif;
      color: #1c1917;
      line-height: 1.65;
      font-size: 11pt;
    }
    p { margin: 0 0 8pt 0; }
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
