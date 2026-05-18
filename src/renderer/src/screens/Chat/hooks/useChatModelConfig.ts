import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { MutableRefObject } from "react";
import {
  inferContextWindow,
  type ContextWindowInfo,
} from "../../../../../shared/chat-metadata";
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
  customModelInput: string;
  setCustomModelInput: React.Dispatch<React.SetStateAction<string>>;
  pickerRef: MutableRefObject<HTMLDivElement | null>;
  loadModelConfig: () => Promise<void>;
  selectModel: (
    provider: string,
    model: string,
    baseUrl: string,
    contextWindow?: number,
  ) => Promise<void>;
  handleCustomModelSubmit: () => Promise<void>;
}

export function useChatModelConfig({ profile }: UseChatModelConfigArgs): UseChatModelConfigResult {
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [currentContextInfo, setCurrentContextInfo] = useState<ContextWindowInfo>(() =>
    inferContextWindow("auto", ""),
  );
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const currentContextInfoRef = useRef(currentContextInfo);
  const currentModelRef = useRef(currentModel);
  const currentProviderRef = useRef(currentProvider);

  currentContextInfoRef.current = currentContextInfo;
  currentModelRef.current = currentModel;
  currentProviderRef.current = currentProvider;

  const loadModelConfig = useCallback(async (): Promise<void> => {
    const [mc, savedModels] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
    ]);
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);
    const selectedSavedModel = savedModels.find(
      (m) => m.provider === mc.provider && m.model === mc.model,
    );
    setCurrentContextInfo(
      inferContextWindow(mc.provider, mc.model, selectedSavedModel?.contextWindow),
    );

    const groupMap = new Map<string, ModelGroup>();
    for (const m of savedModels) {
      if (!groupMap.has(m.provider)) {
        groupMap.set(m.provider, {
          provider: m.provider,
          providerLabel: PROVIDERS.labels[m.provider] || m.provider,
          models: [],
        });
      }
      groupMap.get(m.provider)!.models.push({
        provider: m.provider,
        model: m.model,
        label: m.name,
        baseUrl: m.baseUrl || "",
        contextWindow: m.contextWindow,
      });
    }
    setModelGroups(Array.from(groupMap.values()));
  }, [profile]);

  const selectModel = useCallback(
    async (provider: string, model: string, baseUrl: string, contextWindow?: number): Promise<void> => {
      await window.hermesAPI.setModelConfig(provider, model, baseUrl, profile);
      setCurrentModel(model);
      setCurrentProvider(provider);
      setCurrentBaseUrl(baseUrl);
      setCurrentContextInfo(inferContextWindow(provider, model, contextWindow));
      setShowModelPicker(false);
      setCustomModelInput("");
    },
    [profile],
  );

  const handleCustomModelSubmit = useCallback(async (): Promise<void> => {
    const model = customModelInput.trim();
    if (model) await selectModel(currentProvider === "auto" ? "auto" : currentProvider, model, currentBaseUrl);
  }, [currentBaseUrl, currentProvider, customModelInput, selectModel]);

  useEffect(() => {
    loadModelConfig();
  }, [loadModelConfig]);

  useEffect(() => {
    if (!showModelPicker) return;
    function handleClickOutside(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowModelPicker(false);
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
    customModelInput,
    setCustomModelInput,
    pickerRef,
    loadModelConfig,
    selectModel,
    handleCustomModelSubmit,
  };
}
