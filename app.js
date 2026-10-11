import { formatBytes, stripImageMetadata, validateImageMetadata } from "./core.js";

const input = document.querySelector("#image-input");
const formatSelect = document.querySelector("#output-format");
const qualityControl = document.querySelector("#quality");
const qualityValue = document.querySelector("#quality-value");
const processButton = document.querySelector("#clean-button");
const clearButton = document.querySelector("#clear-button");
const queue = document.querySelector("#queue");
const status = document.querySelector("#status");
const qualityRow = document.querySelector("#quality-row");
let selectedFiles = [];
let outputUrls = [];

function announce(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function clearOutputs() {
  for (const url of outputUrls) URL.revokeObjectURL(url);
  outputUrls = [];
}

function updateQualityVisibility() {
  qualityRow.hidden = formatSelect.value !== "jpeg" && !(formatSelect.value === "same" && selectedFiles.some(file => file.type === "image/jpeg"));
}

function renderQueue() {
  clearOutputs();
  queue.replaceChildren();
  for (const [index, file] of selectedFiles.entries()) {
    const item = document.createElement("li");
    item.className = "queue-item";
    const icon = document.createElement("span"); icon.className = "file-icon"; icon.textContent = file.type === "image/png" ? "PNG" : "JPG";
    const info = document.createElement("span"); info.className = "file-info";
    const name = document.createElement("strong"); name.textContent = file.name;
    const meta = document.createElement("small"); meta.textContent = `${formatBytes(file.size)} · ready`;
    info.append(name, meta);
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-file"; remove.textContent = "×"; remove.setAttribute("aria-label", `Remove image ${file.name}`);
    remove.addEventListener("click", () => { selectedFiles.splice(index, 1); renderQueue(); announce(`${selectedFiles.length} image${selectedFiles.length === 1 ? "" : "s"} queued.`); });
    item.append(icon, info, remove); queue.append(item);
  }
  processButton.disabled = selectedFiles.length === 0;
  clearButton.disabled = selectedFiles.length === 0;
  updateQualityVisibility();
}

function addIncomingFiles(incoming) {
  let skipped = 0;
  for (const file of incoming) {
    if (validateImageMetadata(file)) { skipped++; continue; }
    if (selectedFiles.length >= 20) { skipped++; continue; }
    if (!selectedFiles.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) selectedFiles.push(file);
  }
  renderQueue();
  announce(skipped ? `${selectedFiles.length} queued; ${skipped} unsupported, oversized, empty, or over the 20-image batch limit.` : `${selectedFiles.length} image${selectedFiles.length === 1 ? "" : "s"} queued.`, skipped ? "warning" : "success");
}

input.addEventListener("change", () => {
  addIncomingFiles(Array.from(input.files || []));
  input.value = "";
});
const dropzone = document.querySelector(".dropzone");
dropzone.addEventListener("dragover", event => { event.preventDefault(); dropzone.classList.add("is-dragging"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
dropzone.addEventListener("drop", event => {
  event.preventDefault(); dropzone.classList.remove("is-dragging");
  addIncomingFiles(Array.from(event.dataTransfer?.files || []));
});

formatSelect.addEventListener("change", updateQualityVisibility);
qualityControl.addEventListener("input", () => { qualityValue.textContent = `${Math.round(Number(qualityControl.value) * 100)}%`; });
clearButton.addEventListener("click", () => { selectedFiles = []; clearOutputs(); renderQueue(); announce("Queue cleared."); });

processButton.addEventListener("click", async () => {
  if (!selectedFiles.length) return;
  processButton.disabled = true; clearButton.disabled = true;
  let done = 0, failed = 0;
  const count = selectedFiles.length;
  for (const [index, file] of selectedFiles.entries()) {
    const item = queue.children[index];
    const meta = item?.querySelector("small");
    try {
      if (meta) meta.textContent = "Processing locally…";
      const result = await stripImageMetadata(file, { format: formatSelect.value, quality: Number(qualityControl.value) });
      const url = URL.createObjectURL(result.blob); outputUrls.push(url);
      if (meta) meta.textContent = `${formatBytes(file.size)} → ${formatBytes(result.blob.size)} · ${result.width} × ${result.height} · metadata not copied`;
      const download = document.createElement("a"); download.className = "download-link"; download.href = url; download.download = result.filename; download.textContent = "Download cleaned copy";
      item?.append(download); done++;
    } catch (error) {
      if (meta) meta.textContent = error instanceof Error ? error.message : "Could not process image.";
      item?.classList.add("queue-error"); failed++;
    }
    announce(`Processed ${done + failed} of ${count} · ${done} ready · ${failed} failed.`, failed ? "warning" : "success");
  }
  clearButton.disabled = false;
  processButton.disabled = true;
  if (!failed) announce(`${done} cleaned copy${done === 1 ? "" : "ies"} ready to download. Originals were not modified.`, "success");
});

formatSelect.dispatchEvent(new Event("change"));
renderQueue();
