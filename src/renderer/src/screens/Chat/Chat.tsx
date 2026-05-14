import { Fragment } from "react";
import type React from "react";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { useI18n } from "../../components/useI18n";
import { ChatActivityGroup } from "./components/ChatActivityGroup";
import { ChatComposer } from "./components/ChatComposer";
import { ChatEmpty } from "./components/ChatEmpty";
import { ChatHeader } from "./components/ChatHeader";
import { ChatLoading } from "./components/ChatLoading";
import { MessageRow } from "./components/MessageRow";
import { ModelPicker } from "./components/ModelPicker";
import { SlashMenu } from "./components/SlashMenu";
import { useChatController } from "./hooks/useChatController";
import type { ChatMessage } from "./types";

export { AgentMarkdown };
export type { ChatMessage };

interface ChatProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionId: string | null;
  sessionTitle?: string | null;
  conversationVersion: number;
  profile?: string;
  onSessionStarted?: () => void;
  onSessionResolved?: (sessionId: string) => void;
  onSessionTitleChange?: (title: string) => void;
  onSessionReset?: () => void;
  onNewChat?: () => void;
}

function Chat({
  messages,
  setMessages,
  sessionId,
  sessionTitle,
  conversationVersion,
  profile,
  onSessionStarted,
  onSessionResolved,
  onSessionTitleChange,
  onSessionReset,
  onNewChat,
}: ChatProps): React.JSX.Element {
  const { t } = useI18n();
  const chat = useChatController({
    messages,
    setMessages,
    sessionId,
    sessionTitle,
    conversationVersion,
    profile,
    onSessionStarted,
    onSessionResolved,
    onSessionTitleChange,
    onSessionReset,
    onNewChat,
  });

  return (
    <div className="chat-container">
      <ChatHeader
        sessionId={sessionId}
        sessionTitle={sessionTitle}
        titlePending={chat.titleGenerationPending}
        contextUsage={chat.contextUsage}
        fastMode={chat.fastMode}
        messages={messages}
        profile={profile}
        onFastModeChange={chat.setFastMode}
        onNewChat={onNewChat}
        onClear={chat.handleClear}
        t={t}
      />

      <div className="chat-messages" ref={chat.messagesContainerRef}>
        {messages.length === 0 ? (
          <ChatEmpty
            setPrompt={chat.setInput}
            focusInput={() => chat.inputRef.current?.focus()}
            t={t}
          />
        ) : (
          chat.visibleMessages.map((msg, i) => {
            const activityGroups = chat.activityGroups.filter(
              (group) => group.anchorMessageId === msg.id,
            );
            return (
              <Fragment key={msg.id}>
                <div className="chat-transcript-item">
                  <MessageRow
                    msg={msg}
                    isLast={i === chat.visibleMessages.length - 1}
                    isLoading={chat.isLoading}
                    onApprove={chat.handleApprove}
                    onDeny={chat.handleDeny}
                  />
                </div>
                {activityGroups.length > 0 ? (
                  <div className="chat-transcript-item chat-transcript-activity-item">
                    {activityGroups.map((group) => (
                      <ChatActivityGroup
                        key={group.id}
                        group={group}
                        onToggle={chat.toggleActivityGroup}
                      />
                    ))}
                  </div>
                ) : null}
              </Fragment>
            );
          })
        )}

        {chat.isLoading && !chat.lastMessageIsAgent && <ChatLoading />}

        <div ref={chat.messagesEndRef} />
      </div>

      <div className="chat-input-area">
        {chat.slashMenuOpen && chat.filteredSlashCommands.length > 0 && (
          <SlashMenu
            menuRef={chat.slashMenuRef}
            commands={chat.filteredSlashCommands}
            selectedIndex={chat.slashSelectedIndex}
            onHover={chat.setSlashSelectedIndex}
            onSelect={chat.handleSlashSelect}
            t={t}
          />
        )}

        <ChatComposer
          inputRef={chat.inputRef}
          input={chat.input}
          isLoading={chat.isLoading}
          hermesSessionId={chat.hermesSessionId}
          onChange={chat.handleInputChange}
          onKeyDown={chat.handleKeyDown}
          onAbort={chat.handleAbort}
          onQuickAsk={chat.handleQuickAsk}
          onSend={chat.handleSend}
          t={t}
        />

        <ModelPicker
          pickerRef={chat.pickerRef}
          displayModel={chat.displayModel}
          modelGroups={chat.modelGroups}
          currentModel={chat.currentModel}
          currentProvider={chat.currentProvider}
          customModelInput={chat.customModelInput}
          showModelPicker={chat.showModelPicker}
          setShowModelPicker={chat.setShowModelPicker}
          setCustomModelInput={chat.setCustomModelInput}
          loadModelConfig={chat.loadModelConfig}
          selectModel={chat.selectModel}
          handleCustomModelSubmit={chat.handleCustomModelSubmit}
          t={t}
        />
      </div>
    </div>
  );
}

export default Chat;
