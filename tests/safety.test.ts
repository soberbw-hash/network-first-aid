import assert from "node:assert/strict";
import test from "node:test";

import { getRepairScript } from "../src/main/repair-scripts";
import { REPAIR_ACTIONS } from "../src/shared/action-catalog";

test("orphan TUN cleanup checks adapter state before removing routes", () => {
  const script = getRepairScript("remove-orphan-tun-routes", "C:\\safe snapshot");
  assert.match(script, /Status -ne 'Up'/);
  assert.match(script, /Remove-NetRoute/);
  assert.doesNotMatch(script, /Get-NetRoute[^]*Remove-NetRoute[^]*-Confirm:\$true/);
});

test("dead proxy repair only disables localhost proxies with no listener", () => {
  const script = getRepairScript("disable-dead-proxy", "C:\\safe snapshot");
  assert.match(script, /127\\\.0\\\.0\\\.1\|localhost/);
  assert.match(script, /Get-NetTCPConnection -State Listen/);
  assert.match(script, /ProxyEnable -Type DWord -Value 0/);
});

test("firewall reset exports policy before resetting", () => {
  const script = getRepairScript("reset-firewall", "C:\\safe snapshot");
  assert.ok(script.indexOf("advfirewall export") < script.indexOf("advfirewall reset"));
  assert.match(script, /防火墙策略备份失败，已取消重置/);
});

test("renderer can only select known action IDs", () => {
  const ids = REPAIR_ACTIONS.map((action) => action.id);
  assert.ok(ids.includes("quick-repair"));
  assert.ok(!ids.includes("run-arbitrary-command" as never));
});
