export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const INPUT_TYPES = new Set(["image/jpeg", "image/png"]);

const EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
]);

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function isAnimatedPng(file) {
  if (file.type !== "image/png") return false;
  if (typeof file.arrayBuffer !== "function") {
    throw new Error("This browser cannot inspect PNG files safely.");
  }
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    if (data.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((value, index) => data[index] === value)) return false;

    let offset = PNG_SIGNATURE.length;
    while (offset + 12 <= data.length) {
      const length = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0);
      if (length > data.length - offset - 12) return false;
      const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
      if (type === "acTL") return true;
      if (type === "IDAT") return false;
      offset += length + 12;
    }
    return false;
  } catch {
    throw new Error("Could not inspect this PNG file.");
  }
}

export function validateImageMetadata(file, limits = {}) {
  const maxBytes = limits.maxBytes ?? MAX_FILE_BYTES;
  if (!file || typeof file !== "object") return "Choose a JPEG or PNG image.";
  if (!INPUT_TYPES.has(file.type)) return "Only JPEG and PNG images are supported.";
  if (!Number.isFinite(file.size) || file.size <= 0) return "The selected file is empty or unreadable.";
  if (file.size > maxBytes) return `File is larger than the ${formatBytes(maxBytes)} limit.`;
  return null;
}

export function validateImageDimensions(width, height, maxPixels = MAX_PIXELS) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return "The image dimensions are invalid.";
  }
  if (width * height > maxPixels) return `Image exceeds the ${formatPixels(maxPixels)} pixel limit.`;
  return null;
}

export function getOutputMime(inputMime, format = "same") {
  if (format === "same") {
    if (!INPUT_TYPES.has(inputMime)) throw new Error("Only JPEG and PNG images are supported.");
    return inputMime;
  }
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  throw new Error("Choose JPEG, PNG, or keep the input format.");
}

export function outputFilename(inputName, mime) {
  const extension = EXTENSIONS.get(mime);
  if (!extension) throw new Error("Unsupported output format.");
  const safeName = String(inputName || "image")
    .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
    .replace(/\.[^.]*$/, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "image";
  return `${safeName}-clean${extension}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MiB`;
}

function formatPixels(pixels) {
  return `${(pixels / 1_000_000).toFixed(pixels % 1_000_000 ? 1 : 0)} MP`;
}

function canvasBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error("The browser could not encode this image."));
      if (blob.type !== mime) return reject(new Error("The browser does not support the selected output format."));
      resolve(blob);
    }, mime, quality);
  });
}

/** Re-encode a JPEG/PNG through Canvas. Metadata is not copied to the output. */
export async function stripImageMetadata(file, options = {}) {
  const inputError = validateImageMetadata(file, options);
  if (inputError) throw new Error(inputError);
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    throw new Error("This browser does not support local image processing.");
  }
  if (await isAnimatedPng(file)) throw new Error("Animated PNG (APNG) files are not supported.");
  let bitmap;
  let canvas;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const dimensionsError = validateImageDimensions(bitmap.width, bitmap.height, options.maxPixels ?? MAX_PIXELS);
    if (dimensionsError) throw new Error(dimensionsError);
    const mime = getOutputMime(file.type, options.format ?? "same");
    canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { alpha: mime !== "image/jpeg" });
    if (!context) throw new Error("The browser could not create a drawing surface.");
    if (mime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0);
    const blob = await canvasBlob(canvas, mime, mime === "image/jpeg" ? (options.quality ?? 0.92) : undefined);
    return { blob, filename: outputFilename(file.name, mime), mime, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap?.close?.();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
