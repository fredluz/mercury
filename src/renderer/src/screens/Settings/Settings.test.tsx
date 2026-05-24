import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "./Settings";

vi.mock("../../components/ThemeProvider", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
      removeItem: vi.fn((key: string) => store.delete(key)),
      clear: vi.fn(() => store.clear()),
    },
    configurable: true,
  });
}

function installHermesApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI = {
    getHermesHome: vi.fn().mockResolvedValue("/tmp/hermes"),
    getConfig: vi.fn().mockResolvedValue(null),
    getAppVersion: vi.fn().mockResolvedValue("0.0.0-test"),
    getHermesVersion: vi.fn().mockResolvedValue("1.0.0"),
    refreshHermesVersion: vi.fn().mockResolvedValue("1.0.0"),
    getHermesApprovedUpdate: vi.fn().mockResolvedValue(null),
    checkOpenClaw: vi.fn().mockResolvedValue({ found: false, path: null }),
    onInstallProgress: vi.fn().mockReturnValue(() => undefined),
    getRuntimeDiagnostic: vi.fn().mockResolvedValue(null),
    getConnectionConfig: vi.fn().mockResolvedValue({
      mode: "local",
      remoteUrl: "",
      apiKey: "",
      ssh: { host: "", port: 22, username: "", keyPath: "", remotePort: 8642, localPort: 18642 },
    }),
    isRemoteMode: vi.fn().mockResolvedValue(false),
    isRemoteOnlyMode: vi.fn().mockResolvedValue(false),
    discoverMemoryProviders: vi.fn().mockResolvedValue([]),
    checkForUpdates: vi.fn().mockResolvedValue(null),
  };
}

describe("Settings model entry removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installLocalStorageMock();
    installHermesApiMock();
  });

  it("does not expose the removed Models settings view", async () => {
    render(<Settings profile="work" />);

    await screen.findByText("settings.connectionSection");

    expect(screen.queryByRole("button", { name: "settings.openModels" })).not.toBeInTheDocument();
    expect(screen.getByText("settings.connectionSection")).toBeInTheDocument();
  });
});
