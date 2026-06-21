const { app } = window.comfyAPI.app;

const NODE_NAMES = new Set(["AnimaRegionalCanvas"]);
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

function findWidget(node, name) {
  return node.widgets?.find((w) => w.name === name);
}

function hideWidget(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
  widget.serialize = true;
}

function stop(ev) {
  ev.stopPropagation();
}

function makeButton(text, title) {
  const b = document.createElement("button");
  b.textContent = text;
  b.title = title || "";
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
    .arc-wrap{display:flex;flex-direction:column;gap:6px;min-height:520px;overflow:hidden;color:#d7d7d7;font:12px sans-serif}
    .arc-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .arc-main{display:grid;grid-template-columns:minmax(260px,1fr) 470px;gap:8px;min-height:0;flex:1}
    .arc-canvasbox{background:#181818;border:1px solid #444;border-radius:6px;display:flex;align-items:center;justify-content:center;min-height:260px;overflow:hidden}
    .arc-canvas{background:#fff;cursor:crosshair;touch-action:none;max-width:100%;max-height:100%}
    .arc-prompts{display:flex;flex-direction:column;gap:5px;min-width:0;background:#242424;padding:6px;border-radius:5px}
    .arc-row{display:grid;grid-template-columns:58px 1fr;gap:6px;align-items:stretch}
    .arc-label{display:flex;align-items:center;justify-content:center;font-weight:700;border-radius:2px;color:#fff;min-height:86px;text-align:center}
    .arc-label.base{background:#4b4b4b}.arc-label.neg{background:#2b2b2b;border:1px solid #555}
    .arc-text{display:block;width:100%;height:86px;background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:3px;resize:vertical;min-height:86px;padding:5px 7px;font:12px monospace;box-sizing:border-box}
    .arc-sw{width:22px;height:22px;border:2px solid #777;border-radius:4px;cursor:pointer}
    .arc-sw.active{border-color:#e6e6e6;box-shadow:inset 0 0 0 2px #111}
    .arc-btn{background:#303030;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 8px;cursor:pointer}
    .arc-btn:hover{border-color:#999;color:#fff}
    .arc-range{width:110px}
    .arc-small{color:#aaa}
    .arc-settings{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
    .arc-num{width:64px;background:#202020;color:#eee;border:1px solid #555;border-radius:4px;padding:2px 6px;text-align:right;box-sizing:border-box}
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
      const legacyInput = node.inputs?.findIndex((input) => input.name === "base_prompt_in");
      if (legacyInput >= 0) node.removeInput(legacyInput);
      const markDirty = () => app.graph?.setDirtyCanvas?.(true, true);
      const canvasData = findWidget(node, "canvas_data");
      const widthW = findWidget(node, "width");
      const heightW = findWidget(node, "height");
      const brushW = findWidget(node, "brush_size");
      const regionStrengthW = findWidget(node, "region_strength");
      const regionalEnabledW = findWidget(node, "regional_enabled");
      const promptNames = ["quality_prompt", "scene_prompt", ...COLORS.map((c) => c[2]), "negative_prompt"];
      node.properties.animaPrompts = node.properties.animaPrompts || {};
      const promptWidgets = promptNames.map((name) => findWidget(node, name));
      const promptTextareas = new Map();

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
      const mode = document.createElement("span");
      mode.className = "arc-small";
      mode.textContent = "Standard";
      toolbar.appendChild(mode);

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
        toolbar.appendChild(sw);
      }

      const white = document.createElement("button");
      white.className = "arc-sw";
      white.style.background = "#ffffff";
      white.title = "ERASE / WHITE";
      white.addEventListener("click", () => {
        activeColor = "#ffffff";
        toolbar.querySelectorAll(".arc-sw").forEach((x) => x.classList.remove("active"));
        white.classList.add("active");
      });
      toolbar.appendChild(white);

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
      toolbar.appendChild(brushLabel);
      toolbar.appendChild(brushNum);
      toolbar.appendChild(brushPx);
      toolbar.appendChild(brush);

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
      toolbar.append(opacityLabel, opacity, opacityNum);

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
      toolbar.append(stepLabel, stepSize, stepNum);

      const undo = makeButton("Undo", "Undo");
      const clear = makeButton("Clear", "Clear canvas");
      const resetBrush = makeButton("Reset", "Reset brush settings");
      const saveCanvasButton = makeButton("Save Canvas", "Save painted color canvas as PNG");
      resetBrush.addEventListener("click", () => {
        brush.value = "92";
        syncBrush();
        syncOpacity(1);
        syncStep(18);
      });
      toolbar.appendChild(undo);
      toolbar.appendChild(clear);
      toolbar.appendChild(resetBrush);
      toolbar.appendChild(saveCanvasButton);
      wrap.appendChild(toolbar);

      const main = document.createElement("div");
      main.className = "arc-main";
      const canvasBox = document.createElement("div");
      canvasBox.className = "arc-canvasbox";
      const canvas = document.createElement("canvas");
      canvas.className = "arc-canvas";
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const maskCanvas = document.createElement("canvas");
      const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
      canvasBox.appendChild(canvas);
      function timestamp() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      }
      function downloadMaskCanvas() {
        saveData();
        const filename = `anima_regional_canvas_${timestamp()}_${maskCanvas.width}x${maskCanvas.height}.png`;
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
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            saveUrl(url);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }, "image/png");
        } else {
          saveUrl(maskCanvas.toDataURL("image/png"));
        }
      }
      saveCanvasButton.addEventListener("click", downloadMaskCanvas);

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
        row.append(l, t);
        prompts.appendChild(row);
      }

      main.append(canvasBox, prompts);
      wrap.appendChild(main);

      const history = [];
      let saveTimer = null;
      let lastWidth = null;
      let lastHeight = null;
      let lastInputImageKey = "";
      let canvasEdited = false;
      function dims() {
        return {
          w: Math.max(16, Number(widthW?.value || 1024)),
          h: Math.max(16, Number(heightW?.value || 1024)),
        };
      }
      function syncCanvasSize(keep = false, force = false) {
        const { w, h } = dims();
        if (!force && w === lastWidth && h === lastHeight && canvas.width === w && canvas.height === h) return;
        lastWidth = w;
        lastHeight = h;
        resetCanvas(keep);
      }
      function saveData() {
        if (!canvasData) return;
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        canvasData.value = JSON.stringify({ data_url: maskCanvas.toDataURL("image/png") });
        markDirty();
      }
      function scheduleSaveData() {
        if (!canvasData || saveTimer) return;
        saveTimer = setTimeout(saveData, 500);
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
      function resetCanvas(keep = false) {
        const old = keep && canvas.width && canvas.height
          ? {
              display: ctx.getImageData(0, 0, canvas.width, canvas.height),
              mask: maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height),
            }
          : null;
        const { w, h } = dims();
        lastWidth = w;
        lastHeight = h;
        canvas.width = w;
        canvas.height = h;
        maskCanvas.width = w;
        maskCanvas.height = h;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        maskCtx.fillStyle = "#ffffff";
        maskCtx.fillRect(0, 0, w, h);
        if (old) {
          ctx.putImageData(old.display, 0, 0);
          maskCtx.putImageData(old.mask, 0, 0);
        }
        if (!keep) canvasEdited = false;
        fitCanvas();
        saveData();
      }
      function fitCanvas() {
        const maxW = Math.max(1, canvasBox.clientWidth - 8);
        const maxH = Math.max(1, canvasBox.clientHeight - 8);
        const scale = Math.min(maxW / canvas.width, maxH / canvas.height);
        canvas.style.width = `${Math.max(1, Math.floor(canvas.width * scale))}px`;
        canvas.style.height = `${Math.max(1, Math.floor(canvas.height * scale))}px`;
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
      function connectedImageSource() {
        return null;
      }
      function loadConnectedImage(force = false) {
        const source = connectedImageSource();
        if (!source) return;
        if (!force && source.key === lastInputImageKey) return;
        if (canvasEdited && !force) return;

        const img = new Image();
        img.onload = () => {
          if (canvasEdited && !force) return;
          const w = Math.max(16, img.naturalWidth || img.width || 1024);
          const h = Math.max(16, img.naturalHeight || img.height || 1024);
          if (widthW) widthW.value = w;
          if (heightW) heightW.value = h;
          lastWidth = w;
          lastHeight = h;
          canvas.width = w;
          canvas.height = h;
          maskCanvas.width = w;
          maskCanvas.height = h;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          maskCtx.fillStyle = "#ffffff";
          maskCtx.fillRect(0, 0, w, h);
          lastInputImageKey = source.key;
          canvasEdited = false;
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
      canvas.addEventListener("pointerdown", (ev) => {
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
        if (!drawing) return;
        ev.preventDefault();
        const p = eventPoint(ev);
        drawSmooth(lastPoint || p, p);
        lastPoint = p;
        scheduleSaveData();
      });
      canvas.addEventListener("pointerup", () => { drawing = false; lastPoint = null; saveData(); });
      canvas.addEventListener("pointercancel", () => { drawing = false; lastPoint = null; saveData(); });

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
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        maskCtx.fillStyle = "#ffffff";
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        saveData();
        loadConnectedImage(true);
      });

      const existing = canvasData?.value;
      if (existing) {
        try {
          const payload = JSON.parse(existing);
          const img = new Image();
          img.onload = () => {
            const { w, h } = dims();
            lastWidth = w;
            lastHeight = h;
            canvas.width = w; canvas.height = h;
            maskCanvas.width = w; maskCanvas.height = h;
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
            maskCtx.fillStyle = "#ffffff"; maskCtx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            maskCtx.drawImage(img, 0, 0, w, h);
            canvasEdited = maskHasPaint();
            fitCanvas();
            saveData();
          };
          img.src = payload.data_url;
        } catch (_) {
          resetCanvas(false);
        }
      } else {
        resetCanvas(false);
      }

      const oldWidth = widthW?.callback;
      const oldHeight = heightW?.callback;
      if (widthW) widthW.callback = function () { oldWidth?.apply(this, arguments); syncCanvasSize(false, true); if (!canvasEdited) loadConnectedImage(true); };
      if (heightW) heightW.callback = function () { oldHeight?.apply(this, arguments); syncCanvasSize(false, true); if (!canvasEdited) loadConnectedImage(true); };
      const sizePoll = setInterval(() => syncCanvasSize(false), 250);
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
          writeSerializedValues(workflowNode);
        }
      };

      const oldConfigure = node.onConfigure;
      node.onConfigure = function () {
        oldConfigure?.apply(this, arguments);
        node.properties = node.properties || {};
        node.properties.animaPrompts = node.properties.animaPrompts || {};
        syncPromptTextareas();
      };
      syncPromptTextareas();

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
        requestAnimationFrame(fitCanvas);
      };
      const originalRemoved = node.onRemoved;
      node.onRemoved = function () {
        clearInterval(sizePoll);
        clearInterval(sourcePoll);
        originalRemoved?.apply(this, arguments);
      };
      requestAnimationFrame(fitCanvas);
    };
  },
});
