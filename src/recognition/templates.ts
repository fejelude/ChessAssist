import type { PieceCode, Template } from "../types";
import { cellFeature } from "./vision";
export async function defaultTemplates(): Promise<Template[]> {
  const codes: PieceCode[] = [
    "wk",
    "wq",
    "wr",
    "wb",
    "wn",
    "wp",
    "bk",
    "bq",
    "br",
    "bb",
    "bn",
    "bp",
  ];
  const templates: Template[] = [];
  await Promise.all(
    codes.map(async (code) => {
      const image = new Image();
      image.src = `pieces/${code[0]}${code[1].toUpperCase()}.svg`;
      await image.decode();
      for (const bg of [
        "#eeeed2",
        "#769656",
        "#deded0",
        "#7a927d",
        "#e5dfd1",
        "#7e9483",
      ]) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 80;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 80, 80);
        ctx.drawImage(image, 0, 0, 80, 80);
        templates.push({
          code,
          feature: cellFeature(
            ctx.getImageData(0, 0, 80, 80),
            { x: 0, y: 0, width: 640, height: 640 },
            0,
            0,
          ).feature,
        });
      }
    }),
  );
  return templates;
}
