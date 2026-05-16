import http from "http";
import https from "https";
import { getModelConfig } from "../config";
import { generateTitle } from "../session-cache";
import { getSessionTitle } from "../sessions";
import { profileRuntimeManager } from "./runtime";
import type { ProfileRuntimeHandle } from "./types";
import {
  type GenerateChatTitleRequest,
  sanitizeChatTitle,
} from "../../shared/chat-metadata";

const TITLE_SYSTEM_PROMPT =
  "Write a concise chat title of 3-7 words. Return only the title, no quotes, no markdown, no punctuation.";
const MAX_TITLE_RESPONSE_BYTES = 8_192;

function fallbackTitle(messages: GenerateChatTitleRequest["messages"]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content || "";
  return sanitizeChatTitle(generateTitle(firstUserMessage)) || generateTitle(firstUserMessage);
}

function compactMessages(
  messages: GenerateChatTitleRequest["messages"],
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((message) => message.content.trim())
    .slice(0, 6)
    .map((message) => ({
      role: message.role === "user" ? "user" : "assistant",
      content: message.content.trim().slice(0, 1_200),
    }));
}

function runtimeMatchesRequest(
  runtime: ProfileRuntimeHandle,
  profile?: string,
): boolean {
  const requestedProfile = profileRuntimeManager.normalizeProfile(profile);
  return (
    runtime.request.profile === requestedProfile &&
    runtime.identity.verified &&
    runtime.identity.actualProfile === requestedProfile
  );
}

function requestModelTitle(
  request: GenerateChatTitleRequest,
  runtime: ProfileRuntimeHandle,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const mc = getModelConfig(request.profile);
    if (!runtime.apiBaseUrl) {
      reject(new Error("Title runtime does not expose an API base URL"));
      return;
    }
    const chatUrl = `${runtime.apiBaseUrl}/v1/chat/completions`;
    const requester = chatUrl.startsWith("https") ? https : http;
    const body = JSON.stringify({
      model: mc.model || "hermes-agent",
      messages: [
        { role: "system", content: TITLE_SYSTEM_PROMPT },
        ...compactMessages(request.messages),
      ],
      stream: false,
      store: false,
      max_tokens: 24,
      metadata: { mercury_internal: "generate-chat-title" },
    });

    const req = requester.request(
      chatUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Mercury-Internal": "generate-chat-title",
          ...(runtime.authHeaders ?? {}),
        },
        timeout: 20_000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk.toString();
          if (Buffer.byteLength(raw, "utf8") > MAX_TITLE_RESPONSE_BYTES) {
            req.destroy(new Error("Title response exceeded size limit"));
          }
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Title request failed with ${res.statusCode}`));
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            const content = parsed.choices?.[0]?.message?.content;
            if (typeof content !== "string") {
              reject(new Error("Title response did not include content"));
              return;
            }
            resolve(content);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Title request timed out"));
    });
    req.write(body);
    req.end();
  });
}

export async function generateChatTitle(
  request: GenerateChatTitleRequest,
  preparedRuntime?: ProfileRuntimeHandle,
): Promise<string> {
  if (request.sessionId) {
    const existingTitle = getSessionTitle(request.sessionId, request.profile);
    if (existingTitle) return sanitizeChatTitle(existingTitle) || existingTitle;
  }

  const fallback = fallbackTitle(request.messages);
  if (compactMessages(request.messages).length === 0) return fallback;

  try {
    const runtime =
      preparedRuntime ??
      (await profileRuntimeManager.resolveRuntime({
        profile: request.profile,
        purpose: "title",
        sessionId: request.sessionId,
        preferTransport: "api",
      }));
    if (
      (runtime.transport !== "api" && runtime.transport !== "ssh-api") ||
      !runtimeMatchesRequest(runtime, request.profile)
    ) {
      return fallback;
    }
    const modelTitle = sanitizeChatTitle(await requestModelTitle(request, runtime));
    return modelTitle || fallback;
  } catch {
    return fallback;
  }
}
