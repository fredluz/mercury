import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "./Settings";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

vi.mock("../../components/ThemeProvider", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

vi.mock("../Models/Models", () => ({
  default: ({ onBack }: { onBack?: () => void }) => (
    <div>
      <h1>Models settings mock</h1>
      <button onClick={onBack}>Back from models</button>
    </div>
  ),
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
    getAppVersion: vi.fn().mockResolvedValue("1.0.0"),
    getConnectionConfig: vi.fn().mockResolvedValue({
      mode: "local",
      remoteUrl: "",
      apiKey: "",
      ssh: {},
    }),
    getConfig: vi.fn().mockResolvedValue(null),
    getHermesVersion: vi.fn().mockResolvedValue(null),
    getHermesApprovedUpdate: vi.fn().mockResolvedValue({
      currentVersion: null,
      recommendedVersion: null,
      summary: null,
      notesUrl: null,
      breakingChange: false,
      canUpdate: false,
      reason: "current",
    }),
    checkOpenClaw: vi.fn().mockResolvedValue({ found: false, path: null }),
  };
}

describe("Settings Models entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installLocalStorageMock();
    window.localStorage.clear();
    installHermesApiMock();
  });

  it("opens Models as a dedicated Settings view", async () => {
    render(<Settings profile="work" />);

    await waitFor(() =>
      expect(window.hermesAPI.getConnectionConfig).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "settings.openModels" }));

    expect(screen.getByText("Models settings mock")).toBeInTheDocument();
    expect(screen.queryByText("settings.connectionSection")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back from models" }));
    expect(screen.getByText("settings.connectionSection")).toBeInTheDocument();
  });
});
