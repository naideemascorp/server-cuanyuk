import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/types";
import { Prisma } from "@prisma/client";
import { Elysia, t } from "elysia";

type CashTransactionRow = {
  id: string;
  status: string;
  cash_type: "CASH_IN" | "CASH_OUT";
  transaction_date: Date;
  order_number: string;
  total_amount: number;
  my_fee_bps: number;
  customer_fee_bps: number;
  merchant_fee_bps: number;
  merchant: { id: string; name: string };
  partner: { id: string; name: string };
};

const clampInt = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const parseIsoDate = (raw: string | null): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
};

const parseBpsFromPercent = (raw: string | number): number => {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error("INVALID_FEE");
  return clampInt(Math.round(n * 100), 0, 10_000);
};

const parseBpsFromPercentOptional = (raw: string | number | undefined): number => {
  if (raw === undefined) return 0;
  return parseBpsFromPercent(raw);
};

const escapeCsv = (v: string) => {
  const needs = /[",\n\r]/.test(v);
  if (!needs) return v;
  return `"${v.replaceAll('"', '""')}"`;
};

const xmlEscape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const bpsAmount = (totalAmount: number, bps: number) => Math.trunc((totalAmount * bps) / 10_000);

const computeGrossProfit = (row: CashTransactionRow) =>
  bpsAmount(row.total_amount, row.my_fee_bps + row.customer_fee_bps);

const computeNetProfit = (row: CashTransactionRow) =>
  bpsAmount(row.total_amount, row.my_fee_bps + row.customer_fee_bps - row.merchant_fee_bps);

const buildPdf = (title: string, lines: string[]) => {
  const textLines = [title, "", ...lines].slice(0, 60);
  const content = [
    "BT",
    "/F1 12 Tf",
    "40 800 Td",
    ...textLines.map(
      (l, idx) =>
        `${idx === 0 ? "" : "0 -14 Td\n"}(${l.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj`,
    ),
    "ET",
  ].join("\n");

  const objects: Array<{ id: number; body: string }> = [];
  objects.push({ id: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" });
  objects.push({ id: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" });
  objects.push({
    id: 3,
    body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  });
  objects.push({ id: 4, body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` });
  objects.push({ id: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" });

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

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(f.data.length),
      u32(f.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    locals.push(localHeader, f.data);

    const centralHeader = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(f.data.length),
      u32(f.data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    centrals.push(centralHeader);
    offset += localHeader.length + f.data.length;
  }

  const centralSize = centrals.reduce((a, b) => a + b.length, 0);
  const centralOffset = offset;
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0),
  ]);

  return concatBytes([...locals, ...centrals, end]);
};

const buildXlsx = (rows: CashTransactionRow[]) => {
  const cols = [
    "Transaction Date",
    "Cash Type",
    "Status",
    "Order Number",
    "Partner",
    "Merchant",
    "Total Amount",
    "My Fee (%)",
    "Customer Fee (%)",
    "Merchant Fee (%)",
    "Gross Profit",
    "Net Profit",
  ];

  const cell = (v: string, t: "s" | "n") =>
    t === "n" ? `<c t="n"><v>${v}</v></c>` : `<c t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`;

  const headerRow = `<row r="1">${cols.map((c) => cell(c, "s")).join("")}</row>`;
  const dataRows = rows
    .slice(0, 20_000)
    .map((r, i) => {
      const gross = computeGrossProfit(r);
      const net = computeNetProfit(r);
      const percent = (bps: number) => (bps / 100).toFixed(2);
      const cells = [
        cell(r.transaction_date.toISOString(), "s"),
        cell(r.cash_type, "s"),
        cell(r.status, "s"),
        cell(r.order_number, "s"),
        cell(r.partner.name, "s"),
        cell(r.merchant.name, "s"),
        cell(String(r.total_amount), "n"),
        cell(percent(r.my_fee_bps), "s"),
        cell(percent(r.customer_fee_bps), "s"),
        cell(percent(r.merchant_fee_bps), "s"),
        cell(String(gross), "n"),
        cell(String(net), "n"),
      ];
      return `<row r="${i + 2}">${cells.join("")}</row>`;
    })
    .join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${headerRow}
    ${dataRows}
  </sheetData>
</worksheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Cash In/Out" sheetId="1" r:id="rId1" />
  </sheets>
</workbook>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" />
</Relationships>`;

  const wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml" />
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />
</Types>`;

  const enc = new TextEncoder();
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(contentTypesXml) },
    { name: "_rels/.rels", data: enc.encode(relsXml) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(wbRelsXml) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml) },
  ]);
};

const buildTransactionsWhere = (
  authUser: AuthUser,
  opts: {
    from: Date | null;
    to: Date | null;
    cashType: "CASH_IN" | "CASH_OUT" | null;
    search: string | null;
    merchantId: string | null;
    partnerId: string | null;
    merchantName: string | null;
    partnerName: string | null;
  },
) => {
  const search = opts.search?.trim() ? opts.search.trim() : null;
  const merchantName = opts.merchantName?.trim() ? opts.merchantName.trim() : null;
  const partnerName = opts.partnerName?.trim() ? opts.partnerName.trim() : null;

  type CashTxWhere = Exclude<
    NonNullable<Parameters<typeof prisma.cashTransaction.findMany>[0]>["where"],
    undefined
  >;

  const where: CashTxWhere = {
    organization_id: authUser.organizationId,
    status: { in: ["ACTIVE", "PENDING"] },
    ...(opts.cashType ? { cash_type: opts.cashType } : {}),
    ...(opts.from || opts.to
      ? {
          transaction_date: {
            ...(opts.from ? { gte: opts.from } : {}),
            ...(opts.to ? { lte: opts.to } : {}),
          },
        }
      : {}),
    ...(opts.merchantId ? { merchant_id: opts.merchantId } : {}),
    ...(opts.partnerId ? { partner_id: opts.partnerId } : {}),
  };

  const or: CashTxWhere[] = [];
  if (search) {
    const n = Number(search.replaceAll(/[^\d]/g, ""));
    or.push(
      { order_number: { contains: search, mode: "insensitive" } },
      { merchant: { name: { contains: search, mode: "insensitive" } } },
      { partner: { name: { contains: search, mode: "insensitive" } } },
    );
    if (Number.isFinite(n) && n > 0) or.push({ total_amount: { equals: Math.trunc(n) } });
  }
  if (merchantName)
    or.push({ merchant: { name: { contains: merchantName, mode: "insensitive" } } });
  if (partnerName) or.push({ partner: { name: { contains: partnerName, mode: "insensitive" } } });

  const mergedWhere: CashTxWhere =
    or.length > 0
      ? {
          AND: [where, { OR: or }],
        }
      : where;
  return mergedWhere;
};

const fetchTransactions = async (
  authUser: AuthUser,
  opts: {
    from: Date | null;
    to: Date | null;
    cashType: "CASH_IN" | "CASH_OUT" | null;
    search: string | null;
    merchantId: string | null;
    partnerId: string | null;
    merchantName: string | null;
    partnerName: string | null;
    take: number;
    skip: number;
  },
) => {
  const mergedWhere = buildTransactionsWhere(authUser, opts);
  const entries = await prisma.cashTransaction.findMany({
    where: mergedWhere,
    orderBy: [{ transaction_date: "desc" }, { created_date: "desc" }],
    take: opts.take,
    skip: opts.skip,
    select: {
      id: true,
      status: true,
      cash_type: true,
      transaction_date: true,
      order_number: true,
      total_amount: true,
      my_fee_bps: true,
      customer_fee_bps: true,
      merchant_fee_bps: true,
      merchant: { select: { id: true, name: true } },
      partner: { select: { id: true, name: true } },
    },
  });

  return entries as CashTransactionRow[];
};

export const cashRoutes = new Elysia({ prefix: "/cash" })
  .get("/partners", async (ctx) => {
    const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
    const partners = await prisma.partner.findMany({
      where: { organization_id: authUser.organizationId, status: "ACTIVE" },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true },
    });
    return { partners };
  })
  .post(
    "/partners",
    async (ctx) => {
      const authUser = (ctx as unknown as { authUser: AuthUser }).authUser;
      const body = ctx.body;
      const set = ctx.set;
      const name = body.name.trim();
      const saved = await prisma.partner.upsert({
        where: { organization_id_name: { organization_id: authUser.organizationId, name } },
        create: {
          organization_id: authUser.organizationId,
          name,
          status: "ACTIVE",
          created_by: authUser.userId,
          updated_by: authUser.userId,
        },
        update: { status: "ACTIVE", updated_by: authUser.userId },
        select: { id: true, name: true },
      });
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
      const cashType =
        q.cashType === "CASH_IN" || q.cashType === "CASH_OUT"
          ? (q.cashType as "CASH_IN" | "CASH_OUT")
          : null;
      const where = buildTransactionsWhere(authUser, {
        from,
        to,
        cashType,
        search: q.search ?? null,
        merchantId: q.merchantId ?? null,
        partnerId: q.partnerId ?? null,
        merchantName: q.merchantName ?? null,
        partnerName: q.partnerName ?? null,
      });
      const [rows, totalCount] = await Promise.all([
        fetchTransactions(authUser, {
          from,
          to,
          cashType,
          search: q.search ?? null,
          merchantId: q.merchantId ?? null,
          partnerId: q.partnerId ?? null,
          merchantName: q.merchantName ?? null,
          partnerName: q.partnerName ?? null,
          take,
          skip,
        }),
        prisma.cashTransaction.count({ where }),
      ]);
      return {
        totalCount,
        entries: rows.map((r) => ({
          id: r.id,
          status: r.status,
          cashType: r.cash_type,
          transactionDate: r.transaction_date.toISOString(),
          orderNumber: r.order_number,
          totalAmount: r.total_amount,
          myFeeBps: r.my_fee_bps,
          customerFeeBps: r.customer_fee_bps,
          merchantFeeBps: r.merchant_fee_bps,
          myFeeAmount: bpsAmount(r.total_amount, r.my_fee_bps),
          customerFeeAmount: bpsAmount(r.total_amount, r.customer_fee_bps),
          merchantFeeAmount: bpsAmount(r.total_amount, r.merchant_fee_bps),
          grossProfit: computeGrossProfit(r),
          grossFeeAmount: computeGrossProfit(r),
          netProfit: computeNetProfit(r),
          customerTotalAmount: r.total_amount + computeGrossProfit(r),
          receiveFromMerchantAmount: r.total_amount - bpsAmount(r.total_amount, r.merchant_fee_bps),
          payToCustomerAmount: r.total_amount - computeGrossProfit(r),
          merchant: r.merchant,
          partner: r.partner,
        })),
      };
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        cashType: t.Optional(t.Union([t.Literal("CASH_IN"), t.Literal("CASH_OUT")])),
        search: t.Optional(t.String()),
        merchantId: t.Optional(t.String()),
        partnerId: t.Optional(t.String()),
        merchantName: t.Optional(t.String()),
        partnerName: t.Optional(t.String()),
        take: t.Optional(t.String()),
        skip: t.Optional(t.String()),
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
      if (!Number.isFinite(transactionDate.getTime())) {
        set.status = 400;
        throw new Error("INVALID_TRANSACTION_DATE");
      }

      const totalAmount = Math.trunc(body.totalAmount);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        set.status = 400;
        throw new Error("INVALID_TOTAL_AMOUNT");
      }

      const saved = await prisma.cashTransaction.create({
        data: {
          organization_id: authUser.organizationId,
          cash_type: body.cashType,
          transaction_date: transactionDate,
          order_number: body.orderNumber.trim(),
          total_amount: totalAmount,
          my_fee_bps: parseBpsFromPercentOptional(body.myFeePercent),
          customer_fee_bps: parseBpsFromPercent(body.customerFeePercent),
          merchant_fee_bps: parseBpsFromPercent(body.merchantFeePercent),
          merchant_id: body.merchantId,
          partner_id: body.partnerId,
          status: body.status === "ACTIVE" ? "ACTIVE" : "PENDING",
          created_by: authUser.userId,
          updated_by: authUser.userId,
        },
        select: { id: true },
      });
      set.status = 201;
      return { id: saved.id };
    },
    {
      body: t.Object({
        cashType: t.Union([t.Literal("CASH_IN"), t.Literal("CASH_OUT")]),
        transactionDate: t.String({ minLength: 10, maxLength: 40 }),
        orderNumber: t.String({ minLength: 2, maxLength: 120 }),
        totalAmount: t.Number(),
        myFeePercent: t.Optional(t.Union([t.Number(), t.String()])),
        customerFeePercent: t.Union([t.Number(), t.String()]),
        merchantFeePercent: t.Union([t.Number(), t.String()]),
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
      if (!Number.isFinite(transactionDate.getTime())) {
        set.status = 400;
        throw new Error("INVALID_TRANSACTION_DATE");
      }

      const totalAmount = Math.trunc(body.totalAmount);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        set.status = 400;
        throw new Error("INVALID_TOTAL_AMOUNT");
      }

      const updated = await prisma.cashTransaction.updateMany({
        where: {
          id,
          organization_id: authUser.organizationId,
          status: { in: ["ACTIVE", "PENDING"] },
        },
        data: {
          cash_type: body.cashType,
          transaction_date: transactionDate,
          order_number: body.orderNumber.trim(),
          total_amount: totalAmount,
          my_fee_bps: parseBpsFromPercentOptional(body.myFeePercent),
          customer_fee_bps: parseBpsFromPercent(body.customerFeePercent),
          merchant_fee_bps: parseBpsFromPercent(body.merchantFeePercent),
          merchant_id: body.merchantId,
          partner_id: body.partnerId,
          status: body.status === "ACTIVE" ? "ACTIVE" : "PENDING",
          updated_by: authUser.userId,
        },
      });

      if (updated.count === 0) {
        set.status = 404;
        throw new Error("NOT_FOUND");
      }
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String({ minLength: 10, maxLength: 60 }) }),
      body: t.Object({
        cashType: t.Union([t.Literal("CASH_IN"), t.Literal("CASH_OUT")]),
        transactionDate: t.String({ minLength: 10, maxLength: 40 }),
        orderNumber: t.String({ minLength: 2, maxLength: 120 }),
        totalAmount: t.Number(),
        myFeePercent: t.Optional(t.Union([t.Number(), t.String()])),
        customerFeePercent: t.Union([t.Number(), t.String()]),
        merchantFeePercent: t.Union([t.Number(), t.String()]),
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
      const group =
        q.group === "datetime" ||
        q.group === "day" ||
        q.group === "week" ||
        q.group === "month" ||
        q.group === "year" ||
        q.group === "all"
          ? q.group
          : "day";
      const from = parseIsoDate(q.from ?? null);
      const to = parseIsoDate(q.to ?? null);

      const bucketExpr =
        group === "all"
          ? Prisma.sql`DATE '1970-01-01'`
          : group === "datetime"
            ? Prisma.sql`date_trunc('hour', ct.transaction_date)`
            : group === "day"
              ? Prisma.sql`date_trunc('day', ct.transaction_date)`
              : group === "week"
                ? Prisma.sql`date_trunc('week', ct.transaction_date)`
                : group === "month"
                  ? Prisma.sql`date_trunc('month', ct.transaction_date)`
                  : Prisma.sql`date_trunc('year', ct.transaction_date)`;

      const whereParts: Prisma.Sql[] = [
        Prisma.sql`ct.organization_id = ${authUser.organizationId}`,
        Prisma.sql`ct.status IN ('ACTIVE','PENDING')`,
      ];
      if (from) whereParts.push(Prisma.sql`ct.transaction_date >= ${from}`);
      if (to) whereParts.push(Prisma.sql`ct.transaction_date <= ${to}`);
      if (q.merchantId) whereParts.push(Prisma.sql`ct.merchant_id = ${q.merchantId}`);
      if (q.partnerId) whereParts.push(Prisma.sql`ct.partner_id = ${q.partnerId}`);

      let combined = whereParts[0];
      for (let i = 1; i < whereParts.length; i++) {
        combined = Prisma.sql`${combined} AND ${whereParts[i]}`;
      }
      const whereSql = Prisma.sql`WHERE ${combined}`;

      const res = await prisma.$queryRaw<
        Array<{
          bucket: Date;
          net_profit: bigint | null;
          gross_profit: bigint | null;
          cash_in: bigint | null;
          cash_out: bigint | null;
          pending_funds: bigint | null;
        }>
      >(Prisma.sql`
        SELECT
          ${bucketExpr} AS bucket,
          SUM((ct.total_amount * (ct.my_fee_bps + ct.customer_fee_bps - ct.merchant_fee_bps)) / 10000) AS net_profit,
          SUM((ct.total_amount * (ct.my_fee_bps + ct.customer_fee_bps)) / 10000) AS gross_profit,
          SUM(CASE WHEN ct.cash_type = 'CASH_IN' THEN ct.total_amount ELSE 0 END) AS cash_in,
          SUM(CASE WHEN ct.cash_type = 'CASH_OUT' THEN ct.total_amount ELSE 0 END) AS cash_out,
          SUM(CASE WHEN ct.status = 'PENDING' THEN ct.total_amount ELSE 0 END) AS pending_funds
        FROM "CashTransaction" ct
        ${whereSql}
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT 400
      `);

      const rows = res.map((r) => ({
        bucket: r.bucket.toISOString(),
        netProfit: Number(r.net_profit ?? 0n),
        grossProfit: Number(r.gross_profit ?? 0n),
        cashIn: Number(r.cash_in ?? 0n),
        cashOut: Number(r.cash_out ?? 0n),
        pendingFunds: Number(r.pending_funds ?? 0n),
      }));

      return { rows };
    },
    {
      query: t.Object({
        group: t.Optional(
          t.Union([
            t.Literal("datetime"),
            t.Literal("day"),
            t.Literal("week"),
            t.Literal("month"),
            t.Literal("year"),
            t.Literal("all"),
          ]),
        ),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        merchantId: t.Optional(t.String()),
        partnerId: t.Optional(t.String()),
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
      const cashType =
        q.cashType === "CASH_IN" || q.cashType === "CASH_OUT"
          ? (q.cashType as "CASH_IN" | "CASH_OUT")
          : null;

      const rows = await fetchTransactions(authUser, {
        from,
        to,
        cashType,
        search: q.search ?? null,
        merchantId: q.merchantId ?? null,
        partnerId: q.partnerId ?? null,
        merchantName: q.merchantName ?? null,
        partnerName: q.partnerName ?? null,
        take: 50_000,
        skip: 0,
      });

      const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
      const baseName = `cash-in-out_${stamp}`;

      if (format === "json") {
        const body = JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            status: r.status,
            cashType: r.cash_type,
            transactionDate: r.transaction_date.toISOString(),
            orderNumber: r.order_number,
            totalAmount: r.total_amount,
            myFeePercent: r.my_fee_bps / 100,
            customerFeePercent: r.customer_fee_bps / 100,
            merchantFeePercent: r.merchant_fee_bps / 100,
            merchant: r.merchant,
            partner: r.partner,
            grossProfit: computeGrossProfit(r),
            netProfit: computeNetProfit(r),
          })),
        );
        return new Response(body, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="${baseName}.json"`,
          },
        });
      }

      if (format === "csv") {
        const header = [
          "transaction_date",
          "cash_type",
          "status",
          "order_number",
          "partner",
          "merchant",
          "total_amount",
          "my_fee_percent",
          "customer_fee_percent",
          "merchant_fee_percent",
          "gross_profit",
          "net_profit",
        ].join(",");
        const body = [
          header,
          ...rows.map((r) => {
            const fields = [
              r.transaction_date.toISOString(),
              r.cash_type,
              r.status,
              r.order_number,
              r.partner.name,
              r.merchant.name,
              String(r.total_amount),
              (r.my_fee_bps / 100).toFixed(2),
              (r.customer_fee_bps / 100).toFixed(2),
              (r.merchant_fee_bps / 100).toFixed(2),
              String(computeGrossProfit(r)),
              String(computeNetProfit(r)),
            ].map((v) => escapeCsv(v));
            return fields.join(",");
          }),
        ].join("\n");
        return new Response(body, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${baseName}.csv"`,
          },
        });
      }

      if (format === "xml") {
        const items = rows
          .map((r) => {
            const gross = computeGrossProfit(r);
            const net = computeNetProfit(r);
            return `  <transaction>
    <id>${xmlEscape(r.id)}</id>
    <transactionDate>${xmlEscape(r.transaction_date.toISOString())}</transactionDate>
    <cashType>${xmlEscape(r.cash_type)}</cashType>
    <status>${xmlEscape(r.status)}</status>
    <orderNumber>${xmlEscape(r.order_number)}</orderNumber>
    <partner>${xmlEscape(r.partner.name)}</partner>
    <merchant>${xmlEscape(r.merchant.name)}</merchant>
    <totalAmount>${r.total_amount}</totalAmount>
    <myFeePercent>${(r.my_fee_bps / 100).toFixed(2)}</myFeePercent>
    <customerFeePercent>${(r.customer_fee_bps / 100).toFixed(2)}</customerFeePercent>
    <merchantFeePercent>${(r.merchant_fee_bps / 100).toFixed(2)}</merchantFeePercent>
    <grossProfit>${gross}</grossProfit>
    <netProfit>${net}</netProfit>
  </transaction>`;
          })
          .join("\n");
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<cashInOut>
${items}
</cashInOut>
`;

        return new Response(body, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "content-disposition": `attachment; filename="${baseName}.xml"`,
          },
        });
      }

      if (format === "pdf") {
        const lines = rows.slice(0, 50).map((r) => {
          const gross = computeGrossProfit(r);
          const net = computeNetProfit(r);
          return `${r.transaction_date.toISOString().slice(0, 19)} ${r.cash_type} ${r.status} ${r.order_number} ${r.partner.name} / ${r.merchant.name} total=${r.total_amount} gross=${gross} net=${net}`;
        });
        const bytes = buildPdf("Cash In/Out Report", lines);
        return new Response(bytes, {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="${baseName}.pdf"`,
          },
        });
      }

      if (format === "xlsx") {
        const bytes = buildXlsx(rows);
        return new Response(bytes, {
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="${baseName}.xlsx"`,
          },
        });
      }

      ctx.set.status = 400;
      throw new Error("INVALID_FORMAT");
    },
    {
      query: t.Object({
        format: t.Union([
          t.Literal("pdf"),
          t.Literal("xlsx"),
          t.Literal("xml"),
          t.Literal("json"),
          t.Literal("csv"),
        ]),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        cashType: t.Optional(t.Union([t.Literal("CASH_IN"), t.Literal("CASH_OUT")])),
        search: t.Optional(t.String()),
        merchantId: t.Optional(t.String()),
        partnerId: t.Optional(t.String()),
        merchantName: t.Optional(t.String()),
        partnerName: t.Optional(t.String()),
      }),
    },
  );
