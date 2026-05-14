import type React from "react";
import { MercuryAvatar } from "./MessageRow";

export function ChatLoading(): React.JSX.Element {
  return (
    <div className="chat-message chat-message-agent">
      <MercuryAvatar />
      <div className="chat-bubble chat-bubble-agent">
        <div className="chat-typing">
          <span className="chat-typing-dot" />
          <span className="chat-typing-dot" />
          <span className="chat-typing-dot" />
        </div>
      </div>
    </div>
  );
}
