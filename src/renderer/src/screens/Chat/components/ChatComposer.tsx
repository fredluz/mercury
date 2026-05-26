import type React from "react";
import { Send, Square as Stop } from "lucide-react";
import type { RefObject } from "react";

interface ChatComposerProps {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  isLoading: boolean;
  hermesSessionId: string | null;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onAbort: () => void;
  onQuickAsk: () => void;
  onSend: () => void;
  t: (key: string) => string;
}

export function ChatComposer({
  inputRef,
  input,
  isLoading,
  hermesSessionId,
  disabled = false,
  disabledReason,
  onChange,
  onKeyDown,
  onAbort,
  onQuickAsk,
  onSend,
  t,
}: ChatComposerProps): React.JSX.Element {
  const inputDisabled = isLoading || disabled;
  const sendDisabled = disabled || !input.trim();
  const placeholder = disabled
    ? disabledReason || t("chat.runtimeInputDisabled")
    : t("chat.typeMessage");

  return (
    <div className={`chat-input-wrapper ${disabled ? "chat-input-wrapper-disabled" : ""}`}>
      <textarea
        ref={inputRef}
        className="chat-input"
        placeholder={placeholder}
        value={input}
        onChange={onChange}
        onKeyDown={onKeyDown}
        rows={1}
        disabled={inputDisabled}
        autoFocus
      />
      {isLoading ? (
        <button className="chat-send-btn chat-stop-btn" onClick={onAbort} title={t("common.stop")}>
          <Stop size={14} />
        </button>
      ) : (
        <>
          {input.trim() && hermesSessionId && !disabled && (
            <button className="chat-btw-btn" onClick={onQuickAsk} title={t("chat.quickAskTitle")}>
              💭
            </button>
          )}
          <button className="chat-send-btn" onClick={onSend} disabled={sendDisabled} title={disabled ? placeholder : t("chat.send")}>
            <Send size={16} />
          </button>
        </>
      )}
    </div>
  );
}
