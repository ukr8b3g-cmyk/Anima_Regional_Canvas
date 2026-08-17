const { app } = window.comfyAPI.app;

const NODE_NAMES = new Set(["AnimaRegionalCanvas", "AnimaRegionalInpaintCanvas"]);
const COLORS = [
  ["RED", "#ff0000", "red_prompt"],
  ["BLUE", "#0000ff", "blue_prompt"],
  ["YELLOW", "#ffff00", "yellow_prompt"],
  ["GREEN", "#00ff00", "green_prompt"],
  ["MAGENTA", "#ff00ff", "magenta_prompt"],
];
const HISTORY_LIMIT = 8;
const MAX_STROKE_POINTS = 96;
const STANDARD_NODE_SIZE = [1430, 1270];
const ARC_BACKUP_PREFIX = "anima_regional_canvas:";
const CANVAS_SIZE_VERSION = 1;
const DEFAULT_SPLIT_RATIO = 0.68;
const MIN_CANVAS_WIDTH = 520;
const MIN_PROMPTS_WIDTH = 380;
const SPLITTER_WIDTH = 8;

function findWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function hideWidget(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
  widget.serialize = true;
}

function canvasBackupKey(node) {
  return `${ARC_BACKUP_PREFIX}${node.type}:${node.id}`;
}

function readCanvasBackup(node) {
  try {
    return localStorage.getItem(canvasBackupKey(node)) || "";
  } catch (_) {
    return "";
  }
}

function writeCanvasBackup(node, payload) {
  try {
    localStorage.setItem(canvasBackupKey(node), payload || "");
  } catch (_) {}
}

function stop(ev) {
  ev.stopPropagation();
}

function makeButton(text, title) {
  const b = document.createElement("button");
  b.textContent = text;
  b.title = title || "";
  if (b.title) b.setAttribute("aria-label", b.title);
  b.className = "arc-btn";
  b.addEventListener("pointerdown", stop);
  b.addEventListener("mousedown", stop);
  return b;
}

function inputViewUrl(value) {
  if (!value) return null;
  let filename = String(value);
  let subfolder = "";
  const lastSlash = filename.lastIndexOf("/");
  if (lastSlash >= 0) {
    subfolder = filename.slice(0, lastSlash);
    filename = filename.slice(lastSlash + 1);
  }
  const params = new URLSearchParams({ filename, type: "input", subfolder });
  params.set("no-cache", String(Date.now()));
  return `/view?${params.toString()}`;
}

function ensureStyle() {
  if (document.getElementById("arc-style")) return;
  const style = document.createElement("style");
  style.id = "arc-style";
  style.textContent = `
    .arc-wrap{display:flex;flex-direction:column;gap:7px;min-height:520px;overflow:hidden;color:#d7d7d7;font:12px sans-serif}
    .arc-toolbar{display:flex;flex-direction:column;gap:6px}
    .arc-toolbar-row{display:flex;align-items:center;gap:9px;min-width:0;min-height:32px}
    .arc-toolbar-row.color{min-height:30px}
    .arc-main{display:grid;grid-template-columns:minmax(520px,1fr) 8px minmax(380px,470px);gap:0;min-height:0;flex:1}
    .arc-splitter{width:8px;cursor:col-resize;position:relative;touch-action:none;outline:none}
    .arc-splitter::before{content:"";position:absolute;inset:0 2px;border-radius:3px;background:#3b3b3b;transition:background .12s,box-shadow .12s}
    .arc-splitter:hover::before,.arc-splitter:focus-visible::before,.arc-splitter.dragging::before{background:#6f879e;box-shadow:0 0 0 1px #9cb4ca}
    .arc-canvasbox{background:#181818;border:1px solid #444;border-radius:6px;display:flex;align-items:center;justify-content:center;min-height:260px;overflow:hidden;position:relative}
    .arc-canvas{background:#fff;cursor:none;touch-action:none;max-width:100%;max-height:100%}
    .arc-canvas-layer{position:relative;display:inline-block;line-height:0}
    .arc-brush-preview{position:absolute;border:1px solid rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.75),0 0 6px rgba(0,0,0,.45);border-radius:50%;pointer-events:none;display:none;box-sizing:border-box;mix-blend-mode:difference;transform:translate(-50%,-50%)}
    .arc-prompts{display:flex;flex-direction:column;gap:5px;min-width:0;background:#242424;padding:6px;border-radius:5px}
    .arc-row{display:grid;grid-template-columns:58px minmax(0,1fr) 54px;gap:6px;align-items:stretch}
    .arc-label{display:flex;align-items:center;justify-content:center;font-weight:700;border-radius:2px;color:#fff;min-height:86px;text-align:center}
    .arc-label.base{background:#4b4b4b}.arc-label.neg{background:#2b2b2b;border:1px solid #555}
    .arc-text{display:block;width:100%;height:86px;background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:3px;resize:vertical;min-height:86px;padding:5px 7px;font:12px monospace;box-sizing:border-box}
    .arc-text.external{opacity:.58;cursor:not-allowed}
    .arc-sw{width:26px;height:26px;border:2px solid #777;border-radius:4px;cursor:pointer}
    .arc-sw.active{border-color:#e6e6e6;box-shadow:inset 0 0 0 2px #111}
    .arc-btn{background:#303030;color:#ddd;border:1px solid #555;border-radius:4px;min-height:30px;padding:5px 11px;cursor:pointer;box-sizing:border-box;white-space:nowrap}
    .arc-btn:hover{border-color:#999;color:#fff}
    .arc-range{width:160px}
    .arc-small{color:#aaa}
    .arc-info{color:#b8c7d9;background:#202833;border:1px solid #45515f;border-radius:4px;min-height:30px;padding:6px 9px;font-size:11px;box-sizing:border-box;white-space:nowrap}
    .arc-settings{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
    .arc-num{width:76px;height:30px;background:#202020;color:#eee;border:1px solid #555;border-radius:4px;padding:4px 7px;text-align:right;box-sizing:border-box}
    .arc-size-num{width:92px;font-weight:700}
    .arc-batch-num{width:68px}
    .arc-field-label{color:#c7c7c7;font-weight:700}
    .arc-spacer{flex:1 1 auto}
    .arc-input-btn{min-width:54px;height:30px;align-self:center;padding:3px 7px;font-size:11px}
    .arc-input-btn.active{border-color:#8aa8c7;background:#26394b;color:#d9ecff}
    .arc-px{margin-left:-5px;color:#aaa}
    .arc-switch{width:16px;height:16px;accent-color:#62d45f}
  `;
  document.head.appendChild(style);
}

app.registerExtension({
  name: "anima.regional.canvas",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!NODE_NAMES.has(nodeData.name)) return;

    const original = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      original?.apply(this, arguments);
      ensureStyle();

      const node = this;
      node.properties = node.properties || {};
      const markDirty = () => app.graph?.setDirtyCanvas?.(true, true);
      const promptNames = ["quality_prompt", "scene_prompt", ...COLORS.map((c) => c[2]), "negative_prompt"];
      function removeLegacyInputs({ keepConnected = false } = {}) {
        const legacyNames = new Set(["base_prompt_in", ...promptNames.map((name) => `${name}_in`)]);
        for (let index = (node.inputs?.length ?? 0) - 1; index >= 0; index -= 1) {
          const input = node.inputs[index];
          if (!legacyNames.has(input?.name)) continue;
          if (keepConnected && input.link != null) continue;
          node.removeInput(index);
        }
      }
      removeLegacyInputs();
      const canvasData = findWidget(node, "canvas_data");
      const widthW = findWidget(node, "width");
      const heightW = findWidget(node, "height");
      const batchW = findWidget(node, "batch_size");
      const brushW = findWidget(node, "brush_size");
      const regionStrengthW = findWidget(node, "region_strength");
      const regionalEnabledW = findWidget(node, "regional_enabled");
      node.properties.animaPrompts = node.properties.animaPrompts || {};
      const promptWidgets = promptNames.map((name) => findWidget(node, name));
      const promptTextareas = new Map();
      const promptInputButtons = new Map();

      function promptValue(name) {
        const saved = node.properties.animaPrompts?.[name];
        if (typeof saved === "string") return saved;
        return findWidget(node, name)?.value ?? "";
      }
      function setPromptValue(name, value) {
        const text = String(value ?? "");
        const widget = findWidget(node, name);
        if (widget) widget.value = text;
        node.properties.animaPrompts[name] = text;
      }
      function savePrompts() {
        for (const name of promptNames) {
          const textarea = promptTextareas.get(name);
          setPromptValue(name, textarea?.value ?? promptValue(name));
        }
      }
      function serializedWidgets() {
        return (node.widgets || []).filter((widget) => widget.serialize !== false);
      }
      function setSerializedWidgetValue(workflowNode, name, value) {
        if (!workflowNode) return;
        const index = serializedWidgets().findIndex((widget) => widget.name === name);
        if (index < 0) return;
        workflowNode.widgets_values = workflowNode.widgets_values || [];
        workflowNode.widgets_values[index] = value;
      }
      function writeSerializedValues(workflowNode) {
        savePrompts();
        setSerializedWidgetValue(workflowNode, "width", Number(widthW?.value ?? 1024));
        setSerializedWidgetValue(workflowNode, "height", Number(heightW?.value ?? 1024));
        setSerializedWidgetValue(workflowNode, "batch_size", Number(batchW?.value ?? batchNum?.value ?? 1));
        for (const name of promptNames) {
          setSerializedWidgetValue(workflowNode, name, promptValue(name));
        }
        setSerializedWidgetValue(workflowNode, "brush_size", Number(brushW?.value ?? brush?.value ?? 92));
        setSerializedWidgetValue(workflowNode, "regional_enabled", regionalEnabledW?.value ?? regionalToggle?.checked ?? true);
        setSerializedWidgetValue(workflowNode, "region_strength", Number(regionStrengthW?.value ?? strength?.value ?? 1));
        if (canvasData) {
          setSerializedWidgetValue(workflowNode, "canvas_data", canvasData.value ?? "");
        }
      }
      function syncPromptTextareas() {
        for (const name of promptNames) {
          const value = promptValue(name);
          const textarea = promptTextareas.get(name);
          if (textarea && textarea.value !== value) textarea.value = value;
          setPromptValue(name, value);
        }
      }

      hideWidget(canvasData);
      hideWidget(widthW);
      hideWidget(heightW);
      hideWidget(batchW);
      hideWidget(brushW);
      hideWidget(regionStrengthW);
      hideWidget(regionalEnabledW);
      for (const w of promptWidgets) hideWidget(w);

      const wrap = document.createElement("div");
      wrap.className = "arc-wrap";

      const regionalToggle = { checked: regionalEnabledW?.value !== false };
      const strength = { value: String(regionStrengthW?.value ?? 0.95) };
      if (regionalEnabledW) regionalEnabledW.value = regionalToggle.checked;
      if (regionStrengthW) regionStrengthW.value = Number(strength.value) || 0.95;

      const toolbar = document.createElement("div");
      toolbar.className = "arc-toolbar";
      const toolbarTop = document.createElement("div");
      toolbarTop.className = "arc-toolbar-row top";
      const toolbarBrush = document.createElement("div");
      toolbarBrush.className = "arc-toolbar-row brush";
      const toolbarColor = document.createElement("div");
      toolbarColor.className = "arc-toolbar-row color";
      toolbar.append(toolbarTop, toolbarBrush, toolbarColor);
      const mode = document.createElement("span");
      mode.className = "arc-small";
      mode.textContent = "Standard";
      toolbarTop.appendChild(mode);
      const sizeLabel = document.createElement("span");
      sizeLabel.className = "arc-info";
      sizeLabel.title = "Canvas size, updated from connected image or loaded canvas";
      sizeLabel.setAttribute("aria-label", sizeLabel.title);
      toolbarTop.appendChild(sizeLabel);

      const colorLabel = document.createElement("span");
      colorLabel.className = "arc-field-label";
      colorLabel.textContent = "Color";
      toolbarColor.appendChild(colorLabel);

      let activeColor = COLORS[0][1];
      for (const [label, hex] of COLORS) {
        const sw = document.createElement("button");
        sw.className = "arc-sw" + (hex === activeColor ? " active" : "");
        sw.style.background = hex;
        sw.title = label;
        sw.addEventListener("click", () => {
          activeColor = hex;
          toolbar.querySelectorAll(".arc-sw").forEach((x) => x.classList.remove("active"));
          sw.classList.add("active");
        });
        sw.setAttribute("aria-label", `${label} paint color`);
        toolbarColor.appendChild(sw);
      }

      const white = document.createElement("button");
      white.className = "arc-sw";
      white.style.background = "#ffffff";
      white.title = "Erase painted regions by painting white";
      white.setAttribute("aria-label", white.title);
      white.addEventListener("click", () => {
        activeColor = "#ffffff";
        toolbar.querySelectorAll(".arc-sw").forEach((x) => x.classList.remove("active"));
        white.classList.add("active");
      });
      toolbarColor.appendChild(white);

      const brushLabel = document.createElement("span");
      brushLabel.className = "arc-small";
      brushLabel.textContent = "Brush";
      const brush = document.createElement("input");
      brush.type = "range";
      brush.min = "1";
      brush.max = "512";
      brush.step = "1";
      brush.className = "arc-range";
      brush.value = brushW?.value ?? 92;
      const brushNum = document.createElement("input");
      brushNum.type = "number";
      brushNum.min = "1";
      brushNum.max = "512";
      brushNum.step = "1";
      brushNum.value = brush.value;
      brushNum.className = "arc-num";
      const brushPx = document.createElement("span");
      brushPx.className = "arc-px";
      brushPx.textContent = "px";
      const syncBrush = (mark = true) => {
        const val = Math.max(1, Math.min(512, Math.round(Number(brush.value) || 92)));
        brush.value = String(val);
        brushNum.value = String(val);
        if (brushW) brushW.value = val;
        if (mark) markDirty();
      };
      const setBrush = (value) => {
        brush.value = String(value);
        syncBrush();
      };
      brush.addEventListener("input", () => setBrush(brush.value));
      brushNum.addEventListener("input", () => setBrush(brushNum.value));
      brush.addEventListener("pointerdown", stop);
      brushNum.addEventListener("pointerdown", stop);
      syncBrush(false);
      toolbarBrush.append(brushLabel, brushNum, brushPx, brush);

      const opacity = document.createElement("input");
      opacity.type = "range";
      opacity.min = "0.1";
      opacity.max = "1";
      opacity.step = "0.01";
      opacity.value = node.properties.brushOpacity ?? "1";
      opacity.title = "Brush opacity";
      opacity.className = "arc-range";
      const opacityNum = document.createElement("input");
      opacityNum.type = "number";
      opacityNum.min = "0.1";
      opacityNum.max = "1";
      opacityNum.step = "0.01";
      opacityNum.value = opacity.value;
      opacityNum.className = "arc-num";
      const opacityLabel = document.createElement("span");
      opacityLabel.className = "arc-small";
      opacityLabel.textContent = "Opacity";
      const syncOpacity = (v) => {
        const val = Math.max(0.1, Math.min(1, Number(v) || 1));
        opacity.value = String(val);
        opacityNum.value = String(val);
        node.properties.brushOpacity = val;
      };
      opacity.addEventListener("input", () => syncOpacity(opacity.value));
      opacityNum.addEventListener("input", () => syncOpacity(opacityNum.value));
      opacity.addEventListener("pointerdown", stop);
      opacityNum.addEventListener("pointerdown", stop);
      toolbarBrush.append(opacityLabel, opacityNum, opacity);

      const stepSize = document.createElement("input");
      stepSize.type = "range";
      stepSize.min = "5";
      stepSize.max = "50";
      stepSize.step = "1";
      stepSize.value = node.properties.stepSize ?? "18";
      stepSize.title = "Stroke step size. Smaller is smoother.";
      stepSize.className = "arc-range";
      const stepNum = document.createElement("input");
      stepNum.type = "number";
      stepNum.min = "5";
      stepNum.max = "50";
      stepNum.step = "1";
      stepNum.value = stepSize.value;
      stepNum.className = "arc-num";
      const stepLabel = document.createElement("span");
      stepLabel.className = "arc-small";
      stepLabel.textContent = "Step";
      const syncStep = (v) => {
        const val = Math.max(5, Math.min(50, Number(v) || 18));
        stepSize.value = String(val);
        stepNum.value = String(val);
        node.properties.stepSize = val;
      };
      stepSize.addEventListener("input", () => syncStep(stepSize.value));
      stepNum.addEventListener("input", () => syncStep(stepNum.value));
      stepSize.addEventListener("pointerdown", stop);
      stepNum.addEventListener("pointerdown", stop);
      toolbarBrush.append(stepLabel, stepNum, stepSize);

      const undo = makeButton("Undo", "Undo the last canvas edit");
      const clear = makeButton("Clear", "Clear the painted canvas. Undo remains available.");
      const resetBrush = makeButton("Reset Brush", "Reset Brush, Opacity, and Step to their defaults");
      const loadCanvasButton = makeButton("Load Canvas", "Load a saved canvas PNG or image");
      const saveCanvasButton = makeButton("Save Canvas", "Save painted color canvas as PNG");
      const loadCanvasInput = document.createElement("input");
      loadCanvasInput.type = "file";
      loadCanvasInput.accept = "image/png";
      loadCanvasInput.style.display = "none";
      loadCanvasInput.addEventListener("pointerdown", stop);
      loadCanvasInput.addEventListener("mousedown", stop);
      const resizeCanvasButton = makeButton("Resize Canvas", "Resize the mask canvas inside ComfyUI without loading an external image");
      const canvasWNum = document.createElement("input");
      canvasWNum.type = "number";
      canvasWNum.min = "16";
      canvasWNum.max = "16384";
      canvasWNum.step = "8";
      canvasWNum.value = widthW?.value ?? 1024;
      canvasWNum.className = "arc-num arc-size-num";
      canvasWNum.title = "Canvas width. Apply on change or Enter.";
      const canvasHNum = document.createElement("input");
      canvasHNum.type = "number";
      canvasHNum.min = "16";
      canvasHNum.max = "16384";
      canvasHNum.step = "8";
      canvasHNum.value = heightW?.value ?? 1024;
      canvasHNum.className = "arc-num arc-size-num";
      canvasHNum.title = "Canvas height. Apply on change or Enter.";
      canvasWNum.addEventListener("pointerdown", stop);
      canvasWNum.addEventListener("mousedown", stop);
      canvasHNum.addEventListener("pointerdown", stop);
      canvasHNum.addEventListener("mousedown", stop);
      canvasWNum.setAttribute("aria-label", canvasWNum.title);
      canvasHNum.setAttribute("aria-label", canvasHNum.title);

      const batchNum = document.createElement("input");
      batchNum.type = "number";
      batchNum.min = "1";
      batchNum.max = "4096";
      batchNum.step = "1";
      batchNum.value = batchW?.value ?? 1;
      batchNum.className = "arc-num arc-batch-num";
      batchNum.title = "Number of images generated in one batch";
      batchNum.setAttribute("aria-label", batchNum.title);
      const syncBatch = () => {
        const value = Math.max(1, Math.min(4096, Math.round(Number(batchNum.value) || 1)));
        batchNum.value = String(value);
        if (batchW) batchW.value = value;
        markDirty();
      };
      batchNum.addEventListener("input", syncBatch);
      batchNum.addEventListener("change", syncBatch);
      batchNum.addEventListener("pointerdown", stop);
      batchNum.addEventListener("mousedown", stop);
      resetBrush.addEventListener("click", () => {
        brush.value = "92";
        syncBrush();
        syncOpacity(1);
        syncStep(18);
      });
      const widthLabel = document.createElement("span");
      widthLabel.className = "arc-field-label";
      widthLabel.textContent = "W";
      const heightLabel = document.createElement("span");
      heightLabel.className = "arc-field-label";
      heightLabel.textContent = "H";
      toolbarTop.append(
        widthLabel,
        canvasWNum,
        heightLabel,
        canvasHNum,
        resizeCanvasButton,
        loadCanvasButton,
        saveCanvasButton,
        undo,
        clear,
        loadCanvasInput,
      );
      toolbarBrush.appendChild(resetBrush);
      const colorSpacer = document.createElement("span");
      colorSpacer.className = "arc-spacer";
      const batchLabel = document.createElement("span");
      batchLabel.className = "arc-field-label";
      batchLabel.textContent = "Batch Size";
      batchLabel.title = batchNum.title;
      toolbarColor.append(colorSpacer, batchLabel, batchNum);
      wrap.appendChild(toolbar);

      const main = document.createElement("div");
      main.className = "arc-main";
      const canvasBox = document.createElement("div");
      canvasBox.className = "arc-canvasbox";
      const canvasLayer = document.createElement("div");
      canvasLayer.className = "arc-canvas-layer";
      const canvas = document.createElement("canvas");
      canvas.className = "arc-canvas";
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const maskCanvas = document.createElement("canvas");
      const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
      const brushPreview = document.createElement("div");
      brushPreview.className = "arc-brush-preview";
      canvasLayer.appendChild(canvas);
      canvasLayer.appendChild(brushPreview);
      canvasBox.appendChild(canvasLayer);
      function timestamp() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      }
      function downloadMaskCanvas() {
        saveData();
        const filename = `anima_regional_canvas_${timestamp()}_${maskCanvas.width}x${maskCanvas.height}.png`;
        downloadCanvasAs(filename, "image/png");
      }
      function downloadCanvasAs(filename, mimeType, quality) {
        const saveUrl = (url) => {
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
        };
        if (maskCanvas.toBlob) {
          maskCanvas.toBlob((blob) => {
            if (!blob) {
              downloadCanvasAs(filename.replace(/\.webp$/i, ".png"), "image/png");
              return;
            }
            const url = URL.createObjectURL(blob);
            saveUrl(url);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }, mimeType, quality);
        } else {
          saveUrl(maskCanvas.toDataURL(mimeType, quality));
        }
      }
      function loadCanvasFile(file) {
        if (!file) return;
        if (!file.type?.startsWith("image/")) return;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            pushHistory();
            const w = safeDimension(img.naturalWidth || img.width, 1024);
            const h = safeDimension(img.naturalHeight || img.height, 1024);
            if (widthW) widthW.value = w;
            if (heightW) heightW.value = h;
            lastWidth = w;
            lastHeight = h;
            canvas.width = w;
            canvas.height = h;
            maskCanvas.width = w;
            maskCanvas.height = h;
            ctx.imageSmoothingEnabled = false;
            maskCtx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, w, h);
            maskCtx.clearRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            maskCtx.drawImage(img, 0, 0, w, h);
            canvasEdited = true;
            lastInputImageKey = "";
            saveData();
            fitCanvas();
          } finally {
            URL.revokeObjectURL(url);
            loadCanvasInput.value = "";
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          loadCanvasInput.value = "";
        };
        img.src = url;
      }
      loadCanvasButton.addEventListener("click", () => loadCanvasInput.click());
      loadCanvasInput.addEventListener("change", () => loadCanvasFile(loadCanvasInput.files?.[0]));
      saveCanvasButton.addEventListener("click", downloadMaskCanvas);
      resizeCanvasButton.addEventListener("click", resizeFromToolbar);
      canvasWNum.addEventListener("change", resizeFromToolbar);
      canvasHNum.addEventListener("change", resizeFromToolbar);
      const commitSizeOnEnter = (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        resizeFromToolbar();
      };
      canvasWNum.addEventListener("keydown", commitSizeOnEnter);
      canvasHNum.addEventListener("keydown", commitSizeOnEnter);

      function promptInputSlot(name) {
        return node.inputs?.find((input) => input.name === `${name}_in`) || null;
      }
      function syncPromptInputModes() {
        for (const name of promptNames) {
          const input = promptInputSlot(name);
          const external = Boolean(input);
          const connected = input?.link != null;
          const textarea = promptTextareas.get(name);
          const button = promptInputButtons.get(name);
          if (textarea) {
            textarea.disabled = external;
            textarea.classList.toggle("external", external);
            textarea.title = external
              ? (connected ? "External STRING input connected" : "External input mode. Connect a STRING input.")
              : textarea.placeholder;
          }
          if (button) {
            button.classList.toggle("active", external);
            button.textContent = external ? "IN ON" : "← IN";
            button.setAttribute("aria-pressed", String(external));
            button.title = external
              ? (connected ? "Disconnect the STRING cable before returning to local text" : "Return to local text input")
              : "Show an external STRING input for Text Multiline or another text node";
            button.setAttribute("aria-label", button.title);
          }
        }
      }
      function togglePromptInput(name) {
        const input = promptInputSlot(name);
        if (input) {
          if (input.link != null) {
            syncPromptInputModes();
            return;
          }
          const index = node.inputs?.indexOf(input) ?? -1;
          if (index >= 0) node.removeInput(index);
        } else {
          savePrompts();
          node.addInput(`${name}_in`, "STRING");
        }
        syncPromptInputModes();
        markDirty();
      }

      const prompts = document.createElement("div");
      prompts.className = "arc-prompts";
      const promptRows = [
        ["QUALITY", "#555555", "quality_prompt", "base", "quality tags, style tags"],
        ["SCENE", "#3a3a3a", "scene_prompt", "base", "2girls, character names, cafe, background, situation"],
        ...COLORS.map(([label, hex, name]) => [label, hex, name, "", `${label.toLowerCase()} region prompt`]),
        ["NEGATIVE", "#222222", "negative_prompt", "neg", "negative prompt"],
      ];
      for (const [label, hex, widgetName, cls, placeholder] of promptRows) {
        const row = document.createElement("div");
        row.className = "arc-row";
        const l = document.createElement("div");
        l.className = `arc-label ${cls}`;
        l.style.background = hex;
        l.title = placeholder;
        l.textContent = label;
        const t = document.createElement("textarea");
        t.classList.add("arc-text");
        t.name = widgetName;
        t.placeholder = placeholder;
        t.title = placeholder;
        t.id = t.id || `arc-${node.id ?? "new"}-${widgetName}`;
        t.dataset.arcPrompt = "true";
        t.dataset.widgetName = widgetName;
        t.dataset.comfyWidgetName = widgetName;
        t.dataset.comfyNode = node.comfyClass || "";
        t.autocomplete = "off";
        t.spellcheck = false;
        t.value = promptValue(widgetName);
        setPromptValue(widgetName, t.value);
        promptTextareas.set(widgetName, t);
        const commitPrompt = () => {
          setPromptValue(widgetName, t.value);
          markDirty();
        };
        t.addEventListener("input", commitPrompt);
        t.addEventListener("change", commitPrompt);
        t.addEventListener("keyup", commitPrompt);
        t.addEventListener("blur", commitPrompt);
        t.addEventListener("pointerdown", stop);
        t.addEventListener("mousedown", stop);
        const inputButton = makeButton("← IN", "Show an external STRING input for Text Multiline or another text node");
        inputButton.classList.add("arc-input-btn");
        inputButton.setAttribute("aria-pressed", "false");
        inputButton.addEventListener("click", () => togglePromptInput(widgetName));
        promptInputButtons.set(widgetName, inputButton);
        row.append(l, t, inputButton);
        prompts.appendChild(row);
      }

      const splitter = document.createElement("div");
      splitter.className = "arc-splitter";
      splitter.tabIndex = 0;
      splitter.setAttribute("role", "separator");
      splitter.setAttribute("aria-orientation", "vertical");
      splitter.title = "Drag to resize the canvas and prompt panels. Double-click to reset.";
      splitter.setAttribute("aria-label", splitter.title);
      let currentSplitRatio = Number(node.properties.arcSplitRatio);
      if (!Number.isFinite(currentSplitRatio)) currentSplitRatio = DEFAULT_SPLIT_RATIO;
      currentSplitRatio = Math.max(0.2, Math.min(0.8, currentSplitRatio));
      function applySplit(ratio = currentSplitRatio, persist = false) {
        const available = main.clientWidth - SPLITTER_WIDTH;
        if (available <= 0) return;
        const minCanvas = Math.min(MIN_CANVAS_WIDTH, Math.max(260, available - MIN_PROMPTS_WIDTH));
        const minPrompts = Math.min(MIN_PROMPTS_WIDTH, Math.max(300, available - minCanvas));
        const canvasWidth = Math.max(minCanvas, Math.min(available - minPrompts, available * ratio));
        currentSplitRatio = canvasWidth / available;
        main.style.gridTemplateColumns = `${Math.round(canvasWidth)}px ${SPLITTER_WIDTH}px minmax(0,1fr)`;
        splitter.setAttribute("aria-valuenow", String(Math.round(currentSplitRatio * 100)));
        if (persist) {
          node.properties.arcSplitRatio = currentSplitRatio;
          markDirty();
        }
        requestAnimationFrame(fitCanvas);
      }
      function applySplitFromPointer(event, persist = true) {
        const rect = main.getBoundingClientRect();
        const available = rect.width - SPLITTER_WIDTH;
        if (available <= 0) return;
        applySplit((event.clientX - rect.left) / available, persist);
      }
      splitter.addEventListener("pointerdown", (event) => {
        stop(event);
        event.preventDefault();
        splitter.classList.add("dragging");
        splitter.setPointerCapture?.(event.pointerId);
        applySplitFromPointer(event);
      });
      splitter.addEventListener("pointermove", (event) => {
        if (!splitter.hasPointerCapture?.(event.pointerId)) return;
        stop(event);
        applySplitFromPointer(event);
      });
      const finishSplitDrag = (event) => {
        if (splitter.hasPointerCapture?.(event.pointerId)) splitter.releasePointerCapture?.(event.pointerId);
        splitter.classList.remove("dragging");
      };
      splitter.addEventListener("pointerup", finishSplitDrag);
      splitter.addEventListener("pointercancel", finishSplitDrag);
      splitter.addEventListener("dblclick", (event) => {
        stop(event);
        applySplit(DEFAULT_SPLIT_RATIO, true);
      });
      splitter.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        applySplit(currentSplitRatio + (event.key === "ArrowRight" ? 0.02 : -0.02), true);
      });

      main.append(canvasBox, splitter, prompts);
      wrap.appendChild(main);

      const history = [];
      let saveTimer = null;
      let resizeTimer = null;
      let lastWidth = null;
      let lastHeight = null;
      let lastInputImageKey = "";
      let canvasEdited = false;
      let hasCanvasContent = false;
      let isRestoringCanvas = false;
      let lastDisplayStyle = { width: "", height: "" };
      let canvasResizeObserver = null;
      let splitResizeObserver = null;
      function visibleCanvasBox() {
        return canvasBox.isConnected && canvasBox.clientWidth > 16 && canvasBox.clientHeight > 16;
      }
      function safeDimension(value, fallback) {
        const n = Math.round(Number(value));
        const base = Number.isFinite(n) && n >= 16 ? n : Math.round(Number(fallback) || 1024);
        return Math.min(16384, Math.max(16, Math.floor(base / 8) * 8));
      }
      function markCanvasSizeInitialized() {
        node.properties.arcCanvasSizeVersion = CANVAS_SIZE_VERSION;
      }
      function canvasPayloadDimensions(payloadText) {
        if (!payloadText) return null;
        try {
          const payload = JSON.parse(payloadText);
          const width = Math.round(Number(payload.width));
          const height = Math.round(Number(payload.height));
          if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
        } catch (_) {}
        return null;
      }
      function dims() {
        return {
          w: safeDimension(widthW?.value, canvas.width || lastWidth || canvasWNum?.value || 1024),
          h: safeDimension(heightW?.value, canvas.height || lastHeight || canvasHNum?.value || 1024),
        };
      }
      function syncSizeWidgetsToCanvas() {
        if (widthW && canvas.width) widthW.value = canvas.width;
        if (heightW && canvas.height) heightW.value = canvas.height;
        if (canvasWNum && canvas.width && document.activeElement !== canvasWNum) canvasWNum.value = canvas.width;
        if (canvasHNum && canvas.height && document.activeElement !== canvasHNum) canvasHNum.value = canvas.height;
        if (sizeLabel && canvas.width && canvas.height) sizeLabel.textContent = `Current Canvas ${canvas.width} x ${canvas.height}`;
      }
      function syncCanvasSize(keep = false, force = false) {
        const { w, h } = dims();
        if (!force && w === lastWidth && h === lastHeight && canvas.width === w && canvas.height === h) return;
        resizeCanvasPreserve(w, h, keep);
      }
      function scheduleResizePreserve(force = false) {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          resizeTimer = null;
          syncCanvasSize(true, force);
        }, 120);
      }
      function saveData(options = {}) {
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        const painted = maskHasPaint();
        markCanvasSizeInitialized();
        const payload = JSON.stringify({
          version: 2,
          width: maskCanvas.width,
          height: maskCanvas.height,
          data_url: maskCanvas.toDataURL("image/png"),
        });
        if (canvasData) canvasData.value = payload;
        node.properties.arcCanvasData = payload;
        if (options.clearBackup) {
          writeCanvasBackup(node, "");
        } else if (painted || canvasEdited || hasCanvasContent || options.forceBackup) {
          writeCanvasBackup(node, payload);
        }
        hasCanvasContent = painted || canvasEdited || hasCanvasContent;
        markDirty();
      }
      function scheduleSaveData() {
        if (saveTimer) return;
        saveTimer = setTimeout(saveData, 250);
      }
      function pushHistory() {
        try {
          history.push({
            display: ctx.getImageData(0, 0, canvas.width, canvas.height),
            mask: maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height),
          });
        } catch (_) {}
        if (history.length > HISTORY_LIMIT) history.shift();
      }
      function cloneCanvas(src) {
        if (!src?.width || !src?.height) return null;
        const clone = document.createElement("canvas");
        clone.width = src.width;
        clone.height = src.height;
        clone.getContext("2d").drawImage(src, 0, 0);
        return clone;
      }
      function resizeCanvasPreserve(w, h, keep = true) {
        w = safeDimension(w, canvas.width || lastWidth || 1024);
        h = safeDimension(h, canvas.height || lastHeight || 1024);
        const oldDisplay = keep ? cloneCanvas(canvas) : null;
        const oldMask = keep ? cloneCanvas(maskCanvas) : null;
        lastWidth = w;
        lastHeight = h;
        if (widthW) widthW.value = w;
        if (heightW) heightW.value = h;
        canvas.width = w;
        canvas.height = h;
        maskCanvas.width = w;
        maskCanvas.height = h;
        ctx.imageSmoothingEnabled = false;
        maskCtx.imageSmoothingEnabled = false;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        maskCtx.fillStyle = "#ffffff";
        maskCtx.fillRect(0, 0, w, h);
        if (oldDisplay && oldDisplay.width && oldDisplay.height) ctx.drawImage(oldDisplay, 0, 0, w, h);
        if (oldMask && oldMask.width && oldMask.height) maskCtx.drawImage(oldMask, 0, 0, w, h);
        canvasEdited = keep ? maskHasPaint() : false;
        hasCanvasContent = hasCanvasContent || canvasEdited;
        fitCanvas();
        saveData();
      }
      function resizeFromToolbar() {
        const w = safeDimension(canvasWNum.value, canvas.width || lastWidth || 1024);
        const h = safeDimension(canvasHNum.value, canvas.height || lastHeight || 1024);
        canvasWNum.value = String(w);
        canvasHNum.value = String(h);
        pushHistory();
        resizeCanvasPreserve(w, h, true);
      }
      function resetCanvas(keep = false) {
        const { w, h } = dims();
        resizeCanvasPreserve(w, h, keep);
      }
      function fitCanvas() {
        if (!visibleCanvasBox()) return;
        const maxW = Math.max(1, canvasBox.clientWidth - 8);
        const maxH = Math.max(1, canvasBox.clientHeight - 8);
        const scale = Math.min(maxW / canvas.width, maxH / canvas.height);
        const displayW = Math.max(1, Math.floor(canvas.width * scale));
        const displayH = Math.max(1, Math.floor(canvas.height * scale));
        lastDisplayStyle = { width: `${displayW}px`, height: `${displayH}px` };
        canvas.style.width = `${displayW}px`;
        canvas.style.height = `${displayH}px`;
        canvasLayer.style.width = `${displayW}px`;
        canvasLayer.style.height = `${displayH}px`;
        syncSizeWidgetsToCanvas();
      }
      function maskHasPaint() {
        try {
          const data = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return true;
          }
        } catch (_) {}
        return false;
      }
      function drawMaskOverlay(targetCtx, sourceMask, width, height) {
        const overlay = document.createElement("canvas");
        overlay.width = width;
        overlay.height = height;
        const overlayCtx = overlay.getContext("2d", { willReadFrequently: true });
        overlayCtx.imageSmoothingEnabled = false;
        overlayCtx.drawImage(sourceMask, 0, 0, width, height);
        const imageData = overlayCtx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const opacityValue = Number(opacity.value);
        const overlayAlpha = Math.round(255 * Math.max(0, Math.min(1, Number.isFinite(opacityValue) ? opacityValue : 1)));
        for (let index = 0; index < data.length; index += 4) {
          const white = data[index] >= 250 && data[index + 1] >= 250 && data[index + 2] >= 250;
          data[index + 3] = white ? 0 : overlayAlpha;
        }
        overlayCtx.putImageData(imageData, 0, 0);
        targetCtx.drawImage(overlay, 0, 0);
      }
      function connectedImageSource() {
        const input = node.inputs?.find((slot) => slot.name === "image");
        if (!input?.link || !node.graph?.links) return null;
        const link = node.graph.links[input.link];
        const originId = link?.origin_id ?? link?.[1];
        if (originId == null) return null;
        const source = node.graph.getNodeById?.(originId);
        if (!source) return null;

        const imageWidget = source.widgets?.find((widget) => widget.name === "image");
        const url = inputViewUrl(imageWidget?.value);
        if (url) return { url, key: `${originId}:${imageWidget.value}` };

        const src = source.imgs?.[0]?.src;
        return src ? { url: src, key: `${originId}:${src}` } : null;
      }
      function loadConnectedImage(force = false) {
        const source = connectedImageSource();
        if (!source) return;
        if (!force && source.key === lastInputImageKey) return;
        if (isRestoringCanvas || !visibleCanvasBox()) return;

        const img = new Image();
        img.onload = () => {
          const oldMask = !force ? cloneCanvas(maskCanvas) : null;
          const hadPaint = !force && maskHasPaint();
          const w = safeDimension(img.naturalWidth || img.width, 1024);
          const h = safeDimension(img.naturalHeight || img.height, 1024);
          if (widthW) widthW.value = w;
          if (heightW) heightW.value = h;
          lastWidth = w;
          lastHeight = h;
          canvas.width = w;
          canvas.height = h;
          maskCanvas.width = w;
          maskCanvas.height = h;
          ctx.imageSmoothingEnabled = false;
          maskCtx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          maskCtx.fillStyle = "#ffffff";
          maskCtx.fillRect(0, 0, w, h);
          if (oldMask && hadPaint) {
            maskCtx.drawImage(oldMask, 0, 0, w, h);
            drawMaskOverlay(ctx, maskCanvas, w, h);
          }
          lastInputImageKey = source.key;
          canvasEdited = maskHasPaint();
          hasCanvasContent = hasCanvasContent || canvasEdited;
          fitCanvas();
          saveData();
        };
        img.src = source.url;
      }
      function eventPoint(ev) {
        const r = canvas.getBoundingClientRect();
        return {
          x: (ev.clientX - r.left) * (canvas.width / r.width),
          y: (ev.clientY - r.top) * (canvas.height / r.height),
        };
      }
      function updateBrushPreview(ev) {
        const r = canvas.getBoundingClientRect();
        const layerRect = canvasLayer.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const graphScale = layerRect.width / Math.max(1, canvasLayer.offsetWidth || layerRect.width);
        const scale = (r.width / canvas.width) / Math.max(graphScale, 0.0001);
        const size = Math.max(1, (Number(brush.value) || 1) * scale);
        const x = (ev.clientX - layerRect.left) / Math.max(graphScale, 0.0001);
        const y = (ev.clientY - layerRect.top) / Math.max(graphScale, 0.0001);
        brushPreview.style.display = "block";
        brushPreview.style.width = `${size}px`;
        brushPreview.style.height = `${size}px`;
        brushPreview.style.left = `${x}px`;
        brushPreview.style.top = `${y}px`;
      }
      function strokePath(targetCtx, points, alpha = 1) {
        if (!points.length) return;
        targetCtx.save();
        targetCtx.strokeStyle = activeColor;
        targetCtx.fillStyle = activeColor;
        targetCtx.globalAlpha = alpha;
        targetCtx.lineWidth = Number(brush.value);
        targetCtx.lineCap = "round";
        targetCtx.lineJoin = "round";
        targetCtx.beginPath();
        targetCtx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          targetCtx.lineTo(points[i].x, points[i].y);
        }
        targetCtx.stroke();
        targetCtx.beginPath();
        const to = points[points.length - 1];
        targetCtx.arc(to.x, to.y, Number(brush.value) / 2, 0, Math.PI * 2);
        targetCtx.fill();
        targetCtx.restore();
      }
      function drawSmooth(from, to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.hypot(dx, dy);
        const step = Math.max(1, Number(brush.value) * (Number(stepSize.value) / 100));
        const count = Math.max(1, Math.min(MAX_STROKE_POINTS, Math.ceil(dist / step)));
        const points = [from];
        for (let i = 1; i <= count; i++) {
          const t = i / count;
          points.push({ x: from.x + dx * t, y: from.y + dy * t });
        }
        strokePath(ctx, points, Number(opacity.value));
        strokePath(maskCtx, points, 1);
      }

      let drawing = false;
      let lastPoint = null;
      let brushAdjust = null;
      canvas.addEventListener("pointerdown", (ev) => {
        updateBrushPreview(ev);
        const isWindowsBrushAdjust = ev.altKey && ev.button === 2;
        const isMacBrushAdjust = ev.ctrlKey && ev.altKey && ev.button === 0;
        if (isWindowsBrushAdjust || isMacBrushAdjust) {
          ev.preventDefault();
          ev.stopPropagation();
          canvas.setPointerCapture(ev.pointerId);
          brushAdjust = {
            pointerId: ev.pointerId,
            x: ev.clientX,
            y: ev.clientY,
            brush: Number(brush.value) || 92,
            opacity: Number(opacity.value) || 1,
          };
          return;
        }
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        canvas.setPointerCapture(ev.pointerId);
        pushHistory();
        canvasEdited = true;
        drawing = true;
        lastPoint = eventPoint(ev);
        drawSmooth(lastPoint, lastPoint);
        scheduleSaveData();
      });
      canvas.addEventListener("pointermove", (ev) => {
        updateBrushPreview(ev);
        if (brushAdjust && ev.pointerId === brushAdjust.pointerId) {
          ev.preventDefault();
          ev.stopPropagation();
          const dx = ev.clientX - brushAdjust.x;
          const dy = ev.clientY - brushAdjust.y;
          setBrush(brushAdjust.brush + dx);
          syncOpacity(brushAdjust.opacity - dy / 200);
          return;
        }
        if (!drawing) return;
        ev.preventDefault();
        const p = eventPoint(ev);
        drawSmooth(lastPoint || p, p);
        lastPoint = p;
        scheduleSaveData();
      });
      const endPointer = (ev) => {
        if (brushAdjust && ev.pointerId === brushAdjust.pointerId) {
          brushAdjust = null;
          markDirty();
          return;
        }
        drawing = false;
        lastPoint = null;
        saveData();
      };
      canvas.addEventListener("pointerup", endPointer);
      canvas.addEventListener("pointercancel", endPointer);
      canvas.addEventListener("pointerenter", updateBrushPreview);
      canvas.addEventListener("pointerleave", () => { brushPreview.style.display = "none"; });
      canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

      undo.addEventListener("click", () => {
        const prev = history.pop();
        if (!prev) return;
        ctx.putImageData(prev.display, 0, 0);
        maskCtx.putImageData(prev.mask, 0, 0);
        canvasEdited = maskHasPaint();
        saveData();
      });
      clear.addEventListener("click", () => {
        pushHistory();
        canvasEdited = false;
        hasCanvasContent = false;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        maskCtx.fillStyle = "#ffffff";
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        saveData({ clearBackup: true });
        loadConnectedImage(true);
      });

      function restoreCanvasFromText(payloadText) {
        if (!payloadText) return false;
        try {
          const payload = JSON.parse(payloadText);
          if (!payload?.data_url) return false;
          const img = new Image();
          img.onload = () => {
            isRestoringCanvas = true;
            try {
              const fallback = dims();
              const w = safeDimension(payload.width || img.naturalWidth || img.width, fallback.w);
              const h = safeDimension(payload.height || img.naturalHeight || img.height, fallback.h);
              if (widthW) widthW.value = w;
              if (heightW) heightW.value = h;
              lastWidth = w;
              lastHeight = h;
              canvas.width = w; canvas.height = h;
              maskCanvas.width = w; maskCanvas.height = h;
              ctx.imageSmoothingEnabled = false;
              maskCtx.imageSmoothingEnabled = false;
              ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
              maskCtx.fillStyle = "#ffffff"; maskCtx.fillRect(0, 0, w, h);
              ctx.drawImage(img, 0, 0, w, h);
              maskCtx.drawImage(img, 0, 0, w, h);
              canvasEdited = maskHasPaint();
              hasCanvasContent = canvasEdited;
              fitCanvas();
              saveData({ forceBackup: canvasEdited });
            } finally {
              isRestoringCanvas = false;
            }
          };
          img.src = payload.data_url;
          return true;
        } catch (_) {
          return false;
        }
      }

      const existing = canvasData?.value || node.properties.arcCanvasData || readCanvasBackup(node);
      if (existing) {
        if (!restoreCanvasFromText(existing)) resetCanvas(false);
      } else {
        resetCanvas(false);
      }

      const oldWidth = widthW?.callback;
      const oldHeight = heightW?.callback;
      if (widthW) widthW.callback = function () { oldWidth?.apply(this, arguments); scheduleResizePreserve(true); };
      if (heightW) heightW.callback = function () { oldHeight?.apply(this, arguments); scheduleResizePreserve(true); };
      const sizePoll = setInterval(() => {
        if (visibleCanvasBox()) syncCanvasSize(true);
      }, 250);
      const sourcePoll = setInterval(() => loadConnectedImage(false), 1000);
      setTimeout(() => loadConnectedImage(false), 100);

      const oldSerialize = node.onSerialize;
      node.onSerialize = function (workflowNode) {
        saveData();
        writeSerializedValues(workflowNode);
        oldSerialize?.apply(this, arguments);
        if (workflowNode) {
          workflowNode.properties = workflowNode.properties || {};
          workflowNode.properties.animaPrompts = { ...node.properties.animaPrompts };
          workflowNode.properties.arcCanvasData = node.properties.arcCanvasData || canvasData?.value || "";
          workflowNode.properties.arcCanvasSizeVersion = CANVAS_SIZE_VERSION;
          workflowNode.properties.arcSplitRatio = currentSplitRatio;
          writeSerializedValues(workflowNode);
        }
      };

      const oldConnectionsChange = node.onConnectionsChange;
      node.onConnectionsChange = function () {
        oldConnectionsChange?.apply(this, arguments);
        requestAnimationFrame(() => {
          syncPromptInputModes();
          loadConnectedImage(false);
        });
      };

      const oldConfigure = node.onConfigure;
      node.onConfigure = function () {
        const workflowInfo = arguments[0] || {};
        const workflowProperties = workflowInfo.properties || {};
        const hasWorkflowCanvasData = Object.prototype.hasOwnProperty.call(workflowProperties, "arcCanvasData");
        const workflowWidgetValues = Array.isArray(workflowInfo.widgets_values)
          ? workflowInfo.widgets_values
          : [];
        oldConfigure?.apply(this, arguments);
        node.properties = node.properties || {};
        node.properties.animaPrompts = node.properties.animaPrompts || {};
        removeLegacyInputs({ keepConnected: true });
        syncPromptTextareas();
        batchNum.value = String(Math.max(1, Math.round(Number(batchW?.value) || 1)));
        const serializedCanvas = hasWorkflowCanvasData
          ? String(workflowProperties.arcCanvasData || "")
          : String(canvasData?.value || "");
        if (hasWorkflowCanvasData || !serializedCanvas) node.properties.arcCanvasData = serializedCanvas;
        const existingCanvas = serializedCanvas || readCanvasBackup(node);
        const payloadSize = canvasPayloadDimensions(existingCanvas);
        const workflowSizeVersion = Number(workflowProperties.arcCanvasSizeVersion || 0);
        const legacyWidgetSize = Number(workflowWidgetValues[0]) === 300
          && Number(workflowWidgetValues[1]) === 150;
        const legacyDefaultSize = workflowSizeVersion < CANVAS_SIZE_VERSION && (
          legacyWidgetSize
          || (Number(widthW?.value) === 300 && Number(heightW?.value) === 150)
          || (payloadSize?.width === 300 && payloadSize?.height === 150)
        );
        if (legacyDefaultSize) {
          if (widthW) widthW.value = 1024;
          if (heightW) heightW.value = 1024;
          canvasWNum.value = "1024";
          canvasHNum.value = "1024";
          resetCanvas(false);
        } else if (!restoreCanvasFromText(existingCanvas)) {
          resetCanvas(false);
        }
        const configuredSplit = Number(node.properties.arcSplitRatio);
        if (Number.isFinite(configuredSplit)) currentSplitRatio = configuredSplit;
        requestAnimationFrame(() => {
          syncPromptInputModes();
          applySplit(currentSplitRatio);
          fitCanvas();
        });
      };
      const flushOnVisibilityChange = () => {
        if (document.visibilityState === "hidden") saveData();
        if (document.visibilityState === "visible") requestAnimationFrame(fitCanvas);
      };
      const onResizeVisible = () => {
        if (visibleCanvasBox()) requestAnimationFrame(fitCanvas);
      };
      window.addEventListener("blur", saveData);
      document.addEventListener("visibilitychange", flushOnVisibilityChange);
      canvasResizeObserver = new ResizeObserver(onResizeVisible);
      canvasResizeObserver.observe(canvasBox);
      splitResizeObserver = new ResizeObserver(() => applySplit(currentSplitRatio));
      splitResizeObserver.observe(main);
      syncPromptTextareas();
      syncPromptInputModes();

      node.addDOMWidget("anima_canvas_editor", "AnimaRegionalCanvasEditor", wrap, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 980,
      });
      node.resizable = true;
      const targetSize = STANDARD_NODE_SIZE;
      if (node.size[0] < targetSize[0] || node.size[1] < targetSize[1]) {
        node.setSize([Math.max(node.size[0], targetSize[0]), Math.max(node.size[1], targetSize[1])]);
      }
      const originalResize = node.onResize;
      node.onResize = function () {
        originalResize?.apply(this, arguments);
        requestAnimationFrame(() => {
          applySplit(currentSplitRatio);
          fitCanvas();
        });
      };
      const originalRemoved = node.onRemoved;
      node.onRemoved = function () {
        saveData();
        clearInterval(sizePoll);
        clearInterval(sourcePoll);
        window.removeEventListener("blur", saveData);
        document.removeEventListener("visibilitychange", flushOnVisibilityChange);
        canvasResizeObserver?.disconnect?.();
        splitResizeObserver?.disconnect?.();
        originalRemoved?.apply(this, arguments);
      };
      requestAnimationFrame(() => {
        applySplit(currentSplitRatio);
        fitCanvas();
      });
    };
  },
});
