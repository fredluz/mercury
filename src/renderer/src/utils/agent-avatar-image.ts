const AVATAR_EXPORT_SIZE = 256;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_DECODED_DIMENSION = 8192;
const MAX_DECODED_PIXELS = 32 * 1024 * 1024;
const ACCEPTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

function avatarInvalidFileError(): Error {
  return new Error("avatarInvalidFile");
}

function assertValidAvatarFile(file: File): void {
  if (!file || file.size <= 0 || file.size > MAX_INPUT_BYTES) {
    throw avatarInvalidFileError();
  }

  const type = file.type.toLowerCase();
  if (!ACCEPTED_IMAGE_MIME_TYPES.has(type)) {
    throw avatarInvalidFileError();
  }
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(avatarInvalidFileError());
        return;
      }
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(avatarInvalidFileError());
    };

    image.src = objectUrl;
  });
}

export function avatarInvalidFile(): Error {
  return avatarInvalidFileError();
}

/**
 * Validate and decode an avatar source file into an HTMLImageElement,
 * enforcing input-size and decoded-dimension limits. Used by the crop UI.
 */
export async function loadAvatarImageFromFile(
  file: File,
): Promise<HTMLImageElement> {
  assertValidAvatarFile(file);

  const image = await loadImageFromFile(file);
  if (
    image.naturalWidth > MAX_DECODED_DIMENSION ||
    image.naturalHeight > MAX_DECODED_DIMENSION ||
    image.naturalWidth * image.naturalHeight > MAX_DECODED_PIXELS
  ) {
    throw avatarInvalidFileError();
  }

  return image;
}

/**
 * Render a square region of a decoded image to a 256x256 PNG data URL.
 * `sourceX`/`sourceY`/`sourceSize` are in source-image pixels and define the
 * crop window chosen by the user in the crop UI.
 */
export function cropAvatarImageToPngDataUrl(
  image: HTMLImageElement,
  sourceX: number,
  sourceY: number,
  sourceSize: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_EXPORT_SIZE;
  canvas.height = AVATAR_EXPORT_SIZE;

  const context = canvas.getContext("2d");
  if (!context) throw avatarInvalidFileError();

  context.clearRect(0, 0, AVATAR_EXPORT_SIZE, AVATAR_EXPORT_SIZE);
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_EXPORT_SIZE,
    AVATAR_EXPORT_SIZE,
  );

  const dataUrl = canvas.toDataURL("image/png");
  if (!dataUrl.startsWith("data:image/png;base64,")) {
    throw avatarInvalidFileError();
  }
  return dataUrl;
}

export async function normalizeAvatarFileToPngDataUrl(
  file: File,
): Promise<string> {
  const image = await loadAvatarImageFromFile(file);
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.floor((image.naturalWidth - side) / 2);
  const sourceY = Math.floor((image.naturalHeight - side) / 2);
  return cropAvatarImageToPngDataUrl(image, sourceX, sourceY, side);
}
