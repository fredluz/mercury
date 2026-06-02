import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileInfo } from "../../../../shared/profiles";
import AgentAvatar from "./AgentAvatar";

const baseProfile: ProfileInfo = {
  name: "default",
  path: "/profiles/default",
  isDefault: true,
  isActive: true,
  model: "gpt-4o",
  provider: "openai",
  hasEnv: true,
  hasSoul: true,
  skillCount: 0,
  skillPackCount: 0,
  memoryCount: 0,
  gatewayRunning: false,
  displayName: "Mercury",
  kind: "builtin",
  immutable: true,
  deletable: false,
  selectedPackIds: [],
  docsPointers: [],
};

function customProfile(name: string, updatedAt?: string): ProfileInfo {
  return {
    ...baseProfile,
    name,
    path: `/profiles/${name}`,
    isDefault: false,
    isActive: false,
    displayName: "Research Buddy",
    kind: "custom",
    immutable: false,
    deletable: true,
    avatar: updatedAt
      ? {
          path: "avatar.png",
          contentType: "image/png",
          updatedAt,
          byteLength: 42,
        }
      : undefined,
  };
}

function installAvatarApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI = {
    getAgentAvatarDataUrl: vi.fn().mockResolvedValue({
      success: true,
      dataUrl: "data:image/png;base64,avatar",
      avatar: {
        path: "avatar.png",
        contentType: "image/png",
        updatedAt: "2026-06-02T12:00:00.000Z",
      },
    }),
  };
}

describe("AgentAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installAvatarApiMock();
  });

  it("always renders MercuryMark for default/builtin profiles without loading avatar data", () => {
    const { container } = render(
      <AgentAvatar profile={baseProfile} className="avatar" markSize={30} />,
    );

    expect(container.querySelector("img.mercury-mark")).toBeInTheDocument();
    expect(window.hermesAPI.getAgentAvatarDataUrl).not.toHaveBeenCalled();
  });

  it("renders initials for a full custom profile without avatar metadata", () => {
    render(<AgentAvatar profile={customProfile("no-avatar")} className="avatar" />);

    expect(screen.getByText("R")).toBeInTheDocument();
    expect(window.hermesAPI.getAgentAvatarDataUrl).not.toHaveBeenCalled();
  });

  it("loads and renders a custom avatar image when metadata is present", async () => {
    const { container } = render(
      <AgentAvatar
        profile={customProfile("with-avatar", "2026-06-02T12:00:00.000Z")}
        className="avatar"
      />,
    );

    await waitFor(() => {
      expect(window.hermesAPI.getAgentAvatarDataUrl).toHaveBeenCalledWith(
        "with-avatar",
      );
      expect(container.querySelector("img.agent-avatar-image")).toHaveAttribute(
        "src",
        "data:image/png;base64,avatar",
      );
    });
  });

  it("revalidates profile-name mode even when an older avatar is cached", async () => {
    vi.mocked(window.hermesAPI.getAgentAvatarDataUrl)
      .mockResolvedValueOnce({
        success: true,
        dataUrl: "data:image/png;base64,old",
        avatar: {
          path: "avatar.png",
          contentType: "image/png",
          updatedAt: "2026-06-02T12:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({ success: true, dataUrl: null });

    const first = render(
      <AgentAvatar
        profileName="name-mode-avatar"
        displayName="Name Mode"
        kind="custom"
        isDefault={false}
        avatar={{
          path: "avatar.png",
          contentType: "image/png",
          updatedAt: "2026-06-02T12:00:00.000Z",
        }}
        className="avatar"
      />,
    );
    await waitFor(() => {
      expect(first.container.querySelector("img.agent-avatar-image")).toHaveAttribute(
        "src",
        "data:image/png;base64,old",
      );
    });
    first.unmount();

    const second = render(
      <AgentAvatar
        profileName="name-mode-avatar"
        displayName="Name Mode"
        kind="custom"
        isDefault={false}
        className="avatar"
      />,
    );

    await waitFor(() => {
      expect(window.hermesAPI.getAgentAvatarDataUrl).toHaveBeenCalledTimes(2);
      expect(second.container.querySelector("img.agent-avatar-image")).not.toBeInTheDocument();
      expect(screen.getByText("N")).toBeInTheDocument();
    });
  });
});
