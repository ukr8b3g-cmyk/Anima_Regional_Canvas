// Runs the entire production extension with controlled DOM/canvas/Image doubles.
// This checks state and serialization, not browser rendering or ComfyUI E2E.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";

const root = process.env.ARC_SOURCE_ROOT || fileURLToPath(new URL("../", import.meta.url));
const source = readFileSync(path.join(root, "web/anima_regional_canvas.js"), "utf8");
const payload = (color = "red", width = 64, height = 64) => JSON.stringify({
  version: 2, width, height, data_url: `data:image/png;test,${color}`,
});

function fixture(initial = "", nodeName = "AnimaRegionalInpaintCanvas") {
  const elements = [], images = [], timers = new Map(), intervals = new Map(), backups = new Map();
  const warnings = [];
  let sequence = 0, extension;
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.dataset = {};
      this.children = [];
      this.listeners = new Map();
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.clientWidth = this.clientHeight = 256;
      this.isConnected = true;
      this.width = 300;
      this.height = 150;
      this.value = "";
      elements.push(this);
    }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this[name] = value; }
    append(...children) { this.children.push(...children); }
    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) || [];
      callbacks.push(callback);
      this.listeners.set(type, callbacks);
    }
    removeEventListener(type, callback) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(fn => fn !== callback));
    }
    fire(type, overrides = {}) {
      const event = { preventDefault() {}, stopPropagation() {}, button: 0,
        clientX: 16, clientY: 16, pointerId: 1, ...overrides };
      for (const callback of this.listeners.get(type) || []) callback(event);
    }
    click() { this.fire("click"); }
    remove() { this.isConnected = false; }
    querySelectorAll() { return []; }
    setPointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 256, height: 256 }; }
  }
  class Canvas extends Element {
    constructor() {
      super("canvas");
      this.color = "white";
      const canvas = this;
      this.context = {
        fillStyle: "#ffffff",
        fillRect() { canvas.color = this.fillStyle === "#ffffff" ? "white" : "red"; },
        clearRect() { canvas.color = "white"; },
        drawImage(image) { canvas.color = image.color; },
        getImageData() { return { color: canvas.color, data: canvas.color === "white"
          ? [255, 255, 255, 255] : [255, 0, 0, 255] }; },
        putImageData(image) { canvas.color = image.color; },
        save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
        stroke() { canvas.color = this.strokeStyle === "#ffffff" ? "white" : "red"; },
        fill() { canvas.color = this.fillStyle === "#ffffff" ? "white" : "red"; },
      };
    }
    get width() { return this._width; }
    set width(value) { this._width = value; this.color = "white"; }
    get height() { return this._height; }
    set height(value) { this._height = value; this.color = "white"; }
    getContext() { return this.context; }
    toDataURL() { return `data:image/png;test,${this.color}`; }
  }
  class ControlledImage {
    constructor() { images.push(this); }
    complete(color = "red", width = 64, height = 64) {
      this.color = color;
      this.naturalWidth = width;
      this.naturalHeight = height;
      this.onload?.();
    }
    fail() { this.onerror?.(); }
  }
  const document = new Element("document");
  document.visibilityState = "visible";
  document.createElement = tag => tag === "canvas" ? new Canvas() : new Element(tag);
  document.getElementById = id => elements.find(element => element.id === id);
  document.head = new Element("head");
  document.body = new Element("body");
  const app = { graph: { setDirtyCanvas() {} }, registerExtension(value) { extension = value; } };
  const window = new Element("window");
  window.comfyAPI = { app: { app } };
  const context = vm.createContext({
    window, document, Image: ControlledImage, URLSearchParams,
    URL: { createObjectURL: () => `blob:${++sequence}`, revokeObjectURL() {} },
    localStorage: { getItem: key => backups.get(key), setItem: (key, value) => backups.set(key, value),
      removeItem: key => backups.delete(key) },
    ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn) { const id = ++sequence; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    requestAnimationFrame(fn) { fn(); },
    console: { warn(...args) { warnings.push(args); } },
  });
  vm.runInContext(source, context);
  class Node {
    constructor() {
      this.id = 1;
      this.type = nodeName;
      this.properties = {};
      this.size = [1430, 1270];
      this.inputs = nodeName === "AnimaRegionalInpaintCanvas" ? [{ name: "image", link: null }] : [];
      this.widgets = [
        ["width", 64], ["height", 64], ["batch_size", 1], ["brush_size", 8], ["region_strength", 1],
        ["regional_enabled", true], ["canvas_data", initial],
        ...["quality", "scene", "red", "blue", "yellow", "green", "magenta", "negative"].map(key => [`${key}_prompt`, ""]),
      ].map(([name, value]) => ({ name, value }));
      this.source = { widgets: [{ name: "image", value: "A.png" }] };
      this.graph = { links: { 10: { origin_id: 2 } }, getNodeById: () => this.source };
    }
    addDOMWidget() {}
    addInput(name, type) { this.inputs.push({ name, type, link: null }); }
    removeInput(index) { this.inputs.splice(index, 1); }
    setSize(size) { this.size = size; }
  }
  extension.beforeRegisterNodeDef(Node, { name: nodeName });
  const node = new Node();
  node.onNodeCreated();
  const canvas = elements.find(element => element.className === "arc-canvas");
  const mask = elements.filter(element => element.tagName === "canvas")[1];
  const button = text => elements.find(element => element.textContent === text);
  const widget = name => node.widgets.find(widget => widget.name === name);
  const serialize = () => {
    const workflow = {};
    node.onSerialize(workflow);
    return workflow;
  };
  const saved = () => widget("canvas_data").value;
  const poll = () => {
    for (const [id, timer] of [...timers]) {
      if (timer.delay !== 1500 && timer.delay !== 100) continue;
      timers.delete(id);
      timer.fn();
    }
  };
  const connect = name => {
    node.source.widgets[0].value = name;
    node.inputs[0].link = name ? 10 : null;
    node.onConnectionsChange?.(1, 0);
  };
  const configure = text => {
    widget("canvas_data").value = text;
    node.properties = { arcCanvasData: text, arcCanvasSizeVersion: 1 };
    node.onConfigure({ properties: { ...node.properties } });
  };
  const draw = () => { canvas.fire("pointerdown"); canvas.fire("pointerup"); };
  return { node, canvas, mask, button, widget, images, saved, serialize, poll, connect,
    configure, draw, window, document, intervals, timers, warnings, elements, backups };
}

test("Clear followed by immediate drawing survives late forced image completion", () => {
  const f = fixture();
  f.connect("A.png");
  f.poll();
  f.images.at(-1).complete("A");
  f.button("Clear").click();
  const pending = f.images.at(-1);
  f.draw();
  const expected = f.saved();
  pending.complete("A", 128, 128);
  assert.equal(f.mask.color, "red");
  assert.equal(f.saved(), expected);
  assert.equal(f.widget("width").value, 64);
});

test("B then A completion keeps the connected B image and dimensions", () => {
  const f = fixture();
  f.connect("A.png"); f.poll();
  const a = f.images.at(-1);
  f.connect("B.png"); f.poll();
  const b = f.images.at(-1);
  b.complete("B", 128, 64);
  const expected = f.saved();
  a.complete("A", 64, 128);
  assert.equal(f.canvas.color, "B");
  assert.equal(f.widget("width").value, 128);
  assert.equal(f.saved(), expected);
});

test("unchanged in-flight image is not requested repeatedly", () => {
  const f = fixture();
  f.connect("A.png"); f.poll(); f.poll(); f.poll();
  assert.equal(f.images.length, 1);
});

test("filename change is checked again at completion without a connection event", () => {
  const f = fixture();
  f.connect("A.png"); f.poll();
  const a = f.images.at(-1);
  const expected = f.saved();
  f.node.source.widgets[0].value = "B.png";
  a.complete("A", 256, 256);
  assert.equal(f.saved(), expected);
  f.poll();
  f.images.at(-1).complete("B", 128, 64);
  assert.equal(f.canvas.color, "B");
});

test("failed connected image can be retried by the next poll", () => {
  const f = fixture();
  f.connect("A.png"); f.poll();
  f.images.at(-1).fail();
  f.poll();
  assert.equal(f.images.length, 2);
  f.images.at(-1).complete("A");
  assert.equal(f.canvas.color, "A");
});

test("manual resize supersedes an in-flight image", () => {
  const f = fixture();
  f.connect("A.png"); f.poll();
  const old = f.images.at(-1);
  const width = f.elements.find(element => element.title === "Canvas width. Apply on change or Enter.");
  width.value = "128";
  width.fire("change");
  const expected = f.saved();
  old.complete("A", 256, 256);
  assert.equal(f.saved(), expected);
  assert.equal(f.canvas.width, 128);
});

for (const action of ["disconnect", "remove", "configure"]) {
  test(`late connected image cannot mutate after ${action}`, () => {
    const f = fixture();
    f.connect("A.png"); f.poll();
    const old = f.images.at(-1);
    if (action === "disconnect") f.connect(null);
    if (action === "remove") f.node.onRemoved();
    if (action === "configure") f.configure(payload("blue", 128, 64));
    const expected = f.saved();
    old.complete("A", 256, 256);
    assert.equal(f.saved(), expected);
    assert.notEqual(f.widget("width").value, 256);
    if (action === "remove") assert.equal(f.intervals.size, 0);
  });
}

test("restore waiting preserves original workflow and queue widget through save hooks", () => {
  const original = payload("red", 128, 64);
  const f = fixture(original);
  f.window.fire("blur");
  f.document.visibilityState = "hidden";
  f.document.fire("visibilitychange");
  f.poll();
  f.draw(); // No editing of a not-yet-restored white canvas.
  f.button("Save Canvas").click();
  const workflow = f.serialize();
  assert.equal(f.saved(), original);
  assert.equal(workflow.properties.arcCanvasData, undefined);
  assert.equal(f.node.properties.arcCanvasData, undefined);
  assert.equal(workflow.widgets_values[f.node.widgets.indexOf(f.widget("canvas_data"))], original);
  assert.equal(workflow.widgets_values[f.node.widgets.indexOf(f.widget("width"))], 128);
  f.images[0].complete("red", 128, 64);
  assert.equal(f.mask.color, "red");
  f.draw();
  assert.equal(JSON.parse(f.saved()).data_url, "data:image/png;test,red");
});

test("reconfigure supersedes restore; original response cannot replace latest payload", () => {
  const f = fixture(payload("red"));
  const old = f.images[0];
  f.configure(payload("blue", 128, 64));
  const latest = f.images.at(-1);
  old.complete("red");
  assert.equal(f.saved(), payload("blue", 128, 64));
  latest.complete("blue", 128, 64);
  assert.equal(f.mask.color, "blue");
});

test("restore failure preserves payload until explicit Clear and releases loading", () => {
  const original = payload("red");
  const f = fixture(original);
  f.images[0].fail();
  f.window.fire("blur"); f.poll(); f.serialize();
  assert.equal(f.saved(), original);
  assert.equal(f.warnings.length, 1);
  f.button("Clear").click();
  assert.notEqual(f.saved(), original);
  f.draw();
  assert.equal(f.mask.color, "red");
});

test("Clear and removal invalidate pending restore callbacks", () => {
  for (const action of ["clear", "remove"]) {
    const f = fixture(payload("red"));
    const old = f.images[0];
    if (action === "clear") f.button("Clear").click();
    else f.node.onRemoved();
    const expected = f.saved();
    old.complete("red", 256, 256);
    assert.equal(f.saved(), expected);
    assert.equal(f.mask.color, "white");
  }
});

test("connection changes during restore do not orphan restoration", () => {
  const f = fixture(payload("red"));
  f.connect("B.png"); f.poll();
  f.images[0].complete("red");
  f.draw();
  assert.equal(f.mask.color, "red");
  assert.equal(f.images.length, 1);
});

test("Undo cancels pending Clear reload and restores previous paint", () => {
  const f = fixture();
  f.connect("A.png"); f.poll(); f.images.at(-1).complete("A");
  f.draw();
  f.button("Clear").click();
  const old = f.images.at(-1);
  f.button("Undo").click();
  const expected = f.saved();
  old.complete("A", 128, 128);
  assert.equal(f.saved(), expected);
  assert.equal(f.mask.color, "red");
});

test("Load Canvas cannot overwrite drawing or a newer file request", () => {
  const f = fixture();
  const input = f.elements.find(element => element.type === "file");
  input.files = [{ type: "image/png" }];
  input.fire("change");
  const first = f.images.at(-1);
  input.fire("change");
  const second = f.images.at(-1);
  second.complete("blue", 128, 64);
  const expected = f.saved();
  first.complete("red");
  assert.equal(f.saved(), expected);
  input.fire("change");
  const third = f.images.at(-1);
  f.draw();
  third.complete("blue", 256, 256);
  assert.equal(f.mask.color, "red");
  assert.equal(f.widget("width").value, 128);
});

test("existing toolbar size edit and serialized dimensions remain functional", () => {
  const f = fixture();
  const width = f.elements.find(element => element.title === "Canvas width. Apply on change or Enter.");
  width.value = "130";
  width.fire("keydown", { key: "Enter" });
  assert.equal(f.canvas.width, 128);
  const workflow = f.serialize();
  assert.equal(workflow.widgets_values[f.node.widgets.indexOf(f.widget("width"))], 128);
  assert.equal(workflow.properties.arcCanvasSizeVersion, 1);
});

test("Standard restoration preserves queue payload without creating image polling", () => {
  const original = payload("blue", 128, 64);
  const f = fixture(original, "AnimaRegionalCanvas");
  f.poll(); f.draw();
  const workflow = f.serialize();
  assert.equal(f.saved(), original);
  assert.equal(workflow.properties.arcCanvasData, undefined);
  assert.equal(f.images.length, 1);
  assert.equal([...f.timers.values()].filter(timer => timer.delay === 1500).length, 0);
  f.images[0].complete("blue", 128, 64);
  f.draw();
  assert.equal(f.mask.color, "red");
});

test("all eight prompt input switches preserve disabled local text and return on disconnect", () => {
  const f = fixture();
  const rows = f.elements.filter(element => element.className === "arc-row");
  assert.equal(rows.length, 8);
  for (const row of rows) {
    const textarea = row.children.find(element => element.tagName === "textarea");
    const inputButton = row.children.find(element => element.tagName === "button");
    textarea.value = `LOCAL_${textarea.name}`;
    textarea.fire("input");
    inputButton.click();
    assert.equal(textarea.disabled, true);
    const slot = f.node.inputs.find(input => input.name === `${textarea.name}_in`);
    slot.link = 20;
    inputButton.click(); // A connected cable must remain connected.
    assert.equal(textarea.disabled, true);
    slot.link = null;
    inputButton.click();
    assert.equal(textarea.disabled, false);
    assert.equal(f.widget(textarea.name).value, `LOCAL_${textarea.name}`);
  }
});

test("painted regions survive automatic connected-image change", () => {
  const f = fixture();
  f.connect("A.png"); f.images.at(-1).complete("A");
  f.draw();
  f.connect("B.png"); f.images.at(-1).complete("B", 128, 64);
  assert.equal(f.mask.color, "red");
  assert.equal(f.canvas.width, 128);
  assert.equal(JSON.parse(f.saved()).data_url, "data:image/png;test,red");
});

test("Undo restores dimensions as well as paint after toolbar resize", () => {
  const f = fixture();
  f.draw();
  const width = f.elements.find(element => element.title === "Canvas width. Apply on change or Enter.");
  width.value = "128";
  width.fire("change");
  f.button("Undo").click();
  assert.equal(f.canvas.width, 64);
  assert.equal(f.mask.color, "red");
});
