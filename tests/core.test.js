import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FILE_BYTES, MAX_PIXELS, formatBytes, getOutputMime, outputFilename,
  stripImageMetadata, validateImageDimensions, validateImageMetadata,
} from "../core.js";

function pngBlob(chunks = []) {
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])];
  for (const [type, data = new Uint8Array()] of chunks) {
    const chunk = new Uint8Array(12 + data.length);
    new DataView(chunk.buffer).setUint32(0, data.length);
    chunk.set(new TextEncoder().encode(type), 4);
    chunk.set(data, 8);
    parts.push(chunk);
  }
  return new Blob(parts);
}

const staticPng = pngBlob([["IDAT"]]);
const png = (overrides = {}) => ({ name: "map.png", type: "image/png", size: staticPng.size,
  slice: (start, end) => staticPng.slice(start, end), ...overrides });

test("accepts bounded JPEG and PNG only", () => {
  assert.equal(validateImageMetadata(png()), null);
  assert.equal(validateImageMetadata(png({ name: "photo.jpg", type: "image/jpeg" })), null);
  assert.match(validateImageMetadata(png({ type: "image/webp" })), /Only JPEG and PNG/);
  assert.match(validateImageMetadata(png({ size: MAX_FILE_BYTES + 1 })), /20 MiB/);
  assert.match(validateImageMetadata(png({ size: 0 })), /empty/);
});

test("rejects unreasonable decoded dimensions before canvas allocation", () => {
  assert.equal(validateImageDimensions(4000, 4000), null);
  assert.match(validateImageDimensions(8000, 6000), /pixel limit/);
  assert.match(validateImageDimensions(0, 100), /invalid/);
  assert.equal(validateImageDimensions(1, MAX_PIXELS), null);
});

test("selects only supported output formats", () => {
  assert.equal(getOutputMime("image/png", "same"), "image/png");
  assert.equal(getOutputMime("image/jpeg", "same"), "image/jpeg");
  assert.equal(getOutputMime("image/png", "jpeg"), "image/jpeg");
  assert.equal(getOutputMime("image/jpeg", "png"), "image/png");
  assert.throws(() => getOutputMime("image/webp", "same"), /Only JPEG and PNG/);
  assert.throws(() => getOutputMime("image/png", "gif"), /Choose JPEG/);
});

test("creates safe output filenames and expected extensions", () => {
  assert.equal(outputFilename("my map.png", "image/png"), "my map-clean.png");
  assert.equal(outputFilename("../private\\photo.jpg", "image/jpeg"), "..-private-photo-clean.jpg");
  assert.equal(outputFilename(".png", "image/png"), "image-clean.png");
  assert.throws(() => outputFilename("x", "image/webp"), /Unsupported/);
});

test("formats file sizes without leaking values", () => {
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(1024), "1.0 KiB");
  assert.equal(formatBytes(1_572_864), "1.5 MiB");
  assert.equal(formatBytes(20 * 1024 * 1024), "20 MiB");
  assert.equal(formatBytes(Number.NaN), "0 B");
});

test("re-encodes locally, returns dimensions and always releases bitmap/canvas", async () => {
  const oldBitmap = globalThis.createImageBitmap;
  const oldDocument = globalThis.document;
  let drawn = false, closed = false, canvasWidth = -1;
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() { closed = true; } });
  globalThis.document = { createElement(name) {
    assert.equal(name, "canvas");
    return { width: 0, height: 0, getContext() { return { fillRect() {}, drawImage() { drawn = true; } }; },
      toBlob(callback, type) { callback(new Blob(["encoded"], { type })); } };
  } };
  try {
    const result = await stripImageMetadata(png(), { format: "same" });
    assert.equal(result.filename, "map-clean.png");
    assert.equal(result.mime, "image/png");
    assert.equal(result.width, 640);
    assert.equal(result.height, 480);
    assert.equal(result.blob.type, "image/png");
    assert.equal(drawn, true);
    assert.equal(closed, true);
  } finally {
    globalThis.createImageBitmap = oldBitmap;
    globalThis.document = oldDocument;
  }
});

test("rejects a pixel bomb and closes the decoded bitmap", async () => {
  const oldBitmap = globalThis.createImageBitmap;
  const oldDocument = globalThis.document;
  let closed = false, canvasCreated = false;
  globalThis.createImageBitmap = async () => ({ width: 10_000, height: 10_000, close() { closed = true; } });
  globalThis.document = { createElement() { canvasCreated = true; return {}; } };
  try {
    await assert.rejects(stripImageMetadata(png()), /pixel limit/);
    assert.equal(canvasCreated, false);
    assert.equal(closed, true);
  } finally {
    globalThis.createImageBitmap = oldBitmap;
    globalThis.document = oldDocument;
  }
});

test("fails closed when browser encoding returns a different MIME type", async () => {
  const oldBitmap = globalThis.createImageBitmap;
  const oldDocument = globalThis.document;
  globalThis.createImageBitmap = async () => ({ width: 16, height: 16, close() {} });
  globalThis.document = { createElement() { return { width: 0, height: 0, getContext() { return { fillRect() {}, drawImage() {} }; }, toBlob(cb) { cb(new Blob(["encoded"], { type: "image/png" })); } }; } };
  try {
    await assert.rejects(stripImageMetadata(png(), { format: "jpeg" }), /does not support/);
  } finally {
    globalThis.createImageBitmap = oldBitmap;
    globalThis.document = oldDocument;
  }
});

test("rejects APNG before decoding instead of silently exporting one frame", async () => {
  const oldBitmap = globalThis.createImageBitmap;
  const oldDocument = globalThis.document;
  let decoded = false;
  globalThis.createImageBitmap = async () => { decoded = true; throw new Error("should not decode"); };
  globalThis.document = {};
  const animatedBlob = pngBlob([["acTL", new Uint8Array(8)], ["IDAT"]]);
  const animatedPng = png({ size: animatedBlob.size, slice: (start, end) => animatedBlob.slice(start, end) });
  try {
    await assert.rejects(stripImageMetadata(animatedPng), /Animated PNG.*not supported/);
    assert.equal(decoded, false);
  } finally {
    globalThis.createImageBitmap = oldBitmap;
    globalThis.document = oldDocument;
  }
});
