import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  RuntimeDiagnosticNotice,
  runtimeDiagnosticMessage,
} from "./RuntimeDiagnosticNotice";
import type { RuntimeDiagnostic } from "../../../shared/runtime";

const baseStale: RuntimeDiagnostic = {
  selectedProfile: "default",
  requestedProfile: "default",
  actualProfile: "default",
  verified: false,
  verificationSource: "managed-process",
  mode: "local",
  transport: "api",
  status: "stale",
  authSource: "none",
  startedByMercury: true,
  stale: true,
  staleReason: "Skills changed for profile runtime.",
};

describe("runtimeDiagnosticMessage stale apply states", () => {
  it("explains idle-gated apply when pending-idle", () => {
    const message = runtimeDiagnosticMessage({
      ...baseStale,
      runtimeApplyStatus: "pending-idle",
    });
    expect(message).toBe(
      "Skill changes saved. Mercury will apply them when chat and gateway work are idle.",
    );
  });

  it("explains the in-progress restart when applying", () => {
    const message = runtimeDiagnosticMessage({
      ...baseStale,
      runtimeApplyStatus: "applying",
    });
    expect(message).toBe(
      "Skill changes saved. Mercury is restarting the runtime now.",
    );
  });

  it("explains pending confirmation when background work is active", () => {
    const message = runtimeDiagnosticMessage({
      ...baseStale,
      runtimeApplyStatus: "pending-confirm",
    });
    expect(message).toBe(
      "Skill changes are ready, but a background task is still running. Applying now will stop it.",
    );
  });

  it("surfaces the failure reason when an apply fails", () => {
    const message = runtimeDiagnosticMessage({
      ...baseStale,
      runtimeApplyStatus: "failed",
      runtimeApplyFailureReason: "gateway exited with code 1",
    });
    expect(message).toBe("Runtime update failed: gateway exited with code 1");
  });

  it("does not claim automatic apply for a generic stale runtime", () => {
    const message = runtimeDiagnosticMessage({
      ...baseStale,
      staleReason: "Memory changed for profile runtime.",
    });
    expect(message).not.toMatch(/automatically/i);
    expect(message).toBe("Memory changed for profile runtime.");
  });
});

describe("RuntimeDiagnosticNotice rendering", () => {
  it("renders the pending-idle label and message", () => {
    render(
      <RuntimeDiagnosticNotice
        diagnostic={{ ...baseStale, runtimeApplyStatus: "pending-idle" }}
      />,
    );
    expect(screen.getByText("Runtime update pending")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Skill changes saved. Mercury will apply them when chat and gateway work are idle.",
      ),
    ).toBeInTheDocument();
  });

  it("renders pending-confirm actions", async () => {
    (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI = {
      applyPendingRuntimeUpdateNow: vi.fn().mockResolvedValue(true),
      deferPendingRuntimeUpdate: vi.fn().mockResolvedValue(true),
    };
    render(
      <RuntimeDiagnosticNotice
        diagnostic={{ ...baseStale, runtimeApplyStatus: "pending-confirm" }}
      />,
    );

    expect(screen.getByText("Runtime update waiting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
  });

  it("uses a warn tone for a failed apply", () => {
    const { container } = render(
      <RuntimeDiagnosticNotice
        diagnostic={{ ...baseStale, runtimeApplyStatus: "failed" }}
      />,
    );
    expect(
      container.querySelector(".runtime-diagnostic-warn"),
    ).toBeInTheDocument();
    expect(screen.getByText("Runtime update failed")).toBeInTheDocument();
  });
});
