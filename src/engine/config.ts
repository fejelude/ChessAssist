declare const __ENGINE_VARIANT__: "full" | "lite";
export const ENGINE_VARIANT =
  typeof __ENGINE_VARIANT__ === "undefined" ? "lite" : __ENGINE_VARIANT__;
