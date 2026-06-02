import { useEffect, useMemo, useState } from "react";
import type {
  ProfileAvatarMetadata,
  ProfileInfo,
  ProfileKind,
} from "../../../../shared/profiles";
import MercuryMark from "./MercuryMark";

interface AgentAvatarProfileNameProps {
  profile?: never;
  profileName: string;
  displayName: string;
  kind?: ProfileKind;
  isDefault?: boolean;
  avatar?: ProfileAvatarMetadata;
}

interface AgentAvatarProfileInfoProps {
  profile: ProfileInfo;
  profileName?: never;
  displayName?: never;
  kind?: never;
  isDefault?: never;
  avatar?: never;
}

export type AgentAvatarProps = (AgentAvatarProfileInfoProps | AgentAvatarProfileNameProps) & {
  className: string;
  markClassName?: string;
  imageClassName?: string;
  markSize?: number;
};

type AvatarLoadState = "idle" | "loading" | "loaded" | "failed";

const avatarDataUrlCache = new Map<string, string | null>();
const latestAvatarByProfile = new Map<string, ProfileAvatarMetadata | null>();

function displayNameFor(profile: ProfileInfo): string {
  return profile.displayName.trim() || profile.name;
}

function firstLetterFor(label: string, fallback: string): string {
  const source = label.trim() || fallback.trim() || "?";
  return source.charAt(0).toUpperCase();
}

function cacheKey(
  profileName: string,
  avatar: ProfileAvatarMetadata,
): string {
  return `${profileName}\u0000${avatar.path}\u0000${avatar.updatedAt}`;
}

function isMercuryIdentity(
  name: string,
  kind: ProfileKind | undefined,
  isDefault: boolean | undefined,
): boolean {
  return isDefault === true || name === "default" || kind === "builtin";
}

function resolveProps(props: AgentAvatarProps): {
  name: string;
  label: string;
  kind?: ProfileKind;
  isDefault?: boolean;
  avatar?: ProfileAvatarMetadata;
  shouldDiscoverAvatar: boolean;
} {
  if (props.profile) {
    return {
      name: props.profile.name,
      label: displayNameFor(props.profile),
      kind: props.profile.kind,
      isDefault: props.profile.isDefault,
      avatar: props.profile.avatar,
      shouldDiscoverAvatar: false,
    };
  }

  return {
    name: props.profileName,
    label: props.displayName.trim() || props.profileName,
    kind: props.kind,
    isDefault: props.isDefault,
    avatar: props.avatar,
    shouldDiscoverAvatar: true,
  };
}

function AgentAvatar(props: AgentAvatarProps): React.JSX.Element {
  const {
    name,
    label,
    kind,
    isDefault,
    avatar,
    shouldDiscoverAvatar,
  } = resolveProps(props);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<AvatarLoadState>("idle");
  const [imageFailed, setImageFailed] = useState(false);

  const knownAvatar = useMemo(
    () =>
      shouldDiscoverAvatar
        ? (avatar ?? latestAvatarByProfile.get(name) ?? undefined)
        : avatar,
    [avatar, name, shouldDiscoverAvatar],
  );
  const knownCacheKey = knownAvatar ? cacheKey(name, knownAvatar) : null;
  const isMercury = isMercuryIdentity(name, kind, isDefault);

  useEffect(() => {
    setImageFailed(false);

    if (isMercury) {
      setDataUrl(null);
      setLoadState("idle");
      return;
    }

    if (avatar) {
      latestAvatarByProfile.set(name, avatar);
    }

    if (!knownAvatar && !shouldDiscoverAvatar) {
      latestAvatarByProfile.set(name, null);
      setDataUrl(null);
      setLoadState("idle");
      return;
    }

    if (typeof window.hermesAPI.getAgentAvatarDataUrl !== "function") {
      setDataUrl(null);
      setLoadState("failed");
      return;
    }

    if (knownCacheKey && avatarDataUrlCache.has(knownCacheKey)) {
      const cachedDataUrl = avatarDataUrlCache.get(knownCacheKey) ?? null;
      setDataUrl(cachedDataUrl);
      setLoadState(cachedDataUrl ? "loaded" : "failed");
      if (!shouldDiscoverAvatar || avatar) return;
    } else {
      setDataUrl(null);
      setLoadState("loading");
    }

    let cancelled = false;

    void window.hermesAPI
      .getAgentAvatarDataUrl(name)
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          if (knownCacheKey) avatarDataUrlCache.set(knownCacheKey, null);
          setDataUrl(null);
          setLoadState("failed");
          return;
        }

        const resultAvatar = result.avatar ?? knownAvatar;
        if (result.avatar) {
          latestAvatarByProfile.set(name, result.avatar);
        } else if (!result.dataUrl) {
          latestAvatarByProfile.set(name, null);
        }

        if (resultAvatar) {
          avatarDataUrlCache.set(cacheKey(name, resultAvatar), result.dataUrl);
        }

        setDataUrl(result.dataUrl);
        setLoadState(result.dataUrl ? "loaded" : "failed");
      })
      .catch(() => {
        if (cancelled) return;
        if (knownCacheKey) avatarDataUrlCache.set(knownCacheKey, null);
        setDataUrl(null);
        setLoadState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [avatar, isMercury, knownAvatar, knownCacheKey, name, shouldDiscoverAvatar]);

  const baseClassName = props.className;
  const markClassName = props.markClassName
    ? `${baseClassName} ${props.markClassName}`
    : `${baseClassName} agent-avatar-mark`;
  const imageClassName = props.imageClassName ?? "agent-avatar-image";

  if (isMercury) {
    return (
      <div className={markClassName}>
        <MercuryMark size={props.markSize ?? 32} decorative />
      </div>
    );
  }

  if (dataUrl && loadState === "loaded" && !imageFailed) {
    return (
      <div className={`${baseClassName} agent-avatar-has-image`}>
        <img
          src={dataUrl}
          alt=""
          aria-hidden="true"
          className={imageClassName}
          onError={() => setImageFailed(true)}
        />
      </div>
    );
  }

  return <div className={baseClassName}>{firstLetterFor(label, name)}</div>;
}

export default AgentAvatar;
