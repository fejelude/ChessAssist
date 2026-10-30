import { locateBoard, recognize } from "./vision";
import type { Bounds, Template } from "../types";
self.onmessage = async (
  event: MessageEvent<{
    id: number;
    url: string;
    bounds?: Bounds;
    viewport: { width: number; height: number };
    templates: Template[];
  }>,
) => {
  const { id, url, bounds, viewport, templates } = event.data;
  try {
    if (!url.startsWith("data:image/png;base64,"))
      throw new Error("Expected a local PNG capture.");
    const bytes = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) =>
      c.charCodeAt(0),
    );
    const blob = new Blob([bytes], { type: "image/png" }),
      bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 960 / bitmap.width),
      canvas = new OffscreenCanvas(
        Math.round(bitmap.width * scale),
        Math.round(bitmap.height * scale),
      );
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height),
      factor = canvas.width / viewport.width;
    const region = bounds
      ? {
          x: bounds.x * factor,
          y: bounds.y * factor,
          width: bounds.width * factor,
          height: bounds.height * factor,
        }
      : locateBoard(image);
    if (!region)
      throw new Error(
        "No unambiguous checkerboard found. Select the board region manually.",
      );
    const result = recognize(image, region, templates);
    self.postMessage({
      id,
      result: {
        ...result,
        bounds: {
          x: region.x / factor,
          y: region.y / factor,
          width: region.width / factor,
          height: region.height / factor,
        },
      },
    });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message });
  }
};
