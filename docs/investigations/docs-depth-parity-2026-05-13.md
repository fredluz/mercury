# Investigation: Documentation Depth and Source Parity

## Summary
Mercury is **not close to one Markdown-doc-line per one app-source-line parity**. Using the confirmed scope and a pre-append measurement snapshot, the repo has **3,598 scoped Markdown documentation lines** against **28,830 app-source lines under `src/`**, or **12.48% of 1:1 parity**: a strict parity rating of **1.25/10**. Practical documentation maturity is higher, around **3/10**, because the existing docs are useful for onboarding, product direction, E2E planning, and audits, but uneven and not yet a durable reference system.

## Symptoms
- User asked how deep the docs are in this codebase.
- Desired output is a 0–10 rating for whether the repository has one line of docs per one line of code parity.
- Docs scope: Markdown docs, README, and CONTRIBUTING.
- Code scope: only app source under `src/`.

## Background / Prior Research
No external research required; this investigation is based on repository contents only.

## Investigator Findings

### Pair Validation - 2026-05-13

#### Method and commands

All counts below were taken from the repository root before appending this section, so the self-referential file `docs/investigations/docs-depth-parity-2026-05-13.md` was still 33 LOC at count time. Line counting used physical lines, equivalent to `wc -l` for newline-terminated files plus one final unterminated line when present.

Primary count command:

```bash
python3 - <<'PY'
from pathlib import Path
root=Path('/Users/fredluz/Code/mercury')
def line_count(p):
    data=p.read_bytes()
    return 0 if not data else data.count(b'\n') + (0 if data.endswith(b'\n') else 1)
root_docs=sorted([p for p in root.iterdir() if p.is_file() and p.suffix=='.md' and (p.name.startswith('README') or p.name.startswith('CONTRIBUTING'))])
docs_md=sorted((root/'docs').rglob('*.md'))
# print per-file counts and subtotals
src_exts={'.ts','.tsx','.css','.html'}
exclude={Path('src/renderer/src/components/I18nProvider.test.tsx'), Path('src/renderer/src/test/setup.ts'), Path('src/shared/i18n/index.test.ts')}
src_files=sorted([p for p in (root/'src').rglob('*') if p.is_file() and p.suffix in src_exts])
# print per-extension counts before/after exclusions
PY
```

I also ran a heading inventory over the 16 scoped Markdown files to assess durable documentation versus one-off reports:

```bash
python3 - <<'PY'
from pathlib import Path
root=Path('/Users/fredluz/Code/mercury')
files=sorted([p for p in root.iterdir() if p.is_file() and p.suffix=='.md' and (p.name.startswith('README') or p.name.startswith('CONTRIBUTING'))] + list((root/'docs').rglob('*.md')))
for p in files:
    print(f'## {p.relative_to(root)}')
    for i,line in enumerate(p.read_text(errors='replace').splitlines(),1):
        if line.startswith('#'):
            print(f'{i}: {line[:120]}')
PY
```

#### Documentation numerator

Confirmed scoped numerator: root `README*` / `CONTRIBUTING*` Markdown plus `docs/**/*.md`; no inline comments/JSDoc counted.

| Documentation group | Files | Lines | Notes |
|---|---:|---:|---|
| Root README/CONTRIBUTING variants | 4 | 613 | Includes English and `zh-CN` variants. |
| `docs/**/*.md` | 12 | 2,985 | Includes durable docs plus investigations/reports. |
| **Total Markdown docs** | **16** | **3,598** | Matches Context Builder finding. |

Root files counted:

| File | Lines | Inclusion note |
|---|---:|---|
| `README.md` | 274 | Root product/development doc. |
| `README.zh-CN.md` | 151 | Localized root doc; include per confirmed scope, but note localization sensitivity. |
| `CONTRIBUTING.md` | 94 | Root contributor doc. |
| `CONTRIBUTING.zh-CN.md` | 94 | Localized contributor doc; include per confirmed scope. |
| **Subtotal** | **613** |  |

`docs/**/*.md` files counted:

| File | Lines | Inclusion / sensitivity note |
|---|---:|---|
| `docs/e2e-flow-sweep-report.md` | 41 | E2E report artifact. |
| `docs/e2e-opencode-go-deepseek.md` | 55 | Targeted E2E evidence/report. |
| `docs/hermes-product-spec.md` | 120 | Durable product-direction spec. |
| `docs/investigations/docs-depth-parity-2026-05-13.md` | 33 | This investigation scaffold at count time; generated/investigation-sensitive. |
| `docs/investigations/large-file-split-2026-05-13.md` | 170 | Investigation artifact. |
| `docs/labs-e2e/trace-lab-skill-evolution-report.md` | 32 | E2E/report artifact. |
| `docs/performance-audit.md` | 242 | Point-in-time audit. |
| `docs/pi-flow-sweep-plan.md` | 786 | Large E2E flow plan; useful but test-planning oriented. |
| `docs/superpowers/plans/2026-04-30-windows-winget-fedora-rpm-release.md` | 1,195 | Branch/task-specific implementation plan. |
| `docs/superpowers/specs/2026-04-30-windows-winget-fedora-rpm-release-design.md` | 235 | Branch/task-specific design spec. |
| `docs/trace-lab-visual-direction.md` | 36 | Durable-ish UI direction note. |
| `docs/usage-sweep/50-response-ui-sweep-report.md` | 40 | Sweep report artifact. |
| **Subtotal** | **2,985** |  |

Sensitivity notes:

- Localized root docs add 245 LOC (`README.zh-CN.md` + `CONTRIBUTING.zh-CN.md`). Excluding them would reduce the numerator from 3,598 to 3,353 LOC.
- Clearly investigation/report-like docs total 613 LOC: `docs/e2e-flow-sweep-report.md`, `docs/e2e-opencode-go-deepseek.md`, `docs/investigations/*`, `docs/labs-e2e/trace-lab-skill-evolution-report.md`, `docs/performance-audit.md`, and `docs/usage-sweep/50-response-ui-sweep-report.md`.
- The two `docs/superpowers/*` files add 1,430 LOC and are substantial, but they are branch/task-specific rather than evergreen architecture or operations docs.

#### Code denominator

Confirmed scoped denominator: app source under `src/` with extensions `.ts`, `.tsx`, `.css`, and `.html`; tests/setup-test harness excluded. Build metadata, scripts, root config, tests outside `src`, lockfiles, assets such as fonts/images, and generated output are outside the denominator.

| Extension | Files before exclusions | Lines before exclusions | Files after exclusions | Lines after exclusions |
|---|---:|---:|---:|---:|
| `.css` | 27 | 5,463 | 27 | 5,463 |
| `.html` | 1 | 15 | 1 | 15 |
| `.ts` | 167 | 15,277 | 165 | 15,238 |
| `.tsx` | 42 | 8,192 | 41 | 8,114 |
| **Total** | **237** | **28,947** | **234** | **28,830** |

Excluded in-tree test/setup harness files:

| File | Lines | Reason |
|---|---:|---|
| `src/renderer/src/components/I18nProvider.test.tsx` | 78 | In-tree test file. |
| `src/renderer/src/test/setup.ts` | 7 | Test setup harness. |
| `src/shared/i18n/index.test.ts` | 32 | In-tree test file. |
| **Total excluded** | **117** |  |

I intentionally did **not** exclude app setup source such as `src/renderer/src/screens/Setup/Setup.tsx`, `src/main/claw3d/setup.ts`, setup locale files, or `src/renderer/src/assets/styles/setup.css`; despite containing “setup” in the path, these are application source and belong in the confirmed denominator.

CSS-excluded sensitivity:

| Denominator variant | Files | Lines | Docs/code ratio | Linear 0-10 parity score |
|---|---:|---:|---:|---:|
| Confirmed app source, CSS included | 234 | 28,830 | 12.48% | 1.25 / 10 |
| Sensitivity: TS/TSX/HTML only | 207 | 23,367 | 15.40% | 1.54 / 10 |

Formula: `score = min(10, docs_lines / code_lines * 10)`, where 10/10 means one physical Markdown-doc line per one physical source line.

#### Qualitative maturity evidence

What the docs cover well:

- The root README provides a clear product overview, install/platform guidance, feature inventory, first-run behavior, screens, supported providers, development commands, first-time setup paths, and tech stack. Evidence: install starts at `README.md:34`, features at `README.md:76`, first-run flow at `README.md:114`, screens at `README.md:127`, development commands at `README.md:171`, first-time setup at `README.md:220`, and stack at `README.md:248`.
- Contributor onboarding exists and is concise: setup, branch workflow, checks, PR process, bug/feature issue guidance, project structure, and code style. Evidence: `CONTRIBUTING.md:10`, `CONTRIBUTING.md:25`, `CONTRIBUTING.md:44`, `CONTRIBUTING.md:53`, `CONTRIBUTING.md:62`, `CONTRIBUTING.md:70`, and `CONTRIBUTING.md:80`.
- There is a durable product-direction document for trace/evaluation/skill-training concepts. Evidence: `docs/hermes-product-spec.md:5` for product direction, `docs/hermes-product-spec.md:11` for Runs, `docs/hermes-product-spec.md:34` for Traces, `docs/hermes-product-spec.md:63` for Skill Training, and `docs/hermes-product-spec.md:79` for product screens.
- Testability planning is unusually detailed for UI flows. `docs/pi-flow-sweep-plan.md` maps onboarding, layout, chat, sessions, Trace Lab, Agents, Models, Providers, Skills, Soul, Memory, Tools, Schedules, Gateway, Office, Settings, and a summary matrix; the matrix starts at `docs/pi-flow-sweep-plan.md:751`.
- Performance documentation includes baseline environment, commands, measurements, observations, prioritized quick wins, and future verification commands. Evidence: `docs/performance-audit.md:6`, `docs/performance-audit.md:14`, `docs/performance-audit.md:36`, `docs/performance-audit.md:82`, `docs/performance-audit.md:138`, and `docs/performance-audit.md:200`.

What is missing or not yet durable enough:

- No stable architecture overview/index explains main/preload/renderer boundaries, IPC domains, persistence layout, or module ownership. The root docs only summarize project structure at `CONTRIBUTING.md:70` and runtime behavior at `README.md:114`; deeper architecture exists mostly as inferred code or point-in-time investigations.
- No canonical IPC/API contract documentation for `window.hermesAPI`, channel naming, request/response shapes, or main-process handler ownership.
- No evergreen trace schema reference. The product spec defines trace concepts and event examples at `docs/hermes-product-spec.md:34`, but it is conceptual rather than a maintained data-contract document.
- Release/packaging knowledge exists, but much of it is branch/task-specific: the winget/RPM spec is explicitly dated and branch-targeted at `docs/superpowers/specs/2026-04-30-windows-winget-fedora-rpm-release-design.md:3`, and the implementation plan is tied to a specific branch/upstream PR goal at `docs/superpowers/plans/2026-04-30-windows-winget-fedora-rpm-release.md:1` and `docs/superpowers/plans/2026-04-30-windows-winget-fedora-rpm-release.md:17`.
- The `docs/` tree mixes durable references, implementation plans, audits, E2E reports, and investigation artifacts without an index or status taxonomy. This inflates raw documentation depth while making it harder to distinguish current reference material from historical evidence.
- Operational runbooks are thin: there is no maintained troubleshooting guide, release operator checklist independent of one branch plan, environment matrix, storage/backup recovery guide, or support/incident playbook.

#### Final ratings

| Rating | Score | Rationale |
|---|---:|---|
| Strict linear docs/code parity, confirmed scope | **1.25 / 10** | 3,598 Markdown LOC / 28,830 app-source LOC = 12.48% of one-doc-line-per-code-line parity. This validates the initial 1.25/10 estimate. |
| Strict linear parity, CSS-excluded sensitivity | **1.54 / 10** | 3,598 Markdown LOC / 23,367 TS/TSX/HTML LOC = 15.40%. Useful if CSS is considered less documentation-hungry, but not the confirmed primary denominator. |
| Practical documentation maturity | **3 / 10** | The repo has good README/contributor onboarding, product-direction notes, E2E flow planning, and performance/investigation artifacts. It lacks durable architecture, API/IPC contracts, data schemas, evergreen release/ops runbooks, and a docs index/status taxonomy. Raw volume is also materially boosted by localized variants, dated plans, and reports. |

Conclusion: Context Builder's numerical findings are accurate for the confirmed scope. The strict parity score should remain **1.25/10** primary, with **1.54/10** as a CSS-excluded sensitivity. A separate practical maturity rating of **about 3/10** is fair because the existing docs are useful but uneven and not yet a durable reference system for a 28.8k LOC app.

## Investigation Log

### Phase 1 - Scope Clarification
**Hypothesis:** The rating must be based on explicit documentation artifacts rather than inline code comments.
**Findings:** User selected “Markdown + README/CONTRIBUTING” as docs scope and “Only app source” as code scope.
**Evidence:** Interview answers in this session.
**Conclusion:** Confirmed.

### Phase 2 - Context Builder Seeding
**Hypothesis:** Repository-wide context discovery would identify both the Markdown documentation corpus and the `src/` app-source denominator more reliably than manual spot checks.
**Findings:** Context Builder selected the scoped Markdown docs and `src/**` codemaps, and produced initial counts matching the later pair validation: 3,598 Markdown LOC and 28,830 adjusted app-source LOC.
**Evidence:** Selected context included root README/CONTRIBUTING variants, `docs/**/*.md`, and `src/**` codemaps.
**Conclusion:** Confirmed.

### Phase 3 - Pair Validation
**Hypothesis:** The initial counts and 1.25/10 parity rating are independently reproducible.
**Findings:** Pair investigator reproduced the numerator/denominator counts, identified the three in-tree test/setup harness exclusions, and rejected an over-broad “setup” exclusion because app setup files are real source.
**Evidence:** See `## Investigator Findings`, especially the documentation numerator and code denominator tables.
**Conclusion:** Confirmed.

### Phase 4 - Oracle Synthesis
**Hypothesis:** A strict LOC-parity score should be separated from a qualitative documentation-maturity score.
**Findings:** Oracle agreed the strict score is **1.25/10**, the CSS-excluded sensitivity is **1.54/10**, and practical maturity is about **3/10**. It emphasized that the strict score is already generous because localized duplicates, dated investigations, audits, E2E reports, and branch/task-specific plans are included in the numerator.
**Evidence:** Oracle synthesis in session `docs-parity-AB08A7`.
**Conclusion:** Confirmed.

## Root Cause
Documentation appears to have grown mostly as **workstream artifacts**—README/contributor onboarding, product specs, E2E plans, audits, implementation plans, and investigation reports—rather than as a maintained reference system. Meanwhile, app source spans main-process services, preload API surface, renderer screens, shared i18n/types, CSS, and Electron packaging flows, but there is no equivalently durable set of architecture/API/schema/operator docs. The raw documentation corpus is also inflated by localized root docs and dated reports, so the true evergreen-reference depth is lower than the already-low 12.48% line-parity ratio suggests.

## Recommendations
1. Create `docs/index.md` with a status taxonomy: evergreen reference, active plan, report/audit, investigation, archived.
2. Add an evergreen architecture overview for `src/main`, `src/preload`, `src/renderer`, and `src/shared`, including ownership and runtime boundaries.
3. Add an IPC/preload contract reference for `window.hermesAPI`, channel naming, payload shapes, and handler ownership.
4. Add schema/reference docs for trace/session/config/profile/storage data that developers must preserve across changes.
5. Convert durable findings from investigations and large plans into stable reference docs, then mark the original artifacts as historical.
6. Add release, packaging, troubleshooting, and support/operator runbooks separate from dated implementation plans.
7. Track the docs/source LOC ratio as a trend metric, but do not treat literal 1:1 parity as the only quality bar.

## Preventive Measures
- Add PR checklist prompts for documentation updates when changes touch IPC channels, preload APIs, persistent schemas, release behavior, user-visible workflows, or major renderer screens.
- Require new durable docs for new subsystems before they exceed a meaningful size or become cross-boundary dependencies.
- Keep generated, localized, historical, and evergreen docs clearly labeled so documentation depth is not overstated by duplicate or stale material.
- Periodically rerun the LOC count and review the docs taxonomy to ensure the documentation set is growing as reference material, not only as investigation artifacts.
