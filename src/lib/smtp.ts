import net from "node:net";
import tls from "node:tls";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type SocketLike = net.Socket | tls.TLSSocket;

const toBase64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

const writeLine = async (socket: SocketLike, line: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    socket.write(encoder.encode(`${line}\r\n`), (err) => (err ? reject(err) : resolve()));
  });
};

const readResponse = async (socket: SocketLike): Promise<{ code: number; lines: string[] }> => {
  const lines: string[] = [];
  let buffer = "";

  const readLine = async (): Promise<string> => {
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx >= 0) {
        const line = buffer.slice(0, idx + 1);
        buffer = buffer.slice(idx + 1);
        return line.replace(/\r?\n$/, "");
      }
      const chunk = await new Promise<Uint8Array>((resolve, reject) => {
        const onData = (data: Buffer) => {
          cleanup();
          resolve(new Uint8Array(data));
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const onEnd = () => {
          cleanup();
          reject(new Error("SMTP_CONNECTION_CLOSED"));
        };
        const cleanup = () => {
          socket.off("data", onData);
          socket.off("error", onError);
          socket.off("end", onEnd);
        };
        socket.once("data", onData);
        socket.once("error", onError);
        socket.once("end", onEnd);
      });
      buffer += decoder.decode(chunk, { stream: true });
    }
  };

  while (true) {
    const line = await readLine();
    lines.push(line);
    const m = /^(\d{3})([ -])/.exec(line);
    if (!m) continue;
    const code = Number(m[1]);
    const sep = m[2];
    if (sep === " ") return { code, lines };
  }
};

const expect2xx3xx = (res: { code: number; lines: string[] }, label: string) => {
  if (res.code >= 200 && res.code < 400) return;
  throw new Error(`${label}:${res.code}:${res.lines.join(" | ")}`);
};

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
};

export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
};

const extractEmail = (addr: string): string => {
  const match = /<([^>]+)>/.exec(addr);
  return match ? match[1] : addr;
};

const buildMime = (msg: EmailMessage) => {
  const date = new Date().toUTCString();
  const headers = [
    `From: ${msg.from}`,
    `To: ${msg.to}`,
    `Subject: ${msg.subject}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
  ];

  if (msg.html) {
    const boundary = `b_${crypto.randomUUID().replaceAll("-", "")}`;
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      msg.text,
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: 7bit",
      "",
      msg.html,
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  return [
    ...headers,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    msg.text,
    "",
  ].join("\r\n");
};

export const sendSmtpMail = async (smtp: SmtpConfig, msg: EmailMessage): Promise<void> => {
  const implicitTls = smtp.port === 465;
  const socket: SocketLike = implicitTls
    ? tls.connect({ host: smtp.host, port: smtp.port, servername: smtp.host })
    : net.connect({ host: smtp.host, port: smtp.port });

  socket.setTimeout(30_000);

  await new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("secureConnect", onConnect);
      socket.off("error", onError);
    };
    socket.on(implicitTls ? "secureConnect" : "connect", onConnect);
    socket.on("error", onError);
  });

  expect2xx3xx(await readResponse(socket), "SMTP_GREETING");
  await writeLine(socket, "EHLO localhost");
  const ehlo = await readResponse(socket);
  expect2xx3xx(ehlo, "SMTP_EHLO");

  const supportsStartTls = ehlo.lines.some((l) => l.toUpperCase().includes("STARTTLS"));
  if (!implicitTls && supportsStartTls) {
    await writeLine(socket, "STARTTLS");
    expect2xx3xx(await readResponse(socket), "SMTP_STARTTLS");
    const tlsSocket = tls.connect({ socket, servername: smtp.host });
    await new Promise<void>((resolve, reject) => {
      const onSecure = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        tlsSocket.off("secureConnect", onSecure);
        tlsSocket.off("error", onError);
      };
      tlsSocket.on("secureConnect", onSecure);
      tlsSocket.on("error", onError);
    });

    await writeLine(tlsSocket, "EHLO localhost");
    expect2xx3xx(await readResponse(tlsSocket), "SMTP_EHLO_TLS");

    const auth = `\u0000${smtp.user}\u0000${smtp.pass}`;
    await writeLine(tlsSocket, `AUTH PLAIN ${toBase64(auth)}`);
    expect2xx3xx(await readResponse(tlsSocket), "SMTP_AUTH");

    await writeLine(tlsSocket, `MAIL FROM:<${extractEmail(msg.from)}>`);
    expect2xx3xx(await readResponse(tlsSocket), "SMTP_MAIL_FROM");

    await writeLine(tlsSocket, `RCPT TO:<${msg.to}>`);
    expect2xx3xx(await readResponse(tlsSocket), "SMTP_RCPT_TO");

    await writeLine(tlsSocket, "DATA");
    expect2xx3xx(await readResponse(tlsSocket), "SMTP_DATA");

    const mime = buildMime(msg);
    await new Promise<void>((resolve, reject) => {
      tlsSocket.write(encoder.encode(`${mime}\r\n.\r\n`), (err: Error | null | undefined) =>
        err ? reject(err) : resolve(),
      );
    });
    expect2xx3xx(await readResponse(tlsSocket), "SMTP_DATA_END");

    await writeLine(tlsSocket, "QUIT");
    tlsSocket.end();
    return;
  }

  const auth = `\u0000${smtp.user}\u0000${smtp.pass}`;
  await writeLine(socket, `AUTH PLAIN ${toBase64(auth)}`);
  expect2xx3xx(await readResponse(socket), "SMTP_AUTH");

  await writeLine(socket, `MAIL FROM:<${extractEmail(msg.from)}>`);
  expect2xx3xx(await readResponse(socket), "SMTP_MAIL_FROM");

  await writeLine(socket, `RCPT TO:<${msg.to}>`);
  expect2xx3xx(await readResponse(socket), "SMTP_RCPT_TO");

  await writeLine(socket, "DATA");
  expect2xx3xx(await readResponse(socket), "SMTP_DATA");

  const mime = buildMime(msg);
  await new Promise<void>((resolve, reject) => {
    socket.write(encoder.encode(`${mime}\r\n.\r\n`), (err) => (err ? reject(err) : resolve()));
  });
  expect2xx3xx(await readResponse(socket), "SMTP_DATA_END");

  await writeLine(socket, "QUIT");
  socket.end();
};
