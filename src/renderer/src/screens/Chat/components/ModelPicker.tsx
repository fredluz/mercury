import type React from "react";
import { ChevronDown } from "lucide-react";
import type { RefObject } from "react";
import type { ModelGroup } from "../types";

interface ModelPickerProps {
  pickerRef: RefObject<HTMLDivElement | null>;
  displayModel: string;
  modelGroups: ModelGroup[];
  currentModel: string;
  currentProvider: string;
  customModelInput: string;
  showModelPicker: boolean;
  setShowModelPicker: (value: boolean) => void;
  setCustomModelInput: (value: string) => void;
  loadModelConfig: () => Promise<void>;
  selectModel: (provider: string, model: string, baseUrl: string) => void;
  handleCustomModelSubmit: () => void;
  t: (key: string) => string;
}

export function ModelPicker({
  pickerRef,
  displayModel,
  modelGroups,
  currentModel,
  currentProvider,
  customModelInput,
  showModelPicker,
  setShowModelPicker,
  setCustomModelInput,
  loadModelConfig,
  selectModel,
  handleCustomModelSubmit,
  t,
}: ModelPickerProps): React.JSX.Element {
  return (
    <div className="chat-model-bar" ref={pickerRef}>
      <button
        className="chat-model-trigger"
        onClick={() => {
          if (!showModelPicker) loadModelConfig();
          setShowModelPicker(!showModelPicker);
        }}
      >
        <span className="chat-model-name">{displayModel}</span>
        <ChevronDown size={12} />
      </button>

      {showModelPicker && (
        <div className="chat-model-dropdown">
          {modelGroups.map((group) => (
            <div key={group.provider} className="chat-model-group">
              <div className="chat-model-group-label">{t(group.providerLabel)}</div>
              {group.models.map((m) => (
                <button
                  key={`${m.provider}:${m.model}`}
                  className={`chat-model-option ${currentModel === m.model && currentProvider === m.provider ? "active" : ""}`}
                  onClick={() => selectModel(m.provider, m.model, m.baseUrl)}
                >
                  <span className="chat-model-option-label">{m.label}</span>
                  <span className="chat-model-option-id">{m.model}</span>
                </button>
              ))}
            </div>
          ))}

          <div className="chat-model-group">
            <div className="chat-model-group-label">{t("chat.custom")}</div>
            <div className="chat-model-custom">
              <input
                className="chat-model-custom-input"
                type="text"
                value={customModelInput}
                onChange={(e) => setCustomModelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomModelSubmit();
                }}
                placeholder={t("chat.typeModelName")}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
