export default {
  title: "Models",
  backToSettings: "Back to Settings",
  searchPlaceholder: "Search models...",
  empty: "No models yet",
  noMatch: "No models match your search",
  deleteConfirm: "Delete?",
  displayName: "Display Name",
  modelId: "Model ID",
  namePlaceholder: "e.g. Claude Sonnet 4",
  modelIdPlaceholder: "e.g. anthropic/claude-sonnet-4-20250514",
  baseUrlPlaceholder: "http://localhost:1234/v1",
  subtitle:
    "Manage saved text-capable models for role defaults and the chat page selector.",
  addModel: "Add Model",
  emptyHint:
    "After adding models here, you can use them as role defaults and in the chat page model selector.",
  editModel: "Edit Model",
  update: "Update",
  deleteModelTitle: "Delete Model",
  yes: "Yes",
  no: "No",
  nameRequired: "Name and Model ID are required",
  capabilitiesRequired: "Select at least one capability",
  customProviderHint: "Only required for custom or local providers",
  apiKeyLabel: "API Key",
  apiKeyHint:
    "Stored as an environment variable. Picks the matching env key based on the URL, or CUSTOM_API_KEY otherwise.",
  roleDefaultsTitle: "Role defaults",
  roleDefaultsSubtitle:
    "Choose global defaults and active profile overrides for each Mercury model role.",
  roleDefaultsHint:
    "Text roles can use saved text-capable models. Image uses Codex-native image_gen capability status.",
  modelLibraryTitle: "Saved model library",
  changeModel: "Model choice",
  setGlobalDefault: "Set global default",
  setProfileOverride: "Set for this profile",
  useGlobalDefault: "Use global default",
  globalDefault: "Global",
  profileOverride: "Profile",
  noTextModels: "No text-capable saved models",
  loadFailed: "Could not load model settings",
  retry: "Retry",
  providerAuto: "Provider auto-detect",
  contextWindow: "{{tokens}} tokens",
  missingModelTitle: "Missing saved model",
  missingModelDescription:
    "This role references a deleted saved model. The saved provider/model snapshot is still being used until you choose a replacement.",
  capabilitiesTitle: "Capabilities",
  capabilities: {
    text: "Text generation",
    image_input: "Image input",
    codex_image_gen: "Codex image_gen (system)",
    codexImageGenReserved:
      "Image generation is resolved from the Codex image_gen tool, not from saved model entries.",
  },
  source: {
    profileOverride: "Profile override",
    globalDefault: "Global default",
    fallback: "Fallback",
    legacyChatConfig: "Legacy chat config",
    providerAuto: "Provider auto",
    missingModel: "Missing model",
    imageCapability: "Image capability",
  },
  roles: {
    chat: {
      name: "Chat",
      description: "Default conversational model for normal chat turns.",
    },
    plan: {
      name: "Plan",
      description: "Planning and decomposition before implementation work.",
    },
    code: {
      name: "Code",
      description: "Implementation-focused coding tasks and code edits.",
    },
    explore: {
      name: "Explore",
      description: "Read-only codebase or context exploration.",
    },
    research: {
      name: "Research",
      description: "External or internal research and synthesis.",
    },
    review: {
      name: "Review",
      description: "Code review, critique, and verification work.",
    },
    design: {
      name: "Design",
      description: "Product, UI, and systems design tasks.",
    },
    image: {
      name: "Image",
      description: "Codex-native image generation via the image_gen tool.",
    },
  },
  image: {
    available: "Available",
    unavailable: "Unavailable",
    availableDetail:
      "image_gen enabled · openai-codex configured · Codex auth found",
    codexNativeOnly:
      "Image generation is not a saved text model or public OpenAI Images API picker.",
    requirements:
      "Requires the image_gen toolset, image_gen.provider=openai-codex, and Codex OAuth credentials.",
  },
} as const;
