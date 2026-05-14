import type React from "react";
import type { ChatMessage, ChatUsage, SlashCommand } from "./types";
import { SLASH_COMMANDS } from "./chat.constants";

interface LocalCommandContext {
  profile?: string;
  usage: ChatUsage | null;
  t: (key: string) => string;
  onNewChat?: () => void;
  handleClear: () => void;
  setFastMode: (value: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

export function isLocalSlashCommand(cmd: string): boolean {
  return SLASH_COMMANDS.some(
    (c) => c.name === cmd && (c.local || c.category === "info"),
  );
}

export async function executeLocalCommand(
  cmdText: string,
  ctx: LocalCommandContext,
): Promise<boolean> {
  const parts = cmdText.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const pushLocalResponse = (content: string): void => {
    ctx.setMessages((prev) => [
      ...prev,
      { id: `agent-local-${Date.now()}`, role: "agent", content },
    ]);
    void window.hermesAPI
      .recordLocalChatTrace({
        command: cmdText.trim(),
        profile: ctx.profile,
        responsePreview: content,
        metadata: { command: cmd, source: "renderer-local-slash" },
      })
      .catch((error) => {
        console.warn("Failed to record local chat trace", error);
      });
  };

  switch (cmd) {
    case "/new":
      ctx.onNewChat?.();
      return true;
    case "/clear":
      ctx.handleClear();
      return true;
    case "/model": {
      const mc = await window.hermesAPI.getModelConfig(ctx.profile);
      const display = mc.model || "Not set";
      const prov = mc.provider || "auto";
      pushLocalResponse(
        `**Current model:** \`${display}\`\n**Provider:** ${prov}${mc.baseUrl ? `\n**Base URL:** ${mc.baseUrl}` : ""}`,
      );
      return true;
    }
    case "/memory": {
      const mem = await window.hermesAPI.readMemory(ctx.profile);
      const lines: string[] = ["**Agent Memory**\n"];
      lines.push(
        mem.memory.exists && mem.memory.content.trim()
          ? mem.memory.content.trim()
          : ctx.t("memory.noMemoryEntries"),
      );
      lines.push(
        `\n**Stats:** ${mem.stats.totalSessions} sessions, ${mem.stats.totalMessages} messages`,
      );
      pushLocalResponse(lines.join("\n"));
      return true;
    }
    case "/tools": {
      const tools = await window.hermesAPI.getToolsets(ctx.profile);
      pushLocalResponse(
        tools.length
          ? `**Available Toolsets**\n\n${tools
              .map(
                (tool) =>
                  `- **${tool.label}** — ${tool.description} ${tool.enabled ? "*(enabled)*" : "*(disabled)*"}`,
              )
              .join("\n")}`
          : ctx.t("memory.noToolsetsFound"),
      );
      return true;
    }
    case "/skills": {
      const skills = await window.hermesAPI.listInstalledSkills(ctx.profile);
      pushLocalResponse(
        skills.length
          ? `**Installed Skills**\n\n${skills
              .map((s) => `- **${s.name}** (${s.category}) — ${s.description}`)
              .join("\n")}`
          : "No skills installed.",
      );
      return true;
    }
    case "/persona": {
      const soul = await window.hermesAPI.readSoul(ctx.profile);
      pushLocalResponse(
        soul.trim() ? `**Current Persona**\n\n${soul.trim()}` : "_No persona configured._",
      );
      return true;
    }
    case "/version": {
      const [hermesVer, appVer] = await Promise.all([
        window.hermesAPI.getHermesVersion(),
        window.hermesAPI.getAppVersion(),
      ]);
      pushLocalResponse(`**Hermes Agent:** ${hermesVer || "unknown"}\n**Desktop App:** v${appVer}`);
      return true;
    }
    case "/fast": {
      const current = await window.hermesAPI.getConfig("agent.service_tier", ctx.profile);
      const next = !(current === "fast" || current === "priority");
      ctx.setFastMode(next);
      await window.hermesAPI.setConfig("agent.service_tier", next ? "fast" : "normal", ctx.profile);
      pushLocalResponse(
        next
          ? "**Fast Mode: ON** — Priority processing enabled for lower latency."
          : "**Fast Mode: OFF** — Standard processing restored.",
      );
      return true;
    }
    case "/usage": {
      if (!ctx.usage) {
        pushLocalResponse(ctx.t("chat.noUsageData"));
      } else {
        let md = `**Token Usage**\n\n`;
        md += `- **Prompt:** ${ctx.usage.promptTokens.toLocaleString()} tokens\n`;
        md += `- **Completion:** ${ctx.usage.completionTokens.toLocaleString()} tokens\n`;
        md += `- **Total:** ${ctx.usage.totalTokens.toLocaleString()} tokens\n`;
        if (ctx.usage.cost != null) md += `- **Cost:** $${ctx.usage.cost.toFixed(4)}\n`;
        pushLocalResponse(md);
      }
      return true;
    }
    case "/help": {
      const grouped: Record<string, SlashCommand[]> = {};
      for (const c of SLASH_COMMANDS) (grouped[c.category] ||= []).push(c);
      const categoryLabels: Record<string, string> = {
        chat: ctx.t("chat.categoryChat"),
        agent: ctx.t("chat.categoryAgent"),
        tools: ctx.t("chat.categoryTools"),
        info: ctx.t("chat.categoryInfo"),
      };
      let md = `**${ctx.t("chat.availableCommands")}**\n`;
      for (const cat of ["chat", "agent", "tools", "info"]) {
        if (!grouped[cat]) continue;
        md += `\n**${categoryLabels[cat]}**\n`;
        for (const c of grouped[cat]) md += `\`${c.name}\` — ${c.description}\n`;
      }
      pushLocalResponse(md);
      return true;
    }
    default:
      return false;
  }
}
