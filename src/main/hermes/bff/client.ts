import { randomUUID } from "crypto";
import http from "http";
import https from "https";
import type { ClientRequest, IncomingMessage } from "http";
import { URL } from "url";
import type { ProfileRuntimeHandle, RuntimePurpose } from "../types";
import {
  assertVerifiedApiRuntimeHandle,
  type VerifiedApiRuntimeHandle,
} from "../runtime/api-runtime";
import { HermesCapabilitiesBffClient } from "./capabilities";
import { HermesJobsBffClient } from "./jobs";
import { HermesModelsBffClient } from "./models";
import { HermesRunsBffClient } from "./runs";
import { HermesSessionsBffClient } from "./sessions";
import { recordHermesBffDiagnostic } from "./diagnostics";
import {
  errorMessage,
  HermesBffError,
  responsePreview,
  type HermesBffErrorCode,
} from "./errors";
import type {
  HermesBffClientDeps,
  HermesBffFamily,
  HermesBffHttpMethod,
  HermesBffJsonRequest,
  HermesBffSseRequest,
  JsonRecord,
} from "./types";

const DEFAULT_TIMEOUT_MS = 20_000;
const HEALTH_TIMEOUT_MS = 5_000;
const TRANSIENT_STATUSES = new Set([408, 502, 503, 504]);
const SAFE_METHODS = new Set<HermesBffHttpMethod>(["GET"]);

interface AttemptResult {
  statusCode: number;
  raw: string;
}

interface DiagnosticRequestShape {
  family: HermesBffFamily;
  path: string;
  runId?: string;
  sessionId?: string;
  jobId?: string;
}

export interface HermesDetailedHealthPayload extends JsonRecord {
  status?: string;
  platform?: string;
  gateway_state?: string;
  platforms?: unknown;
  active_agents?: number;
  exit_reason?: string | null;
  updated_at?: string;
  pid?: number;
}

export class ProfileHermesBffClient {
  readonly profile: string;
  readonly apiBaseUrl: string;
  readonly transport: "api" | "ssh-api";
  readonly runs: HermesRunsBffClient;
  readonly sessions: HermesSessionsBffClient;
  readonly jobs: HermesJobsBffClient;
  readonly models: HermesModelsBffClient;
  readonly capabilities: HermesCapabilitiesBffClient;

  private readonly runtime: VerifiedApiRuntimeHandle;
  private readonly deps: Required<HermesBffClientDeps>;

  constructor(runtime: VerifiedApiRuntimeHandle, deps: HermesBffClientDeps = {}) {
    this.runtime = runtime;
    this.profile = runtime.request.profile;
    this.apiBaseUrl = runtime.apiBaseUrl.replace(/\/+$/, "");
    this.transport = runtime.transport;
    this.deps = {
      requestId: deps.requestId ?? randomUUID,
      now: deps.now ?? Date.now,
    };
    this.runs = new HermesRunsBffClient(this);
    this.sessions = new HermesSessionsBffClient(this);
    this.jobs = new HermesJobsBffClient(this);
    this.models = new HermesModelsBffClient(this);
    this.capabilities = new HermesCapabilitiesBffClient(this);
  }

  async json<T = JsonRecord>(options: HermesBffJsonRequest): Promise<T> {
    const requestId = options.requestId ?? this.deps.requestId();
    const expectedStatuses = options.expectedStatuses ?? [200];
    const retryPolicy = options.retry ?? (options.method === "GET" ? "transient-once" : "none");
    let retryCount = 0;

    for (;;) {
      const startedAt = this.deps.now();
      try {
        const result = await this.requestJsonAttempt(options, requestId, retryCount);
        if (!expectedStatuses.includes(result.statusCode)) {
          throw this.errorForStatus(options, requestId, result, retryCount);
        }
        const parsed = result.raw.trim() ? parseJson<T>(result.raw) : ({} as T);
        this.recordDiagnostic(options, options.method, requestId, retryCount, startedAt, true, {
          statusCode: result.statusCode,
        });
        return parsed;
      } catch (error) {
        const bffError =
          error instanceof SyntaxError
            ? this.makeError(
                "invalid-json",
                `Hermes BFF ${options.method} ${options.path} returned invalid JSON.`,
                options,
                requestId,
                retryCount,
                { cause: error, retryable: false },
              )
            : this.toBffError(error, options, requestId, retryCount);
        this.recordDiagnostic(options, options.method, requestId, retryCount, startedAt, false, {
          statusCode: bffError.statusCode,
          errorCode: bffError.code,
          errorMessage: bffError.message,
          responsePreview: bffError.responsePreview,
        });
        if (await this.shouldRetry(options, retryPolicy, bffError, retryCount)) {
          retryCount += 1;
          continue;
        }
        throw bffError;
      }
    }
  }

  async sse<T = unknown>(options: HermesBffSseRequest<T>): Promise<void> {
    const requestId = options.requestId ?? this.deps.requestId();
    const method = options.method ?? "GET";
    const startedAt = this.deps.now();
    const url = this.urlFor(options.path);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let aborted = false;
      let timedOut = false;
      let buffer = "";
      let pending = Promise.resolve();

      const fail = (error: unknown, statusCode?: number, raw?: string): void => {
        if (settled) return;
        settled = true;
        const bffError =
          error instanceof HermesBffError
            ? error
            : this.makeError(
                aborted ? "aborted" : timedOut ? "timeout" : "sse-error",
                aborted
                  ? `Hermes BFF ${method} ${options.path} was aborted.`
                  : timedOut
                    ? `Hermes BFF ${method} ${options.path} timed out.`
                    : `Hermes BFF ${method} ${options.path} stream failed: ${errorMessage(error)}`,
                { ...options, method, expectedStatuses: [200] },
                requestId,
                0,
                {
                  cause: error,
                  statusCode,
                  responsePreview: raw ? responsePreview(raw) : undefined,
                  retryable: false,
                },
              );
        this.recordDiagnostic(options, method, requestId, 0, startedAt, false, {
          statusCode: bffError.statusCode,
          errorCode: bffError.code,
          errorMessage: bffError.message,
          responsePreview: bffError.responsePreview,
        });
        reject(bffError);
      };

      const req = this.request(
        url,
        {
          method,
          headers: this.headersFor({
            accept: "text/event-stream",
            requestId,
            extra: options.headers,
          }),
        },
        (res) => {
          if (res.statusCode !== 200) {
            readResponse(res).then((raw) => {
              fail(
                this.makeError(
                  "http-error",
                  `Hermes BFF ${method} ${options.path} failed with HTTP ${res.statusCode ?? "unknown"}.`,
                  { ...options, method, expectedStatuses: [200] },
                  requestId,
                  0,
                  {
                    statusCode: res.statusCode,
                    responsePreview: responsePreview(raw),
                    retryable: false,
                  },
                ),
                res.statusCode,
                raw,
              );
            }, fail);
            return;
          }

          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            if (settled) return;
            buffer += chunk;
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
              try {
                const event = parseSseBlock<T>(block);
                if (event === undefined) continue;
                pending = pending.then(() => options.onEvent(event));
                pending.catch((error) => {
                  req.destroy();
                  fail(error);
                });
              } catch (error) {
                req.destroy();
                fail(error);
                return;
              }
            }
          });
          res.on("end", () => {
            if (settled) return;
            try {
              const tail = parseSseBlock<T>(buffer);
              if (tail !== undefined) pending = pending.then(() => options.onEvent(tail));
            } catch (error) {
              fail(error);
              return;
            }
            pending.then(
              () => {
                if (settled) return;
                settled = true;
                this.recordDiagnostic(options, method, requestId, 0, startedAt, true, {
                  statusCode: res.statusCode,
                });
                resolve();
              },
              fail,
            );
          });
        },
      );

      options.setActiveRequest?.(req);
      const cleanupActive = (): void => options.setActiveRequest?.(undefined);
      req.on("close", cleanupActive);
      req.on("error", (error) => {
        fail(error);
      });
      if (options.timeoutMs !== undefined) {
        req.setTimeout(options.timeoutMs, () => {
          timedOut = true;
          req.destroy(new Error("Hermes BFF SSE request timed out."));
        });
      }

      const abort = (): void => {
        aborted = true;
        req.destroy(new Error("Hermes BFF SSE request aborted."));
      };
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
      req.on("close", () => options.signal?.removeEventListener("abort", abort));
      req.end();
    });
  }

  async health(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<boolean> {
    try {
      await this.json({
        family: "health",
        method: "GET",
        path: "/health",
        expectedStatuses: [200],
        timeoutMs: options.timeoutMs ?? HEALTH_TIMEOUT_MS,
        signal: options.signal,
        retry: "none",
      });
      return true;
    } catch {
      return false;
    }
  }

  detailedHealth(
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<HermesDetailedHealthPayload> {
    return this.json<HermesDetailedHealthPayload>({
      family: "health",
      method: "GET",
      path: "/health/detailed",
      expectedStatuses: [200],
      timeoutMs: options.timeoutMs ?? HEALTH_TIMEOUT_MS,
      signal: options.signal,
      retry: "none",
    });
  }

  private async requestJsonAttempt(
    options: HermesBffJsonRequest,
    requestId: string,
    retryCount: number,
  ): Promise<AttemptResult> {
    const url = this.urlFor(options.path);
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);

    try {
      return await new Promise<AttemptResult>((resolve, reject) => {
        let aborted = false;
        let timedOut = false;
        const req = this.request(
          url,
          {
            method: options.method,
            headers: this.headersFor({
              accept: "application/json",
              contentType: body === undefined ? undefined : "application/json",
              requestId,
              extra: options.headers,
            }),
          },
          (res) => {
            readResponse(res).then(
              (raw) => resolve({ statusCode: res.statusCode ?? 0, raw }),
              reject,
            );
          },
        );

        options.setActiveRequest?.(req);
        req.on("close", () => options.setActiveRequest?.(undefined));
        req.on("error", (error) => {
          if (aborted) {
            reject(
              this.makeError("aborted", `Hermes BFF ${options.method} ${options.path} was aborted.`, options, requestId, retryCount, {
                cause: error,
              }),
            );
            return;
          }
          if (timedOut) {
            reject(
              this.makeError("timeout", `Hermes BFF ${options.method} ${options.path} timed out.`, options, requestId, retryCount, {
                cause: error,
                retryable: isSafe(options.method),
              }),
            );
            return;
          }
          reject(
            this.makeError("network-error", `Hermes BFF ${options.method} ${options.path} network error: ${errorMessage(error)}`, options, requestId, retryCount, {
              cause: error,
              retryable: isSafe(options.method),
            }),
          );
        });
        req.setTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => {
          timedOut = true;
          req.destroy(new Error("Hermes BFF request timed out."));
        });
        const abort = (): void => {
          aborted = true;
          req.destroy(new Error("Hermes BFF request aborted."));
        };
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener("abort", abort, { once: true });
        req.on("close", () => options.signal?.removeEventListener("abort", abort));
        if (body !== undefined) req.write(body);
        req.end();
      });

    } catch (error) {
      throw this.toBffError(error, options, requestId, retryCount);
    }
  }

  private request(
    url: URL,
    options: http.RequestOptions,
    callback: (res: IncomingMessage) => void,
  ): ClientRequest {
    const mod = url.protocol === "https:" ? https : http;
    return mod.request(url, options, callback);
  }

  private urlFor(path: string): URL {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return new URL(`${this.apiBaseUrl}${normalizedPath}`);
  }

  private headersFor(args: {
    accept: string;
    requestId: string;
    contentType?: string;
    extra?: Record<string, string>;
  }): Record<string, string> {
    return {
      ...withoutReservedHeaders(args.extra ?? {}),
      Accept: args.accept,
      ...(args.contentType ? { "Content-Type": args.contentType } : {}),
      "X-Mercury-Request-Id": args.requestId,
      ...(this.runtime.authHeaders ?? {}),
    };
  }

  private errorForStatus(
    options: HermesBffJsonRequest,
    requestId: string,
    result: AttemptResult,
    retryCount: number,
  ): HermesBffError {
    return this.makeError(
      "http-error",
      `Hermes BFF ${options.method} ${options.path} failed with HTTP ${result.statusCode}.`,
      options,
      requestId,
      retryCount,
      {
        statusCode: result.statusCode,
        responsePreview: responsePreview(result.raw),
        retryable: isSafe(options.method) && TRANSIENT_STATUSES.has(result.statusCode),
      },
    );
  }

  private makeError(
    code: HermesBffErrorCode,
    message: string,
    options: HermesBffJsonRequest,
    requestId: string,
    _retryCount: number,
    details: {
      statusCode?: number;
      retryable?: boolean;
      responsePreview?: string;
      cause?: unknown;
    } = {},
  ): HermesBffError {
    return new HermesBffError(message, {
      code,
      family: options.family,
      method: options.method,
      path: options.path,
      profile: this.profile,
      requestId,
      statusCode: details.statusCode,
      retryable: details.retryable,
      responsePreview: details.responsePreview,
      cause: details.cause,
    });
  }

  private toBffError(
    error: unknown,
    options: HermesBffJsonRequest,
    requestId: string,
    retryCount: number,
  ): HermesBffError {
    if (error instanceof HermesBffError) return error;
    return this.makeError(
      "network-error",
      `Hermes BFF ${options.method} ${options.path} failed: ${errorMessage(error)}`,
      options,
      requestId,
      retryCount,
      { cause: error, retryable: isSafe(options.method) },
    );
  }

  private async shouldRetry(
    options: HermesBffJsonRequest,
    retryPolicy: string,
    error: HermesBffError,
    retryCount: number,
  ): Promise<boolean> {
    if (retryPolicy !== "transient-once") return false;
    if (retryCount > 0) return false;
    if (!isSafe(options.method)) return false;
    if (options.signal?.aborted) return false;
    if (!error.retryable) return false;
    return this.health({ timeoutMs: HEALTH_TIMEOUT_MS, signal: options.signal });
  }

  private recordDiagnostic(
    options: DiagnosticRequestShape,
    method: string,
    requestId: string,
    retryCount: number,
    startedAt: number,
    ok: boolean,
    details: {
      statusCode?: number;
      errorCode?: HermesBffErrorCode;
      errorMessage?: string;
      responsePreview?: string;
    } = {},
  ): void {
    recordHermesBffDiagnostic({
      scope: "hermes-bff",
      requestId,
      family: options.family,
      method,
      path: options.path,
      profile: this.profile,
      transport: this.transport,
      apiBaseUrl: this.apiBaseUrl,
      runtimeAuthFingerprint: this.runtime.identity.authKeyFingerprint,
      statusCode: details.statusCode,
      ok,
      retryCount,
      durationMs: Math.max(0, this.deps.now() - startedAt),
      errorCode: details.errorCode,
      errorMessage: details.errorMessage,
      responsePreview: details.responsePreview,
      runId: options.runId,
      sessionId: options.sessionId,
      jobId: options.jobId,
      ts: new Date(this.deps.now()).toISOString(),
    });
  }
}

export function profileHermesBffClientForRuntime(
  runtime: ProfileRuntimeHandle,
  expectedProfile: string,
  purpose: RuntimePurpose,
  deps?: HermesBffClientDeps,
): ProfileHermesBffClient {
  assertVerifiedApiRuntimeHandle(runtime, expectedProfile, purpose);
  return new ProfileHermesBffClient(runtime, deps);
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function readResponse(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      raw += chunk;
    });
    res.on("end", () => resolve(raw));
    res.on("error", reject);
  });
}

function parseSseBlock<T>(block: string): T | undefined {
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return undefined;
  try {
    return JSON.parse(data.join("\n")) as T;
  } catch (error) {
    throw new Error(`Hermes BFF SSE event contained invalid JSON: ${errorMessage(error)}`);
  }
}

function withoutReservedHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (
      normalized === "authorization" ||
      normalized === "x-mercury-request-id" ||
      normalized === "accept" ||
      normalized === "content-type"
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function isSafe(method: HermesBffHttpMethod): boolean {
  return SAFE_METHODS.has(method);
}
