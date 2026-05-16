# Oracle Review

## Summary

The Skills redesign implements category-grouped collapsible skill sections, install/uninstall-as-enable/disable flows, bulk category actions, an in-screen markdown/metadata detail panel, a new skill metadata IPC/preload API, updated i18n, tests, and subsystem docs. I don’t see P0 blockers in the requested Skills-related scope, but there are a couple of safety/test-quality issues worth fixing before merge.

## Findings

### P1

- **`src/main/skills.ts` / `src/main/ssh/skills.ts` — metadata API can enumerate non-skill directories**
  - **What’s wrong:** `getSkillMetadata(skillPath)` only checks that `skillPath` is a directory, then lists immediate children under `scripts/` and `references/`. The SSH implementation similarly accepts any remote directory path. Since this is a renderer-exposed IPC method, it should not disclose filesystem structure for arbitrary non-skill directories.
  - **Suggestion:** Require `SKILL.md` to exist under `skillPath` before returning `metadataAvailable: true`. For SSH, add the same `os.path.exists(os.path.join(base, "SKILL.md"))` guard. If missing, return the existing unavailable shape.

### P2

- **`src/renderer/src/screens/Skills/Skills.test.tsx` — individual enable test can click the bulk button**
  - **What’s wrong:** The individual enable test uses:
    ```ts
    within(browseSection).getAllByRole("button", { name: /skills.enable/i })[0]
    ```
    This can match `skills.enableAll`, so the test may pass through the bulk path rather than proving the row-level enable button works.
  - **Suggestion:** Scope to the `ts-test` row or query the exact accessible name:
    ```ts
    within(row).getByRole("button", { name: "skills.enable" })
    ```
    or use a stricter regex like `/^skills\.enable$/`.

- **`src/renderer/src/screens/Skills/Skills.tsx` — load failure fallback bypasses i18n**
  - **What’s wrong:** `loadAll()` falls back to hardcoded `"Failed to load skills"` instead of `t("skills.loadFailed")`, even though the key was added.
  - **Suggestion:** Replace:
    ```ts
    setError((err as Error).message || "Failed to load skills");
    ```
    with:
    ```ts
    setError((err as Error).message || t("skills.loadFailed"));
    ```
    and include `t` in the relevant callback dependencies if needed.