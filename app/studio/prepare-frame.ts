import { frameCrop } from "../frame-crop";

/* A photo shaped to the film's frame (16:9, 9:16 or 2.39:1) in the browser, trimming the same way a new film does:
   sideways trims are centred; height comes off the top so the floor stays. Returns a JPEG data URL under the server's limit. */
export async function prepareFrameFile(file: File, aspect: string): Promise<string> {
  const target = aspect === "vertical" ? 9 / 16 : aspect === "cinematic" ? 2.39 : 16 / 9;
  const source = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("That photo could not be read.")); reader.readAsDataURL(file); });
  const image = new Image(); image.src = source;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("That photo could not be opened.")); });
  const { sx, sy, sw, sh } = frameCrop(image.naturalWidth, image.naturalHeight, target);
  for (const width of [4096, 3200, 2560, 1920]) {
    const canvas = document.createElement("canvas"); canvas.width = Math.min(width, Math.round(sw)); canvas.height = Math.round(canvas.width / target);
    const context = canvas.getContext("2d"); if (!context) throw new Error("That photo could not be prepared.");
    context.imageSmoothingQuality = "high"; context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/jpeg", 0.95);
    if (result.length <= 10_000_000) return result;
  }
  throw new Error("That photo is too large. Try a smaller one.");
}
