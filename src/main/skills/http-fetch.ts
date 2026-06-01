export type HttpFetchErrorCode =
  | "timeout"
  | "network-error"
  | "http-error"
  | "rate-limited"
  | "source-too-large"
  | "invalid-json";

export type HttpFetchOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  expectedStatuses?: number[];
  accept?: string;
  githubAuth?: boolean;
};

export class HttpFetchError extends Error {
  readonly code: HttpFetchErrorCode;
  readonly status?: number;
  readonly responseText?: string;
  readonly retryAfter?: string;

  constructor(
    code: HttpFetchErrorCode,
    message: string,
    details: {
      status?: number;
      responseText?: string;
      retryAfter?: string;
    } = {},
  ) {
    super(message);
    this.name = "HttpFetchError";
    this.code = code;
    this.status = details.status;
    this.responseText = details.responseText;
    this.retryAfter = details.retryAfter;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const GITHUB_API_VERSION = "2022-11-28";

export async function fetchText(
  url: string,
  options: HttpFetchOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const expectedStatuses = options.expectedStatuses ?? [200];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: buildHeaders(url, options),
      body: options.body,
      signal: controller.signal,
    });

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new HttpFetchError(
        "source-too-large",
        `Response is larger than the ${maxBytes} byte limit.`,
        {
          status: response.status,
          retryAfter: response.headers.get("retry-after") ?? undefined,
        },
      );
    }

    const responseText = await readCappedResponse(response, maxBytes);
    if (!expectedStatuses.includes(response.status)) {
      const code = classifyStatus(response);
      throw new HttpFetchError(
        code,
        `Request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
        {
          status: response.status,
          responseText,
          retryAfter: response.headers.get("retry-after") ?? undefined,
        },
      );
    }

    return responseText;
  } catch (err) {
    if (err instanceof HttpFetchError) throw err;
    if (isAbortError(err)) {
      throw new HttpFetchError(
        "timeout",
        `Request timed out after ${timeoutMs}ms.`,
      );
    }
    throw new HttpFetchError(
      "network-error",
      (err as Error).message || "Network request failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson<T>(
  url: string,
  options: HttpFetchOptions = {},
): Promise<T> {
  const text = await fetchText(url, {
    ...options,
    accept: options.accept ?? "application/json",
  });

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new HttpFetchError(
      "invalid-json",
      (err as Error).message || "Response was not valid JSON.",
      {
        responseText: text,
      },
    );
  }
}

export async function fetchBytes(
  url: string,
  options: HttpFetchOptions = {},
): Promise<Uint8Array> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const expectedStatuses = options.expectedStatuses ?? [200];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: buildHeaders(url, options),
      body: options.body,
      signal: controller.signal,
    });

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new HttpFetchError(
        "source-too-large",
        `Response is larger than the ${maxBytes} byte limit.`,
        {
          status: response.status,
          retryAfter: response.headers.get("retry-after") ?? undefined,
        },
      );
    }

    const bytes = await readCappedBytes(response, maxBytes);
    if (!expectedStatuses.includes(response.status)) {
      const code = classifyStatus(response);
      throw new HttpFetchError(
        code,
        `Request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
        {
          status: response.status,
          responseText: new TextDecoder().decode(bytes.slice(0, 4096)),
          retryAfter: response.headers.get("retry-after") ?? undefined,
        },
      );
    }

    return bytes;
  } catch (err) {
    if (err instanceof HttpFetchError) throw err;
    if (isAbortError(err)) {
      throw new HttpFetchError(
        "timeout",
        `Request timed out after ${timeoutMs}ms.`,
      );
    }
    throw new HttpFetchError(
      "network-error",
      (err as Error).message || "Network request failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function classifyStatus(
  response: Response,
): "http-error" | "rate-limited" {
  if (
    response.status === 429 ||
    response.headers.get("retry-after") ||
    (response.status === 403 &&
      response.headers.get("x-ratelimit-remaining") === "0")
  ) {
    return "rate-limited";
  }

  return "http-error";
}

function buildHeaders(
  url: string,
  options: HttpFetchOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: options.accept ?? "text/plain, application/json;q=0.9, */*;q=0.8",
    "User-Agent": "Mercury",
    ...options.headers,
  };

  const hostname = safeHostname(url);
  if (hostname === "api.github.com") {
    headers["X-GitHub-Api-Version"] = GITHUB_API_VERSION;
    const token = process.env.GITHUB_TOKEN?.trim();
    if (options.githubAuth !== false && token && !headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  return headers;
}

async function readCappedResponse(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const bytes = await readCappedBytes(response, maxBytes);
  return new TextDecoder().decode(bytes);
}

async function readCappedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new HttpFetchError(
          "source-too-large",
          `Response is larger than the ${maxBytes} byte limit.`,
          {
            status: response.status,
            retryAfter: response.headers.get("retry-after") ?? undefined,
          },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
