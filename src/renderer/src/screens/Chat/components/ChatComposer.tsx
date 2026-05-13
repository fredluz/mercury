import type React from "react";
import { Send, Square as Stop } from "lucide-react";
import type { RefObject } from "react";

interface ChatComposerProps {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  isLoading: boolean;
  hermesSessionId: string | null;
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
  onChange,
  onKeyDown,
  onAbort,
  onQuickAsk,
  onSend,
  t,
}: ChatComposerProps): React.JSX.Element {
  return (
    <div className="chat-input-wrapper">
      <textarea
        ref={inputRef}
        className="chat-input"
        placeholder={t("chat.typeMessage")}
        value={input}
        onChange={onChange}
        onKeyDown={onKeyDown}
        rows={1}
        disabled={isLoading}
        autoFocus
      />
      {isLoading ? (
        <button className="chat-send-btn chat-stop-btn" onClick={onAbort} title={t("common.stop")}>
          <Stop size={14} />
        </button>
      ) : (
        <>
          {input.trim() && hermesSessionId && (
            <button className="chat-btw-btn" onClick={onQuickAsk} title={t("chat.quickAskTitle")}>
              💭
            </button>
          )}
          <button className="chat-send-btn" onClick={onSend} disabled={!input.trim()} title={t("chat.send")}>
            <Send size={16} />
          </button>
        </>
      )}
    </div>
  );
}
