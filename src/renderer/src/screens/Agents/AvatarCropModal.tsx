import { useCallback, useEffect, useRef, useState } from "react";
import {
  cropAvatarImageToPngDataUrl,
  loadAvatarImageFromFile,
} from "../../utils/agent-avatar-image";

const VIEWPORT = 260;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface AvatarCropModalProps {
  file: File;
  title: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}

interface Offset {
  x: number;
  y: number;
}

function clampOffset(
  offset: Offset,
  displayWidth: number,
  displayHeight: number,
): Offset {
  return {
    x: Math.min(0, Math.max(VIEWPORT - displayWidth, offset.x)),
    y: Math.min(0, Math.max(VIEWPORT - displayHeight, offset.y)),
  };
}

function AvatarCropModal({
  file,
  title,
  busy = false,
  onCancel,
  onConfirm,
}: AvatarCropModalProps): React.JSX.Element {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const baseScaleRef = useRef(1);
  const dragRef = useRef<{ pointerX: number; pointerY: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    loadAvatarImageFromFile(file)
      .then((loaded) => {
        if (cancelled) return;
        const baseScale = Math.max(
          VIEWPORT / loaded.naturalWidth,
          VIEWPORT / loaded.naturalHeight,
        );
        baseScaleRef.current = baseScale;
        const displayWidth = loaded.naturalWidth * baseScale;
        const displayHeight = loaded.naturalHeight * baseScale;
        setImage(loaded);
        setZoom(1);
        setOffset({
          x: (VIEWPORT - displayWidth) / 2,
          y: (VIEWPORT - displayHeight) / 2,
        });
      })
      .catch(() => {
        if (!cancelled) setError("invalid");
      });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const scale = baseScaleRef.current * zoom;
  const displayWidth = image ? image.naturalWidth * scale : 0;
  const displayHeight = image ? image.naturalHeight * scale : 0;

  const handleZoomChange = useCallback(
    (nextZoom: number) => {
      if (!image) return;
      const oldScale = baseScaleRef.current * zoom;
      const newScale = baseScaleRef.current * nextZoom;
      // Keep the viewport center anchored to the same source point.
      const centerSourceX = (VIEWPORT / 2 - offset.x) / oldScale;
      const centerSourceY = (VIEWPORT / 2 - offset.y) / oldScale;
      const nextOffset = clampOffset(
        {
          x: VIEWPORT / 2 - centerSourceX * newScale,
          y: VIEWPORT / 2 - centerSourceY * newScale,
        },
        image.naturalWidth * newScale,
        image.naturalHeight * newScale,
      );
      setZoom(nextZoom);
      setOffset(nextOffset);
    },
    [image, zoom, offset],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !image) return;
    const dx = event.clientX - drag.pointerX;
    const dy = event.clientY - drag.pointerY;
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY };
    setOffset((prev) =>
      clampOffset(
        { x: prev.x + dx, y: prev.y + dy },
        displayWidth,
        displayHeight,
      ),
    );
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!image) return;
    const delta = -event.deltaY * 0.0015;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta * zoom));
    handleZoomChange(next);
  };

  const handleConfirm = () => {
    if (!image) return;
    const sourceSize = VIEWPORT / scale;
    const maxX = Math.max(0, image.naturalWidth - sourceSize);
    const maxY = Math.max(0, image.naturalHeight - sourceSize);
    const sourceX = Math.min(maxX, Math.max(0, -offset.x / scale));
    const sourceY = Math.min(maxY, Math.max(0, -offset.y / scale));
    try {
      onConfirm(cropAvatarImageToPngDataUrl(image, sourceX, sourceY, sourceSize));
    } catch {
      setError("invalid");
    }
  };

  return (
    <div
      className="agents-modal-backdrop"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="agents-modal agents-crop-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="agents-modal-header">
          <h3>{title}</h3>
        </div>

        {error ? (
          <div className="agents-create-error">
            That image couldn&apos;t be loaded. Try a different file.
          </div>
        ) : (
          <>
            <p className="agents-crop-hint">Drag to reposition · scroll or use the slider to zoom</p>
            <div
              className="agents-crop-viewport"
              style={{ width: VIEWPORT, height: VIEWPORT }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onWheel={handleWheel}
            >
              {image && previewUrl ? (
                <img
                  className="agents-crop-image"
                  src={previewUrl}
                  alt=""
                  draggable={false}
                  style={{
                    width: displayWidth,
                    height: displayHeight,
                    transform: `translate(${offset.x}px, ${offset.y}px)`,
                  }}
                />
              ) : null}
              <div className="agents-crop-mask" aria-hidden="true" />
            </div>
            <input
              className="agents-crop-zoom"
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={!image}
              onChange={(event) =>
                handleZoomChange(Number(event.currentTarget.value))
              }
              aria-label="Zoom"
            />
          </>
        )}

        <div className="agents-crop-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleConfirm}
            disabled={busy || !image || error !== null}
          >
            {busy ? "Saving…" : "Save avatar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AvatarCropModal;
