import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSnapshot } from "../src/main/diagnostics";
import { REPAIR_ACTIONS } from "../src/shared/action-catalog";
import type { RawNetworkSnapshot } from "../src/shared/contracts";

const makeSnapshot = (): RawNetworkSnapshot => ({
  capturedAt: new Date(0).toISOString(),
  computerName: "TEST-PC",
  windowsVersion: "Windows test",
  proxy: { enabled: false, server: "", override: "", autoConfigUrl: "", autoDetect: false },
  winHttpProxy: "Direct access (no proxy server).",
  adapters: [
    {
      name: "Ethernet",
      description: "Test Ethernet",
      status: "Up",
      linkSpeed: "1 Gbps",
      macAddress: "00-00-00-00-00-00",
      interfaceIndex: 7,
      hardwareInterface: true,
    },
  ],
  dns: [{ interfaceAlias: "Ethernet", interfaceIndex: 7, addressFamily: 2, serverAddresses: ["192.168.1.1"] }],
  defaultRoutes: [
    {
      interfaceAlias: "Ethernet",
      interfaceIndex: 7,
      destinationPrefix: "0.0.0.0/0",
      nextHop: "192.168.1.1",
      routeMetric: 0,
      interfaceMetric: 25,
      policyStore: "ActiveStore",
    },
  ],
  allRoutes: [],
  proxyProcesses: [],
  proxyServices: [],
  listeners: [],
  ipConfigurations: [],
  hostsHash: "abc",
  hostsEntries: [],
  networkProfiles: [],
});

const successfulConnectivity = [
  { name: "国内直连", target: "https://www.baidu.com/", ok: true, latencyMs: 80, detail: "HTTP 200" },
];

test("healthy snapshot produces no false critical warning", () => {
  const issues = analyzeSnapshot(makeSnapshot(), successfulConnectivity);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.id, "healthy");
});

test("detects a Windows proxy pointing at a closed localhost port", () => {
  const snapshot = makeSnapshot();
  snapshot.proxy = {
    enabled: true,
    server: "http://127.0.0.1:12450",
    override: "<local>",
    autoConfigUrl: "",
    autoDetect: false,
  };
  const issue = analyzeSnapshot(snapshot, successfulConnectivity).find((item) => item.id === "dead-local-proxy");
  assert.equal(issue?.severity, "critical");
  assert.equal(issue?.actionId, "disable-dead-proxy");
});

test("detects the user's dual proxy plus TUN conflict pattern", () => {
  const snapshot = makeSnapshot();
  snapshot.proxyProcesses = [
    { name: "xsus", id: 101 },
    { name: "mihomo", id: 202 },
  ];
  snapshot.adapters.push({
    name: "tun0",
    description: "Wintun Userspace Tunnel",
    status: "Up",
    linkSpeed: "100 Gbps",
    macAddress: "",
    interfaceIndex: 22,
    hardwareInterface: false,
  });
  const ids = analyzeSnapshot(snapshot, successfulConnectivity).map((item) => item.id);
  assert.ok(ids.includes("multiple-proxy-cores"));
  assert.ok(ids.includes("tun-proxy-conflict"));
});

test("treats Clash UI and Mihomo core as one proxy family", () => {
  const snapshot = makeSnapshot();
  snapshot.proxyProcesses = [
    { name: "clash-verge", id: 101 },
    { name: "mihomo", id: 202 },
  ];
  const ids = analyzeSnapshot(snapshot, successfulConnectivity).map((item) => item.id);
  assert.ok(!ids.includes("multiple-proxy-cores"));
});

test("distinguishes a live local proxy port from a failed ChatGPT egress", () => {
  const snapshot = makeSnapshot();
  const issues = analyzeSnapshot(snapshot, [
    ...successfulConnectivity,
    { name: "本地代理端口", target: "127.0.0.1:12450", ok: true, latencyMs: 1, detail: "端口正在监听" },
    { name: "代理出口（ChatGPT）", target: "chatgpt.com:443", ok: false, latencyMs: 6500, detail: "代理 CONNECT 超时" },
  ]);
  assert.equal(issues.find((item) => item.id === "proxy-egress-failed")?.severity, "critical");
});

test("detects stale 4.2.2.x DNS on an active physical adapter", () => {
  const snapshot = makeSnapshot();
  snapshot.dns[0]!.serverAddresses = ["4.2.2.1", "4.2.2.2"];
  const issue = analyzeSnapshot(snapshot, successfulConnectivity).find((item) => item.id === "legacy-static-dns");
  assert.equal(issue?.actionId, "dns-auto");
});

test("repair catalog is unique, finite, and high-risk actions require elevation", () => {
  assert.equal(REPAIR_ACTIONS.length, 15);
  assert.equal(new Set(REPAIR_ACTIONS.map((action) => action.id)).size, REPAIR_ACTIONS.length);
  assert.ok(REPAIR_ACTIONS.filter((action) => action.risk === "high").every((action) => action.requiresAdmin));
});
