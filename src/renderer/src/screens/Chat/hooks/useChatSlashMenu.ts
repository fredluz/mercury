import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { MutableRefObject } from "react";
import { SLASH_COMMANDS } from "../chat.constants";
import type { SlashCommand } from "../types";

interface UseChatSlashMenuArgs {
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
}

interface UseChatSlashMenuResult {
  slashMenuRef: MutableRefObject<HTMLDivElement | null>;
  slashMenuOpen: boolean;
  setSlashMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  filteredSlashCommands: SlashCommand[];
  slashSelectedIndex: number;
  setSlashSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSlashKeyDown: (
    e: React.KeyboardEvent,
    onSelect: (cmd: SlashCommand) => void,
  ) => boolean;
  resetInputHeight: () => void;
}

export function useChatSlashMenu({
  inputRef,
  setInput,
}: UseChatSlashMenuArgs): UseChatSlashMenuResult {
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  const filteredSlashCommands = useMemo(
    () =>
      slashMenuOpen
        ? SLASH_COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(slashFilter.toLowerCase()))
        : [],
    [slashMenuOpen, slashFilter],
  );

  const resetInputHeight = useCallback((): void => {
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [inputRef]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
      const value = e.target.value;
      setInput(value);
      const target = e.target;
      requestAnimationFrame(() => {
        target.style.height = "auto";
        target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
      });
      if (value.startsWith("/") && !value.includes(" ")) {
        setSlashMenuOpen(true);
        setSlashFilter(value.split(" ")[0]);
        setSlashSelectedIndex(0);
      } else if (slashMenuOpen) {
        setSlashMenuOpen(false);
      }
    },
    [setInput, slashMenuOpen],
  );

  const handleSlashKeyDown = useCallback(
    (e: React.KeyboardEvent, onSelect: (cmd: SlashCommand) => void): boolean => {
      if (!slashMenuOpen || filteredSlashCommands.length === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((i) => (i < filteredSlashCommands.length - 1 ? i + 1 : 0));
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((i) => (i > 0 ? i - 1 : filteredSlashCommands.length - 1));
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        onSelect(filteredSlashCommands[slashSelectedIndex]);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenuOpen(false);
        return true;
      }
      return false;
    },
    [filteredSlashCommands, slashMenuOpen, slashSelectedIndex],
  );

  useEffect(() => {
    if (!slashMenuOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) setSlashMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [slashMenuOpen]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashMenuRef.current?.querySelector(".slash-menu-item-active")?.scrollIntoView({ block: "nearest" });
  }, [slashSelectedIndex, slashMenuOpen]);

  return {
    slashMenuRef,
    slashMenuOpen,
    setSlashMenuOpen,
    filteredSlashCommands,
    slashSelectedIndex,
    setSlashSelectedIndex,
    handleInputChange,
    handleSlashKeyDown,
    resetInputHeight,
  };
}
