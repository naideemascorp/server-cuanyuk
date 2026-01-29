import { __testBuildXlsx } from "@/routes/cash";

const rows = [
  {
    id: "1",
    status: "ACTIVE",
    cash_type: "CASH_IN" as const,
    transaction_date: new Date("2026-01-01T10:00:00Z"),
    order_number: "ORD-001",
    total_amount: 123456,
    customer_fee_bps: 250,
    merchant_fee_bps: 50,
    remarks: "hello\u0001world",
    merchant: { id: "m1", name: "Merchant & Co" },
    partner: { id: "p1", name: "Partner <Test>" },
  },
];

const out = __testBuildXlsx(rows);
await Bun.write("./tmp-export.xlsx", out);
console.log(`wrote tmp-export.xlsx (${out.length} bytes)`);
