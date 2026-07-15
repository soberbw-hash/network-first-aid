import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedReleaseUrl } from "../src/shared/update-policy";
import { compareVersions, isNewerVersion, normalizeVersion } from "../src/shared/version";

test("normalizes GitHub release tags", () => {
  assert.equal(normalizeVersion(" v0.1.1 "), "0.1.1");
});

test("compares stable semantic versions", () => {
  assert.equal(compareVersions("0.1.1", "0.1.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.9.0", "2.0.0"), -1);
});

test("treats stable versions as newer than prereleases", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("1.0.0-beta.3", "1.0.0"), -1);
});

test("detects whether an update is available", () => {
  assert.equal(isNewerVersion("0.2.0", "0.1.9"), true);
  assert.equal(isNewerVersion("v0.1.1", "0.1.1"), false);
});

test("rejects malformed version strings", () => {
  assert.throws(() => compareVersions("latest", "0.1.0"), /版本号格式无效/);
});

test("only trusts release pages from the official repository", () => {
  assert.equal(
    isAllowedReleaseUrl("https://github.com/soberbw-hash/network-first-aid/releases/tag/v0.1.1"),
    true,
  );
  assert.equal(isAllowedReleaseUrl("https://github.com.example.com/soberbw-hash/network-first-aid/releases/latest"), false);
  assert.equal(isAllowedReleaseUrl("https://github.com/another-owner/network-first-aid/releases/latest"), false);
});
