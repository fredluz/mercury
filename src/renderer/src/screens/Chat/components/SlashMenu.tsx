import type React from "react";
import { Slash } from "lucide-react";
import type { RefObject } from "react";
import type { SlashCommand } from "../types";

interface SlashMenuProps {
  menuRef: RefObject<HTMLDivElement | null>;
  commands: SlashCommand[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (command: SlashCommand) => void;
  t: (key: string) => string;
}

export function SlashMenu({
  menuRef,
  commands,
  selectedIndex,
  onHover,
  onSelect,
  t,
}: SlashMenuProps): React.JSX.Element {
  return (
    <div className="slash-menu" ref={menuRef}>
      <div className="slash-menu-header">
        <Slash size={12} />
        {t("chat.commandsTitle")}
      </div>
      <div className="slash-menu-list">
        {commands.map((cmd, i) => (
          <button
            key={cmd.name}
            className={`slash-menu-item ${i === selectedIndex ? "slash-menu-item-active" : ""}`}
            onMouseEnter={() => onHover(i)}
            onClick={() => onSelect(cmd)}
          >
            <span className="slash-menu-item-name">{cmd.name}</span>
            <span className="slash-menu-item-desc">{cmd.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
