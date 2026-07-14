import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AuditService } from "../src/main/audit";
import { SnapshotService } from "../src/main/snapshots";
import type { RawNetworkSnapshot } from "../src/shared/contracts";

const raw: RawNetworkSnapshot = {
  capturedAt: new Date(0).toISOString(),
  computerName: "SNAPSHOT-TEST",
  windowsVersion: "Windows test",
  proxy: { enabled: true, server: "http://127.0.0.1:12450", override: "<local>", autoConfigUrl: "", autoDetect: false },
  winHttpProxy: "Direct access",
  adapters: [],
  dns: [],
  defaultRoutes: [],
  allRoutes: [],
  proxyProcesses: [],
  proxyServices: [],
  listeners: [],
  ipConfigurations: [],
  hostsHash: "hash",
  hostsEntries: [],
  networkProfiles: [],
};

test("snapshot create/list/read/remove round-trip preserves restorable settings", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "network-first-aid-"));
  try {
    const audit = new AuditService(directory);
    const diagnostics = { captureRawSnapshot: async () => raw };
    const service = new SnapshotService(directory, diagnostics as never, audit);
    const created = await service.create("测试备份");
    assert.equal(created.computerName, "SNAPSHOT-TEST");
    assert.equal((await service.list()).length, 1);
    assert.equal((await service.read(created.id)).raw.proxy.server, "http://127.0.0.1:12450");
    const stored = JSON.parse(
      await readFile(path.join(service.resolveDirectory(created.id), "snapshot.json"), "utf8"),
    ) as { schemaVersion: number };
    assert.equal(stored.schemaVersion, 1);
    await service.remove(created.id);
    assert.equal((await service.list()).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
