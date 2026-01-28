export type ApiCode = "00" | "09" | "99";

export type ApiErrorMessage =
  | {
      what: string;
      why: string;
      how: string;
    }
  | {
      originalCode: string;
      originalMessage: string;
    }
  | Record<string, string>;

export type ApiResponse<T> =
  | { code: "00"; message: string; data?: T }
  | { code: "09"; message: string; data?: T }
  | { code: "99"; message: ApiErrorMessage; data?: T };

export const ok = <T>(data?: T, message = "OK"): ApiResponse<T> => ({
  code: "00",
  message,
  ...(typeof data === "undefined" ? {} : { data }),
});

export const pending = <T>(data?: T, message = "PENDING"): ApiResponse<T> => ({
  code: "09",
  message,
  ...(typeof data === "undefined" ? {} : { data }),
});

export const failBug = (what: string, why: string, how: string): ApiResponse<never> => ({
  code: "99",
  message: { what, why, how },
});

export const failFields = (fields: Record<string, string>): ApiResponse<never> => ({
  code: "99",
  message: fields,
});

export const isApiResponse = (x: unknown): x is ApiResponse<unknown> => {
  if (!x || typeof x !== "object") return false;
  const rec = x as Record<string, unknown>;
  const code = rec.code;
  if (code !== "00" && code !== "09" && code !== "99") return false;
  return "message" in rec;
};
