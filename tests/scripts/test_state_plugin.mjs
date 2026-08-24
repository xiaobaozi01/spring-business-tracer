#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  claimBatch,
  commitUnit,
  computeWorkspaceFingerprints,
  controlRun,
  initRun,
  planRun,
  statusRun,
} from "../../.opencode/plugins/spring-business-state.js";

const root = await mkdtemp(join(tmpdir(), "spring-business-state-v05-"));
const fp = { configHash: "cfg-a", sourceSnapshot: "src-a", indexFingerprint: "cg-a" };
const reportFingerprints = { config: fp.configHash, source: fp.sourceSnapshot, index: fp.indexFingerprint };

function tokenOf(claim, entryId) {
  return claim.units.find((unit) => unit.id === entryId).fingerprintToken;
}

function verification(entryId, overrides = {}) {
  return JSON.stringify({
    schemaVersion: "0.5",
    entryId,
    validator: "spring-trace-validator",
    decision: "ACCEPTED",
    fingerprints: reportFingerprints,
    checks: [{ code: "JAVA_EDGES_REPLAYED", passed: true, evidence: ["codegraph"] }],
    ...overrides,
  });
}

function audit(runId, kind, overrides = {}) {
  return JSON.stringify({
    schemaVersion: "0.5",
    runId,
    kind,
    validator: kind === "COVERAGE" ? "spring-coverage-auditor" : "spring-boundary-validator",
    decision: "ACCEPTED",
    fingerprints: reportFingerprints,
    checks: [{ code: `${kind}_REPLAYED`, passed: true, evidence: ["independent-query"] }],
    ...overrides,
  });
}

async function rejects(action, fragment) {
  await assert.rejects(action, (error) => String(error.message).includes(fragment));
}

try {
  const created = await initRun(root, { runId: "run-main", batchSize: 2, retryLimit: 2, ...fp });
  assert.equal(created.phase, "CREATED");
  assert.deepEqual(created.audits, { coverageHash: null, boundaryHash: null });
  await rejects(() => claimBatch(root, { runId: "run-main", workerId: "too-early", ...fp }), "尚未规划");

  await planRun(root, {
    runId: "run-main",
    entriesJson: JSON.stringify([
      { id: "entry-a", service: "order", kind: "HTTP", target: "POST /orders" },
      { id: "entry-b", service: "inventory", kind: "SCHEDULED", target: "expiry" },
      { id: "entry-c", service: "notify", kind: "RABBIT", target: "order.created" },
    ]),
    ...fp,
  });
  await rejects(
    () => planRun(root, { runId: "run-main", entriesJson: JSON.stringify([{ id: "replanned" }]), ...fp }),
    "不能规划",
  );
  const first = await claimBatch(root, { runId: "run-main", workerId: "trace-1", limit: 9, ...fp });
  assert.deepEqual(first.units.map((unit) => unit.id), ["entry-a", "entry-b"]);
  assert.equal(first.units.length, 2, "claim不能超过run.batchSize");
  await rejects(
    () => commitUnit(root, { runId: "run-main", entryId: "entry-a", workerId: "intruder", fingerprintToken: tokenOf(first, "entry-a"), status: "TRACED", artifactHash: "a", ...fp }),
    "租约持有者",
  );
  await rejects(
    () => commitUnit(root, { runId: "run-main", entryId: "entry-a", workerId: "trace-1", fingerprintToken: tokenOf(first, "entry-a"), status: "TRACED", ...fp }),
    "artifactHash",
  );
  for (const id of ["entry-a", "entry-b"]) {
    const fingerprintToken = tokenOf(first, id);
    await commitUnit(root, { runId: "run-main", entryId: id, workerId: "trace-1", fingerprintToken, status: "TRACED", artifactHash: `trace-${id}`, ...fp });
    await commitUnit(root, { runId: "run-main", entryId: id, workerId: "validator", fingerprintToken, status: "VERIFIED", verificationJson: verification(id), ...fp });
    await commitUnit(root, { runId: "run-main", entryId: id, workerId: "publisher", fingerprintToken, status: "PUBLISHED", artifactHash: `doc-${id}`, ...fp });
  }

  await controlRun(root, { runId: "run-main", action: "PAUSE" });
  assert.equal((await statusRun(root, "run-main")).phase, "PAUSED");
  await rejects(
    () => planRun(root, { runId: "run-main", entriesJson: JSON.stringify([{ id: "bypass" }]), ...fp }),
    "不能规划",
  );
  await rejects(
    () => controlRun(root, { runId: "run-main", action: "RESUME", ...fp, sourceSnapshot: "src-changed" }),
    "STALE",
  );
  assert.equal((await statusRun(root, "run-main")).phase, "STALE");

  await initRun(root, { runId: "run-lease", batchSize: 1, ...fp });
  await planRun(root, { runId: "run-lease", entriesJson: JSON.stringify([{ id: "lease-a" }]), ...fp });
  const crashed = await claimBatch(root, { runId: "run-lease", workerId: "crashed-worker", leaseSeconds: 30, ...fp });
  const statePath = join(root, ".opencode/.cache/spring-business-tracer/runs/run-lease/run.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.units["lease-a"].leaseUntil = "2000-01-01T00:00:00.000Z";
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await rejects(
    () => commitUnit(root, { runId: "run-lease", entryId: "lease-a", workerId: "crashed-worker", fingerprintToken: tokenOf(crashed, "lease-a"), status: "TRACED", artifactHash: "stale", ...fp }),
    "租约已过期",
  );
  const recovered = await claimBatch(root, { runId: "run-lease", workerId: "replacement", ...fp });
  assert.equal(recovered.recovered, 0, "过期提交已先把单元放回重试队列");
  assert.equal(recovered.units[0].leaseOwner, "replacement");
  assert.notEqual(tokenOf(recovered, "lease-a"), tokenOf(crashed, "lease-a"), "重新领取必须生成唯一租约令牌");
  await rejects(
    () => commitUnit(root, { runId: "run-lease", entryId: "lease-a", workerId: "replacement", fingerprintToken: tokenOf(crashed, "lease-a"), status: "TRACED", artifactHash: "old-token", ...fp }),
    "令牌",
  );

  const leaseToken = tokenOf(recovered, "lease-a");
  await commitUnit(root, { runId: "run-lease", entryId: "lease-a", workerId: "replacement", fingerprintToken: leaseToken, status: "TRACED", artifactHash: "trace", ...fp });
  await rejects(
    () => commitUnit(root, { runId: "run-lease", entryId: "lease-a", workerId: "validator", fingerprintToken: leaseToken, status: "VERIFIED", verificationJson: verification("wrong-entry"), ...fp }),
    "entryId不匹配",
  );
  await commitUnit(root, { runId: "run-lease", entryId: "lease-a", workerId: "validator", fingerprintToken: leaseToken, status: "VERIFIED", verificationJson: verification("lease-a"), ...fp });
  await commitUnit(root, { runId: "run-lease", entryId: "lease-a", workerId: "publisher", fingerprintToken: leaseToken, status: "PUBLISHED", artifactHash: "doc", ...fp });
  await rejects(() => controlRun(root, { runId: "run-lease", action: "COMPLETE", ...fp }), "审计报告");
  await rejects(
    () => controlRun(root, { runId: "run-lease", action: "COMPLETE", coverageAuditJson: audit("run-lease", "COVERAGE", { decision: "REJECTED" }), boundaryAuditJson: audit("run-lease", "BOUNDARY"), ...fp }),
    "ACCEPTED",
  );
  const complete = await controlRun(root, { runId: "run-lease", action: "COMPLETE", coverageAuditJson: audit("run-lease", "COVERAGE"), boundaryAuditJson: audit("run-lease", "BOUNDARY"), ...fp });
  assert.equal(complete.phase, "COMPLETE");
  await rejects(() => controlRun(root, { runId: "run-lease", action: "RESUME", ...fp }), "终态运行不可控制");
  await rejects(() => controlRun(root, { runId: "run-lease", action: "FAIL" }), "终态运行不可控制");
  await rejects(
    () => commitUnit(root, { runId: "run-lease", entryId: "lease-a", workerId: "late", status: "FAILED", ...fp }),
    "终态运行",
  );

  await initRun(root, { runId: "run-retry", batchSize: 1, retryLimit: 0, ...fp });
  await planRun(root, { runId: "run-retry", entriesJson: JSON.stringify([{ id: "retry-a" }]), ...fp });
  const retryClaim = await claimBatch(root, { runId: "run-retry", workerId: "failing-worker", ...fp });
  const failed = await commitUnit(root, { runId: "run-retry", entryId: "retry-a", workerId: "failing-worker", fingerprintToken: tokenOf(retryClaim, "retry-a"), status: "RETRYABLE_FAILED", errorCode: "TRANSIENT", ...fp });
  assert.equal(failed.unit.status, "FAILED");
  assert.equal(failed.unit.lastError, "RETRY_LIMIT_EXCEEDED");
  assert.equal((await claimBatch(root, { runId: "run-retry", workerId: "other", ...fp })).units.length, 0);

  await initRun(root, { runId: "run-drift", batchSize: 1, ...fp });
  await planRun(root, { runId: "run-drift", entriesJson: JSON.stringify([{ id: "drift-a" }]), ...fp });
  await rejects(
    () => claimBatch(root, { runId: "run-drift", workerId: "worker", ...fp, indexFingerprint: "cg-changed" }),
    "STALE",
  );
  assert.equal((await statusRun(root, "run-drift")).phase, "STALE");

  await initRun(root, { runId: "run-pause", batchSize: 1, ...fp });
  await planRun(root, { runId: "run-pause", entriesJson: JSON.stringify([{ id: "pause-a" }]), ...fp });
  const pauseClaim = await claimBatch(root, { runId: "run-pause", workerId: "worker", ...fp });
  const pauseToken = tokenOf(pauseClaim, "pause-a");
  await rejects(
    () => commitUnit(root, { runId: "run-pause", entryId: "pause-a", workerId: "worker", fingerprintToken: "wrong", status: "TRACED", artifactHash: "trace", ...fp }),
    "令牌",
  );
  await commitUnit(root, { runId: "run-pause", entryId: "pause-a", workerId: "worker", fingerprintToken: pauseToken, status: "TRACED", artifactHash: "trace", ...fp });
  assert.equal((await controlRun(root, { runId: "run-pause", action: "PAUSE" })).phase, "PAUSE_REQUESTED");
  assert.equal((await commitUnit(root, { runId: "run-pause", entryId: "pause-a", workerId: "validator", fingerprintToken: pauseToken, status: "VERIFIED", verificationJson: verification("pause-a"), ...fp })).phase, "PAUSE_REQUESTED");
  assert.equal((await commitUnit(root, { runId: "run-pause", entryId: "pause-a", workerId: "publisher", fingerprintToken: pauseToken, status: "PUBLISHED", artifactHash: "doc", ...fp })).phase, "PAUSED");

  await initRun(root, { runId: "run-expire", batchSize: 1, retryLimit: 1, ...fp });
  await planRun(root, { runId: "run-expire", entriesJson: JSON.stringify([{ id: "expire-a" }]), ...fp });
  await claimBatch(root, { runId: "run-expire", workerId: "worker-1", ...fp });
  const expirePath = join(root, ".opencode/.cache/spring-business-tracer/runs/run-expire/run.json");
  let expireState = JSON.parse(await readFile(expirePath, "utf8"));
  expireState.units["expire-a"].leaseUntil = "2000-01-01T00:00:00.000Z";
  await writeFile(expirePath, `${JSON.stringify(expireState, null, 2)}\n`);
  await claimBatch(root, { runId: "run-expire", workerId: "worker-2", ...fp });
  expireState = JSON.parse(await readFile(expirePath, "utf8"));
  expireState.units["expire-a"].leaseUntil = "2000-01-01T00:00:00.000Z";
  await writeFile(expirePath, `${JSON.stringify(expireState, null, 2)}\n`);
  const exhaustedLease = await claimBatch(root, { runId: "run-expire", workerId: "worker-3", ...fp });
  assert.equal(exhaustedLease.units.length, 0);
  assert.equal((await statusRun(root, "run-expire")).units["expire-a"].status, "FAILED");

  await initRun(root, { runId: "run-commit-drift", batchSize: 1, ...fp });
  await planRun(root, { runId: "run-commit-drift", entriesJson: JSON.stringify([{ id: "commit-a" }]), ...fp });
  const driftClaim = await claimBatch(root, { runId: "run-commit-drift", workerId: "worker", ...fp });
  await rejects(
    () => commitUnit(root, { runId: "run-commit-drift", entryId: "commit-a", workerId: "worker", fingerprintToken: tokenOf(driftClaim, "commit-a"), status: "TRACED", artifactHash: "trace", ...fp, sourceSnapshot: "src-changed" }),
    "STALE",
  );
  assert.equal((await statusRun(root, "run-commit-drift")).phase, "STALE");

  await initRun(root, { runId: "run-complete-drift", batchSize: 1, ...fp });
  await planRun(root, { runId: "run-complete-drift", entriesJson: JSON.stringify([{ id: "complete-a" }]), ...fp });
  const completeClaim = await claimBatch(root, { runId: "run-complete-drift", workerId: "worker", ...fp });
  const completeToken = tokenOf(completeClaim, "complete-a");
  await commitUnit(root, { runId: "run-complete-drift", entryId: "complete-a", workerId: "worker", fingerprintToken: completeToken, status: "TRACED", artifactHash: "trace", ...fp });
  await commitUnit(root, { runId: "run-complete-drift", entryId: "complete-a", workerId: "validator", fingerprintToken: completeToken, status: "VERIFIED", verificationJson: verification("complete-a"), ...fp });
  await commitUnit(root, { runId: "run-complete-drift", entryId: "complete-a", workerId: "publisher", fingerprintToken: completeToken, status: "PUBLISHED", artifactHash: "doc", ...fp });
  await rejects(
    () => controlRun(root, { runId: "run-complete-drift", action: "COMPLETE", coverageAuditJson: audit("run-complete-drift", "COVERAGE"), boundaryAuditJson: audit("run-complete-drift", "BOUNDARY"), ...fp, configHash: "cfg-changed" }),
    "STALE",
  );
  assert.equal((await statusRun(root, "run-complete-drift")).phase, "STALE");

  await initRun(root, { runId: "run-partial", ...fp });
  await rejects(() => controlRun(root, { runId: "run-partial", action: "PARTIAL" }), "已有入口");
  await planRun(root, { runId: "run-partial", entriesJson: JSON.stringify([{ id: "partial-ok" }, { id: "partial-gap" }]), ...fp });
  const partialClaim = await claimBatch(root, { runId: "run-partial", workerId: "worker", ...fp });
  const partialToken = tokenOf(partialClaim, "partial-ok");
  await commitUnit(root, { runId: "run-partial", entryId: "partial-ok", workerId: "worker", fingerprintToken: partialToken, status: "TRACED", artifactHash: "trace", ...fp });
  await commitUnit(root, { runId: "run-partial", entryId: "partial-ok", workerId: "validator", fingerprintToken: partialToken, status: "VERIFIED", verificationJson: verification("partial-ok"), ...fp });
  await commitUnit(root, { runId: "run-partial", entryId: "partial-ok", workerId: "publisher", fingerprintToken: partialToken, status: "PUBLISHED", artifactHash: "doc", ...fp });
  await commitUnit(root, { runId: "run-partial", entryId: "partial-gap", workerId: "worker", fingerprintToken: tokenOf(partialClaim, "partial-gap"), status: "BLOCKED", errorCode: "UNRESOLVED_BOUNDARY", ...fp });
  assert.equal((await controlRun(root, { runId: "run-partial", action: "PARTIAL", ...fp })).phase, "PARTIAL");
  await rejects(() => controlRun(root, { runId: "run-partial", action: "FAIL" }), "终态运行不可控制");

  await initRun(root, { runId: "run-partial-drift", ...fp });
  await planRun(root, { runId: "run-partial-drift", entriesJson: JSON.stringify([{ id: "delivered" }, { id: "gap" }]), ...fp });
  const partialDriftPath = join(root, ".opencode/.cache/spring-business-tracer/runs/run-partial-drift/run.json");
  const partialDriftState = JSON.parse(await readFile(partialDriftPath, "utf8"));
  partialDriftState.units.delivered.status = "PUBLISHED";
  partialDriftState.units.gap.status = "BLOCKED";
  await writeFile(partialDriftPath, `${JSON.stringify(partialDriftState, null, 2)}\n`);
  await rejects(() => controlRun(root, { runId: "run-partial-drift", action: "PARTIAL", ...fp, sourceSnapshot: "src-changed" }), "STALE");
  assert.equal((await statusRun(root, "run-partial-drift")).phase, "STALE");

  const linkRoot = await mkdtemp(join(tmpdir(), "spring-business-link-v05-"));
  const linkOutside = await mkdtemp(join(tmpdir(), "spring-business-outside-v05-"));
  await mkdir(join(linkRoot, ".opencode/.cache/spring-business-tracer"), { recursive: true });
  await symlink(linkOutside, join(linkRoot, ".opencode/.cache/spring-business-tracer/runs"));
  await rejects(() => initRun(linkRoot, { runId: "unsafe", ...fp }), "符号链接");
  await rm(linkRoot, { recursive: true, force: true });
  await rm(linkOutside, { recursive: true, force: true });

  const stateLinkRoot = await mkdtemp(join(tmpdir(), "spring-business-state-file-link-v05-"));
  const outsideStateRoot = await mkdtemp(join(tmpdir(), "spring-business-state-file-outside-v05-"));
  const linkedRunDirectory = join(stateLinkRoot, ".opencode/.cache/spring-business-tracer/runs/linked-run");
  const outsideState = join(outsideStateRoot, "outside.json");
  await mkdir(linkedRunDirectory, { recursive: true });
  await writeFile(outsideState, JSON.stringify({ marker: "OUTSIDE_FILE_WAS_READ", units: {} }));
  await symlink(outsideState, join(linkedRunDirectory, "run.json"));
  await rejects(() => statusRun(stateLinkRoot, "linked-run"), "符号链接");
  await rm(stateLinkRoot, { recursive: true, force: true });
  await rm(outsideStateRoot, { recursive: true, force: true });

  const serviceRoot = await mkdtemp(join(tmpdir(), "spring-business-service-link-v05-"));
  const externalService = await mkdtemp(join(tmpdir(), "spring-business-external-service-v05-"));
  await mkdir(join(serviceRoot, ".opencode"), { recursive: true });
  await symlink(externalService, join(serviceRoot, "linked-service"));
  await writeFile(join(serviceRoot, ".opencode/spring-business-tracer.json"), JSON.stringify({ workspace: { services: [{ id: "linked", root: "linked-service" }] } }));
  await rejects(() => computeWorkspaceFingerprints(serviceRoot, { codeGraphStatus: async () => "Index is up to date" }), "越出工作区");
  await rm(serviceRoot, { recursive: true, force: true });
  await rm(externalService, { recursive: true, force: true });

  const fingerprintRoot = await mkdtemp(join(tmpdir(), "spring-business-fingerprint-v05-"));
  await mkdir(join(fingerprintRoot, ".opencode"), { recursive: true });
  await mkdir(join(fingerprintRoot, "service/src/main/java"), { recursive: true });
  const fingerprintConfig = join(fingerprintRoot, ".opencode/spring-business-tracer.json");
  const fingerprintSource = join(fingerprintRoot, "service/src/main/java/Demo.java");
  await writeFile(fingerprintConfig, JSON.stringify({ workspace: { services: [{ id: "service", root: "service" }] }, marker: 1 }));
  await writeFile(fingerprintSource, "class Demo { int value() { return 1; } }\n");
  const fingerprintOptions = { codeGraphStatus: async () => "Index is up to date", codeGraphVersion: async () => "1.5.0" };
  const fingerprintA = await computeWorkspaceFingerprints(fingerprintRoot, fingerprintOptions);
  const fingerprintCached = await computeWorkspaceFingerprints(fingerprintRoot, fingerprintOptions);
  assert.deepEqual(fingerprintCached, fingerprintA, "增量缓存不能改变稳定指纹");
  await writeFile(fingerprintSource, "class Demo { int value() { return 2; } }\n");
  const fingerprintB = await computeWorkspaceFingerprints(fingerprintRoot, fingerprintOptions);
  assert.notEqual(fingerprintB.sourceSnapshot, fingerprintA.sourceSnapshot, "源码变化必须改变sourceSnapshot");
  const fingerprintVersion = await computeWorkspaceFingerprints(fingerprintRoot, { ...fingerprintOptions, codeGraphVersion: async () => "1.6.0" });
  assert.notEqual(fingerprintVersion.indexFingerprint, fingerprintB.indexFingerprint, "Code Graph版本变化必须改变indexFingerprint");
  await rm(fingerprintRoot, { recursive: true, force: true });

  console.log("PASS: 状态机、批次/重试上限、租约回收、暂停/终态门禁、真实提交指纹、结构化独立审计与符号链接防护");
} finally {
  await rm(root, { recursive: true, force: true });
}
