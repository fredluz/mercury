interface ModelPickerProps {
  displayModel: string;
  disabled?: boolean;
  onOpen: () => void;
}

export function ModelPicker({
  displayModel,
  disabled = false,
  onOpen,
}: ModelPickerProps): React.JSX.Element {
  return (
    <div className="chat-model-picker">
      <button
        className="chat-model-badge"
        type="button"
        onClick={onOpen}
        disabled={disabled}
        aria-label={displayModel}
        title={displayModel}
      >
        <span className="chat-model-badge-text">{displayModel}</span>
      </button>
    </div>
  );
}
