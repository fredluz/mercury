import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { MutableRefObject } from "react";
import {
  inferContextWindow,
  type ContextWindowInfo,
} from "../../../../../shared/chat-metadata";
import { normalizeModelCapabilities } from "../../../../../shared/model-roles";
import { PROVIDERS } from "../../../constants";
import type { ModelGroup } from "../types";

interface UseChatModelConfigArgs {
  profile?: string;
}

interface UseChatModelConfigResult {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  currentContextInfo: ContextWindowInfo;
  currentContextInfoRef: MutableRefObject<ContextWindowInfo>;
  currentModelRef: MutableRefObject<string>;
  currentProviderRef: MutableRefObject<string>;
  modelGroups: ModelGroup[];
  showModelPicker: boolean;
  setShowModelPicker: React.Dispatch<React.SetStateAction<boolean>>;
  pickerRef: MutableRefObject<HTMLDivElement | null>;
  loadModelConfig: () => Promise<void>;
  selectModel: (
    provider: string,
    model: string,
    baseUrl: string,
    contextWindow?: number,
    modelId?: string,
  ) => Promise<void>;
}

export function useChatModelConfig({
  profile,
}: UseChatModelConfigArgs): UseChatModelConfigResult {
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [currentContextInfo, setCurrentContextInfo] =
    useState<ContextWindowInfo>(() => inferContextWindow("auto", ""));
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const currentContextInfoRef = useRef(currentContextInfo);
  const currentModelRef = useRef(currentModel);
  const currentProviderRef = useRef(currentProvider);

  currentContextInfoRef.current = currentContextInfo;
  currentModelRef.current = currentModel;
  currentProviderRef.current = currentProvider;

  const loadModelConfig = useCallback(async (): Promise<void> => {
    const savedModels = await window.hermesAPI.listModels();
    let mc: {
      provider: string;
      model: string;
      baseUrl: string;
      contextWindow?: number;
      modelId?: string;
    };
    try {
      const resolved = await window.hermesAPI.resolveModelForRole(
        "chat",
        profile,
      );
      if (resolved.kind !== "text" || !resolved.ok)
        throw new Error("Chat role did not resolve to text");
      mc = {
        provider: resolved.provider,
        model: resolved.model,
        baseUrl: resolved.baseUrl,
        contextWindow: resolved.contextWindow,
        modelId: resolved.modelId,
      };
    } catch {
      mc = await window.hermesAPI.getModelConfig(profile);
    }
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);
    const selectedSavedModel = mc.modelId
      ? savedModels.find((m) => m.id === mc.modelId)
      : savedModels.find(
          (m) =>
            m.provider === mc.provider &&
            m.model === mc.model &&
            (m.baseUrl || "") === (mc.baseUrl || ""),
        );
    setCurrentContextInfo(
      inferContextWindow(
        mc.provider,
        mc.model,
        selectedSavedModel?.contextWindow ?? mc.contextWindow,
      ),
    );

    const groupMap = new Map<string, ModelGroup>();
    for (const m of savedModels) {
      const capabilities = normalizeModelCapabilities(m.capabilities);
      if (!capabilities.includes("text")) continue;
      if (!groupMap.has(m.provider)) {
        groupMap.set(m.provider, {
          provider: m.provider,
          providerLabel: PROVIDERS.labels[m.provider] || m.provider,
          models: [],
        });
      }
      groupMap.get(m.provider)!.models.push({
        id: m.id,
        provider: m.provider,
        model: m.model,
        label: m.name,
        baseUrl: m.baseUrl || "",
        contextWindow: m.contextWindow,
        capabilities,
      });
    }
    setModelGroups(Array.from(groupMap.values()));
  }, [profile]);

  const selectModel = useCallback(
    async (
      provider: string,
      model: string,
      baseUrl: string,
      contextWindow?: number,
      modelId?: string,
    ): Promise<void> => {
      await window.hermesAPI.setProfileModelRoleOverride(
        "chat",
        {
          ...(modelId ? { modelId } : {}),
          provider,
          model,
          baseUrl,
          ...(contextWindow ? { contextWindow } : {}),
          capabilities: ["text"],
        },
        profile,
      );
      setCurrentModel(model);
      setCurrentProvider(provider);
      setCurrentBaseUrl(baseUrl);
      setCurrentContextInfo(inferContextWindow(provider, model, contextWindow));
      setShowModelPicker(false);
    },
    [profile],
  );

  useEffect(() => {
    loadModelConfig();
  }, [loadModelConfig]);

  useEffect(() => {
    if (!showModelPicker) return;
    function handleClickOutside(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setShowModelPicker(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showModelPicker]);

  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    currentContextInfo,
    currentContextInfoRef,
    currentModelRef,
    currentProviderRef,
    modelGroups,
    showModelPicker,
    setShowModelPicker,
    pickerRef,
    loadModelConfig,
    selectModel,
  };
}
