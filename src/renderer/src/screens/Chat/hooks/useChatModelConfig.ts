import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  inferContextWindow,
  type ContextWindowInfo,
} from "../../../../../shared/chat-metadata";
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
  pickerRef: MutableRefObject<HTMLDivElement | null>;
  loadModelConfig: () => Promise<void>;
}

export function useChatModelConfig({
  profile,
}: UseChatModelConfigArgs): UseChatModelConfigResult {
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [currentContextInfo, setCurrentContextInfo] =
    useState<ContextWindowInfo>(() => inferContextWindow("", ""));
  const pickerRef = useRef<HTMLDivElement>(null);
  const currentContextInfoRef = useRef(currentContextInfo);
  const currentModelRef = useRef(currentModel);
  const currentProviderRef = useRef(currentProvider);

  currentContextInfoRef.current = currentContextInfo;
  currentModelRef.current = currentModel;
  currentProviderRef.current = currentProvider;

  const loadModelConfig = useCallback(async (): Promise<void> => {
    const config = await window.hermesAPI.getModelConfig(profile);
    const provider = config.provider?.trim() ?? "";
    const model = config.model?.trim() ?? "";
    const baseUrl = config.baseUrl?.trim() ?? "";
    setCurrentProvider(provider);
    setCurrentModel(model);
    setCurrentBaseUrl(baseUrl);
    setCurrentContextInfo(inferContextWindow(provider, model));
  }, [profile]);

  useEffect(() => {
    void loadModelConfig();
  }, [loadModelConfig]);

  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    currentContextInfo,
    currentContextInfoRef,
    currentModelRef,
    currentProviderRef,
    modelGroups: [],
    pickerRef,
    loadModelConfig,
  };
}
