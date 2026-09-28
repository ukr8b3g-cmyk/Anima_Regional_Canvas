import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../web/anima_regional_canvas.js", import.meta.url), "utf8");

assert.match(source, /const HISTORY_MEMORY_BUDGET = 128 \* 1024 \* 1024;/);
assert.match(source, /const MAX_CANVAS_DIMENSION = 4096;/);
assert.match(source, /bytes > HISTORY_MEMORY_BUDGET/);
assert.match(source, /historyBytes/);
assert.match(source, /delete workflowNode\.properties\.arcCanvasData;/);
assert.match(source, /delete node\.properties\.arcCanvasData;/);
assert.match(source, /nodeData\.name === "AnimaRegionalInpaintCanvas"/);
assert.match(source, /canvas\.width !== prev\.width \|\| canvas\.height !== prev\.height/);
assert.doesNotMatch(source, /scheduleSaveData\s*\(/);
assert.doesNotMatch(source, /setInterval\s*\(/);
assert.doesNotMatch(source, /node\.properties\.arcCanvasData\s*=\s*payload/);
assert.doesNotMatch(source, /workflowNode\.properties\.arcCanvasData\s*=/);

console.log("frontend contract checks passed");
