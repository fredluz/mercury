import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "../../components/ThemeProvider";
import { useI18n } from "../../components/useI18n";
import { SettingsCoreSections } from "./components/SettingsCoreSections";
import { SettingsPreferenceSections } from "./components/SettingsPreferenceSections";
import type { RuntimeDiagnostic } from "../../../../shared/runtime";

// Read cached values from localStorage for instant display
function getCachedVersion(): string | null {
  try {
    return localStorage.getItem("hermes-version-cache");
  } catch {
    return null;
  }
}

function getCachedOpenClaw(): { found: boolean; path: string | null } | null {
  try {
    const raw = localStorage.getItem("hermes-openclaw-cache");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function Settings({
  profile,
  runtimeDiagnostic,
}: {
  profile?: string;
  runtimeDiagnostic?: RuntimeDiagnostic | null;
}): React.JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const [hermesHome, setHermesHome] = useState("");
  const { theme, setTheme } = useTheme();

  // Hermes engine info — initialize from localStorage cache for instant display
  const [hermesVersion, setHermesVersion] = useState<string | null>(
    getCachedVersion,
  );
  const [appVersion, setAppVersion] = useState("");
  const [doctorOutput, setDoctorOutput] = useState<string | null>(null);
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [updateResultType, setUpdateResultType] = useState<
    "success" | "error" | null
  >(null);

  // OpenClaw migration — initialize from localStorage cache
  const cachedClaw = getCachedOpenClaw();
  const [openclawFound, setOpenclawFound] = useState(
    cachedClaw?.found ?? false,
  );
  const [openclawPath, setOpenclawPath] = useState<string | null>(
    cachedClaw?.path ?? null,
  );
  const [migrationDismissed, setMigrationDismissed] = useState(
    () => localStorage.getItem("hermes-openclaw-dismissed") === "true",
  );
  const [migrating, setMigrating] = useState(false);
  const [migrationLog, setMigrationLog] = useState("");
  const [migrationResult, setMigrationResult] = useState<string | null>(null);
  const [migrationResultType, setMigrationResultType] = useState<
    "success" | "error" | null
  >(null);
  const migrationLogRef = useRef<HTMLPreElement>(null);

  // Connection mode
  const [connMode, setConnMode] = useState<"local" | "remote" | "ssh">("local");
  const [connRemoteUrl, setConnRemoteUrl] = useState("");
  const [connApiKey, setConnApiKey] = useState("");
  const [connTesting, setConnTesting] = useState(false);
  const [connStatus, setConnStatus] = useState<string | null>(null);
  const connLoaded = useRef(false);

  // SSH connection state
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshRemotePort, setSshRemotePort] = useState("");

  // Backup / Import state
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // Log viewer state
  const [logContent, setLogContent] = useState("");
  const [logFile, setLogFile] = useState("gateway.log");
  const [logPath, setLogPath] = useState("");
  const [logsExpanded, setLogsExpanded] = useState(false);

  // Network settings
  const [forceIpv4, setForceIpv4] = useState(false);
  const [httpProxy, setHttpProxy] = useState("");
  const [networkSaved, setNetworkSaved] = useState(false);

  // Debug dump
  const [dumpOutput, setDumpOutput] = useState<string | null>(null);
  const [dumpRunning, setDumpRunning] = useState(false);

  const loadConfig = useCallback(async (): Promise<void> => {
    // Load fast config first (cached in main process)
    const [home, aVersion, conn] = await Promise.all([
      window.hermesAPI.getHermesHome(profile),
      window.hermesAPI.getAppVersion(),
      window.hermesAPI.getConnectionConfig(),
    ]);
    setHermesHome(home);
    setAppVersion(aVersion);
    setConnMode(conn.mode);
    setConnRemoteUrl(conn.remoteUrl);
    setConnApiKey(conn.apiKey);
    setSshHost(conn.ssh?.host || "");
    setSshPort(conn.ssh?.port ? String(conn.ssh.port) : "");
    setSshUser(conn.ssh?.username || "");
    setSshKeyPath(conn.ssh?.keyPath || "");
    setSshRemotePort(conn.ssh?.remotePort ? String(conn.ssh.remotePort) : "");
    connLoaded.current = true;

    // Load network settings from config.yaml
    window.hermesAPI.getConfig("network.force_ipv4", profile).then((v) => {
      setForceIpv4(v === "true" || v === "True");
    });
    window.hermesAPI.getConfig("network.proxy", profile).then((v) => {
      setHttpProxy(v || "");
    });

    // Defer slow calls — background refresh, cached values show instantly
    window.hermesAPI.getHermesVersion().then((v) => {
      setHermesVersion(v);
      if (v) {
        try {
          localStorage.setItem("hermes-version-cache", v);
        } catch {
          /* ignore */
        }
      }
    });

    if (localStorage.getItem("hermes-openclaw-dismissed") !== "true") {
      window.hermesAPI.checkOpenClaw().then((claw) => {
        setOpenclawFound(claw.found);
        setOpenclawPath(claw.path);
        try {
          localStorage.setItem("hermes-openclaw-cache", JSON.stringify(claw));
        } catch {
          /* ignore */
        }
      });
    }
  }, [profile]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  async function handleMigrate(): Promise<void> {
    setMigrating(true);
    setMigrationLog("");
    setMigrationResult(null);

    const cleanup = window.hermesAPI.onInstallProgress((p) => {
      setMigrationLog(p.log);
    });

    try {
      const result = await window.hermesAPI.runClawMigrate();
      cleanup();
      if (result.success) {
        setMigrationResult(t("settings.migrationComplete"));
        setMigrationResultType("success");
        setOpenclawFound(false);
      } else {
        setMigrationResult(result.error || t("settings.migrationFailed"));
        setMigrationResultType("error");
      }
    } catch (err) {
      cleanup();
      setMigrationResult(
        (err as Error).message || t("settings.migrationFailed"),
      );
      setMigrationResultType("error");
    }
    setMigrating(false);
  }

  function handleDismissMigration(): void {
    localStorage.setItem("hermes-openclaw-dismissed", "true");
    setMigrationDismissed(true);
  }

  async function handleSaveConnection(): Promise<void> {
    if (connMode === "ssh") {
      await window.hermesAPI.setSshConfig(
        sshHost.trim(),
        parseInt(sshPort, 10) || 22,
        sshUser.trim(),
        sshKeyPath.trim(),
        parseInt(sshRemotePort, 10) || 8642,
        18642,
      );
    } else {
      await window.hermesAPI.setConnectionConfig(connMode, connRemoteUrl, connApiKey);
    }
    setConnStatus("Saved");
    setTimeout(() => setConnStatus(null), 2000);
  }

  async function handleTestConnection(): Promise<void> {
    if (connMode === "ssh") {
      if (!sshHost.trim() || !sshUser.trim()) {
        setConnStatus("Host and username are required");
        return;
      }
      setConnTesting(true);
      setConnStatus(null);
      const ok = await window.hermesAPI.testSshConnection(
        sshHost.trim(),
        parseInt(sshPort, 10) || 22,
        sshUser.trim(),
        sshKeyPath.trim(),
        parseInt(sshRemotePort, 10) || 8642,
      );
      setConnTesting(false);
      setConnStatus(ok ? "SSH tunnel connected!" : "Could not connect via SSH");
    } else {
      const url = connRemoteUrl.trim();
      if (!url) { setConnStatus("Please enter a URL"); return; }
      setConnTesting(true);
      setConnStatus(null);
      const ok = await window.hermesAPI.testRemoteConnection(url, connApiKey.trim());
      setConnTesting(false);
      setConnStatus(ok ? "Connected successfully!" : "Could not reach server");
    }
  }

  async function handleSwitchToLocal(): Promise<void> {
    setConnMode("local");
    setConnRemoteUrl("");
    setConnApiKey("");
    await window.hermesAPI.setConnectionConfig("local", "", "");
    setConnStatus(t("settings.switchedToLocal"));
    setTimeout(() => setConnStatus(null), 2000);
  }

  async function handleBackup(): Promise<void> {
    setBackingUp(true);
    setBackupResult(null);
    const result = await window.hermesAPI.runHermesBackup(profile);
    setBackingUp(false);
    if (result.success) {
      setBackupResult(`Backup created: ${result.path || "success"}`);
    } else {
      setBackupResult(result.error || "Backup failed.");
    }
  }

  async function handleImport(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tar.gz,.tgz,.zip";
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      setImportResult(null);
      const filePath = (file as File & { path: string }).path;
      const result = await window.hermesAPI.runHermesImport(filePath, profile);
      setImporting(false);
      if (result.success) {
        setImportResult(t("settings.migrationComplete"));
      } else {
        setImportResult(result.error || t("settings.migrationFailed"));
      }
    };
    input.click();
  }

  async function loadLogs(): Promise<void> {
    const result = await window.hermesAPI.readLogs(logFile, 300, profile);
    setLogContent(result.content);
    setLogPath(result.path);
  }

  async function handleDoctor(): Promise<void> {
    setDoctorRunning(true);
    setDoctorOutput(null);
    const output = await window.hermesAPI.runHermesDoctor();
    setDoctorOutput(output);
    setDoctorRunning(false);
  }

  // Helper to fetch fresh version, clear backend cache, and update localStorage
  function refreshVersion(): void {
    window.hermesAPI.refreshHermesVersion().then((v) => {
      setHermesVersion(v);
      if (v) {
        try {
          localStorage.setItem("hermes-version-cache", v);
        } catch {
          /* ignore */
        }
      }
    });
  }

  async function handleUpdateHermes(): Promise<void> {
    setUpdating(true);
    setUpdateResult(null);
    const result = await window.hermesAPI.runHermesUpdate(profile);
    setUpdating(false);
    if (result.success) {
      setUpdateResult(t("settings.updateSuccess"));
      setUpdateResultType("success");
      refreshVersion();
    } else {
      setUpdateResult(result.error || t("settings.updateFailed"));
      setUpdateResultType("error");
    }
  }

  // Parse "Hermes Agent v0.7.0 (2026.4.3) Project: ... Python: 3.11.15 OpenAI SDK: 2.30.0 Update available: ..."
  const parsedVersion = (() => {
    if (!hermesVersion) return null;
    const v = hermesVersion;
    const version = v.match(/v([\d.]+)/)?.[1] || "";
    const date = v.match(/\(([\d.]+)\)/)?.[1] || "";
    const python = v.match(/Python:\s*([\d.]+)/)?.[1] || "";
    const sdk = v.match(/OpenAI SDK:\s*([\d.]+)/)?.[1] || "";
    const updateMatch = v.match(/Update available:\s*(.+?)(?:\s*—|$)/);
    const updateInfo = updateMatch?.[1]?.trim() || null;
    return { version, date, python, sdk, updateInfo };
  })();

  const sectionValues = {
        t,
        locale,
        setLocale,
        hermesHome,
        theme,
        setTheme,
        hermesVersion,
        appVersion,
        doctorOutput,
        doctorRunning,
        updating,
        updateResult,
        updateResultType,
        openclawFound,
        openclawPath,
        migrationDismissed,
        migrating,
        migrationLog,
        migrationResult,
        migrationResultType,
        migrationLogRef,
        connMode,
        setConnMode,
        connRemoteUrl,
        setConnRemoteUrl,
        connApiKey,
        setConnApiKey,
        connTesting,
        connStatus,
        connLoaded,
        sshHost,
        setSshHost,
        sshPort,
        setSshPort,
        sshUser,
        setSshUser,
        sshKeyPath,
        setSshKeyPath,
        sshRemotePort,
        setSshRemotePort,
        backingUp,
        backupResult,
        importing,
        importResult,
        logContent,
        setLogContent,
        logFile,
        setLogFile,
        logPath,
        setLogPath,
        logsExpanded,
        setLogsExpanded,
        forceIpv4,
        setForceIpv4,
        httpProxy,
        setHttpProxy,
        networkSaved,
        setNetworkSaved,
        dumpOutput,
        setDumpOutput,
        dumpRunning,
        setDumpRunning,
        parsedVersion,
        handleMigrate,
        handleDismissMigration,
        handleSaveConnection,
        handleTestConnection,
        handleSwitchToLocal,
        handleBackup,
        handleImport,
        loadLogs,
        handleDoctor,
        handleUpdateHermes,
        profile,
        runtimeDiagnostic,
      };

  return (
    <div className="settings-container">
      <SettingsCoreSections values={sectionValues} />
      <SettingsPreferenceSections values={sectionValues} />
    </div>
  );
}

export default Settings;
