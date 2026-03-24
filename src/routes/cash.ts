import { supabase } from "../lib/supabase";
import type { AuthUser } from "../lib/types";
import { Elysia, t } from "elysia";

type CashTransactionRow = {
  id: string;
  status: string;
  cash_type: "CASH_IN" | "CASH_OUT";
  transaction_date: string;
  order_number: string;
  total_amount: number;
  customer_fee_bps: number;
  merchant_fee_bps: number;
  remarks: string | null;
  merchant: { id: string; name: string };
  partner: { id: string; name: string };
};

const clampInt = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const parseIsoDate = (raw: string | null): string | null => {
  if (!raw) return null;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
};

const parseBpsFromPercent = (raw: string | number): number => {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error("INVALID_FEE");
  return clampInt(Math.round(n * 100), 0, 10_000);
};

const escapeCsv = (v: string) => {
  const needs = /[",\n\r]/.test(v);
  if (!needs) return v;
  return `"${v.replaceAll('"', '""')}"`;
};

const stripXmlControlChars = (s: string) => {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c === 0x9 || c === 0xa || c === 0xd || c >= 0x20) out += s[i];
  }
  return out;
};

const xmlEscape = (s: string) =>
  stripXmlControlChars(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const bpsAmount = (totalAmount: number, bps: number) => Math.trunc((totalAmount * bps) / 10_000);

const computeGrossProfit = (row: CashTransactionRow) =>
  bpsAmount(row.total_amount, row.customer_fee_bps);

const computeNetProfit = (row: CashTransactionRow) =>
  bpsAmount(row.total_amount, row.customer_fee_bps - row.merchant_fee_bps);

const cashTypeLabel = (t: CashTransactionRow["cash_type"]) =>
  t === "CASH_IN" ? "Cash In" : "Cash Out";
const cashStatusLabel = (s: CashTransactionRow["status"]) =>
  s === "ACTIVE" ? "Success" : s === "PENDING" ? "Pending" : s;

const exportAmounts = (row: CashTransactionRow) => {
  const customerFeeAmount = computeGrossProfit(row);
  const merchantFeeAmount = bpsAmount(row.total_amount, row.merchant_fee_bps);
  const netProfit = customerFeeAmount - merchantFeeAmount;
  return {
    customerFeeAmount,
    merchantFeeAmount,
    netProfit,
    receiveFromMerchantAmount: row.total_amount - merchantFeeAmount,
    payToCustomerAmount: row.total_amount - customerFeeAmount,
  };
};

const buildPdf = (title: string, header: string[], rows: string[][]) => {
  const sanitize = (s: string) => s.replaceAll(/[^\x20-\x7e]/g, "?").replaceAll("\n", " ");
  const esc = (s: string) =>
    sanitize(s).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const pageW = 842;
  const pageH = 595;
  const marginX = 24;
  const marginBottom = 22;
  const titleY = pageH - 26;
  const tableTopY = pageH - 56;
  const rowH = 20;
  const headerH = 26;
  const colW = [100, 50, 56, 70, 70, 70, 66, 66, 66, 60, 70, 70];
  const maxTableW = pageW - marginX * 2;
  const tableW = Math.min(maxTableW, colW.reduce((a, b) => a + b, 0));
  const widths = (() => {
    const sum = colW.reduce((a, b) => a + b, 0);
    if (sum <= tableW) return colW;
    const scale = tableW / sum;
    return colW.map((w) => Math.max(50, Math.floor(w * scale)));
  })();
  const fit = (s: string, w: number) => {
    const approxChars = Math.max(6, Math.floor((w - 10) / 5.2));
    const v = s.trim().replaceAll(/\s+/g, " ");
    if (v.length <= approxChars) return v;
    return `${v.slice(0, Math.max(0, approxChars - 3)).trimEnd()}...`;
  };
  const chunkSize = Math.max(1, Math.floor((tableTopY - marginBottom - headerH) / rowH));
  const pages: Array<{ idx: number; data: string[][] }> = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    pages.push({ idx: pages.length + 1, data: rows.slice(i, i + chunkSize) });
  }
  if (pages.length === 0) pages.push({ idx: 1, data: [] });

  const mkPageContent = (pageIdx: number, pageTotal: number, data: string[][]) => {
    const cmds: string[] = [];
    cmds.push("q");
    cmds.push("0.22 0.24 0.28 RG");
    cmds.push("0.45 w");
    cmds.push("BT");
    cmds.push("/F2 16 Tf");
    cmds.push(`1 0 0 1 ${marginX} ${titleY} Tm`);
    cmds.push(`(${esc(title)}) Tj`);
    cmds.push("ET");
    cmds.push("BT");
    cmds.push("/F1 9 Tf");
    cmds.push(`1 0 0 1 ${pageW - marginX - 170} ${titleY} Tm`);
    cmds.push(`(Page ${pageIdx} of ${pageTotal}) Tj`);
    cmds.push("ET");
    const x0 = marginX;
    const y0 = tableTopY;
    const tableH = headerH + data.length * rowH;
    cmds.push("q");
    cmds.push("0.08 0.10 0.14 rg");
    cmds.push(`${x0} ${y0 - headerH} ${tableW} ${headerH} re f`);
    cmds.push("Q");
    for (let r = 0; r < data.length; r++) {
      if (r % 2 === 1) {
        const y = y0 - headerH - (r + 1) * rowH;
        cmds.push("q");
        cmds.push("0.97 0.98 0.99 rg");
        cmds.push(`${x0} ${y} ${tableW} ${rowH} re f`);
        cmds.push("Q");
      }
    }
    cmds.push(`${x0} ${y0 - tableH} ${tableW} ${tableH} re S`);
    let x = x0;
    for (let c = 0; c < widths.length - 1; c++) {
      x += widths[c];
      cmds.push(`${x} ${y0 - tableH} m ${x} ${y0} l S`);
    }
    cmds.push(`${x0} ${y0 - headerH} m ${x0 + tableW} ${y0 - headerH} l S`);
    for (let r = 0; r < data.length; r++) {
      const y = y0 - headerH - (r + 1) * rowH;
      cmds.push(`${x0} ${y} m ${x0 + tableW} ${y} l S`);
    }
    const headerY = y0 - 18;
    let cx = x0;
    cmds.push("0.98 0.99 1 rg");
    for (let i = 0; i < header.length; i++) {
      cmds.push("BT");
      cmds.push("/F2 9 Tf");
      cmds.push(`1 0 0 1 ${cx + 5} ${headerY} Tm`);
      cmds.push(`(${esc(fit(header[i] ?? "", widths[i] ?? 80))}) Tj`);
      cmds.push("ET");
      cx += widths[i] ?? 0;
    }
    cmds.push("0 0 0 rg");
    const rightAlignedCols = new Set([6, 7, 8, 9, 10, 11]);
    for (let r = 0; r < data.length; r++) {
      const row = data[r] ?? [];
      const baseY = y0 - headerH - r * rowH - 15;
      cx = x0;
      for (let c = 0; c < widths.length; c++) {
        const raw = row[c] ?? "";
        const fitted = fit(raw, widths[c] ?? 80);
        const approxCharW = 4.3;
        const textW = fitted.length * approxCharW;
        const tx = rightAlignedCols.has(c) ? cx + (widths[c] ?? 80) - 6 - textW : cx + 5;
        cmds.push("BT");
        cmds.push("/F1 8 Tf");
        cmds.push(`1 0 0 1 ${tx.toFixed(2)} ${baseY} Tm`);
        cmds.push(`(${esc(fitted)}) Tj`);
        cmds.push("ET");
        cx += widths[c] ?? 0;
      }
    }
    cmds.push("Q");
    return cmds.join("\n");
  };

  const objects: Array<{ id: number; body: string }> = [];
  objects.push({ id: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" });
  const kids = pages.map((_, idx) => `${3 + idx * 2} 0 R`).join(" ");
  objects.push({ id: 2, body: `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>` });
  const fontF1Id = 3 + pages.length * 2;
  const fontF2Id = fontF1Id + 1;
  for (let i = 0; i < pages.length; i++) {
    const pageObjId = 3 + i * 2;
    const contentObjId = pageObjId + 1;
    const content = mkPageContent(i + 1, pages.length, pages[i]?.data ?? []);
    objects.push({
      id: pageObjId,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${fontF1Id} 0 R /F2 ${fontF2Id} 0 R >> >> /Contents ${contentObjId} 0 R >>`,
    });
    objects.push({
      id: contentObjId,
      body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    });
  }
  objects.push({ id: fontF1Id, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" });
  objects.push({
    id: fontF2Id,
    body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(out.length);
    out += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
  }
  const xrefStart = out.length;
  out += "xref\n";
  out += `0 ${objects.length + 1}\n`;
  out += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(out);
};

const crc32 = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return (data: Uint8Array) => {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
})();

const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n: number) =>
  new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

const concatBytes = (parts: Uint8Array[]) => {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

const zipStore = (files: Array<{ name: string; data: Uint8Array }>) => {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((Math.floor(now.getSeconds() / 2) & 0x1f) << 0);
  const dosDate =
    ((Math.max(0, now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0xf) << 5) |
    (now.getDate() & 0x1f);
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const localHeader = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(nameBytes.length), u16(0), nameBytes,
    ]);
    locals.push(localHeader, f.data);
    const centralHeader = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(nameBytes.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]);
    centrals.push(centralHeader);
    offset += localHeader.length + f.data.length;
  }
  const centralSize = centrals.reduce((a, b) => a + b.length, 0);
  const centralOffset = offset;
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(centralOffset), u16(0),
  ]);
  return concatBytes([...locals, ...centrals, end]);
};

const buildXlsx = (rows: CashTransactionRow[]) => {
  const cols = ["Date", "Type", "Status", "Order", "Partner", "Merchant", "Base", "Customer Fee", "Merchant Fee", "Net", "From Merchant", "To Customer"];
  const colName = (idx: number) => {
    let n = idx + 1;
    let out = "";
    while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
    return out;
  };
  const cell = (ref: string, v: string, kind: "s" | "n", s: number) => {
    if (kind === "n") return `<c r="${ref}" t="n" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
  };
  const headerRow = `<row r="1">${cols.map((c, i) => cell(`${colName(i)}1`, c, "s", 1)).join("")}</row>`;
  const dataRows = rows.slice(0, 20_000).map((r, i) => {
    const rowNo = i + 2;
    const amounts = exportAmounts(r);
    const txDate = new Date(r.transaction_date);
    const values: Array<{ v: string; kind: "s" | "n"; style: number }> = [
      { v: txDate.toISOString().slice(0, 19).replace("T", " "), kind: "s", style: 2 },
      { v: cashTypeLabel(r.cash_type), kind: "s", style: 2 },
      { v: cashStatusLabel(r.status), kind: "s", style: 2 },
      { v: r.order_number, kind: "s", style: 2 },
      { v: r.partner.name, kind: "s", style: 2 },
      { v: r.merchant.name, kind: "s", style: 2 },
      { v: String(r.total_amount), kind: "n", style: 3 },
      { v: String(amounts.customerFeeAmount), kind: "n", style: 3 },
      { v: String(amounts.merchantFeeAmount), kind: "n", style: 3 },
      { v: String(amounts.netProfit), kind: "n", style: 3 },
      { v: String(amounts.receiveFromMerchantAmount), kind: "n", style: 3 },
      { v: String(amounts.payToCustomerAmount), kind: "n", style: 3 },
    ];
    const cells = values.map((c, idx) => cell(`${colName(idx)}${rowNo}`, c.v, c.kind, c.style));
    return `<row r="${rowNo}">${cells.join("")}</row>`;
  }).join("");
  const colWidths = [20, 10, 12, 18, 18, 22, 14, 14, 14, 14, 18, 18];
  const colsXml = `<cols>${colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1" />`).join("")}</cols>`;
  const lastRow = Math.max(1, Math.min(20_001, rows.length + 1));
  const lastCell = `${colName(cols.length - 1)}${lastRow}`;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n  <dimension ref="A1:${lastCell}"/>\n  <sheetViews><sheetView workbookViewId="0" tabSelected="1"/></sheetViews>\n  <sheetFormatPr defaultRowHeight="15"/>\n  ${colsXml}\n  <sheetData>\n    ${headerRow}\n    ${dataRows}\n  </sheetData>\n  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>\n</worksheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n  <fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="25330"/>\n  <workbookPr defaultThemeVersion="164011"/>\n  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16560"/></bookViews>\n  <sheets><sheet name="Cash In/Out" sheetId="1" r:id="rId1" /></sheets>\n  <calcPr calcId="191029" fullCalcOnLoad="1"/>\n</workbook>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" />\n  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml" />\n  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml" />\n</Relationships>`;
  const wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml" />\n  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml" />\n  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml" />\n</Relationships>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />\n  <Default Extension="xml" ContentType="application/xml" />\n  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml" />\n  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml" />\n  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />\n  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />\n  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" />\n  <Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml" />\n</Types>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n  <numFmts count="0"/>\n  <fonts count="2">\n    <font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>\n    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>\n  </fonts>\n  <fills count="2">\n    <fill><patternFill patternType="none"/></fill>\n    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill>\n  </fills>\n  <borders count="2">\n    <border><left/><right/><top/><bottom/><diagonal/></border>\n    <border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>\n  </borders>\n  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\n  <cellXfs count="4">\n    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>\n    <xf numFmtId="0" fontId="1" fillId="1" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>\n    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>\n    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>\n  </cellXfs>\n  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>\n  <dxfs count="0"/>\n  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>\n</styleSheet>`;
  const themeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">\n  <a:themeElements>\n    <a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>\n    <a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>\n    <a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>\n  </a:themeElements>\n  <a:objectDefaults/>\n  <a:extraClrSchemeLst/>\n</a:theme>`;
  const createdIso = new Date().toISOString();
  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\n  <Application>CuanYuk</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>\n  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>\n  <TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Cash In/Out</vt:lpstr></vt:vector></TitlesOfParts>\n  <Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>\n</Properties>`;
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n  <dc:title>Cash In/Out</dc:title><dc:creator>CuanYuk</dc:creator><cp:lastModifiedBy>CuanYuk</cp:lastModifiedBy>\n  <dcterms:created xsi:type="dcterms:W3CDTF">${createdIso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdIso}</dcterms:modified>\n</cp:coreProperties>`;
  const enc = new TextEncoder();
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(contentTypesXml) },
    { name: "_rels/.rels", data: enc.encode(relsXml) },
    { name: "docProps/app.xml", data: enc.encode(appXml) },
    { name: "docProps/core.xml", data: enc.encode(coreXml) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(wbRelsXml) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml) },
    { name: "xl/styles.xml", data: enc.encode(stylesXml) },
    { name: "xl/theme/theme1.xml", data: enc.encode(themeXml) },
  ]);
};

export const __testBuildXlsx = buildXlsx;

const fetchTransactions = async (
  authUser: AuthUser,
  opts: {
    from: string | null;
    to: string | null;
    cashType: "CASH_IN" | "CASH_OUT" | null;
    status: "ALL" | "ACTIVE" | "PENDING" | "INACTIVE" | "DELETED" | null;
    search: string | null;
    merchantId: string | null;
    partnerId: string | null;
    merchantName: string | null;
    partnerName: string | null;
    take: number;
    skip: number;
  },
): Promise<CashTransactionRow[]> => {
  let query = supabase
    .from("cash_transactions")
    .select("id, status, cash_type, transaction_date, order_number, total_amount, customer_fee_bps, merchant_fee_bps, remarks, merchant_id, partner_id")
    .eq("organization_id", authUser.organizationId)
    .order("transaction_date", { ascending: false })
    .order("created_date", { ascending: false })
    .range(opts.skip, opts.skip + opts.take - 1);

  if (opts.status === "ALL") {

  } else if (opts.status) {
    query = query.eq("status", opts.status);
  } else {
    query = query.in("status", ["ACTIVE", "PENDING"]);
  }
  if (opts.cashType) query = query.eq("cash_type", opts.cashType);
  if (opts.from) query = query.gte("transaction_date", opts.from);
  if (opts.to) query = query.lte("transaction_date", opts.to);
  if (opts.merchantId) query = query.eq("merchant_id", opts.merchantId);
  if (opts.partnerId) query = query.eq("partner_id", opts.partnerId);
  if (opts.search) query = query.ilike("order_number", `%${opts.search}%`);

  const { data: entries } = await query;
  const rows = (entries ?? []) as Array<{
    id: string; status: string; cash_type: "CASH_IN" | "CASH_OUT";
    transaction_date: string; order_number: string; total_amount: number;
    customer_fee_bps: number; merchant_fee_bps: number; remarks: string | null;
    merchant_id: string; partner_id: string;
  }>;


  const merchantIds = [...new Set(rows.map((r) => r.merchant_id))];
  const partnerIds = [...new Set(rows.map((r) => r.partner_id))];
  const [merchantsResult, partnersResult] = await Promise.all([
    merchantIds.length ? supabase.from("merchants").select("id, name").in("id", merchantIds) : { data: [] },
    partnerIds.length ? supabase.from("partners").select("id, name").in("id", partnerIds) : { data: [] },
  ]);
  const merchantMap = new Map((merchantsResult.data ?? []).map((m: { id: string; name: string }) => [m.id, m]));
  const partnerMap = new Map((partnersResult.data ?? []).map((p: { id: string; name: string }) => [p.id, p]));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    cash_type: r.cash_type,
    transaction_date: r.transaction_date,
    order_number: r.order_number,
    total_amount: r.total_amount,
    customer_fee_bps: r.customer_fee_bps,
    merchant_fee_bps: r.merchant_fee_bps,
    remarks: r.remarks,
    merchant: merchantMap.get(r.merchant_id) ?? { id: r.merchant_id, name: "" },
    partner: partnerMap.get(r.partner_id) ?? { id: r.partner_id, name: "" },
  }));
};

export const cashRoutes = new Elysia({ prefix: "/cash" })
  .get("/partners", async (ctx) => {
    const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
    const { data: partners } = await supabase
      .from("partners")
      .select("id, name")
      .eq("organization_id", authUser.organizationId)
      .eq("status", "ACTIVE")
      .order("name", { ascending: true });
    return { partners: partners ?? [] };
  })
  .post(
    "/partners",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const body = ctx.body;
      const set = ctx.set;
      const name = body.name.trim();
      const { data: saved } = await supabase
        .from("partners")
        .upsert(
          {
            organization_id: authUser.organizationId,
            name,
            status: "ACTIVE",
            created_by: authUser.userId,
            updated_by: authUser.userId,
          },
          { onConflict: "organization_id,name" },
        )
        .select("id, name")
        .single();
      set.status = 201;
      return { partner: saved };
    },
    { body: t.Object({ name: t.String({ minLength: 2, maxLength: 120 }) }) },
  )
  .get(
    "/transactions",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const q = ctx.query;
      const from = parseIsoDate(q.from ?? null);
      const to = parseIsoDate(q.to ?? null);
      const take = clampInt(Number(q.take ?? 200), 1, 500);
      const skip = clampInt(Number(q.skip ?? 0), 0, 50_000);
      const cashType = q.cashType === "CASH_IN" || q.cashType === "CASH_OUT" ? q.cashType : null;
      const status = q.status === "ALL" || q.status === "ACTIVE" || q.status === "PENDING" || q.status === "INACTIVE" || q.status === "DELETED" ? q.status : null;

      const rows = await fetchTransactions(authUser, {
        from, to, cashType, status,
        search: q.search ?? null, merchantId: q.merchantId ?? null,
        partnerId: q.partnerId ?? null, merchantName: q.merchantName ?? null,
        partnerName: q.partnerName ?? null, take, skip,
      });


      let countQuery = supabase
        .from("cash_transactions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", authUser.organizationId);
      if (status === "ALL") { /* no filter */ }
      else if (status) countQuery = countQuery.eq("status", status);
      else countQuery = countQuery.in("status", ["ACTIVE", "PENDING"]);
      if (cashType) countQuery = countQuery.eq("cash_type", cashType);
      if (from) countQuery = countQuery.gte("transaction_date", from);
      if (to) countQuery = countQuery.lte("transaction_date", to);
      if (q.merchantId) countQuery = countQuery.eq("merchant_id", q.merchantId);
      if (q.partnerId) countQuery = countQuery.eq("partner_id", q.partnerId);
      if (q.search) countQuery = countQuery.ilike("order_number", `%${q.search}%`);
      const { count: totalCount } = await countQuery;

      return {
        totalCount: totalCount ?? 0,
        entries: rows.map((r) => ({
          id: r.id, status: r.status, cashType: r.cash_type,
          transactionDate: r.transaction_date, orderNumber: r.order_number,
          totalAmount: r.total_amount, customerFeeBps: r.customer_fee_bps,
          merchantFeeBps: r.merchant_fee_bps, remarks: r.remarks,
          customerFeeAmount: bpsAmount(r.total_amount, r.customer_fee_bps),
          merchantFeeAmount: bpsAmount(r.total_amount, r.merchant_fee_bps),
          grossProfit: computeGrossProfit(r), grossFeeAmount: computeGrossProfit(r),
          netProfit: computeNetProfit(r),
          customerTotalAmount: r.total_amount + computeGrossProfit(r),
          receiveFromMerchantAmount: r.total_amount - bpsAmount(r.total_amount, r.merchant_fee_bps),
          payToCustomerAmount: r.total_amount - computeGrossProfit(r),
          merchant: r.merchant, partner: r.partner,
        })),
      };
    },
    {
      query: t.Object({
        from: t.Optional(t.String()), to: t.Optional(t.String()),
        cashType: t.Optional(t.Union([t.Literal("CASH_IN"), t.Literal("CASH_OUT")])),
        search: t.Optional(t.String()), merchantId: t.Optional(t.String()),
        partnerId: t.Optional(t.String()), merchantName: t.Optional(t.String()),
        partnerName: t.Optional(t.String()),
        status: t.Optional(t.Union([t.Literal("ALL"), t.Literal("ACTIVE"), t.Literal("PENDING"), t.Literal("INACTIVE"), t.Literal("DELETED")])),
        take: t.Optional(t.String()), skip: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/transactions",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const body = ctx.body;
      const set = ctx.set;
      const transactionDate = new Date(body.transactionDate);
      if (!Number.isFinite(transactionDate.getTime())) { set.status = 400; throw new Error("INVALID_TRANSACTION_DATE"); }
      const totalAmount = Math.trunc(body.totalAmount);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) { set.status = 400; throw new Error("INVALID_TOTAL_AMOUNT"); }
      const remarks = (() => { const raw = body.remarks ?? null; if (raw == null) return null; const v = raw.trim(); return v ? v : null; })();
      const { data: saved } = await supabase
        .from("cash_transactions")
        .insert({
          organization_id: authUser.organizationId, cash_type: body.cashType,
          transaction_date: transactionDate.toISOString(), order_number: body.orderNumber.trim(),
          total_amount: totalAmount, customer_fee_bps: parseBpsFromPercent(body.customerFeePercent),
          merchant_fee_bps: parseBpsFromPercent(body.merchantFeePercent), remarks,
          merchant_id: body.merchantId, partner_id: body.partnerId,
          status: body.status === "ACTIVE" ? "ACTIVE" : "PENDING",
          created_by: authUser.userId, updated_by: authUser.userId,
        })
        .select("id")
        .single();
      set.status = 201;
      return { id: saved?.id };
    },
    {
      body: t.Object({
        cashType: t.Union([t.Literal("CASH_IN"), t.Literal("CASH_OUT")]),
        transactionDate: t.String({ minLength: 10, maxLength: 40 }),
        orderNumber: t.String({ minLength: 2, maxLength: 120 }),
        totalAmount: t.Number(),
        customerFeePercent: t.Union([t.Number(), t.String()]),
        merchantFeePercent: t.Union([t.Number(), t.String()]),
        remarks: t.Optional(t.String({ maxLength: 800 })),
        merchantId: t.String({ minLength: 10, maxLength: 60 }),
        partnerId: t.String({ minLength: 10, maxLength: 60 }),
        status: t.Optional(t.Union([t.Literal("PENDING"), t.Literal("ACTIVE")])),
      }),
    },
  )
  .post(
    "/transactions/:id",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const body = ctx.body;
      const set = ctx.set;
      const id = ctx.params.id;
      const transactionDate = new Date(body.transactionDate);
      if (!Number.isFinite(transactionDate.getTime())) { set.status = 400; throw new Error("INVALID_TRANSACTION_DATE"); }
      const totalAmount = Math.trunc(body.totalAmount);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) { set.status = 400; throw new Error("INVALID_TOTAL_AMOUNT"); }
      const remarks = (() => { const raw = body.remarks ?? null; if (raw == null) return null; const v = raw.trim(); return v ? v : null; })();
      const { data: updated } = await supabase
        .from("cash_transactions")
        .update({
          cash_type: body.cashType, transaction_date: transactionDate.toISOString(),
          order_number: body.orderNumber.trim(), total_amount: totalAmount,
          customer_fee_bps: parseBpsFromPercent(body.customerFeePercent),
          merchant_fee_bps: parseBpsFromPercent(body.merchantFeePercent), remarks,
          merchant_id: body.merchantId, partner_id: body.partnerId,
          status: body.status === "ACTIVE" ? "ACTIVE" : "PENDING",
          updated_by: authUser.userId,
        })
        .eq("id", id)
        .eq("organization_id", authUser.organizationId)
        .in("status", ["ACTIVE", "PENDING"])
        .select("id");
      if (!updated || updated.length === 0) { set.status = 404; throw new Error("NOT_FOUND"); }
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String({ minLength: 10, maxLength: 60 }) }),
      body: t.Object({
        cashType: t.Union([t.Literal("CASH_IN"), t.Literal("CASH_OUT")]),
        transactionDate: t.String({ minLength: 10, maxLength: 40 }),
        orderNumber: t.String({ minLength: 2, maxLength: 120 }),
        totalAmount: t.Number(),
        customerFeePercent: t.Union([t.Number(), t.String()]),
        merchantFeePercent: t.Union([t.Number(), t.String()]),
        remarks: t.Optional(t.String({ maxLength: 800 })),
        merchantId: t.String({ minLength: 10, maxLength: 60 }),
        partnerId: t.String({ minLength: 10, maxLength: 60 }),
        status: t.Optional(t.Union([t.Literal("PENDING"), t.Literal("ACTIVE")])),
      }),
    },
  )
  .get(
    "/summary",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const q = ctx.query;
      const group = q.group === "datetime" || q.group === "day" || q.group === "week" || q.group === "month" || q.group === "year" || q.group === "all" ? q.group : "day";
      let from = parseIsoDate(q.from ?? null);
      let to = parseIsoDate(q.to ?? null);
      if (group !== "all" && group !== "datetime" && (!from || !to)) {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        const toWeekStart = (d: Date) => { const day = (d.getDay() + 6) % 7; const out = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); out.setDate(out.getDate() - day); return out; };
        const defaults = group === "day" ? { from: startOfDay, to: endOfDay }
          : group === "week" ? (() => { const s = toWeekStart(now); const e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(23, 59, 59, 999); return { from: s, to: e }; })()
            : group === "month" ? (() => { const s = new Date(now.getFullYear(), now.getMonth(), 1); const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999); return { from: s, to: e }; })()
              : (() => { const s = new Date(now.getFullYear(), 0, 1); const e = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999); return { from: s, to: e }; })();
        from = from ?? defaults.from.toISOString();
        to = to ?? defaults.to.toISOString();
      }

      const { data: res } = await supabase.rpc("cash_summary", {
        p_org_id: authUser.organizationId,
        p_group: group,
        p_from: from ?? null,
        p_to: to ?? null,
        p_merchant_id: q.merchantId ?? null,
        p_partner_id: q.partnerId ?? null,
      });

      const rows = ((res ?? []) as Array<{
        bucket: string; net_profit: number | null; gross_profit: number | null;
        cash_in: number | null; cash_out: number | null; pending_funds: number | null;
      }>).map((r) => ({
        bucket: new Date(r.bucket).toISOString(),
        netProfit: Number(r.net_profit ?? 0),
        grossProfit: Number(r.gross_profit ?? 0),
        cashIn: Number(r.cash_in ?? 0),
        cashOut: Number(r.cash_out ?? 0),
        pendingFunds: Number(r.pending_funds ?? 0),
      }));
      return { rows };
    },
    {
      query: t.Object({
        group: t.Optional(t.Union([t.Literal("datetime"), t.Literal("day"), t.Literal("week"), t.Literal("month"), t.Literal("year"), t.Literal("all")])),
        from: t.Optional(t.String()), to: t.Optional(t.String()),
        merchantId: t.Optional(t.String()), partnerId: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/export",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const q = ctx.query;
      const format = q.format;
      const from = parseIsoDate(q.from ?? null);
      const to = parseIsoDate(q.to ?? null);
      const cashType = q.cashType === "CASH_IN" || q.cashType === "CASH_OUT" ? q.cashType : null;
      const status = q.status === "ALL" || q.status === "ACTIVE" || q.status === "PENDING" || q.status === "INACTIVE" || q.status === "DELETED" ? q.status : null;
      const rows = await fetchTransactions(authUser, {
        from, to, cashType, status, search: q.search ?? null,
        merchantId: q.merchantId ?? null, partnerId: q.partnerId ?? null,
        merchantName: q.merchantName ?? null, partnerName: q.partnerName ?? null,
        take: 50_000, skip: 0,
      });
      const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
      const baseName = `cash-in-out_${stamp}`;
      if (format === "json") {
        const body = JSON.stringify(rows.map((r) => {
          const amounts = exportAmounts(r);
          return { id: r.id, date: new Date(r.transaction_date).toISOString().slice(0, 19).replace("T", " "), type: cashTypeLabel(r.cash_type), status: cashStatusLabel(r.status), orderNumber: r.order_number, partner: r.partner.name, merchant: r.merchant.name, base: r.total_amount, customerFee: amounts.customerFeeAmount, merchantFee: amounts.merchantFeeAmount, net: amounts.netProfit, fromMerchant: amounts.receiveFromMerchantAmount, toCustomer: amounts.payToCustomerAmount };
        }));
        return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${baseName}.json"` } });
      }
      if (format === "csv") {
        const header = ["date", "type", "status", "order_number", "partner", "merchant", "base", "customer_fee", "merchant_fee", "net", "from_merchant", "to_customer"].join(",");
        const body = [header, ...rows.map((r) => {
          const amounts = exportAmounts(r);
          return [new Date(r.transaction_date).toISOString().slice(0, 19).replace("T", " "), cashTypeLabel(r.cash_type), cashStatusLabel(r.status), r.order_number, r.partner.name, r.merchant.name, String(r.total_amount), String(amounts.customerFeeAmount), String(amounts.merchantFeeAmount), String(amounts.netProfit), String(amounts.receiveFromMerchantAmount), String(amounts.payToCustomerAmount)].map(escapeCsv).join(",");
        })].join("\n");
        return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${baseName}.csv"` } });
      }
      if (format === "xml") {
        const items = rows.map((r) => {
          const amounts = exportAmounts(r);
          return `  <transaction>\n    <id>${xmlEscape(r.id)}</id>\n    <date>${xmlEscape(new Date(r.transaction_date).toISOString().slice(0, 19).replace("T", " "))}</date>\n    <type>${xmlEscape(cashTypeLabel(r.cash_type))}</type>\n    <status>${xmlEscape(cashStatusLabel(r.status))}</status>\n    <orderNumber>${xmlEscape(r.order_number)}</orderNumber>\n    <partner>${xmlEscape(r.partner.name)}</partner>\n    <merchant>${xmlEscape(r.merchant.name)}</merchant>\n    <base>${r.total_amount}</base>\n    <customerFee>${amounts.customerFeeAmount}</customerFee>\n    <merchantFee>${amounts.merchantFeeAmount}</merchantFee>\n    <net>${amounts.netProfit}</net>\n    <fromMerchant>${amounts.receiveFromMerchantAmount}</fromMerchant>\n    <toCustomer>${amounts.payToCustomerAmount}</toCustomer>\n  </transaction>`;
        }).join("\n");
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<cashInOut>\n${items}\n</cashInOut>\n`, { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${baseName}.xml"` } });
      }
      if (format === "pdf") {
        const tzOffsetMinutes = (() => { const raw = String((q as { tzOffsetMinutes?: string }).tzOffsetMinutes ?? ""); if (!raw.trim()) return 0; const n = Number.parseInt(raw, 10); return Number.isFinite(n) ? n : 0; })();
        const pad2 = (n: number) => String(n).padStart(2, "0");
        const formatLocal = (d: Date) => { const local = new Date(d.getTime() - tzOffsetMinutes * 60_000); return `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())} ${pad2(local.getHours())}:${pad2(local.getMinutes())}`; };
        const pdfHeader = ["Date", "Type", "Status", "Order", "Partner", "Merchant", "Base", "Cust Fee", "Merch Fee", "Net", "From Merch", "To Cust"];
        const tableRows = rows.slice(0, 400).map((r) => {
          const amounts = exportAmounts(r);
          return [formatLocal(new Date(r.transaction_date)), cashTypeLabel(r.cash_type), cashStatusLabel(r.status), r.order_number, r.partner.name, r.merchant.name, String(r.total_amount), String(amounts.customerFeeAmount), String(amounts.merchantFeeAmount), String(amounts.netProfit), String(amounts.receiveFromMerchantAmount), String(amounts.payToCustomerAmount)];
        });
        const bytes = buildPdf("Cash In/Out Report", pdfHeader, tableRows);
        return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${baseName}.pdf"` } });
      }
      if (format === "xlsx") {
        const bytes = buildXlsx(rows);
        return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${baseName}.xlsx"` } });
      }
      ctx.set.status = 400;
      throw new Error("INVALID_FORMAT");
    },
    {
      query: t.Object({
        format: t.Union([t.Literal("pdf"), t.Literal("xlsx"), t.Literal("xml"), t.Literal("json"), t.Literal("csv")]),
        from: t.Optional(t.String()), to: t.Optional(t.String()),
        tzOffsetMinutes: t.Optional(t.String()),
        cashType: t.Optional(t.Union([t.Literal("CASH_IN"), t.Literal("CASH_OUT")])),
        search: t.Optional(t.String()), merchantId: t.Optional(t.String()),
        partnerId: t.Optional(t.String()), merchantName: t.Optional(t.String()),
        partnerName: t.Optional(t.String()),
        status: t.Optional(t.Union([t.Literal("ALL"), t.Literal("ACTIVE"), t.Literal("PENDING"), t.Literal("INACTIVE"), t.Literal("DELETED")])),
      }),
    },
  );
