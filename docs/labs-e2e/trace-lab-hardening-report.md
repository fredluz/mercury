# Trace Lab Hardening E2E

Date: 2026-05-14T00:04:49.873Z

## Configuration

- Provider: openai-codex
- Model: gpt-5.5
- Credential source: local ~/.hermes/auth.json openai-codex (secrets copied only into the temporary Hermes home at runtime).
- Temporary Hermes home: `/var/folders/yl/6991_2tx48j101frnnd3fl6m0000gn/T/mercury-trace-hardening-FkqKF6`
- Image scenario: enabled
- Harness path: Playwright launches the built Electron app and drives renderer UI/preload APIs against the real IPC/main Hermes path.

## Scenario verification

| Result | Scenario | Run status | Run id | Missing evidence |
| --- | --- | --- | --- | --- |
| PASS | Normal conversation | completed | cd168d23-71d8-4c0f-bae2-59b780e2bc1f | — |
| PASS | Resumed/history conversation | completed | 19219f07-b705-42e6-87a1-65adadd96ae1 | — |
| PASS | Tool call | completed | 6a72e36d-d197-4232-8701-559dabbed70b | — |
| PASS | Delegation/sub-agent | completed | 7c143bac-0eca-480e-aa97-a155d831aded | — |
| FAIL | Harness aborted before completion | n/a | n/a | locator.waitFor: Target page, context or browser has been closed
Call log:
[2m  - waiting for locator('.chat-message-agent .chat-bubble-agent').filter({ hasText: 'TRACE_HARDEN_IMAGE_OK' }) to be visible[22m
 |

## Trace Lab UI verification

| Result | Marker | Detail |
| --- | --- | --- |


## Classification semantics

- PASS means the scenario produced all required evidence. Image generation only passes when a completed run contains `artifact.created` image evidence.
- DEPENDENCY means the app path traced an expected external provider/tool-unavailable failure; it is not counted as generated image success.
- FAIL means a harness crash, page closure, unclassified app failure, or missing hard evidence.

## Item 1 dependencies

- Not evaluated because harness/scenario hard failures were present.

## Harness failures

- Harness failure: Electron page/context closed before completion while waiting for `TRACE_HARDEN_IMAGE_OK`.

## Artifacts

- Summary JSON: [trace-lab-hardening-summary.json](trace-lab-hardening-summary.json)
- Screenshot: [trace-lab-hardening.png](trace-lab-hardening.png)

## Secret handling

The report and summary intentionally include only provider/model names, credential source labels, run ids, statuses, event type names, and dependency notes. API keys and auth payloads are not written to repository artifacts.
