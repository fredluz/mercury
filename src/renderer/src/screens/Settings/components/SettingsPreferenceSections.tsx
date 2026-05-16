import type React from "react";
import { Download, Upload, FileText } from "lucide-react";
import { THEME_OPTIONS } from "../../../constants";
import { APP_LOCALES, type AppLocale } from "../../../../../shared/i18n";

const LANGUAGE_LABEL_KEYS: Record<AppLocale, string> = {
  en: "settings.language.english",
  es: "settings.language.spanish",
  "pt-BR": "settings.language.portuguese",
  "zh-CN": "settings.language.chinese",
};

interface SettingsPreferenceSectionsProps {
  values: any;
}

export function SettingsPreferenceSections({ values }: SettingsPreferenceSectionsProps): React.JSX.Element {
  const {
  t,
  theme,
  setTheme,
  locale,
  setLocale,
  forceIpv4,
  setForceIpv4,
  httpProxy,
  setHttpProxy,
  networkSaved,
  setNetworkSaved,
  connMode,
  profile,
  backingUp,
  backupResult,
  importing,
  importResult,
  logsExpanded,
  setLogsExpanded,
  logFile,
  setLogFile,
  logPath,
  setLogPath,
  logContent,
  setLogContent,
  loadLogs,
  handleBackup,
  handleImport,
  } = values;
  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.sections.appearance")}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.theme.label")}
          </label>
          <div className="settings-theme-options">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`settings-theme-option ${theme === opt.value ? "active" : ""}`}
                onClick={() => setTheme(opt.value)}
              >
                {opt.value === "system"
                  ? t("settings.theme.system")
                  : opt.value === "light"
                    ? t("settings.theme.light")
                    : t("settings.theme.dark")}
              </button>
            ))}
          </div>
          <div className="settings-field-hint">
            {t("settings.appearanceHint")}
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.language.label")}
          </label>
          <div className="settings-theme-options">
            {APP_LOCALES.map((supportedLocale) => (
              <button
                key={supportedLocale}
                className={`settings-theme-option ${locale === supportedLocale ? "active" : ""}`}
                onClick={() => setLocale(supportedLocale)}
              >
                {t(LANGUAGE_LABEL_KEYS[supportedLocale])}
              </button>
            ))}
          </div>
          <div className="settings-field-hint">
            {t("settings.language.hint")}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.networkSection")}
          {networkSaved && (
            <span className="settings-saved" style={{ marginLeft: 8 }}>
              {t("settings.saved")}
            </span>
          )}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.forceIpv4")}
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={forceIpv4}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setForceIpv4(val);
                  await window.hermesAPI.setConfig(
                    "network.force_ipv4",
                    val ? "true" : "false",
                    profile,
                  );
                  setNetworkSaved(true);
                  setTimeout(() => setNetworkSaved(false), 2000);
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            {t("settings.forceIpv4Hint")}
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.httpProxy")}
          </label>
          <input
            className="input"
            type="text"
            value={httpProxy}
            onChange={(e) => setHttpProxy(e.target.value)}
            onBlur={async () => {
              await window.hermesAPI.setConfig(
                "network.proxy",
                httpProxy.trim(),
                profile,
              );
              setNetworkSaved(true);
              setTimeout(() => setNetworkSaved(false), 2000);
            }}
            placeholder={t("settings.proxyPlaceholder")}
          />
          <div className="settings-field-hint">
            {t("settings.httpProxyHint")}
          </div>
        </div>
      </div>

      {connMode === "remote" && (
        <div className="settings-section">
          <div className="settings-section-title">
            {t("settings.serverConfigTitle")}
          </div>
          <div
            className="settings-field-hint"
            dangerouslySetInnerHTML={{ __html: t("settings.serverConfigHint") }}
          />
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.dataSection")}
        </div>
        <div className="settings-field">
          <div className="settings-field-hint" style={{ marginBottom: 10 }}>
            {t("settings.dataHint")}
          </div>
          <div className="settings-hermes-actions">
            <button
              className="btn btn-secondary"
              onClick={handleBackup}
              disabled={backingUp}
            >
              <Download size={14} style={{ marginRight: 6 }} />
              {backingUp ? t("settings.backingUp") : t("settings.exportBackup")}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleImport}
              disabled={importing}
            >
              <Upload size={14} style={{ marginRight: 6 }} />
              {importing ? t("settings.importing") : t("settings.importBackup")}
            </button>
          </div>
          {backupResult && (
            <div
              className={`settings-hermes-result ${backupResult.includes("created") || backupResult.includes("success") ? "success" : "error"}`}
              style={{ marginTop: 8 }}
            >
              {backupResult}
            </div>
          )}
          {importResult && (
            <div
              className={`settings-hermes-result ${importResult.includes("complete") ? "success" : "error"}`}
              style={{ marginTop: 8 }}
            >
              {importResult}
            </div>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          <span
            style={{ cursor: "pointer" }}
            onClick={() => {
              const next = !logsExpanded;
              setLogsExpanded(next);
              if (next) loadLogs();
            }}
          >
            <FileText
              size={14}
              style={{ marginRight: 6, verticalAlign: "middle" }}
            />
            {t("settings.logsSection")} {logsExpanded ? "▾" : "▸"}
          </span>
        </div>
        {logsExpanded && (
          <div className="settings-field">
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {["gateway.log", "agent.log", "errors.log"].map((f) => (
                <button
                  key={f}
                  className={`btn btn-sm ${logFile === f ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => {
                    setLogFile(f);
                    window.hermesAPI.readLogs(f, 300, profile).then((r) => {
                      setLogContent(r.content);
                      setLogPath(r.path);
                    });
                  }}
                >
                  {f.replace(".log", "")}
                </button>
              ))}
              <button className="btn btn-sm btn-secondary" onClick={loadLogs}>
                {t("settings.refresh")}
              </button>
            </div>
            {logPath && (
              <div className="settings-field-hint" style={{ marginBottom: 4 }}>
                {logPath}
              </div>
            )}
            <pre
              className="settings-hermes-doctor"
              style={{
                maxHeight: 300,
                overflow: "auto",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {logContent || t("settings.emptyLog")}
            </pre>
          </div>
        )}
      </div>
    </>
  );
}
