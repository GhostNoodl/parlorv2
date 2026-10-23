/**
 * Converts any image the browser can read into a PNG, scaled down to fit
 * within the given box. Card PNGs are uploaded untouched elsewhere; this is
 * only for avatars, where re-encoding is fine.
 */
export async function toPng(file: Blob, maxWidth = 768, maxHeight = 1152): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas isn't available in this browser.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't convert the image."))), "image/png"),
  );
}
