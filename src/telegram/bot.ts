import { Bot, InlineKeyboard } from "grammy";
import { config } from "../config";
import { verifyPassword } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { storeUpload } from "../lib/storage";
import { wsRegistry } from "../lib/ws";

type Stage =
  | { kind: "idle" }
  | { kind: "awaiting_password"; organizationId: string; username: string; attempts: number }
  | { kind: "add_category_name"; userId: string; organizationId: string }
  | { kind: "add_merchant_name"; userId: string; organizationId: string }
  | { kind: "add_merchant_choose_category"; userId: string; organizationId: string; name: string }
  | { kind: "post_choose_kind"; userId: string; organizationId: string }
  | { kind: "post_link_merchant_name"; userId: string; organizationId: string }
  | { kind: "post_link_amount"; userId: string; organizationId: string; merchantId: string }
  | { kind: "post_link_expiration"; userId: string; organizationId: string; merchantId: string; totalAmount: number }
  | {
      kind: "post_link_url";
      userId: string;
      organizationId: string;
      merchantId: string;
      totalAmount: number;
      expiration: string;
    }
  | { kind: "post_qris_upload"; userId: string; organizationId: string }
  | { kind: "post_qris_merchant_name"; userId: string; organizationId: string; qrisFilename: string }
  | { kind: "post_qris_amount"; userId: string; organizationId: string; qrisFilename: string; merchantId: string }
  | {
      kind: "post_qris_expiration";
      userId: string;
      organizationId: string;
      qrisFilename: string;
      merchantId: string;
      totalAmount: number;
    };

type LoginSession = { userId: string; organizationId: string; expiresAt: number };

const stages = new Map<number, Stage>();
const logins = new Map<number, LoginSession>();

const isLoggedIn = (telegramId: number) => {
  const session = logins.get(telegramId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    logins.delete(telegramId);
    return null;
  }
  return session;
};

const loggedInKeyboard = () =>
  new InlineKeyboard()
    .text("Add Payment Link/QRIS.", "cmd:post")
    .row()
    .text("add category", "cmd:add-category")
    .row()
    .text("category list", "cmd:category-list")
    .row()
    .text("add merchant", "cmd:add-merchant")
    .row()
    .text("merchant list", "cmd:merchant-list");

const requireLogin = async (telegramId: number) => {
  const session = isLoggedIn(telegramId);
  if (!session) return null;
  return session;
};

const listMerchantsKeyboard = async (organizationId: string, actionPrefix: string) => {
  const merchants = await prisma.merchant.findMany({
    where: { organization_id: organizationId, status: "ACTIVE" },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    take: 40
  });
  const kb = new InlineKeyboard();
  for (const m of merchants) kb.text(m.name, `${actionPrefix}:${m.id}`).row();
  return { kb, merchantsCount: merchants.length };
};

const listCategoriesKeyboard = async (organizationId: string, actionPrefix: string) => {
  const categories = await prisma.category.findMany({
    where: { organization_id: organizationId, status: "ACTIVE" },
    orderBy: [{ name: "asc" }],
    take: 40,
    select: { id: true, name: true }
  });
  const kb = new InlineKeyboard();
  for (const c of categories) kb.text(c.name, `${actionPrefix}:${c.id}`).row();
  return { kb, categoriesCount: categories.length };
};

const expirationKeyboard = (defaultLabel: string) =>
  new InlineKeyboard()
    .text(defaultLabel, "exp:default")
    .row()
    .text("5m", "exp:5m")
    .text("10m", "exp:10m")
    .text("30m", "exp:30m")
    .row()
    .text("1h", "exp:1h")
    .text("12h", "exp:12h")
    .text("1d", "exp:1d")
    .row()
    .text("lifetime", "exp:lifetime");

const parseAmount = (text: string) => {
  const raw = text.replaceAll(/[^\d]/g, "");
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
};

const computeExpiresAt = (expiration: string) => {
  const exp = expiration.trim().toLowerCase();
  if (exp === "lifetime" || exp === "none") return null;
  if (exp.endsWith("m")) return new Date(Date.now() + Number(exp.slice(0, -1)) * 60_000);
  if (exp.endsWith("h")) return new Date(Date.now() + Number(exp.slice(0, -1)) * 3_600_000);
  if (exp.endsWith("d")) return new Date(Date.now() + Number(exp.slice(0, -1)) * 86_400_000);
  return null;
};

export const startTelegramBot = async () => {
  const enabledRaw = (process.env.TELEGRAM_ENABLE ?? "true").trim().toLowerCase();
  const enabled = !["0", "false", "no", "off", "disabled"].includes(enabledRaw);
  if (!enabled) return;
  if (!config.telegramBotToken) return;
  const bot = new Bot(config.telegramBotToken);

  bot.command("start", async (ctx) => {
    await ctx.reply("Type: sign in <username>");
  });

  bot.on("message:text", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const text = ctx.message.text.trim();
    const lower = text.toLowerCase();
    const stage = stages.get(telegramId) ?? { kind: "idle" as const };

    if (lower.startsWith("sign in")) {
      const parts = text.split(/\s+/);
      const username = parts.slice(2).join(" ").trim();
      if (!username) {
        await ctx.reply("Usage: sign in <username>");
        return;
      }
      const org = await prisma.organization.findFirst({ where: { status: "ACTIVE" } });
      if (!org) {
        await ctx.reply("No workspace found. Ask an admin to finish setup.");
        return;
      }
      stages.set(telegramId, {
        kind: "awaiting_password",
        organizationId: org.id,
        username,
        attempts: 0
      });
      await ctx.reply("Enter your password.");
      return;
    }

    if (stage.kind === "awaiting_password") {
      const user = await prisma.user.findFirst({
        where: {
          organization_id: stage.organizationId,
          username: { equals: stage.username, mode: "insensitive" }
        },
        select: { id: true, password_hash: true, status: true, email_verified_at: true, organization_id: true }
      });
      if (!user || user.status !== "ACTIVE" || !user.email_verified_at) {
        stages.delete(telegramId);
        await ctx.reply("Login unavailable. Use the web app to verify your account first.");
        return;
      }

      const ok = await verifyPassword(text, user.password_hash);
      if (!ok) {
        const attempts = stage.attempts + 1;
        if (attempts >= 3) {
          stages.delete(telegramId);
          await ctx.reply("Too many attempts. Contact admin: support@cuanyuk.com");
          return;
        }
        stages.set(telegramId, { ...stage, attempts });
        await ctx.reply(`Wrong password. Try again (${3 - attempts} left).`);
        return;
      }

      try {
        await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
      } catch {}

      logins.set(telegramId, {
        userId: user.id,
        organizationId: user.organization_id,
        expiresAt: Date.now() + 30 * 60 * 1000
      });
      stages.delete(telegramId);

      await prisma.telegramUser.upsert({
        where: { telegram_id: BigInt(telegramId) },
        update: { user_id: user.id, last_login_at: new Date(), updated_by: user.id },
        create: {
          telegram_id: BigInt(telegramId),
          user_id: user.id,
          last_login_at: new Date(),
          created_by: user.id,
          updated_by: user.id,
          status: "ACTIVE"
        }
      });

      await ctx.reply("Signed in. Available commands:", { reply_markup: loggedInKeyboard() });
      return;
    }

    const login = await requireLogin(telegramId);
    if (!login) {
      await ctx.reply("Please sign in first: sign in <username>");
      return;
    }

    if (stage.kind === "idle") {
      if (lower === "add category") {
        stages.set(telegramId, { kind: "add_category_name", userId: login.userId, organizationId: login.organizationId });
        await ctx.reply("Set category name.");
        return;
      }
      if (lower === "category list") {
        const categories = await prisma.category.findMany({
          where: { organization_id: login.organizationId, status: "ACTIVE" },
          orderBy: [{ name: "asc" }],
          take: 80,
          select: { name: true }
        });
        if (categories.length === 0) {
          await ctx.reply("No category yet. Run: add category");
          return;
        }
        await ctx.reply(categories.map((c: { name: string }) => `• ${c.name}`).join("\n"));
        return;
      }
      if (lower === "add merchant") {
        const categoriesCount = await prisma.category.count({
          where: { organization_id: login.organizationId, status: "ACTIVE" }
        });
        if (categoriesCount === 0) {
          await ctx.reply("Create a category first: add category");
          return;
        }
        stages.set(telegramId, { kind: "add_merchant_name", userId: login.userId, organizationId: login.organizationId });
        await ctx.reply("Set merchant name.");
        return;
      }
      if (lower === "merchant list") {
        const merchants = await prisma.merchant.findMany({
          where: { organization_id: login.organizationId, status: "ACTIVE" },
          orderBy: [{ category: "asc" }, { name: "asc" }],
          take: 60
        });
        if (merchants.length === 0) {
          await ctx.reply("No merchant yet. Run: add merchant");
          return;
        }
        const lines = merchants
          .map((m: { category: string; name: string }) => `• ${m.category} — ${m.name}`)
          .join("\n");
        await ctx.reply(lines);
        return;
      }
      if (lower === "post") {
        const merchantsCount = await prisma.merchant.count({
          where: { organization_id: login.organizationId, status: "ACTIVE" }
        });
        if (merchantsCount === 0) {
          await ctx.reply("Create a merchant first: add merchant");
          return;
        }
        stages.set(telegramId, { kind: "post_choose_kind", userId: login.userId, organizationId: login.organizationId });
        await ctx.reply("Choose:", {
          reply_markup: new InlineKeyboard()
            .text("Post Payment Link", "post:link")
            .row()
            .text("Post QRIS", "post:qris")
        });
        return;
      }
    }

    if (stage.kind === "add_category_name") {
      const name = text.trim();
      if (name.length < 2) {
        await ctx.reply("Category name too short.");
        return;
      }
      await prisma.category.upsert({
        where: { organization_id_name: { organization_id: stage.organizationId, name } },
        create: {
          organization_id: stage.organizationId,
          name,
          status: "ACTIVE",
          created_by: stage.userId,
          updated_by: stage.userId
        },
        update: { status: "ACTIVE", updated_by: stage.userId }
      });
      stages.delete(telegramId);
      await ctx.reply("Category added.", { reply_markup: loggedInKeyboard() });
      return;
    }

    if (stage.kind === "add_merchant_name") {
      const name = text.trim();
      if (!name) {
        await ctx.reply("Set merchant name.");
        return;
      }
      const { kb, categoriesCount } = await listCategoriesKeyboard(stage.organizationId, "catpick");
      if (categoriesCount === 0) {
        stages.delete(telegramId);
        await ctx.reply("Create a category first: add category");
        return;
      }
      stages.set(telegramId, {
        kind: "add_merchant_choose_category",
        userId: login.userId,
        organizationId: login.organizationId,
        name
      });
      await ctx.reply("Choose category:", { reply_markup: kb });
      return;
    }

    if (stage.kind === "post_link_merchant_name") {
      const name = text.trim();
      if (!name) {
        await ctx.reply("Enter merchant name.");
        return;
      }
      const existing =
        (await prisma.merchant.findFirst({
          where: { organization_id: stage.organizationId, name: { equals: name, mode: "insensitive" }, status: "ACTIVE" },
          select: { id: true }
        })) ?? null;
      if (!existing?.id) {
        await ctx.reply("Merchant not found. Run: merchant list");
        return;
      }
      const merchantId = existing.id;
      stages.set(telegramId, { kind: "post_link_amount", userId: stage.userId, organizationId: stage.organizationId, merchantId });
      await ctx.reply("Enter payment total amount (numbers only).");
      return;
    }

    if (stage.kind === "post_link_amount") {
      const amount = parseAmount(text);
      if (!amount) {
        await ctx.reply("Invalid amount. Enter numbers only (example: 150000).");
        return;
      }
      stages.set(telegramId, {
        kind: "post_link_expiration",
        userId: stage.userId,
        organizationId: stage.organizationId,
        merchantId: stage.merchantId,
        totalAmount: amount
      });
      await ctx.reply("Set expiration (optional):", { reply_markup: expirationKeyboard("default: 12h") });
      return;
    }

    if (stage.kind === "post_link_url") {
      const expiresAt = computeExpiresAt(stage.expiration || "12h");
      await prisma.paymentItem.create({
        data: {
          organization_id: stage.organizationId,
          merchant_id: stage.merchantId,
          kind: "LINK",
          payment_url: text.trim(),
          total_amount: stage.totalAmount,
          expires_at: expiresAt,
          created_by: stage.userId,
          updated_by: stage.userId,
          status: "ACTIVE"
        }
      });
      stages.delete(telegramId);
      wsRegistry.broadcast({ type: "items:changed" });
      await ctx.reply("Posted payment link.", { reply_markup: loggedInKeyboard() });
      return;
    }

    if (stage.kind === "post_qris_merchant_name") {
      const name = text.trim();
      if (!name) {
        await ctx.reply("Enter merchant name.");
        return;
      }
      const existing =
        (await prisma.merchant.findFirst({
          where: { organization_id: stage.organizationId, name: { equals: name, mode: "insensitive" }, status: "ACTIVE" },
          select: { id: true }
        })) ?? null;
      if (!existing?.id) {
        await ctx.reply("Merchant not found. Run: merchant list");
        return;
      }
      const merchantId = existing.id;
      stages.set(telegramId, {
        kind: "post_qris_amount",
        userId: stage.userId,
        organizationId: stage.organizationId,
        qrisFilename: stage.qrisFilename,
        merchantId
      });
      await ctx.reply("Enter payment total amount (numbers only).");
      return;
    }

    if (stage.kind === "post_qris_amount") {
      const amount = parseAmount(text);
      if (!amount) {
        await ctx.reply("Invalid amount. Enter numbers only (example: 150000).");
        return;
      }
      stages.set(telegramId, {
        kind: "post_qris_expiration",
        userId: stage.userId,
        organizationId: stage.organizationId,
        qrisFilename: stage.qrisFilename,
        merchantId: stage.merchantId,
        totalAmount: amount
      });
      await ctx.reply("Set expiration (optional):", { reply_markup: expirationKeyboard("default: 12h") });
      return;
    }

    await ctx.reply("Use buttons:", { reply_markup: loggedInKeyboard() });
  });

  bot.on("message:photo", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const login = await requireLogin(telegramId);
    if (!login) {
      await ctx.reply("Please sign in first: sign in <username>");
      return;
    }
    const stage = stages.get(telegramId);
    if (!stage || stage.kind !== "post_qris_upload") return;

    const photo = ctx.message.photo.at(-1);
    if (!photo) return;

    const file = await ctx.api.getFile(photo.file_id);
    const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
    const res = await fetch(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const stored = await storeUpload(bytes, ".jpg");

    stages.set(telegramId, {
      kind: "post_qris_merchant_name",
      userId: login.userId,
      organizationId: login.organizationId,
      qrisFilename: stored.filename
    });
    await ctx.reply("Enter merchant name.");
  });

  bot.callbackQuery("cmd:add-merchant", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const login = await requireLogin(telegramId);
    if (!login) {
      await ctx.answerCallbackQuery();
      await ctx.reply("Please sign in first: sign in <username>");
      return;
    }
    await ctx.answerCallbackQuery();
    const categoriesCount = await prisma.category.count({ where: { organization_id: login.organizationId, status: "ACTIVE" } });
    if (categoriesCount === 0) {
      await ctx.reply("Create a category first: add category");
      return;
    }
    stages.set(telegramId, { kind: "add_merchant_name", userId: login.userId, organizationId: login.organizationId });
    await ctx.reply("Set merchant name.");
  });

  bot.callbackQuery("cmd:add-category", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const login = await requireLogin(telegramId);
    if (!login) {
      await ctx.answerCallbackQuery();
      await ctx.reply("Please sign in first: sign in <username>");
      return;
    }
    stages.set(telegramId, { kind: "add_category_name", userId: login.userId, organizationId: login.organizationId });
    await ctx.answerCallbackQuery();
    await ctx.reply("Set category name.");
  });

  bot.callbackQuery("cmd:category-list", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const login = await requireLogin(telegramId);
    if (!login) {
      await ctx.answerCallbackQuery();
      await ctx.reply("Please sign in first: sign in <username>");
      return;
    }
    const categories = await prisma.category.findMany({
      where: { organization_id: login.organizationId, status: "ACTIVE" },
      orderBy: [{ name: "asc" }],
      take: 80,
      select: { name: true }
    });
    await ctx.answerCallbackQuery();
    if (categories.length === 0) {
      await ctx.reply("No category yet. Run: add category");
      return;
    }
    await ctx.reply(categories.map((c: { name: string }) => `• ${c.name}`).join("\n"));
  });

  bot.callbackQuery("cmd:merchant-list", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const login = await requireLogin(telegramId);
    if (!login) {
      await ctx.answerCallbackQuery();
      await ctx.reply("Please sign in first: sign in <username>");
      return;
    }
    const merchants = await prisma.merchant.findMany({
      where: { organization_id: login.organizationId, status: "ACTIVE" },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      take: 60
    });
    await ctx.answerCallbackQuery();
    if (merchants.length === 0) {
      await ctx.reply("No merchant yet. Run: add merchant");
      return;
    }
    const lines = merchants.map((m: { category: string; name: string }) => `• ${m.category} — ${m.name}`).join("\n");
    await ctx.reply(lines);
  });

  bot.callbackQuery("cmd:post", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const login = await requireLogin(telegramId);
    if (!login) {
      await ctx.answerCallbackQuery();
      await ctx.reply("Please sign in first: sign in <username>");
      return;
    }
    stages.set(telegramId, { kind: "post_choose_kind", userId: login.userId, organizationId: login.organizationId });
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Choose:",
      {
        reply_markup: new InlineKeyboard().text("Post Payment Link", "post:link").row().text("Post QRIS", "post:qris")
      }
    );
  });

  bot.callbackQuery("post:link", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const login = await requireLogin(telegramId);
    if (!login) {
      await ctx.answerCallbackQuery();
      await ctx.reply("Please sign in first: sign in <username>");
      return;
    }
    await ctx.answerCallbackQuery();
    const merchantsCount = await prisma.merchant.count({ where: { organization_id: login.organizationId, status: "ACTIVE" } });
    if (merchantsCount === 0) {
      await ctx.reply("Create a merchant first: add merchant");
      return;
    }
    stages.set(telegramId, { kind: "post_link_merchant_name", userId: login.userId, organizationId: login.organizationId });
    await ctx.reply("Enter merchant name.");
  });

  bot.callbackQuery("post:qris", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const login = await requireLogin(telegramId);
    if (!login) {
      await ctx.answerCallbackQuery();
      await ctx.reply("Please sign in first: sign in <username>");
      return;
    }
    await ctx.answerCallbackQuery();
    const merchantsCount = await prisma.merchant.count({ where: { organization_id: login.organizationId, status: "ACTIVE" } });
    if (merchantsCount === 0) {
      await ctx.reply("Create a merchant first: add merchant");
      return;
    }
    stages.set(telegramId, { kind: "post_qris_upload", userId: login.userId, organizationId: login.organizationId });
    await ctx.reply("Upload the QRIS image now.");
  });

  bot.callbackQuery(/^catpick:(.+)$/i, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const login = await requireLogin(telegramId);
    if (!login) return;
    const stage = stages.get(telegramId);
    if (!stage || stage.kind !== "add_merchant_choose_category") {
      await ctx.answerCallbackQuery();
      return;
    }
    const categoryId = ctx.match?.[1] ?? "";
    const category = await prisma.category.findFirst({
      where: { id: categoryId, organization_id: stage.organizationId, status: "ACTIVE" },
      select: { name: true }
    });
    await ctx.answerCallbackQuery();
    if (!category) {
      await ctx.reply("Category not found. Try again.");
      return;
    }
    const merchant = await prisma.merchant.create({
      data: {
        organization_id: stage.organizationId,
        name: stage.name.trim(),
        category: category.name,
        created_by: stage.userId,
        updated_by: stage.userId,
        status: "ACTIVE"
      }
    });
    stages.delete(telegramId);
    await ctx.reply(`Merchant added: ${merchant.name}. Type: merchant list`, { reply_markup: loggedInKeyboard() });
  });

  bot.callbackQuery(/^exp:(.+)$/i, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const login = await requireLogin(telegramId);
    if (!login) return;
    const value = ctx.match?.[1] ?? "default";
    const stage = stages.get(telegramId);
    if (!stage) return;

    if (stage.kind === "post_link_expiration") {
      const expiration = value === "default" ? "12h" : value;
      stages.set(telegramId, {
        kind: "post_link_url",
        userId: stage.userId,
        organizationId: stage.organizationId,
        merchantId: stage.merchantId,
        totalAmount: stage.totalAmount,
        expiration
      });
      await ctx.answerCallbackQuery();
      await ctx.reply("Send the payment link URL.");
      return;
    }

    if (stage.kind === "post_qris_expiration") {
      const expiration = value === "default" ? "12h" : value;
      const expiresAt = computeExpiresAt(expiration);

      await prisma.paymentItem.create({
        data: {
          organization_id: stage.organizationId,
          merchant_id: stage.merchantId,
          kind: "QRIS",
          qris_path: stage.qrisFilename,
          total_amount: stage.totalAmount,
          expires_at: expiresAt,
          status: "ACTIVE",
          created_by: stage.userId,
          updated_by: stage.userId
        }
      });
      stages.delete(telegramId);
      wsRegistry.broadcast({ type: "items:changed" });
      await ctx.answerCallbackQuery();
      await ctx.reply("Posted QRIS.", { reply_markup: loggedInKeyboard() });
      return;
    }

    await ctx.answerCallbackQuery();
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await bot.start();
      return;
    } catch (err) {
      const errorCode = (() => {
        if (!err || typeof err !== "object") return undefined;
        const e = err as Record<string, unknown>;
        if (typeof e.error_code === "number") return e.error_code;
        const nested = e.error;
        if (!nested || typeof nested !== "object") return undefined;
        const n = nested as Record<string, unknown>;
        if (typeof n.error_code === "number") return n.error_code;
        return undefined;
      })();
      if (errorCode === 409) {
        const delayMs = Math.min(15_000, 1_500 + attempt * 750);
        console.warn(`Telegram bot conflict (409). Retrying in ${delayMs}ms…`);
        await sleep(delayMs);
        continue;
      }
      console.error("Telegram bot crashed. Continuing without telegram bot.", err);
      return;
    }
  }

  console.warn("Telegram bot still conflicted after retries. Continuing without telegram bot.");
};
