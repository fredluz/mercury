import type { RefObject } from "react";

interface ModelPickerProps {
  pickerRef: RefObject<HTMLDivElement | null>;
  displayModel: string;
  loadModelConfig: () => Promise<void>;
  onOpenProviders?: () => void;
  t: (key: string) => string;
}

export function ModelPicker({
  pickerRef,
  displayModel,
  loadModelConfig,
  onOpenProviders,
  t,
}: ModelPickerProps): React.JSX.Element {
  return (
    <div className="model-picker-container" ref={pickerRef}>
      <div className="model-picker-readonly" aria-label={t("chat.currentModel")}>
        <span className="model-picker-label">{t("chat.currentModel")}</span>
        <span className="model-picker-current">{displayModel}</span>
      </div>
      <button
        className="model-picker-configure"
        type="button"
        onClick={() => {
          void loadModelConfig();
          onOpenProviders?.();
        }}
      >
        {t("chat.configureAgent")}
      </button>
    </div>
  );
}
