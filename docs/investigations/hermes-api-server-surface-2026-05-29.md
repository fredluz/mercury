# Hermes API Server Surface, 2026-05-29

This report maps the updated Hermes local API server in `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py` and cross-references Mercury's current chat integration in `src/main/hermes/chat-api.ts`.

## Executive Summary

Hermes exposes an authenticated aiohttp server, defaulting to `http://127.0.0.1:8642`, with an OpenAI-compatible surface plus Hermes-native resources for sessions, runs, response storage, skills/toolsets, and cron jobs. The route list is registered in `APIServerAdapter.connect()` at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:4052`.

Every endpoint below is authenticated with `Authorization: Bearer <API_SERVER_KEY>` except `GET /health`, `GET /v1/health`, and `GET /health/detailed`. The server now refuses to start without an API key, including loopback binds, at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:4103`.

The single most useful under-used API for Mercury is the structured runs surface: `POST /v1/runs`, `GET /v1/runs/{run_id}/events`, `POST /v1/runs/{run_id}/approval`, and `POST /v1/runs/{run_id}/stop`. It gives Mercury first-class lifecycle, approval, stop, and failure events instead of inferring state from chat-completions SSE.

## Base URL And Configuration

Defaults:

- Base URL: `http://127.0.0.1:8642`
- Host default: `127.0.0.1`
- Port default: `8642`
- OpenAI-compatible base for clients: `http://127.0.0.1:8642/v1`
- Max request body: `10_000_000` bytes
- Chat/Responses SSE keepalive interval: 30 seconds
- Response store capacity: 100 stored responses

Sources: defaults are declared at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:64`; request body cap and keepalive at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:68`; startup log at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:4147`.

Configuration sources:

- Env: `API_SERVER_ENABLED=true` enables the platform.
- Env: `API_SERVER_KEY=<secret>` supplies the bearer token.
- Env: `API_SERVER_HOST`, `API_SERVER_PORT`, `API_SERVER_CORS_ORIGINS`, `API_SERVER_MODEL_NAME` map into `platforms.api_server.extra`.
- Config: `platforms.api_server.extra.key`, `host`, `port`, `cors_origins`, `model_name`.

Source: env-to-config mapping is in `/Users/fredluz/.hermes/hermes-agent/gateway/config.py:1442`; adapter config resolution is in `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:688`.

## Auth And Common Behavior

Auth scheme:

```http
Authorization: Bearer <API_SERVER_KEY>
```

Validation:

- `_check_auth()` extracts `Authorization`, requires a `Bearer ` prefix, strips the token, and compares with `self._api_key` using `hmac.compare_digest()`.
- On failure it returns HTTP 401:

```json
{
  "error": {
    "message": "Invalid API key",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:843`.

Startup hardening:

- `connect()` returns `False` if no key is configured.
- If bound to a network-accessible host, placeholder/weak keys are rejected.
- Port conflict detection probes `127.0.0.1:<port>` and refuses to start if occupied.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:4103`.

Common OpenAI error envelope:

```json
{
  "error": {
    "message": "string",
    "type": "invalid_request_error | server_error | ...",
    "param": "optional string or null",
    "code": "optional string or null"
  }
}
```

Source: `_openai_error()` at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:533`.

Not all older cron endpoints use the OpenAI envelope; several return a flat `{"error": "..."}` string.

Middleware:

- CORS only allows requests with no `Origin` or an explicitly configured origin. Browser preflight with an unallowed origin receives 403.
- Allowed CORS headers: `Authorization`, `Content-Type`, `Idempotency-Key`.
- Body limit rejects oversized `POST`, `PUT`, `PATCH` with HTTP 413 and `code: "body_too_large"`.
- Security headers include CSP, Permissions-Policy, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`.

Sources: CORS at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:502`; body limit at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:545`; security headers at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:561`.

Optional session headers:

- `X-Hermes-Session-Id`: transcript/session continuity. Accepted by `/v1/chat/completions`; echoed on chat/session/responses SSE and JSON responses.
- `X-Hermes-Session-Key`: stable long-term memory scope, independent of transcript ID. Accepted by `/v1/chat/completions`, `/v1/responses`, `/v1/runs`, and session chat endpoints; echoed when present.
- Session header values are capped at 256 chars and reject `\r`, `\n`, and NUL.

Sources: session key parser at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:882`; chat session continuation at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1734`.

Idempotency:

- Non-streaming `/v1/chat/completions` and `/v1/responses` honor `Idempotency-Key`.
- Cached for 5 minutes in memory using a fingerprint of stable request fields.

Source: `_IdempotencyCache` at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:584`; chat usage at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1890`; responses usage at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2936`.

## Endpoint Reference

### GET /health

Auth: none.

Purpose: simple liveness probe.

Response 200:

```json
{
  "status": "ok",
  "platform": "hermes-agent"
}
```

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1023`.

### GET /v1/health

Auth: none.

Purpose: alias for `/health`, registered for `/v1` clients.

Response: same as `/health`.

Source: route registration at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:4054`.

### GET /health/detailed

Auth: none.

Purpose: dashboard-style runtime probe with gateway status.

Response 200:

```json
{
  "status": "ok",
  "platform": "hermes-agent",
  "gateway_state": "string|null",
  "platforms": {},
  "active_agents": 0,
  "exit_reason": "string|null",
  "updated_at": "string|number|null",
  "pid": 12345
}
```

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1027`.

### GET /v1/models

Auth: bearer.

Purpose: model discovery for OpenAI-compatible frontends.

Response 200:

```json
{
  "object": "list",
  "data": [
    {
      "id": "hermes-agent-or-profile-name",
      "object": "model",
      "created": 1710000000,
      "owned_by": "hermes",
      "permission": [],
      "root": "hermes-agent-or-profile-name",
      "parent": null
    }
  ]
}
```

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1048`.

### GET /v1/capabilities

Auth: bearer.

Purpose: machine-readable feature and endpoint discovery.

Response 200:

```json
{
  "object": "hermes.api_server.capabilities",
  "platform": "hermes-agent",
  "model": "hermes-agent",
  "auth": {"type": "bearer", "required": true},
  "runtime": {
    "mode": "server_agent",
    "tool_execution": "server",
    "split_runtime": false,
    "description": "..."
  },
  "features": {
    "chat_completions": true,
    "chat_completions_streaming": true,
    "responses_api": true,
    "responses_streaming": true,
    "run_submission": true,
    "run_status": true,
    "run_events_sse": true,
    "run_stop": true,
    "run_approval_response": true,
    "tool_progress_events": true,
    "approval_events": true,
    "session_resources": true,
    "session_chat": true,
    "session_chat_streaming": true,
    "session_fork": true,
    "admin_config_rw": false,
    "jobs_admin": false,
    "memory_write_api": false,
    "skills_api": true,
    "audio_api": false,
    "realtime_voice": false,
    "session_continuity_header": "X-Hermes-Session-Id",
    "session_key_header": "X-Hermes-Session-Key",
    "cors": false
  },
  "endpoints": {
    "health": {"method": "GET", "path": "/health"},
    "health_detailed": {"method": "GET", "path": "/health/detailed"},
    "models": {"method": "GET", "path": "/v1/models"},
    "chat_completions": {"method": "POST", "path": "/v1/chat/completions"},
    "responses": {"method": "POST", "path": "/v1/responses"},
    "runs": {"method": "POST", "path": "/v1/runs"},
    "run_status": {"method": "GET", "path": "/v1/runs/{run_id}"},
    "run_events": {"method": "GET", "path": "/v1/runs/{run_id}/events"},
    "run_approval": {"method": "POST", "path": "/v1/runs/{run_id}/approval"},
    "run_stop": {"method": "POST", "path": "/v1/runs/{run_id}/stop"},
    "skills": {"method": "GET", "path": "/v1/skills"},
    "toolsets": {"method": "GET", "path": "/v1/toolsets"},
    "sessions": {"method": "GET", "path": "/api/sessions"},
    "session_create": {"method": "POST", "path": "/api/sessions"},
    "session": {"method": "GET", "path": "/api/sessions/{session_id}"},
    "session_update": {"method": "PATCH", "path": "/api/sessions/{session_id}"},
    "session_delete": {"method": "DELETE", "path": "/api/sessions/{session_id}"},
    "session_messages": {"method": "GET", "path": "/api/sessions/{session_id}/messages"},
    "session_fork": {"method": "POST", "path": "/api/sessions/{session_id}/fork"},
    "session_chat": {"method": "POST", "path": "/api/sessions/{session_id}/chat"},
    "session_chat_stream": {"method": "POST", "path": "/api/sessions/{session_id}/chat/stream"}
  }
}
```

Note: `/api/jobs/*`, `/v1/responses/{id}`, and `DELETE /v1/responses/{id}` are registered but not currently listed in this `endpoints` map.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1069`.

### GET /v1/skills

Auth: bearer.

Purpose: list installed skills visible to the API-server agent.

Response 200:

```json
{
  "object": "list",
  "data": [
    {
      "name": "string",
      "description": "string",
      "category": "string",
      "...": "skill metadata from tools.skills_tool"
    }
  ]
}
```

Errors:

- 500 OpenAI envelope, `type: "server_error"`, message `Failed to enumerate skills`.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1149`.

### GET /v1/toolsets

Auth: bearer.

Purpose: list API-server platform toolsets and concrete resolved tools.

Response 200:

```json
{
  "object": "list",
  "platform": "api_server",
  "data": [
    {
      "name": "string",
      "label": "string",
      "description": "string",
      "enabled": true,
      "configured": true,
      "tools": ["terminal", "read_file"]
    }
  ]
}
```

Errors:

- 500 OpenAI envelope, `type: "server_error"`, message `Failed to enumerate toolsets`.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1180`.

## Chat Completions

### POST /v1/chat/completions

Auth: bearer.

Purpose: OpenAI Chat Completions compatible agent turn. Stateless by body by default, with optional server-side session continuity through `X-Hermes-Session-Id`.

Request:

```json
{
  "model": "hermes-agent",
  "messages": [
    {"role": "system", "content": "optional instructions"},
    {"role": "user", "content": "hello"},
    {"role": "assistant", "content": "hi"},
    {"role": "user", "content": [
      {"type": "text", "text": "Describe this image"},
      {"type": "image_url", "image_url": {"url": "https://example.com/image.png", "detail": "high"}}
    ]}
  ],
  "stream": false
}
```

Accepted message roles:

- `system`: flattened into an ephemeral system prompt.
- `user`, `assistant`: included in conversation history; last conversation message becomes the active user message.

Accepted content:

- Plain string.
- Text parts: `text`, `input_text`, `output_text`.
- Image parts: `image_url`, `input_image`, using HTTP(S) URL or `data:image/...` URL.
- Unsupported: uploaded file parts (`file`, `input_file`, `file_id`) and non-image `data:` URLs.

Source: message normalization and validation at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1694`; multimodal validation at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:178`.

Session behavior:

- If `X-Hermes-Session-Id` is supplied, Hermes loads history from `state.db` for that session and ignores body history.
- If no session ID is supplied, it derives a deterministic `api-<sha>` from system prompt plus first user message.
- Response header always includes `X-Hermes-Session-Id`.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1734`.

Non-streaming response 200:

```json
{
  "id": "chatcmpl_<id>",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "hermes-agent",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "final text"},
      "finish_reason": "stop | length | error"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  },
  "hermes": {
    "completed": false,
    "partial": true,
    "failed": false,
    "error": "optional",
    "error_code": "output_truncated | agent_error"
  }
}
```

Headers:

- `X-Hermes-Session-Id: <effective_session_id>`
- `X-Hermes-Session-Key: <key>` if supplied
- `X-Hermes-Completed: false`, `X-Hermes-Partial: true|false`, and `X-Hermes-Error: <message>` on partial/failed 200 responses

Source: response construction at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1911`.

Hard failure response 502:

```json
{
  "error": {
    "message": "Agent run did not produce a response.",
    "type": "server_error",
    "param": null,
    "code": "agent_incomplete",
    "hermes": {
      "completed": false,
      "partial": true,
      "failed": true
    }
  }
}
```

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1933`.

Streaming response 200:

Headers:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `X-Accel-Buffering: no`
- `X-Hermes-Session-Id: <session_id>`
- `X-Hermes-Session-Key: <key>` if supplied

SSE format:

1. Initial assistant role chunk:

```text
data: {"id":"chatcmpl_...","object":"chat.completion.chunk","created":1710000000,"model":"hermes-agent","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}
```

2. Text delta chunks:

```text
data: {"id":"chatcmpl_...","object":"chat.completion.chunk","created":1710000000,"model":"hermes-agent","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}
```

3. Tool progress custom events:

```text
event: hermes.tool.progress
data: {"tool":"terminal","emoji":"$","label":"terminal: ls","toolCallId":"call_...","status":"running"}
```

Completion:

```text
event: hermes.tool.progress
data: {"tool":"terminal","toolCallId":"call_...","status":"completed"}
```

4. Keepalive comments every 30 seconds of inactivity:

```text
: keepalive
```

5. Final usage chunk:

```text
data: {"id":"chatcmpl_...","object":"chat.completion.chunk","created":1710000000,"model":"hermes-agent","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}
```

6. Terminal marker:

```text
data: [DONE]
```

Source: SSE writer at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1990`; tool event payloads at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1808`.

Streaming caveat: if the agent task raises inside `_write_sse_chat_completion`, Hermes attempts to send a final chunk with `finish_reason: "error"` and `[DONE]`, but it does not include the provider error message in the chat-completions stream. Non-streaming is better for structured failure detection, and `/v1/runs`/`/v1/responses` expose cleaner failure events.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2123`.

## Responses API And Response Store

The Responses API uses `ResponseStore`, a SQLite-backed LRU store at `$HERMES_HOME/response_store.db`, falling back to in-memory SQLite if unavailable. It stores each response plus internal conversation history so `previous_response_id` can reconstruct context, including tool calls and results. File permissions are tightened to owner-only.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:342`.

### POST /v1/responses

Auth: bearer.

Purpose: OpenAI Responses-style stateful agent turn with optional stored chaining.

Request:

```json
{
  "model": "hermes-agent",
  "input": "What files are here?",
  "instructions": "optional system instructions",
  "previous_response_id": "resp_...",
  "conversation": "optional-name",
  "conversation_history": [
    {"role": "user", "content": "previous"},
    {"role": "assistant", "content": "answer"}
  ],
  "store": true,
  "stream": false,
  "truncation": "auto"
}
```

Request rules:

- Required: `input`.
- `input` may be a string or an array of strings/message objects.
- Multimodal content supports the same text/image parts as chat completions.
- `conversation` and `previous_response_id` are mutually exclusive.
- `conversation_history` overrides `previous_response_id`.
- `store` defaults to `true`.
- `truncation: "auto"` trims history to the last 100 messages.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2738`.

Non-streaming response 200:

```json
{
  "id": "resp_<id>",
  "object": "response",
  "status": "completed",
  "created_at": 1710000000,
  "model": "hermes-agent",
  "output": [
    {
      "type": "function_call",
      "name": "terminal",
      "arguments": "{\"command\":\"ls\"}",
      "call_id": "call_..."
    },
    {
      "type": "function_call_output",
      "call_id": "call_...",
      "output": "README.md"
    },
    {
      "type": "message",
      "role": "assistant",
      "content": [{"type": "output_text", "text": "final text"}]
    }
  ],
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  }
}
```

Headers:

- `X-Hermes-Session-Id`
- `X-Hermes-Session-Key` if supplied

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2960`.

Streaming response 200:

Headers mirror chat SSE. Event stream uses OpenAI Responses event names:

```text
event: response.created
data: {"type":"response.created","response":{"id":"resp_...","object":"response","status":"in_progress","created_at":1710000000,"model":"hermes-agent","output":[]},"sequence_number":0}
```

Text item open and deltas:

```text
event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg_...","type":"message","status":"in_progress","role":"assistant","content":[]},"sequence_number":1}

event: response.output_text.delta
data: {"type":"response.output_text.delta","item_id":"msg_...","output_index":0,"content_index":0,"delta":"hello","logprobs":[],"sequence_number":2}
```

Tool call lifecycle:

```text
event: response.output_item.added
data: {"type":"response.output_item.added","output_index":1,"item":{"id":"fc_...","type":"function_call","status":"in_progress","name":"terminal","call_id":"call_...","arguments":"{}"},"sequence_number":3}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":1,"item":{"id":"fc_...","type":"function_call","status":"completed","name":"terminal","call_id":"call_...","arguments":"{}"},"sequence_number":4}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":2,"item":{"id":"fco_...","type":"function_call_output","call_id":"call_...","output":[{"type":"input_text","text":"tool result"}],"status":"completed"},"sequence_number":5}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":2,"item":{"id":"fco_...","type":"function_call_output","call_id":"call_...","output":[{"type":"input_text","text":"tool result"}],"status":"completed"},"sequence_number":6}
```

Text and message close:

```text
event: response.output_text.done
data: {"type":"response.output_text.done","item_id":"msg_...","output_index":0,"content_index":0,"text":"final text","logprobs":[],"sequence_number":7}

event: response.output_item.done
data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_...","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"final text"}]},"sequence_number":8}
```

Terminal success:

```text
event: response.completed
data: {"type":"response.completed","response":{"id":"resp_...","object":"response","status":"completed","created_at":1710000000,"model":"hermes-agent","output":[...],"usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}},"sequence_number":9}
```

Terminal failure:

```text
event: response.failed
data: {"type":"response.failed","response":{"id":"resp_...","object":"response","status":"failed","created_at":1710000000,"model":"hermes-agent","output":[...],"error":{"message":"provider error","type":"server_error"},"usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}},"sequence_number":9}
```

Disconnect behavior: if `store: true`, Hermes persists an `incomplete` snapshot so `GET /v1/responses/{id}` and later `previous_response_id` use can recover partial state.

Source: SSE writer and event list at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2142`; specific event writes at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2305`; failure event at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2629`.

### GET /v1/responses/{response_id}

Auth: bearer.

Purpose: retrieve stored response by ID.

Response 200: the stored `response` object exactly as returned by `POST /v1/responses`.

Errors:

- 404 OpenAI envelope, message `Response not found: <id>`.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3022`.

### DELETE /v1/responses/{response_id}

Auth: bearer.

Purpose: delete stored response and clear any named-conversation mapping to it.

Response 200:

```json
{
  "id": "resp_...",
  "object": "response",
  "deleted": true
}
```

Errors:

- 404 OpenAI envelope, message `Response not found: <id>`.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3035`.

## Session Resource API

Session responses are client-safe projections of `SessionDB` records. They include only: `id`, `source`, `user_id`, `model`, `title`, `started_at`, `ended_at`, `end_reason`, `message_count`, `tool_call_count`, token/cost counters, `api_call_count`, `parent_session_id`, `last_active`, `preview`, `_lineage_root_id`, plus booleans `has_system_prompt` and `has_model_config`.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1251`.

Message responses include only: `id`, `session_id`, `role`, `content`, `tool_call_id`, `tool_calls`, `tool_name`, `timestamp`, `token_count`, `finish_reason`, `reasoning`, `reasoning_content`.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1269`.

### GET /api/sessions

Auth: bearer.

Query:

- `limit`: integer, default 50, max 200.
- `offset`: integer, default 0.
- `source`: optional source filter.
- `include_children`: bool-ish string/number, default false.

Response 200:

```json
{
  "object": "list",
  "data": [{"id": "session", "source": "api_server", "...": "..."}],
  "limit": 50,
  "offset": 0,
  "has_more": false
}
```

Errors:

- 503 OpenAI envelope, `code: "session_db_unavailable"`.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1305`.

### POST /api/sessions

Auth: bearer.

Request:

```json
{
  "id": "optional-session-id",
  "session_id": "optional-alias",
  "model": "optional model",
  "system_prompt": "optional string",
  "title": "optional title"
}
```

Response 201:

```json
{
  "object": "hermes.session",
  "session": {"id": "api_...", "source": "api_server"}
}
```

Errors:

- 400 `invalid_session_id`
- 400 `invalid_system_prompt`
- 400 `invalid_title`
- 409 `session_exists`
- 503 `session_db_unavailable`

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1334`.

### GET /api/sessions/{session_id}

Auth: bearer.

Response 200:

```json
{
  "object": "hermes.session",
  "session": {"id": "session_id"}
}
```

Errors:

- 404 `session_not_found`
- 503 `session_db_unavailable`

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1371`.

### PATCH /api/sessions/{session_id}

Auth: bearer.

Request:

```json
{
  "title": "new title or null",
  "end_reason": "optional reason"
}
```

Only `title` and `end_reason` are accepted.

Response 200:

```json
{
  "object": "hermes.session",
  "session": {"id": "session_id", "title": "new title"}
}
```

Errors:

- 400 `unsupported_session_field`
- 400 `invalid_title`
- 404 `session_not_found`

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1381`.

### DELETE /api/sessions/{session_id}

Auth: bearer.

Response 200:

```json
{
  "object": "hermes.session.deleted",
  "id": "session_id",
  "deleted": true
}
```

Errors:

- 404 `session_not_found`

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1409`.

### GET /api/sessions/{session_id}/messages

Auth: bearer.

Response 200:

```json
{
  "object": "list",
  "session_id": "session_id",
  "data": [{"role": "user", "content": "hello"}]
}
```

Errors:

- 404 `session_not_found`

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1422`.

### POST /api/sessions/{session_id}/fork

Auth: bearer.

Purpose: branch a session using `SessionDB` lineage. The source is marked `end_reason: "branched"`, messages are copied, and the child has `parent_session_id`.

Request:

```json
{
  "id": "optional-fork-id",
  "session_id": "optional-alias",
  "title": "optional title"
}
```

Response 201:

```json
{
  "object": "hermes.session",
  "session": {"id": "fork_id", "parent_session_id": "source_id"}
}
```

Errors:

- 400 `invalid_session_id`
- 400 `invalid_title`
- 409 `session_exists`
- 404 `session_not_found`

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1439`.

### POST /api/sessions/{session_id}/chat

Auth: bearer.

Purpose: one synchronous agent turn in an existing persisted session.

Request:

```json
{
  "message": "user text or multimodal content",
  "input": "alias for message",
  "system_message": "optional",
  "instructions": "alias for system_message"
}
```

Response 200:

```json
{
  "object": "hermes.session.chat.completion",
  "session_id": "effective_session_id",
  "message": {"role": "assistant", "content": "final text"},
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  }
}
```

Headers:

- `X-Hermes-Session-Id`
- `X-Hermes-Session-Key` if supplied

Errors:

- 400 `missing_message`
- 400 `invalid_system_message`
- 400 multimodal errors
- 404 `session_not_found`

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1486`.

### POST /api/sessions/{session_id}/chat/stream

Auth: bearer.

Purpose: Hermes-native SSE stream for one agent turn in an existing session.

Request: same as `/api/sessions/{session_id}/chat`.

Headers:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `X-Accel-Buffering: no`
- `X-Hermes-Session-Id`
- `X-Hermes-Session-Key` if supplied

SSE events:

```text
event: run.started
data: {"user_message":{"role":"user","content":"..."}, "session_id":"...", "run_id":"...", "seq":1, "ts":1710000000.0}

event: message.started
data: {"message":{"id":"msg_...","role":"assistant"}, "session_id":"...", "run_id":"...", "seq":2, "ts":...}

event: assistant.delta
data: {"message_id":"msg_...","delta":"text", "session_id":"...", "run_id":"...", "seq":3, "ts":...}

event: tool.started
data: {"message_id":"msg_...","tool_name":"terminal","preview":"...","args":{}, "session_id":"...", "run_id":"...", "seq":4, "ts":...}

event: tool.completed
data: {"message_id":"msg_...","tool_name":"terminal","preview":"...","args":{}, "session_id":"...", "run_id":"...", "seq":5, "ts":...}

event: tool.failed
data: {"message_id":"msg_...","tool_name":"terminal","preview":"...","args":{}, "session_id":"...", "run_id":"...", "seq":6, "ts":...}

event: tool.progress
data: {"message_id":"msg_...","tool_name":"_thinking","delta":"...", "session_id":"...", "run_id":"...", "seq":7, "ts":...}

event: assistant.completed
data: {"session_id":"effective","message_id":"msg_...","content":"final","completed":true,"partial":false,"interrupted":false,"run_id":"...","seq":8,"ts":...}

event: run.completed
data: {"session_id":"effective","message_id":"msg_...","completed":true,"usage":{}, "run_id":"...","seq":9,"ts":...}

event: error
data: {"message":"error text", "session_id":"...", "run_id":"...", "seq":10, "ts":...}

event: done
data: {"session_id":"...", "run_id":"...", "seq":11, "ts":...}
```

Keepalive:

```text
: keepalive
```

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1530`.

## Structured Runs API

The runs API is designed for long-form sessions where clients subscribe to lifecycle events and may need approvals or stop control.

### POST /v1/runs

Auth: bearer.

Purpose: start an agent run and return immediately.

Request:

```json
{
  "input": "user text",
  "instructions": "optional system instructions",
  "previous_response_id": "optional resp id",
  "conversation_history": [
    {"role": "user", "content": "previous"}
  ],
  "session_id": "optional session id",
  "model": "optional model"
}
```

Request notes:

- `input` is required.
- If `input` is an array, the last element becomes the user message and previous elements become history when no explicit `conversation_history` is supplied.
- `previous_response_id` can source stored response history and session ID.
- Max concurrent runs: 10.

Response 202:

```json
{
  "run_id": "run_<uuid>",
  "status": "started"
}
```

Headers:

- `X-Hermes-Session-Key` if supplied

Errors:

- 400 invalid JSON
- 400 missing/no user input
- 400 invalid `conversation_history`
- 429 OpenAI envelope with `code: "rate_limit_exceeded"`

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3514`.

### GET /v1/runs/{run_id}

Auth: bearer.

Purpose: poll run status.

Response 200:

```json
{
  "object": "hermes.run",
  "run_id": "run_...",
  "status": "queued | running | waiting_for_approval | completed | failed | cancelled | stopping",
  "created_at": 1710000000.0,
  "updated_at": 1710000000.0,
  "session_id": "session",
  "model": "hermes-agent",
  "last_event": "event.name",
  "output": "final text if completed",
  "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
  "error": "error text if failed"
}
```

Errors:

- 404 OpenAI envelope, `code: "run_not_found"`.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3810`.

### GET /v1/runs/{run_id}/events

Auth: bearer.

Purpose: SSE lifecycle stream for a started run.

SSE format uses default unnamed `data:` events:

```text
data: {"event":"message.delta","run_id":"run_...","timestamp":1710000000.0,"delta":"text"}

data: {"event":"tool.started","run_id":"run_...","timestamp":1710000000.0,"tool":"terminal","preview":"..."}

data: {"event":"tool.completed","run_id":"run_...","timestamp":1710000000.0,"tool":"terminal","duration":0.123,"error":false}

data: {"event":"reasoning.available","run_id":"run_...","timestamp":1710000000.0,"text":"..."}

data: {"event":"approval.request","run_id":"run_...","timestamp":1710000000.0,"choices":["once","session","always","deny"], "...approval_data":"..."}

data: {"event":"approval.responded","run_id":"run_...","timestamp":1710000000.0,"choice":"once","resolved":1}

data: {"event":"run.completed","run_id":"run_...","timestamp":1710000000.0,"output":"final text","usage":{}}

data: {"event":"run.failed","run_id":"run_...","timestamp":1710000000.0,"error":"provider/auth error text"}

data: {"event":"run.cancelled","run_id":"run_...","timestamp":1710000000.0}
```

Keepalive:

```text
: keepalive
```

Terminal comment:

```text
: stream closed
```

Errors:

- 404 `run_not_found` if not registered after a short wait.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3825`; event callback source at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3468`.

### POST /v1/runs/{run_id}/approval

Auth: bearer.

Purpose: resolve a pending tool approval for a run.

Request:

```json
{
  "choice": "once | session | always | deny | approve | approved | allow",
  "all": false,
  "resolve_all": false
}
```

Aliases: `approve`, `approved`, and `allow` map to `once`.

Response 200:

```json
{
  "object": "hermes.run.approval_response",
  "run_id": "run_...",
  "choice": "once",
  "resolved": 1
}
```

Errors:

- 400 invalid JSON
- 400 `invalid_approval_choice`
- 404 `run_not_found`
- 409 `approval_not_active`
- 409 `approval_not_pending`
- 500 OpenAI envelope if approval resolution throws

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3875`.

### POST /v1/runs/{run_id}/stop

Auth: bearer.

Purpose: interrupt a running agent and cancel the async task wrapper.

Request: no body required.

Response 200:

```json
{
  "run_id": "run_...",
  "status": "stopping"
}
```

Errors:

- 404 `run_not_found`

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3963`.

## Cron Jobs API

These endpoints wrap `cron.jobs` helpers. Unlike the OpenAI surfaces, errors are mostly flat `{"error": "..."}` objects.

Cron availability check:

- If the cron module cannot import, endpoints return HTTP 501:

```json
{"error": "Cron module not available"}
```

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3062`.

Job ID validation:

- Path job IDs must match `[a-f0-9]{12}`.
- Invalid ID returns 400:

```json
{"error": "Invalid job ID format"}
```

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3071`.

### GET /api/jobs

Auth: bearer.

Query:

- `include_disabled=true|1`

Response 200:

```json
{
  "jobs": [
    {
      "id": "12 hex chars",
      "name": "string",
      "schedule": "cron or schedule expression",
      "prompt": "string",
      "deliver": "local or platform",
      "skills": ["optional"],
      "repeat": 1,
      "enabled": true,
      "...": "cron job fields"
    }
  ]
}
```

Errors:

- 500 `{"error": "<exception text>"}`

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3085`.

### POST /api/jobs

Auth: bearer.

Request:

```json
{
  "name": "required, <= 200 chars",
  "schedule": "required",
  "prompt": "optional, <= 5000 chars",
  "deliver": "local",
  "skills": ["optional"],
  "repeat": 1
}
```

Response 200:

```json
{
  "job": {"id": "12 hex chars", "...": "cron job"}
}
```

Validation errors:

- 400 `{"error": "Name is required"}`
- 400 `{"error": "Name must be <= 200 characters"}` in source uses a Unicode <= symbol
- 400 `{"error": "Schedule is required"}`
- 400 `{"error": "Prompt must be <= 5000 characters"}` in source uses a Unicode <= symbol
- 400 `{"error": "Repeat must be a positive integer"}`
- 500 `{"error": "<exception text>"}`

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3100`.

### GET /api/jobs/{job_id}

Auth: bearer.

Response 200:

```json
{"job": {"id": "job_id"}}
```

Errors:

- 400 invalid job ID format
- 404 `{"error": "Job not found"}`
- 500 flat error

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3149`.

### PATCH /api/jobs/{job_id}

Auth: bearer.

Request:

```json
{
  "name": "optional <= 200 chars",
  "schedule": "optional",
  "prompt": "optional <= 5000 chars",
  "deliver": "optional",
  "skills": ["optional"],
  "skill": "optional",
  "repeat": 1,
  "enabled": true
}
```

Only these fields are forwarded: `name`, `schedule`, `prompt`, `deliver`, `skills`, `skill`, `repeat`, `enabled`.

Response 200:

```json
{"job": {"id": "job_id"}}
```

Errors:

- 400 invalid job ID format
- 400 `{"error": "No valid fields to update"}`
- 400 name/prompt length
- 404 job not found
- 500 flat error

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3168`.

### DELETE /api/jobs/{job_id}

Auth: bearer.

Response 200:

```json
{"ok": true}
```

Errors:

- 400 invalid job ID format
- 404 job not found
- 500 flat error

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3201`.

### POST /api/jobs/{job_id}/pause

Auth: bearer.

Response 200:

```json
{"job": {"id": "job_id", "enabled": false}}
```

Errors: 400 invalid job ID, 404 job not found, 500 flat error.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3220`.

### POST /api/jobs/{job_id}/resume

Auth: bearer.

Response 200:

```json
{"job": {"id": "job_id", "enabled": true}}
```

Errors: 400 invalid job ID, 404 job not found, 500 flat error.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3239`.

### POST /api/jobs/{job_id}/run

Auth: bearer.

Purpose: trigger immediate execution.

Response 200:

```json
{"job": {"id": "job_id"}}
```

Errors: 400 invalid job ID, 404 job not found, 500 flat error.

Source: `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3258`.

## Error And Provider/Auth Failure Detection

Most non-cron endpoints return an OpenAI-style error object. Important status codes:

- 400 invalid JSON/body/schema.
- 401 invalid/missing bearer token, `code: "invalid_api_key"`.
- 403 invalid CORS origin or session headers requiring auth in unsupported no-key test wiring.
- 404 missing response/session/run/job.
- 409 resource conflict or approval state conflict.
- 413 oversized request.
- 429 too many concurrent runs.
- 500 internal server error or enumeration failures.
- 502 agent incomplete for non-streaming chat completions with no usable assistant text.

Provider/model failures:

- Non-streaming `/v1/chat/completions` catches raised agent exceptions and returns 500 `{"error":{"message":"Internal server error: <exception>","type":"server_error"}}`.
- Non-streaming chat also maps structured agent failures to either 502 `code: "agent_incomplete"` or 200 with `finish_reason: "error"` and a `hermes.error` payload.
- Streaming chat completions can end with `finish_reason: "error"` but may omit the actual provider error message.
- Streaming `/v1/responses` emits `response.failed` with `response.error.message`.
- `/v1/runs/{run_id}/events` emits `run.failed` with an `error` string, and `GET /v1/runs/{run_id}` persists `status: "failed"` plus `error`.

For Mercury's recent Codex provider error, `'NoneType' object is not iterable`, the most client-friendly detection paths are:

- Non-streaming probe to `/v1/chat/completions`: parse `error.message`, `error.code`, and `error.hermes`, plus `choices[0].finish_reason === "error"` and top-level `hermes.error`.
- Runs API: watch for `data.event === "run.failed"` or poll `status === "failed"` and inspect `error`.
- Responses API: watch `event: response.failed` and inspect `response.error.message`.
- Auth failure: detect HTTP 401 plus `error.code === "invalid_api_key"`.

Sources: chat failure handling at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1895`; structured chat incomplete at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1933`; response failure SSE at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2629`; run failed event/status at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3706`; auth failure at `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:864`.

## Mercury Current Usage And Gaps

Status update — 2026-05-31 gateway/runtime fixes:

- Chat execution now uses structured runs: `POST /v1/runs`, `GET /v1/runs/{run_id}/events`, run status polling, run approval, and run stop through the internal BFF/runs path.
- The readiness path no longer probes `/v1/chat/completions`; it checks `/health` and then authenticated `GET /v1/capabilities`.
- The current runtime target requires both `run_submission` and `session_resources`. Mercury does not keep `/v1/chat/completions` or runs-only behavior as a compatibility fallback for stale Hermes gateways.
- The BFF capabilities client now uses `/v1/capabilities`, not `/capabilities`.
- Chat/session setup uses `/api/sessions` for server-side session creation/read before `/v1/runs` dispatch. A live smoke after stale gateway refresh passed against `/api/sessions`.
- Local gateway startup generates and persists a per-profile `API_SERVER_KEY` when missing, merges profile `.env`, and then forces `API_SERVER_ENABLED`, host, port, and key into the child environment so stale env cannot disable the managed API server.
- Pid-file-only local gateways are refreshed before use so Mercury does not attach to an older process missing the current session API surface.

Historical notes from the original 2026-05-29 surface audit remain useful for endpoint shapes above, but the old local snapshot that posted chat only to `/v1/chat/completions`, used a chat-completions readiness probe, and recommended a chat-completions compatibility fallback is superseded.

Remaining under-used API areas:

1. Responses API: Mercury can use `/v1/responses` with `previous_response_id` or `conversation` if it later wants OpenAI Responses-compatible transcript chaining with tool-call output items.

2. Skills/toolsets: Mercury can use `/v1/skills` and `/v1/toolsets` to render deterministic capability/tool availability and avoid asking the model or reading config files.

## Suggested Mercury Integration Priority

1. Keep authenticated `/v1/capabilities` as the runtime identity/auth gate and continue treating 401 `invalid_api_key` as a gateway API-key problem distinct from model/provider auth.
2. Keep interactive chat on `/v1/runs` plus `/events`, with `/api/sessions` as the session lifecycle source of truth.
3. Do **not** add `/v1/chat/completions` or runs-only fallback for older/stale Hermes gateways; refresh/update the gateway until `/api/sessions` is available.
4. Continue migrating remaining endpoint families through typed BFF subclients rather than one-off raw HTTP helpers or renderer-visible proxy methods.
