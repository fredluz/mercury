import type React from "react";
import { Plus, Trash } from "../../../assets/icons";
import { Check, ExternalLink } from "lucide-react";

const PROVIDER_URLS: Record<string, string> = {
  honcho: "https://app.honcho.dev",
  hindsight: "https://ui.hindsight.vectorize.io",
  mem0: "https://app.mem0.ai",
  retaindb: "https://retaindb.com",
  supermemory: "https://supermemory.ai",
  byterover: "https://app.byterover.dev",
};

interface MemoryPanelsProps { values: any; }

export function MemoryPanels({ values }: MemoryPanelsProps): React.JSX.Element {
  const {
  tab,
  t,
  data,
  showAdd,
  setShowAdd,
  newEntry,
  setNewEntry,
  handleAddEntry,
  editingIndex,
  setEditingIndex,
  editContent,
  setEditContent,
  handleSaveEdit,
  confirmDelete,
  setConfirmDelete,
  handleDeleteEntry,
  userSaved,
  userContent,
  setUserContent,
  setUserEditing,
  userEditing,
  handleSaveUserProfile,
  memoryProvider,
  providers,
  providerEnv,
  setProviderEnv,
  providerSavedKey,
  setProviderSavedKey,
  profile,
  activating,
  setActivating,
  setMemoryProvider,
  setProviders,
  } = values;
  return (
    <>
      {/* Agent Memory Entries */}
      {tab === "entries" && (
        <div className="memory-entries">
          <div className="memory-entries-header">
            <span className="memory-entries-count">
              {t("memory.entries", { count: data.memory.entries.length })}
            </span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowAdd(!showAdd)}
            >
              <Plus size={13} />
              {t("memory.addMemory")}
            </button>
          </div>

          {showAdd && (
            <div className="memory-entry-form">
              <textarea
                className="memory-entry-textarea"
                value={newEntry}
                onChange={(e) => setNewEntry(e.target.value)}
                placeholder={t("memory.entriesPlaceholder")}
                rows={3}
                autoFocus
              />
              <div className="memory-entry-form-actions">
                <span className="memory-entry-chars">
                  {newEntry.length} chars
                </span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setShowAdd(false);
                    setNewEntry("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleAddEntry}
                  disabled={!newEntry.trim()}
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {data.memory.entries.length === 0 ? (
            <div className="memory-empty">
              <p>
                {t("memory.noMemoriesYet")}
              </p>
              <p className="memory-empty-hint">
                {t("memory.addManuallyHint")}
              </p>
            </div>
          ) : (
            data.memory.entries.map((entry) => (
              <div key={entry.index} className="memory-entry-card">
                {editingIndex === entry.index ? (
                  <div className="memory-entry-form">
                    <textarea
                      className="memory-entry-textarea"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={3}
                      autoFocus
                    />
                    <div className="memory-entry-form-actions">
                      <span className="memory-entry-chars">
                        {t("memory.chars", { count: editContent.length })}
                      </span>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditingIndex(null)}
                      >
                        {t("memory.cancel")}
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleSaveEdit}
                      >
                        {t("memory.save")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="memory-entry-content">{entry.content}</div>
                    <div className="memory-entry-actions">
                      <button
                        className="btn-ghost memory-entry-btn"
                        onClick={() => {
                          setEditingIndex(entry.index);
                          setEditContent(entry.content);
                        }}
                      >
                        {t("memory.edit")}
                      </button>
                      {confirmDelete === entry.index ? (
                        <span className="memory-entry-confirm">
                          {t("memory.deleteConfirm")}
                          <button
                            className="btn-ghost"
                            style={{ color: "var(--error)" }}
                            onClick={() => handleDeleteEntry(entry.index)}
                          >
                            {t("memory.yes")}
                          </button>
                          <button
                            className="btn-ghost"
                            onClick={() => setConfirmDelete(null)}
                          >
                            {t("memory.no")}
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn-ghost memory-entry-btn"
                          onClick={() => setConfirmDelete(entry.index)}
                        >
                          <Trash size={13} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* User Profile */}
      {tab === "profile" && (
        <div className="memory-profile">
          <div className="memory-profile-header">
            <span className="memory-profile-hint">
              {t("memory.userProfileHint")}
            </span>
            {userSaved && (
              <span
                style={{
                  color: "var(--success)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {t("common.saved")}
              </span>
            )}
          </div>
          <textarea
            className="memory-profile-textarea"
            value={userContent}
            onChange={(e) => {
              setUserContent(e.target.value);
              setUserEditing(true);
            }}
            placeholder={t("memory.userProfilePlaceholder")}
            rows={8}
          />
          <div className="memory-profile-footer">
            <span className="memory-entry-chars">
              {t("memory.chars", { count: userContent.length })} / {data.user.charLimit} {t("memory.chars", { count: 1 }).split(" ")[1]}
            </span>
            {userEditing && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveUserProfile}
              >
                {t("memory.saveProfile")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Memory Providers */}
      {tab === "providers" && (
        <div className="memory-providers">
          <div className="memory-providers-hint">
            {t("memory.providersHint")}
            {memoryProvider ? (
              <span dangerouslySetInnerHTML={{ __html: t("memory.providersHintActive", { provider: memoryProvider }) }} />
            ) : (
              <span> {t("memory.providersHintInactive")}</span>
            )}
          </div>

          {providers.length === 0 ? (
            <div className="memory-empty">
              <p>{t("memory.noProvidersFound")}</p>
            </div>
          ) : (
            <div className="memory-providers-grid">
              {providers.map((p) => (
                <div
                  key={p.name}
                  className={`memory-provider-card ${p.active ? "memory-provider-active" : ""}`}
                >
                  <div className="memory-provider-header">
                    <div className="memory-provider-name">
                      {p.name}
                      {p.active && (
                        <span className="memory-provider-badge">
                          <Check size={10} /> {t("memory.active")}
                        </span>
                      )}
                    </div>
                    {PROVIDER_URLS[p.name] && (
                      <button
                        className="btn-ghost"
                        style={{ padding: 2, opacity: 0.6 }}
                        onClick={() =>
                          window.hermesAPI.openExternal(PROVIDER_URLS[p.name])
                        }
                        title={t("memory.openProviderWebsite")}
                      >
                        <ExternalLink size={12} />
                      </button>
                    )}
                  </div>
                  <div className="memory-provider-desc">{t(p.description)}</div>

                  {/* Env var config fields */}
                  {p.envVars.length > 0 && (
                    <div className="memory-provider-fields">
                      {p.envVars.map((envKey) => (
                        <div key={envKey} className="memory-provider-field">
                          <label className="memory-provider-field-label">
                            {envKey}
                            {providerSavedKey === envKey && (
                              <span
                                style={{
                                  color: "var(--success)",
                                  fontSize: 10,
                                  marginLeft: 6,
                                }}
                              >
                                {t("common.saved")}
                              </span>
                            )}
                          </label>
                          <input
                            className="input"
                            type="password"
                            value={providerEnv[envKey] || ""}
                            onChange={(e) =>
                              setProviderEnv((prev) => ({
                                ...prev,
                                [envKey]: e.target.value,
                              }))
                            }
                            onBlur={async () => {
                              await window.hermesAPI.setEnv(
                                envKey,
                                providerEnv[envKey] || "",
                                profile,
                              );
                              setProviderSavedKey(envKey);
                              setTimeout(() => setProviderSavedKey(null), 2000);
                            }}
                            placeholder={t("memory.enterEnvKey", { key: envKey })}
                            style={{ fontSize: 12 }}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="memory-provider-actions">
                    {p.active ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                          setActivating(p.name);
                          await window.hermesAPI.setConfig(
                            "memory.provider",
                            "",
                            profile,
                          );
                          setMemoryProvider(null);
                          setProviders((prev) =>
                            prev.map((pr) => ({ ...pr, active: false })),
                          );
                          setActivating(null);
                        }}
                        disabled={activating !== null}
                      >
                        {t("memory.deactivate")}
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={async () => {
                          setActivating(p.name);
                          await window.hermesAPI.setConfig(
                            "memory.provider",
                            p.name,
                            profile,
                          );
                          setMemoryProvider(p.name);
                          setProviders((prev) =>
                            prev.map((pr) => ({
                              ...pr,
                              active: pr.name === p.name,
                            })),
                          );
                          setActivating(null);
                        }}
                        disabled={activating !== null}
                      >
                        {activating === p.name ? t("memory.activating") : t("memory.activate")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
