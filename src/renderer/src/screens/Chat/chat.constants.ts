import type { SlashCommand } from "./types";

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/new", description: "Start a new chat", category: "chat", local: true },
  { name: "/clear", description: "Clear conversation history", category: "chat", local: true },
  { name: "/btw", description: "Ask a side question without affecting context", category: "agent" },
  { name: "/approve", description: "Approve a pending action", category: "agent" },
  { name: "/deny", description: "Deny a pending action", category: "agent" },
  { name: "/status", description: "Show current agent status", category: "agent" },
  { name: "/reset", description: "Reset conversation context", category: "agent" },
  { name: "/compact", description: "Compact and summarize the conversation", category: "agent" },
  { name: "/undo", description: "Undo the last action", category: "agent" },
  { name: "/retry", description: "Retry the last failed action", category: "agent" },
  { name: "/fast", description: "Toggle priority processing (lower latency)", category: "agent", local: true },
  { name: "/compress", description: "Compress conversation with optional focus topic", category: "agent" },
  { name: "/usage", description: "Show token usage, cost, and rate limits", category: "agent", local: true },
  { name: "/debug", description: "Show diagnostics and debug info", category: "agent" },
  { name: "/web", description: "Search the web", category: "tools" },
  { name: "/image", description: "Generate an image", category: "tools" },
  { name: "/browse", description: "Browse a URL", category: "tools" },
  { name: "/code", description: "Write or execute code", category: "tools" },
  { name: "/file", description: "Read or write files", category: "tools" },
  { name: "/shell", description: "Run a shell command", category: "tools" },
  { name: "/help", description: "Show available commands and help", category: "info" },
  { name: "/tools", description: "List available tools", category: "info" },
  { name: "/skills", description: "List installed skills", category: "info" },
  { name: "/model", description: "Show or switch the current model", category: "info" },
  { name: "/memory", description: "Show agent memory", category: "info" },
  { name: "/persona", description: "Show current persona", category: "info" },
  { name: "/version", description: "Show Hermes version", category: "info" },
];

export const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;
