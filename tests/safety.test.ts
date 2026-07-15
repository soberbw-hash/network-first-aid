import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { REPAIR_ACTIONS } from "../src/shared/action-catalog";

const repairScript = readFileSync(
  new URL("../src-tauri/resources/repair.ps1", import.meta.url),
  "utf8",
);

test("orphan TUN cleanup checks adapter state before removing routes", () => {
  assert.match(repairScript, /Status -ne 'Up'/);
  assert.match(repairScript, /Remove-NetRoute/);
  assert.doesNotMatch(repairScript, /Get-NetRoute[^]*Remove-NetRoute[^]*-Confirm:\$true/);
});

test("dead proxy repair only disables localhost proxies with no listener", () => {
  assert.match(repairScript, /127\\\.0\\\.0\\\.1\|localhost/);
  assert.match(repairScript, /Get-NetTCPConnection -State Listen/);
  assert.match(repairScript, /ProxyEnable -Type DWord -Value 0/);
});

test("firewall reset exports policy before resetting", () => {
  assert.ok(repairScript.indexOf("advfirewall export") < repairScript.indexOf("advfirewall reset"));
  assert.match(repairScript, /防火墙策略备份失败，已取消重置/);
});

test("renderer can only select known action IDs", () => {
  const ids = REPAIR_ACTIONS.map((action) => action.id);
  assert.ok(ids.includes("quick-repair"));
  assert.ok(!ids.includes("run-arbitrary-command" as never));
});
