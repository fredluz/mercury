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

export async function normalizeAvatarFileToPngDataUrl(
  file: File,
): Promise<string> {
  assertValidAvatarFile(file);

  const image = await loadImageFromFile(file);
  if (
    image.naturalWidth > MAX_DECODED_DIMENSION ||
    image.naturalHeight > MAX_DECODED_DIMENSION ||
    image.naturalWidth * image.naturalHeight > MAX_DECODED_PIXELS
  ) {
    throw avatarInvalidFileError();
  }

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_EXPORT_SIZE;
  canvas.height = AVATAR_EXPORT_SIZE;

  const context = canvas.getContext("2d");
  if (!context) throw avatarInvalidFileError();

  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.floor((image.naturalWidth - side) / 2);
  const sourceY = Math.floor((image.naturalHeight - side) / 2);

  context.clearRect(0, 0, AVATAR_EXPORT_SIZE, AVATAR_EXPORT_SIZE);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    side,
    side,
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
