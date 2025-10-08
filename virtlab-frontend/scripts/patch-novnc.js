#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const filePath = resolve("node_modules/@novnc/novnc/lib/util/browser.js");
const target = "exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();";
const replacement = `var supportsWebCodecsH264DecodePromise = _checkWebCodecsH264DecodeSupport();\nexports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = false;\nsupportsWebCodecsH264DecodePromise.then(function (result) {\n  exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = result;\n}).catch(function () {\n  exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = false;\n});`;

let content;
try {
  content = readFileSync(filePath, "utf8");
} catch (error) {
  console.warn("[patch-novnc] Skipped: util/browser.js not found");
  process.exit(0);
}

if (!content.includes(target)) {
  // Already patched or unexpected version; nothing to do.
  process.exit(0);
}

writeFileSync(filePath, content.replace(target, replacement), "utf8");
console.log("[patch-novnc] Applied WebCodecs patch");
