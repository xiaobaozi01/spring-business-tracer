#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Ajv2020 from "../../.opencode/node_modules/ajv/dist/2020.js";
import SpringBusinessStatePlugin from "../../.opencode/plugins/spring-business-state.js";

const {
  buildGraphSnapshot, claimBatch, closeBatch, commitUnit, computeWorkspaceFingerprints,
  controlRun, diffGraphSnapshots, findSnapshotPaths, heartbeatBatch, initRun, migrateConfiguration, planRun, recoverRun,
  queryGraphSnapshot, seedIncrementalRun, statusRun, submitReport,
} = SpringBusinessStatePlugin.__test;

const root = await mkdtemp(join(tmpdir(), "spring-business-state-v15-"));
const fp = {
  configHash: "cfg-v15", sourceSnapshot: "src-v1", indexFingerprint: "cg-v1", toolkitFingerprint: "kit-v15",
  serviceSnapshots: { order: "service-order-v1" }, indexMetadata: { order: { initialized: true } },
};
const reportFp = { config: fp.configHash, source: fp.sourceSnapshot, index: fp.indexFingerprint, toolkit: fp.toolkitFingerprint };
const ajv = new Ajv2020({ allErrors: true, strict: false });
const verificationSchema = JSON.parse(await readFile(new URL("../../.opencode/skills/spring-business-tracer/schemas/verification.schema.json", import.meta.url), "utf8"));
const configSchema = JSON.parse(await readFile(new URL("../../.opencode/skills/spring-business-tracer/schemas/config.schema.json", import.meta.url), "utf8"));
const validateVerificationSchema = ajv.compile(verificationSchema);
const validateConfigSchema = ajv.compile(configSchema);
let op = 0;
const operationId = (label) => `${label}-${String(++op).padStart(6, "0")}`;
const rejects = (action, fragment) => assert.rejects(action, (error) => String(error.message).includes(fragment));

function trace(runId, entryId, boundaries = []) {
  return JSON.stringify({
    schemaVersion: "1.5", runId, entryId, status: "TRACED", fingerprints: reportFp,
    serviceClosure: ["order"], sharedDependency: false, unownedDependency: false,
    javaEdges: [
      { from: `${entryId}:controller`, to: `${entryId}:service`, tool: "codegraph_callees", query: { symbol: `${entryId}:controller`, limit: 101 }, file: "Controller.java", line: 10 },
      { from: "shared:service", to: "shared:repository", tool: "codegraph_callees", query: { symbol: "shared:service", limit: 101 }, file: "SharedService.java", line: 30 },
    ],
    specialEdges: [], boundaries,
    persistence: [{ symbol: `${entryId}:service`, resource: "db:main:table:sales.t_order", storeId: "main", resourceKind: "RELATIONAL_TABLE", operation: "READ", evidence: { file: "OrderRepository.java", line: 20 } }],
    queryLog: [{ tool: "codegraph_callees", args: { symbol: `${entryId}:controller`, limit: 101 }, purpose: "direct callees", resultCount: 1, truncated: false }],
  });
}

function report(runId, kind, checks, extra = {}) {
  const validators = { TRACE: "spring-trace-validator", COVERAGE: "spring-coverage-auditor", BOUNDARY: "spring-boundary-validator", INCREMENTAL: "spring-incremental-validator" };
  return JSON.stringify({ schemaVersion: "1.5", runId, kind, validator: validators[kind], decision: "ACCEPTED", fingerprints: reportFp,
    checks: checks.map((code) => ({ code, passed: true, evidence: [`evidence:${code}`] })),
    queryLog: [{ tool: "codegraph_query", args: { limit: 101 }, resultCount: 1, truncated: false }], ...(kind === "BOUNDARY" ? { verifiedBoundaryIds: [] } : {}), ...extra });
}

async function close(runId, claim, workerId, override = {}) {
  return closeBatch(root, { runId, batchId: claim.batchId, batchToken: claim.batchToken, operationId: operationId("close"), ...fp, ...override });
}

await rejects(() => initRun(root, { runId: "bad-inc", mode: "INCREMENTAL", ...fp }), "baseRunId");
await mkdir(join(root, ".opencode/.cache/spring-business-tracer/runs/legacy-run"), { recursive: true });
await writeFile(join(root, ".opencode/.cache/spring-business-tracer/runs/legacy-run/run.json"), JSON.stringify({ schemaVersion: "0.5", runId: "legacy-run", phase: "COMPLETE", units: {}, events: [] }));
const legacyStatus = await statusRun(root, "legacy-run");
assert.equal(legacyStatus.legacyReadOnly, true);
assert.equal(legacyStatus.fullRebaseRequired, true);
await rejects(() => planRun(root, { runId: "legacy-run", operationId: operationId("legacy"), entriesJson: "[]", ...fp }), "只读");
await initRun(root, { runId: "run-main", mode: "FULL", batchSize: 2, ...fp });
const planned = await planRun(root, { runId: "run-main", operationId: "plan-main-0001", entriesJson: JSON.stringify([
  { id: "constructor", service: "order", kind: "HTTP" }, { id: "toString", service: "order", kind: "SCHEDULED" },
]), ...fp });
assert.equal(planned.counts.PENDING, 2, "原型链名称不能丢失");
assert.deepEqual(await planRun(root, { runId: "run-main", operationId: "plan-main-0001", entriesJson: JSON.stringify([
  { id: "constructor", service: "order", kind: "HTTP" }, { id: "toString", service: "order", kind: "SCHEDULED" },
]), ...fp }), planned, "operationId应精确重放");

const traceClaim = await claimBatch(root, { runId: "run-main", workerId: "trace-worker", limit: 2, operationId: operationId("claim"), ...fp });
assert.equal((await heartbeatBatch(root, { runId: "run-main", batchId: traceClaim.batchId, batchToken: traceClaim.batchToken, workerId: "trace-worker", operationId: operationId("heart") })).extended, 2);
for (const unit of traceClaim.units) {
  await commitUnit(root, { runId: "run-main", entryId: unit.id, workerId: "trace-worker", batchId: traceClaim.batchId, fingerprintToken: unit.fingerprintToken, status: "TRACED", traceResultJson: trace("run-main", unit.id), operationId: operationId("trace") });
}
await close("run-main", traceClaim, "trace-worker");

const validateClaim = await claimBatch(root, { runId: "run-main", workerId: "validator-worker", limit: 2, operationId: operationId("claim"), ...fp });
await rejects(() => submitReport(root, { runId: "run-main", kind: "TRACE", entryId: "constructor", batchToken: validateClaim.units[0].fingerprintToken, operationId: operationId("forged"), reportJson: "{}" }, "spring-business-orchestrator"), "不能提交TRACE");
const current = await statusRun(root, "run-main");
for (const unit of validateClaim.units) {
  const traceHash = current.units[unit.id].artifactHash;
  const traceReportJson = report("run-main", "TRACE", ["ENTRY_IDENTITY", "JAVA_EDGE_REPLAY", "PERSISTENCE_EVIDENCE", "NO_TEXT_EDGE", "QUERY_COMPLETENESS"], { entryId: unit.id, traceHash });
  assert.equal(validateVerificationSchema(JSON.parse(traceReportJson)), true, ajv.errorsText(validateVerificationSchema.errors));
  const accepted = await submitReport(root, {
    runId: "run-main", kind: "TRACE", entryId: unit.id, batchToken: unit.fingerprintToken, operationId: operationId("report"),
    reportJson: traceReportJson,
  }, "spring-trace-validator");
  await commitUnit(root, { runId: "run-main", entryId: unit.id, workerId: "validator-worker", batchId: validateClaim.batchId, fingerprintToken: unit.fingerprintToken, status: "VERIFIED", reportId: accepted.reportId, operationId: operationId("verify") });
}
await close("run-main", validateClaim, "validator-worker");

const publishClaim = await claimBatch(root, { runId: "run-main", workerId: "publisher", limit: 2, operationId: operationId("claim"), ...fp });
for (const unit of publishClaim.units) {
  await commitUnit(root, { runId: "run-main", entryId: unit.id, workerId: "publisher", batchId: publishClaim.batchId, fingerprintToken: unit.fingerprintToken, status: "PUBLISHED", documentContent: `# ${unit.id}\n\n已验证。\n`, operationId: operationId("publish") });
}
await close("run-main", publishClaim, "publisher");
const graph1 = await buildGraphSnapshot(root, { runId: "run-main", ...fp });
const graph2 = await buildGraphSnapshot(root, { runId: "run-main", ...fp });
assert.equal(graph1.graphHash, graph2.graphHash, "同一trace并集必须生成确定性graphHash");
const stagedEdges = (await readFile(join(root, "docs/spring-business/.staging/run-main/graph/edges.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
const sharedEdges = stagedEdges.filter((edge) => edge.from === "shared:service" && edge.to === "shared:repository");
assert.equal(sharedEdges.length, 1, "相同事实边必须去重");
assert.deepEqual(sharedEdges[0].entryMembership, ["constructor", "toString"], "去重边必须合并入口归属");

const coverage = await submitReport(root, { runId: "run-main", kind: "COVERAGE", operationId: operationId("coverage"), reportJson: report("run-main", "COVERAGE", ["ENTRY_SET_EQUAL", "ADAPTER_COVERAGE", "EXCLUSIONS_REVIEWED"]) }, "spring-coverage-auditor");
const boundary = await submitReport(root, { runId: "run-main", kind: "BOUNDARY", operationId: operationId("boundary"), reportJson: report("run-main", "BOUNDARY", ["BOUNDARY_SET_EQUAL", "TWO_SIDED_EVIDENCE", "UNRESOLVED_ACCOUNTED"]) }, "spring-boundary-validator");
const firstDoc = join(root, "docs/spring-business/.staging/run-main/entrypoints/constructor.md");
const originalDoc = await readFile(firstDoc);
await writeFile(firstDoc, "tampered\n");
await rejects(() => controlRun(root, { runId: "run-main", action: "COMPLETE", operationId: operationId("complete"), coverageReportId: coverage.reportId, boundaryReportId: boundary.reportId, ...fp }), "文档哈希不匹配");
await writeFile(firstDoc, originalDoc);
const complete = await controlRun(root, { runId: "run-main", action: "COMPLETE", operationId: operationId("complete"), coverageReportId: coverage.reportId, boundaryReportId: boundary.reportId, ...fp });
assert.equal(complete.phase, "COMPLETE");
const table = await queryGraphSnapshot(root, { runId: "current", query: "table", key: "db:main:table:sales.t_order", limit: 1 });
assert.equal(table.total, 2);
assert.equal(table.truncated, true);
const path = await queryGraphSnapshot(root, { runId: "run-main", query: "path", key: "constructor:controller", target: "db:main:table:sales.t_order", maxDepth: 4, limit: 10 });
assert.equal(path.paths.length, 1);
assert.deepEqual(path.paths[0].entryMembership, ["constructor"]);
await rejects(() => queryGraphSnapshot(root, { runId: "run-main", query: "path", key: "missing", target: "db:main:table:sales.t_order" }), "NODE_NOT_FOUND");
await rejects(() => queryGraphSnapshot(root, { runId: "run-main", query: "path", key: "constructor:controller", target: "db:main:table:sales.t_order", maxDepth: 21 }), "maxDepth");
await rejects(() => queryGraphSnapshot(root, { runId: "run-main", query: "entry", key: "constructor", limit: "5" }), "必须是数字");
const competingPath = findSnapshotPaths({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [
  { id: "ab", type: "JAVA_CALL", from: "a", to: "b", entryMembership: ["entry"] },
  { id: "bc", type: "LOGICAL_BOUNDARY", from: "b", to: "c", entryMembership: ["entry"], evidence: { deliverySemantics: "COMPETING_ONE_OF" } },
] }, { key: "a", target: "c", maxDepth: 3, limit: 10 });
assert.equal(competingPath.paths[0].potential, true);
assert.deepEqual(competingPath.paths[0].potentialReasons, ["COMPETING_ONE_OF"]);
assert.equal((await diffGraphSnapshots(root, { fromRunId: "run-main", toRunId: "run-main", limit: 10 })).edges.total, 0);
const mainState = await statusRun(root, "run-main");
assert(mainState.manifestHash && mainState.indexHash, "COMPLETE必须绑定manifest/index实际字节哈希");
const currentPointerPath = join(root, "docs/spring-business/current.json");
const currentPointer = await readFile(currentPointerPath);
const badPointer = JSON.parse(currentPointer.toString("utf8"));
badPointer.manifestHash = "sha256:tampered";
await writeFile(currentPointerPath, JSON.stringify(badPointer));
await rejects(() => queryGraphSnapshot(root, { runId: "current", query: "entry", key: "constructor" }), "可信根");
await writeFile(currentPointerPath, currentPointer);

const fpIncremental = { ...fp, sourceSnapshot: "src-v2" };
const incReportFp = { config: fp.configHash, source: fpIncremental.sourceSnapshot, index: fp.indexFingerprint, toolkit: fp.toolkitFingerprint };
await initRun(root, { runId: "run-incremental", mode: "INCREMENTAL", baseRunId: "run-main", batchSize: 2, ...fpIncremental });
await planRun(root, { runId: "run-incremental", operationId: operationId("planinc"), entriesJson: JSON.stringify([
  { id: "constructor", service: "order", kind: "HTTP" }, { id: "toString", service: "order", kind: "SCHEDULED" },
]), ...fpIncremental });
const incReport = await submitReport(root, {
  runId: "run-incremental", kind: "INCREMENTAL", operationId: operationId("incremental"),
  reportJson: JSON.stringify({ schemaVersion: "1.5", runId: "run-incremental", kind: "INCREMENTAL", validator: "spring-incremental-validator", decision: "ACCEPTED", fingerprints: incReportFp,
    baseRunId: "run-main", baseGraphHash: graph1.graphHash, baseManifestHash: mainState.manifestHash, changedServices: [], reusableEntryIds: ["constructor", "toString"], affectedEntryIds: [], newEntryIds: [], tombstonedEntryIds: [], workQueueEntryIds: [],
    checks: ["BASELINE_COMPLETE", "ENTRY_SET_REDISCOVERED", "SERVICE_CLOSURE_SAFE", "CHANGED_SERVICES_EXACT", "TOMBSTONES_ACCOUNTED"].map((code) => ({ code, passed: true, evidence: [code] })),
    queryLog: [{ tool: "codegraph_query", args: { limit: 101 }, resultCount: 1, truncated: false }] }),
}, "spring-incremental-validator");
const seeded = await seedIncrementalRun(root, { runId: "run-incremental", reportId: incReport.reportId, ...fpIncremental });
assert.deepEqual(seeded.reusableEntryIds, ["constructor", "toString"]);
const incGraph = await buildGraphSnapshot(root, { runId: "run-incremental", ...fpIncremental });
assert.equal(incGraph.edgeCount, graph1.edgeCount, "复用入口必须从基线trace重建同构图");
const incCoverage = await submitReport(root, { runId: "run-incremental", kind: "COVERAGE", operationId: operationId("coverage"), reportJson: JSON.stringify({ ...JSON.parse(report("run-incremental", "COVERAGE", ["ENTRY_SET_EQUAL", "ADAPTER_COVERAGE", "EXCLUSIONS_REVIEWED"])), fingerprints: incReportFp }) }, "spring-coverage-auditor");
const incBoundary = await submitReport(root, { runId: "run-incremental", kind: "BOUNDARY", operationId: operationId("boundary"), reportJson: JSON.stringify({ ...JSON.parse(report("run-incremental", "BOUNDARY", ["BOUNDARY_SET_EQUAL", "TWO_SIDED_EVIDENCE", "UNRESOLVED_ACCOUNTED"])), fingerprints: incReportFp }) }, "spring-boundary-validator");
assert.equal((await controlRun(root, { runId: "run-incremental", action: "COMPLETE", operationId: operationId("complete"), coverageReportId: incCoverage.reportId, boundaryReportId: incBoundary.reportId, ...fpIncremental })).phase, "COMPLETE");
await initRun(root, { runId: "run-delete", mode: "INCREMENTAL", baseRunId: "run-main", ...fpIncremental });
await planRun(root, { runId: "run-delete", operationId: operationId("plan-delete"), entriesJson: JSON.stringify([{ id: "constructor", service: "order", kind: "HTTP" }]), ...fpIncremental });
const deleteReport = await submitReport(root, { runId: "run-delete", kind: "INCREMENTAL", operationId: operationId("report-delete"), reportJson: JSON.stringify({
  schemaVersion: "1.5", runId: "run-delete", kind: "INCREMENTAL", validator: "spring-incremental-validator", decision: "ACCEPTED", fingerprints: incReportFp,
  baseRunId: "run-main", baseGraphHash: graph1.graphHash, baseManifestHash: mainState.manifestHash, changedServices: [], reusableEntryIds: ["constructor"], affectedEntryIds: [], newEntryIds: [], tombstonedEntryIds: ["toString"], workQueueEntryIds: [],
  checks: ["BASELINE_COMPLETE", "ENTRY_SET_REDISCOVERED", "SERVICE_CLOSURE_SAFE", "CHANGED_SERVICES_EXACT", "TOMBSTONES_ACCOUNTED"].map((code) => ({ code, passed: true, evidence: [code] })), queryLog: [{ tool: "codegraph_query", args: { limit: 101 }, resultCount: 1, truncated: false }],
}) }, "spring-incremental-validator");
const deletedSeed = await seedIncrementalRun(root, { runId: "run-delete", reportId: deleteReport.reportId, ...fpIncremental });
assert.deepEqual(deletedSeed.tombstonedEntryIds, ["toString"]);
await buildGraphSnapshot(root, { runId: "run-delete", ...fpIncremental });
const deleteCoverage = await submitReport(root, { runId: "run-delete", kind: "COVERAGE", operationId: operationId("coverage-delete"), reportJson: JSON.stringify({ ...JSON.parse(report("run-delete", "COVERAGE", ["ENTRY_SET_EQUAL", "ADAPTER_COVERAGE", "EXCLUSIONS_REVIEWED"])), fingerprints: incReportFp }) }, "spring-coverage-auditor");
const deleteBoundary = await submitReport(root, { runId: "run-delete", kind: "BOUNDARY", operationId: operationId("boundary-delete"), reportJson: JSON.stringify({ ...JSON.parse(report("run-delete", "BOUNDARY", ["BOUNDARY_SET_EQUAL", "TWO_SIDED_EVIDENCE", "UNRESOLVED_ACCOUNTED"])), fingerprints: incReportFp }) }, "spring-boundary-validator");
await controlRun(root, { runId: "run-delete", action: "COMPLETE", operationId: operationId("complete-delete"), coverageReportId: deleteCoverage.reportId, boundaryReportId: deleteBoundary.reportId, ...fpIncremental });
const deletionDiff = await diffGraphSnapshots(root, { fromRunId: "run-main", toRunId: "run-delete", limit: 100 });
assert.deepEqual(deletionDiff.entries.removed, ["toString"]);
assert(deletionDiff.edges.removed.length > 0 && deletionDiff.edges.changedMembership.length > 0, "删除入口必须产生边删除或归属变化");
await initRun(root, { runId: "run-new-set", mode: "INCREMENTAL", baseRunId: "run-main", ...fpIncremental });
await planRun(root, { runId: "run-new-set", operationId: operationId("plan-new-set"), entriesJson: JSON.stringify([{ id: "constructor", service: "order" }, { id: "newEntry", service: "order" }]), ...fpIncremental });
const newSetReport = await submitReport(root, { runId: "run-new-set", kind: "INCREMENTAL", operationId: operationId("report-new-set"), reportJson: JSON.stringify({
  schemaVersion: "1.5", runId: "run-new-set", kind: "INCREMENTAL", validator: "spring-incremental-validator", decision: "ACCEPTED", fingerprints: incReportFp,
  baseRunId: "run-main", baseGraphHash: graph1.graphHash, baseManifestHash: mainState.manifestHash, changedServices: [], reusableEntryIds: ["constructor"], affectedEntryIds: [], newEntryIds: ["newEntry"], tombstonedEntryIds: ["toString"], workQueueEntryIds: ["newEntry"],
  checks: ["BASELINE_COMPLETE", "ENTRY_SET_REDISCOVERED", "SERVICE_CLOSURE_SAFE", "CHANGED_SERVICES_EXACT", "TOMBSTONES_ACCOUNTED"].map((code) => ({ code, passed: true, evidence: [code] })), queryLog: [{ tool: "codegraph_query", args: { limit: 101 }, resultCount: 1, truncated: false }],
}) }, "spring-incremental-validator");
const newSet = await seedIncrementalRun(root, { runId: "run-new-set", reportId: newSetReport.reportId, ...fpIncremental });
assert.deepEqual(newSet.affectedEntryIds, []);
assert.deepEqual(newSet.newEntryIds, ["newEntry"]);
assert.deepEqual(newSet.workQueueEntryIds, ["newEntry"]);
const incEdgesPath = join(root, "docs/spring-business/snapshots/run-incremental/graph/edges.jsonl");
const incEdges = await readFile(incEdgesPath);
await writeFile(incEdgesPath, Buffer.concat([incEdges, Buffer.from("tampered\n")]));
await rejects(() => queryGraphSnapshot(root, { runId: "run-incremental", query: "entry", key: "constructor" }), "哈希不匹配");
await writeFile(incEdgesPath, incEdges);
const incManifestPath = join(root, "docs/spring-business/snapshots/run-incremental/manifest.json");
const incManifest = await readFile(incManifestPath);
await writeFile(incManifestPath, "{}\n");
await rejects(() => queryGraphSnapshot(root, { runId: "run-incremental", query: "entry", key: "constructor" }), "manifest或index");
await writeFile(incManifestPath, incManifest);

const incStatePath = join(root, ".opencode/.cache/spring-business-tracer/runs/run-incremental/run.json");
const incState = JSON.parse(await readFile(incStatePath, "utf8"));
incState.phase = "FINALIZING";
incState.publication.currentUpdated = false;
await writeFile(incStatePath, `${JSON.stringify(incState, null, 2)}\n`);
const incDocPath = join(root, "docs/spring-business/snapshots/run-incremental/entrypoints/constructor.md");
const incDoc = await readFile(incDocPath);
await writeFile(incDocPath, "tampered\n");
await rejects(() => recoverRun(root, { runId: "run-incremental" }), "文档哈希不匹配");
await writeFile(incDocPath, incDoc);
assert.equal((await recoverRun(root, { runId: "run-incremental" })).phase, "COMPLETE");
const completeWindow = JSON.parse(await readFile(incStatePath, "utf8"));
completeWindow.publication.currentUpdated = false;
await writeFile(incStatePath, `${JSON.stringify(completeWindow, null, 2)}\n`);
await writeFile(incDocPath, "tampered-again\n");
await rejects(() => recoverRun(root, { runId: "run-incremental" }), "文档哈希不匹配");
await writeFile(incDocPath, incDoc);
assert.equal((await recoverRun(root, { runId: "run-incremental" })).currentRecovered, true);

await initRun(root, { runId: "run-query", batchSize: 1, ...fp });
await planRun(root, { runId: "run-query", operationId: operationId("plan"), entriesJson: JSON.stringify([{ id: "entry", service: "order" }]), ...fp });
const queryClaim = await claimBatch(root, { runId: "run-query", workerId: "worker", operationId: operationId("claim"), ...fp });
const badTrace = JSON.parse(trace("run-query", "entry"));
delete badTrace.queryLog[0].args.limit;
await rejects(() => commitUnit(root, { runId: "run-query", entryId: "entry", workerId: "worker", batchId: queryClaim.batchId, fingerprintToken: queryClaim.units[0].fingerprintToken, status: "TRACED", traceResultJson: JSON.stringify(badTrace), operationId: operationId("badquery") }), "limit=101");
badTrace.queryLog[0].args.limit = 101;
badTrace.queryLog[0].resultCount = 101;
await rejects(() => commitUnit(root, { runId: "run-query", entryId: "entry", workerId: "worker", batchId: queryClaim.batchId, fingerprintToken: queryClaim.units[0].fingerprintToken, status: "TRACED", traceResultJson: JSON.stringify(badTrace), operationId: operationId("touchlimit") }), "resultCount<limit");

await initRun(root, { runId: "run-boundary-auth", batchSize: 1, ...fp });
await planRun(root, { runId: "run-boundary-auth", operationId: operationId("plan-boundary"), entriesJson: JSON.stringify([{ id: "entry", service: "order" }]), ...fp });
const boundaryFact = { id: "kafka-main-orders-workers", kind: "KAFKA", key: "main:orders:workers", channelKey: "main:orders", consumerGroup: "workers", source: "publisher", targets: ["listener-a", "listener-b"], deliverySemantics: "COMPETING_ONE_OF", status: "CANDIDATE" };
const boundaryTraceClaim = await claimBatch(root, { runId: "run-boundary-auth", workerId: "trace", operationId: operationId("claim-boundary"), ...fp });
await commitUnit(root, { runId: "run-boundary-auth", entryId: "entry", workerId: "trace", batchId: boundaryTraceClaim.batchId, fingerprintToken: boundaryTraceClaim.units[0].fingerprintToken, status: "TRACED", traceResultJson: trace("run-boundary-auth", "entry", [boundaryFact]), operationId: operationId("trace-boundary") });
await close("run-boundary-auth", boundaryTraceClaim, "trace");
const boundaryValidateClaim = await claimBatch(root, { runId: "run-boundary-auth", workerId: "validator", operationId: operationId("claim-boundary"), ...fp });
const boundaryState = await statusRun(root, "run-boundary-auth");
const boundaryTraceReport = await submitReport(root, { runId: "run-boundary-auth", kind: "TRACE", entryId: "entry", batchToken: boundaryValidateClaim.units[0].fingerprintToken, operationId: operationId("trace-report-boundary"), reportJson: report("run-boundary-auth", "TRACE", ["ENTRY_IDENTITY", "JAVA_EDGE_REPLAY", "PERSISTENCE_EVIDENCE", "NO_TEXT_EDGE", "QUERY_COMPLETENESS"], { entryId: "entry", traceHash: boundaryState.units.entry.artifactHash }) }, "spring-trace-validator");
await commitUnit(root, { runId: "run-boundary-auth", entryId: "entry", workerId: "validator", batchId: boundaryValidateClaim.batchId, fingerprintToken: boundaryValidateClaim.units[0].fingerprintToken, status: "VERIFIED", reportId: boundaryTraceReport.reportId, operationId: operationId("verify-boundary") });
await close("run-boundary-auth", boundaryValidateClaim, "validator");
const boundaryPublishClaim = await claimBatch(root, { runId: "run-boundary-auth", workerId: "publisher", operationId: operationId("claim-boundary"), ...fp });
await commitUnit(root, { runId: "run-boundary-auth", entryId: "entry", workerId: "publisher", batchId: boundaryPublishClaim.batchId, fingerprintToken: boundaryPublishClaim.units[0].fingerprintToken, status: "PUBLISHED", documentContent: "# boundary\n", operationId: operationId("publish-boundary") });
await close("run-boundary-auth", boundaryPublishClaim, "publisher");
await rejects(() => buildGraphSnapshot(root, { runId: "run-boundary-auth", ...fp }), "没有认证BOUNDARY报告");
await submitReport(root, { runId: "run-boundary-auth", kind: "BOUNDARY", operationId: operationId("boundary-auth-report"), reportJson: report("run-boundary-auth", "BOUNDARY", ["BOUNDARY_SET_EQUAL", "TWO_SIDED_EVIDENCE", "UNRESOLVED_ACCOUNTED"], { verifiedBoundaryIds: [boundaryFact.id] }) }, "spring-boundary-validator");
assert.equal((await buildGraphSnapshot(root, { runId: "run-boundary-auth", ...fp })).edgeCount, 5, "认证Kafka竞争边界应展开两个潜在目标边");

await initRun(root, { runId: "run-drift", batchSize: 1, ...fp });
await planRun(root, { runId: "run-drift", operationId: operationId("plan"), entriesJson: JSON.stringify([{ id: "entry", service: "order" }]), ...fp });
const driftClaim = await claimBatch(root, { runId: "run-drift", workerId: "worker", operationId: operationId("claim"), ...fp });
await commitUnit(root, { runId: "run-drift", entryId: "entry", workerId: "worker", batchId: driftClaim.batchId, fingerprintToken: driftClaim.units[0].fingerprintToken, status: "TRACED", traceResultJson: trace("run-drift", "entry"), operationId: operationId("trace") });
await rejects(() => close("run-drift", driftClaim, "worker", { sourceSnapshot: "changed" }), "STALE");
assert.equal((await statusRun(root, "run-drift")).phase, "STALE");

await initRun(root, { runId: "run-stage-recover", batchSize: 1, ...fp });
await planRun(root, { runId: "run-stage-recover", operationId: operationId("plan"), entriesJson: JSON.stringify([{ id: "entry", service: "order" }]), ...fp });
const stageTrace = await claimBatch(root, { runId: "run-stage-recover", workerId: "trace-worker", operationId: operationId("claim"), ...fp });
await commitUnit(root, { runId: "run-stage-recover", entryId: "entry", workerId: "trace-worker", batchId: stageTrace.batchId, fingerprintToken: stageTrace.units[0].fingerprintToken, status: "TRACED", traceResultJson: trace("run-stage-recover", "entry"), operationId: operationId("trace") });
await close("run-stage-recover", stageTrace, "trace-worker");
const stageValidate = await claimBatch(root, { runId: "run-stage-recover", workerId: "validator", operationId: operationId("claim"), ...fp });
await controlRun(root, { runId: "run-stage-recover", action: "PAUSE", operationId: operationId("pause") });
const stagePath = join(root, ".opencode/.cache/spring-business-tracer/runs/run-stage-recover/run.json");
const stageState = JSON.parse(await readFile(stagePath, "utf8"));
stageState.units.entry.leaseUntil = "2000-01-01T00:00:00.000Z";
await writeFile(stagePath, `${JSON.stringify(stageState, null, 2)}\n`);
assert.equal((await recoverRun(root, { runId: "run-stage-recover", ...fp })).phase, "PAUSED");
await controlRun(root, { runId: "run-stage-recover", action: "RESUME", operationId: operationId("resume"), ...fp });
const reclaimedValidate = await claimBatch(root, { runId: "run-stage-recover", workerId: "validator-2", operationId: operationId("claim"), ...fp });
assert.equal(reclaimedValidate.units[0].leaseStage, "VALIDATE", "VALIDATE崩溃后不能重做TRACE");

const symlinkRoot = await mkdtemp(join(tmpdir(), "spring-business-symlink-v15-"));
await initRun(root, { runId: "run-symlink", batchSize: 1, ...fp });
await planRun(root, { runId: "run-symlink", operationId: operationId("plan"), entriesJson: JSON.stringify([{ id: "entry", service: "order" }]), ...fp });
const symlinkClaim = await claimBatch(root, { runId: "run-symlink", workerId: "worker", operationId: operationId("claim"), ...fp });
const artifactRoot = join(root, ".opencode/.cache/spring-business-tracer/runs/run-symlink/artifacts");
await mkdir(artifactRoot, { recursive: true });
await symlink(symlinkRoot, join(artifactRoot, "entry"));
await rejects(() => commitUnit(root, { runId: "run-symlink", entryId: "entry", workerId: "worker", batchId: symlinkClaim.batchId, fingerprintToken: symlinkClaim.units[0].fingerprintToken, status: "TRACED", traceResultJson: trace("run-symlink", "entry"), operationId: operationId("trace") }), "符号链接");
await assert.rejects(() => access(join(symlinkRoot, "trace.json")), "符号链接逃逸不得创建工作区外文件");

const migrationRoot = await mkdtemp(join(tmpdir(), "spring-business-migrate-v15-"));
await mkdir(join(migrationRoot, ".opencode"), { recursive: true });
const legacyConfig = JSON.parse(await readFile(new URL("../../spring-business-tracer-workspace/iteration-3/v05-snapshot/spring-business-tracer.json", import.meta.url), "utf8"));
await writeFile(join(migrationRoot, ".opencode/spring-business-tracer.json"), JSON.stringify(legacyConfig));
assert.equal((await migrateConfiguration(migrationRoot)).status, "DRY_RUN");
assert.equal((await migrateConfiguration(migrationRoot, { apply: true })).status, "APPLIED");
assert.equal((await migrateConfiguration(migrationRoot, { apply: true })).status, "NOOP");
assert.equal(JSON.parse(await readFile(join(migrationRoot, ".opencode/spring-business-tracer.v0.5.json"), "utf8")).version, "0.5.0");
const migratedConfig = JSON.parse(await readFile(join(migrationRoot, ".opencode/spring-business-tracer.json"), "utf8"));
assert(migratedConfig.verification.validators.includes("incremental"));
assert.equal(migratedConfig.resume.requireToolkitFingerprint, true);
assert.equal(validateConfigSchema(migratedConfig), true, ajv.errorsText(validateConfigSchema.errors));
const v10MigrationRoot = await mkdtemp(join(tmpdir(), "spring-business-migrate-v10-to-v15-"));
await mkdir(join(v10MigrationRoot, ".opencode"), { recursive: true });
const v10Config = JSON.parse(await readFile(new URL("../../spring-business-tracer-workspace/iteration-4/v10-snapshot/spring-business-tracer.json", import.meta.url), "utf8"));
await writeFile(join(v10MigrationRoot, ".opencode/spring-business-tracer.json"), JSON.stringify(v10Config));
assert.equal((await migrateConfiguration(v10MigrationRoot)).report.from, "1.0.0");
assert.equal((await migrateConfiguration(v10MigrationRoot, { apply: true })).status, "APPLIED");
assert.equal((await migrateConfiguration(v10MigrationRoot, { apply: true })).status, "NOOP");
assert.equal(JSON.parse(await readFile(join(v10MigrationRoot, ".opencode/spring-business-tracer.v1.0.json"), "utf8")).version, "1.0.0");
assert.equal(validateConfigSchema(JSON.parse(await readFile(join(v10MigrationRoot, ".opencode/spring-business-tracer.json"), "utf8"))), true, ajv.errorsText(validateConfigSchema.errors));
const v10JournalPath = join(v10MigrationRoot, ".opencode/.cache/spring-business-tracer/migration-1.0.0-to-1.5.0.json");
const v10Journal = JSON.parse(await readFile(v10JournalPath, "utf8"));
await writeFile(v10JournalPath, JSON.stringify({ ...v10Journal, state: "PREPARED" }));
assert.equal((await migrateConfiguration(v10MigrationRoot)).status, "RECOVERY_REQUIRED");
assert.equal((await migrateConfiguration(v10MigrationRoot, { apply: true })).status, "RECOVERED");
const invalidMigrationRoot = await mkdtemp(join(tmpdir(), "spring-business-invalid-migrate-v15-"));
await mkdir(join(invalidMigrationRoot, ".opencode"), { recursive: true });
const invalidLegacy = structuredClone(legacyConfig);
invalidLegacy.analysis.maxBranches = "not-a-number";
const invalidLegacyBytes = JSON.stringify(invalidLegacy);
await writeFile(join(invalidMigrationRoot, ".opencode/spring-business-tracer.json"), invalidLegacyBytes);
await rejects(() => migrateConfiguration(invalidMigrationRoot, { apply: true }), "类型或范围非法");
assert.equal(await readFile(join(invalidMigrationRoot, ".opencode/spring-business-tracer.json"), "utf8"), invalidLegacyBytes, "迁移失败必须保持原配置字节不变");
const invalidV10MigrationRoot = await mkdtemp(join(tmpdir(), "spring-business-invalid-v10-migrate-v15-"));
await mkdir(join(invalidV10MigrationRoot, ".opencode"), { recursive: true });
const invalidV10 = structuredClone(v10Config);
invalidV10.analysis.maxBranches = "100";
const invalidV10Bytes = JSON.stringify(invalidV10);
await writeFile(join(invalidV10MigrationRoot, ".opencode/spring-business-tracer.json"), invalidV10Bytes);
await rejects(() => migrateConfiguration(invalidV10MigrationRoot, { apply: true }), "类型或范围非法");
assert.equal(await readFile(join(invalidV10MigrationRoot, ".opencode/spring-business-tracer.json"), "utf8"), invalidV10Bytes, "V1.0错误数字字符串迁移失败必须保持原字节");

const fingerprintRoot = await mkdtemp(join(tmpdir(), "spring-business-fingerprint-v15-"));
await mkdir(join(fingerprintRoot, ".opencode/plugins"), { recursive: true });
await mkdir(join(fingerprintRoot, "src/main/java/docs"), { recursive: true });
await writeFile(join(fingerprintRoot, ".opencode/spring-business-tracer.json"), JSON.stringify({ version: "1.0.0", workspace: { services: [] } }));
await writeFile(join(fingerprintRoot, ".opencode/plugins/tool.js"), "export default 1;\n");
await writeFile(join(fingerprintRoot, "src/main/java/docs/Valid.java"), "class Valid {}\n");
const mock = { codeGraphStatus: async () => ({ initialized: true, index: { state: "complete" }, pendingChanges: {}, worktreeMismatch: null }), codeGraphVersion: async () => "1.5.0" };
const before = await computeWorkspaceFingerprints(fingerprintRoot, mock);
await writeFile(join(fingerprintRoot, "src/main/java/docs/Valid.java"), "class Valid { int changed; }\n");
const after = await computeWorkspaceFingerprints(fingerprintRoot, mock);
assert.notEqual(before.sourceSnapshot, after.sourceSnapshot, "src树中的docs目录不能被错误忽略");

console.log("PASS: V1.5状态机、分阶段租约、认证报告、实际哈希、确定性图、迁移与指纹测试");
