#!/usr/bin/env node
import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, rename, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import SpringBusinessStatePlugin from "../../.opencode/plugins/spring-business-state.js";
import { resolveAnalysisContexts } from "../../.opencode/plugins/spring-business/config-resolver.js";
import { createTopology, queryTopologyBundle, verifyTopologyBundle, writeTopologyBundle, __test as graphTest } from "../../.opencode/plugins/spring-business/graph-v2.js";

const { assertSafeConfigAgent, buildGraphSnapshot, claimBatch, closeBatch, commitUnit, controlRun, diffGraphSnapshots, findSnapshotPaths, heartbeatBatch, initRun, migrateConfiguration, planRun, queryGraphSnapshot, queryTopologySnapshot, recoverRun, seedIncrementalRun, statusRun, submitReport } = SpringBusinessStatePlugin.__test;
const pluginHooks = await SpringBusinessStatePlugin();
assert.deepEqual(Object.keys(pluginHooks.tool).sort(), [
  "spring_config_resolve", "spring_graph_build", "spring_graph_diff", "spring_graph_query", "spring_migrate_config", "spring_report_submit",
  "spring_state_claim", "spring_state_close_batch", "spring_state_commit", "spring_state_control", "spring_state_fingerprint", "spring_state_heartbeat",
  "spring_state_init", "spring_state_plan", "spring_state_recover", "spring_state_seed", "spring_state_status", "spring_topology_query",
].sort(), "V2插件必须完整暴露18个状态、配置和图工具");
let serial = 0;
const op = (label) => `${label}-${String(++serial).padStart(8, "0")}`;
const rejects = (fn, fragment) => assert.rejects(fn, (error) => String(error.message).includes(fragment));

const contextRoot = await mkdtemp(join(tmpdir(), "spring-context-v20-"));
await mkdir(join(contextRoot, "config"), { recursive: true });
await writeFile(join(contextRoot, "config/application.yml"), [
  "spring:", "  config:", "    import: optional:configserver:http://cfg:8888/app", "service:", "  base-url: http://default", "  password: default-secret", "routes:", "  - id: order-route", "    uri: http://order-service", "    predicates:", "      - Path=/orders/**", "nested: ${service.base-url}/v1", "cycle-a: ${cycle-b}", "cycle-b: ${cycle-a}",
  "---", "spring:", "  config:", "    activate:", "      on-profile: prod", "service:", "  base-url: https://prod.internal", "  password: prod-secret", "queue: ${billing.queue:billing.default}", "",
  "---", "spring:", "  config:", "    activate:", "      on-profile: prod & !cloud", "advanced-profile: enabled", "",
].join("\n"));
await writeFile(join(contextRoot, "config/override.properties"), "billing.queue=billing.prod\ndynamic.destination=#{systemProperties[user.home]}\ndynamic.alias=${dynamic.destination}\ndynamic.alias2=${dynamic.alias}\nexternal.alias=${spring.config.import}\nexternal.alias2=${external.alias}\nexternal.fallback=${spring.config.import:local}\napi.token=do-not-leak\nclientSecret=camel-secret\naccessToken=camel-token\nclientCredential=camel-credential\ndb.password=hunter2\nredis.url=redis://default:redis-pass@redis:6379/0\nservice.url=https://u:service-pass@host/api\njdbc.url=jdbc:postgresql://dbuser:jdbc-pass@host/db\njdbc.alias=${jdbc.url}\nquery.url=https://host/api?access_token=query-pass\nquery.fragment=host/path?password=query2-pass\nuri.alias=${redis.url}\npublic-url=https://u:${db.password}@host\npublic-alias=${public-url}\nfallback-secret=${missing:${db.password}}\nmissing-secret-default=${db.missing-password:fallback-secret-value}\nsafe-alias=${billing.queue}\nnested-fallback=${missing:${billing.queue:default}}\nescaped.value=hello\\ world\nunicode.value=\\u4E2D\\u6587\ncontinued.value=first\\\n  second\nescaped\\:key=works\nruntime-home=${HOME}\nruntime-home-default=${HOME:/tmp}\nruntime-password-default=${DB_PASSWORD:hunter2}\n");
const contextConfig = {
  analysisContexts: { defaultContext: "prod-cn", definitions: [{ id: "prod-cn", activeProfiles: ["prod", "cn"], propertySources: ["config/application.yml", "config/override.properties"] }] },
  configResolution: { externalSourcePolicy: "PARTIAL" },
};
const resolution = await resolveAnalysisContexts(contextRoot, contextConfig);
assert.equal(resolution.contexts[0].values.find((row) => row.key === "service.base-url").value, "https://prod.internal");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "queue").value, "billing.prod");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "nested-fallback").value, "billing.prod");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "advanced-profile").value, "enabled");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "routes[0].id").value, "order-route");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "routes[0].uri").value, "http://order-service");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "routes[0].predicates[0]").value, "Path=/orders/**");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "service.password").value, undefined, "秘密值不能返回");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "api.token").value, undefined, "token不能返回");
for (const key of ["clientSecret", "accessToken", "clientCredential"]) assert.equal(resolution.contexts[0].values.find((row) => row.key === key).value, undefined, `${key}驼峰秘密不能返回`);
for (const key of ["redis.url", "service.url", "jdbc.url", "jdbc.alias", "query.url", "query.fragment", "uri.alias", "public-url", "public-alias", "fallback-secret"]) {
  const derived = resolution.contexts[0].values.find((row) => row.key === key);
  assert.equal(derived.redacted, true, `${key}必须继承秘密污染标记`);
  assert.equal(derived.value, undefined, `${key}不能返回派生秘密明文`);
}
const secretDefault = resolution.contexts[0].values.find((row) => row.key === "missing-secret-default");
assert.equal(secretDefault.redacted, true);
assert.equal(secretDefault.value, undefined);
assert.equal(resolution.contexts[0].values.find((row) => row.key === "safe-alias").value, "billing.prod");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "escaped.value").value, "hello world");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "unicode.value").value, "中文");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "continued.value").value, "firstsecond");
assert.equal(resolution.contexts[0].values.find((row) => row.key === "escaped:key").value, "works");
for (const secret of ["hunter2", "camel-secret", "camel-token", "camel-credential", "redis-pass", "service-pass", "jdbc-pass", "query-pass", "query2-pass"]) assert(!JSON.stringify(resolution).includes(secret), "resolved-config不得包含直接、URI、驼峰或派生秘密明文");
assert(resolution.contexts[0].unresolved.some((row) => row.reason === "PLACEHOLDER_CYCLE"));
assert(resolution.contexts[0].unresolved.some((row) => row.key === "spring.config.import" && row.reason === "EXTERNAL_CONFIG_SOURCE"));
assert(resolution.contexts[0].unresolved.some((row) => row.key === "dynamic.destination" && row.reason === "SPEL_UNSUPPORTED"));
for (const key of ["dynamic.alias", "dynamic.alias2"]) assert(resolution.contexts[0].unresolved.some((row) => row.key === key && row.reason === "SPEL_UNSUPPORTED"));
for (const key of ["external.alias", "external.alias2", "external.fallback"]) assert(resolution.contexts[0].unresolved.some((row) => row.key === key && row.reason === "EXTERNAL_CONFIG_SOURCE"));
assert(resolution.contexts[0].unresolved.some((row) => row.key === "runtime-home" && row.reason === "EXTERNAL_ENVIRONMENT"));
assert(resolution.contexts[0].unresolved.some((row) => row.key === "runtime-home-default" && row.reason === "EXTERNAL_ENVIRONMENT"));
assert(resolution.contexts[0].unresolved.some((row) => row.key === "runtime-password-default" && row.reason === "EXTERNAL_ENVIRONMENT"));
await rejects(() => resolveAnalysisContexts(contextRoot, { ...contextConfig, analysisContexts: { defaultContext: "x", definitions: [{ id: "x", activeProfiles: [], propertySources: ["../.env"] }] } }), "CONFIG_SOURCE_FORBIDDEN");
const externalConfig = join(contextRoot, "external-hardlink.properties");
const declaredHardlink = join(contextRoot, "config/hardlink.properties");
await writeFile(externalConfig, "safe.value=must-not-be-read\n");
await link(externalConfig, declaredHardlink);
await rejects(() => resolveAnalysisContexts(contextRoot, { ...contextConfig, analysisContexts: { defaultContext: "x", definitions: [{ id: "x", activeProfiles: [], propertySources: ["config/hardlink.properties"] }] } }), "CONFIG_SOURCE_UNSAFE");
await writeFile(join(contextRoot, "config/bad.yml"), "spring.config.activate.on-profile: 'prod && cloud'\nvalue: bad\n");
await rejects(() => resolveAnalysisContexts(contextRoot, { ...contextConfig, analysisContexts: { defaultContext: "x", definitions: [{ id: "x", activeProfiles: ["prod"], propertySources: ["config/bad.yml"] }] } }), "CONFIG_PROFILE_EXPRESSION_UNSUPPORTED");
await writeFile(join(contextRoot, "config/malformed.yml"), "password: [hunter2\n");
await assert.rejects(() => resolveAnalysisContexts(contextRoot, { ...contextConfig, analysisContexts: { defaultContext: "x", definitions: [{ id: "x", activeProfiles: [], propertySources: ["config/malformed.yml"] }] } }), (error) => String(error.message).startsWith("CONFIG_YAML_SYNTAX:config/malformed.yml:") && !String(error.message).includes("hunter2"));

for (const agent of ["spring-business-orchestrator", "spring-boundary-validator", "spring-config-auditor", "spring-coverage-auditor", "spring-entry-worker", "spring-incremental-validator", "spring-trace-validator", "spring-trace-worker"]) {
  assert.doesNotThrow(() => assertSafeConfigAgent({ agent }), `${agent}应能调用脱敏配置解析`);
}
assert.throws(() => assertSafeConfigAgent({ agent: "untrusted-agent" }), /不能解析配置上下文/);

const root = await mkdtemp(join(tmpdir(), "spring-state-v20-"));
const fp = {
  configHash: "cfg-v20", sourceSnapshot: "src-v1", indexFingerprint: "cg-v1", toolkitFingerprint: "kit-v20",
  resolutionContextHash: resolution.resolutionContextHash, adapterRegistryFingerprint: "adapter-v20", contextIds: ["prod-cn"], resolutionSummary: resolution,
  serviceSnapshots: { order: "order-v1" }, serviceRoots: { order: "modules/order-service" }, indexMetadata: { order: { projectPath: "order", version: "1.5.0", index: { builtWithVersion: "1.5.0", currentExtractionVersion: 24 }, languages: ["java"] } }, queryLimit: 101,
};
const reportFp = { config: fp.configHash, source: fp.sourceSnapshot, index: fp.indexFingerprint, toolkit: fp.toolkitFingerprint, resolvedConfig: fp.resolutionContextHash, adapterRegistry: fp.adapterRegistryFingerprint };
const initIdempotencyInput = { runId: "run-init-idempotent", operationId: op("init-idempotent"), ...fp };
const initializedOnce = await initRun(root, initIdempotencyInput);
assert.deepEqual(await initRun(root, initIdempotencyInput), initializedOnce, "run初始化重试必须精确幂等");
await rejects(() => initRun(root, { ...initIdempotencyInput, retryLimit: 3 }), "operationId已用于不同请求");
const checks = {
  TRACE: ["ENTRY_IDENTITY", "JAVA_EDGE_REPLAY", "PERSISTENCE_EVIDENCE", "NO_TEXT_EDGE", "QUERY_COMPLETENESS"],
  COVERAGE: ["ENTRY_SET_EQUAL", "ADAPTER_COVERAGE", "EXCLUSIONS_REVIEWED"],
  BOUNDARY: ["BOUNDARY_SET_EQUAL", "TWO_SIDED_EVIDENCE", "UNRESOLVED_ACCOUNTED"],
  CONFIG: ["CONFIG_PRECEDENCE", "PLACEHOLDER_RESOLUTION", "EXTERNALS_ACCOUNTED", "SECRETS_REDACTED"],
  INCREMENTAL: ["BASELINE_COMPLETE", "ENTRY_SET_REDISCOVERED", "SERVICE_CLOSURE_SAFE", "CONFIG_DEPENDENCY_CLOSURE", "CHANGED_SERVICES_EXACT", "TOMBSTONES_ACCOUNTED"],
};
const agents = { TRACE: "spring-trace-validator", COVERAGE: "spring-coverage-auditor", BOUNDARY: "spring-boundary-validator", CONFIG: "spring-config-auditor", INCREMENTAL: "spring-incremental-validator" };
function report(runId, kind, extra = {}, fingerprints = reportFp) {
  return JSON.stringify({ schemaVersion: "2.0", runId, kind, validator: agents[kind], decision: "ACCEPTED", fingerprints,
    checks: checks[kind].map((code) => ({ code, passed: true, evidence: [code] })),
    ...(kind === "CONFIG" ? { resolutionContextHash: fingerprints.resolvedConfig, contextIds: ["prod-cn"], resolutionLog: [{ contextId: "prod-cn", status: "RESOLVED" }], queryLog: [] } : { queryLog: [{ tool: "codegraph_callees", args: { limit: 101 }, resultCount: 1, truncated: false }] }),
    ...(kind === "BOUNDARY" ? { verifiedBoundaryIds: [] } : {}), ...extra });
}
function trace(runId, entryId, key = "billing.queue", fingerprints = reportFp) {
  return JSON.stringify({ schemaVersion: "2.0", runId, entryId, status: "TRACED", fingerprints, contextIds: ["prod-cn"], configDependencyIds: [key], serviceClosure: ["order"], sharedDependency: false, unownedDependency: false, entrySymbol: `${entryId}:controller`,
    javaEdges: [{ from: `${entryId}:controller`, to: `${entryId}:service`, tool: "codegraph_callees", query: { limit: 101 }, file: "Controller.java", line: 10 }], specialEdges: [], boundaries: [],
    persistence: [{ symbol: `${entryId}:service`, resource: "db:main:table:sales.orders", storeId: "main", resourceKind: "RELATIONAL_TABLE", operation: "READ", evidence: { file: "Repository.java", line: 20 } }],
    topologyFacts: [{ type: "DISPATCHES_TO", from: `entry:${entryId}`, to: `${entryId}:controller`, assurance: "VERIFIED", provenance: { file: "Controller.java", line: 1 } }], unresolvedFindings: [],
    queryLog: [{ tool: "codegraph_callees", args: { limit: 101 }, purpose: "callees", resultCount: 1, truncated: false }] });
}
async function close(runId, claim, override = fp) {
  return closeBatch(root, { runId, batchId: claim.batchId, batchToken: claim.batchToken, operationId: op("close"), ...override });
}
async function publishRun(runId, fingerprints = fp, reportFingerprints = reportFp, traceKey = "billing.queue") {
  const traceClaim = await claimBatch(root, { runId, workerId: "trace", operationId: op("claim"), ...fingerprints });
  for (const unit of traceClaim.units) await commitUnit(root, { runId, entryId: unit.id, workerId: "trace", batchId: traceClaim.batchId, fingerprintToken: unit.fingerprintToken, status: "TRACED", traceResultJson: trace(runId, unit.id, traceKey, reportFingerprints), operationId: op("trace") });
  await close(runId, traceClaim, fingerprints);
  const validationClaim = await claimBatch(root, { runId, workerId: "validator", operationId: op("claim"), ...fingerprints });
  const state = await statusRun(root, runId);
  for (const unit of validationClaim.units) {
    const accepted = await submitReport(root, { runId, kind: "TRACE", entryId: unit.id, batchToken: unit.fingerprintToken, operationId: op("report"), reportJson: report(runId, "TRACE", { entryId: unit.id, traceHash: state.units[unit.id].artifactHash }, reportFingerprints) }, agents.TRACE);
    await commitUnit(root, { runId, entryId: unit.id, workerId: "validator", batchId: validationClaim.batchId, fingerprintToken: unit.fingerprintToken, status: "VERIFIED", reportId: accepted.reportId, operationId: op("verify") });
  }
  await close(runId, validationClaim, fingerprints);
  const publishClaim = await claimBatch(root, { runId, workerId: "publisher", operationId: op("claim"), ...fingerprints });
  for (const unit of publishClaim.units) await commitUnit(root, { runId, entryId: unit.id, workerId: "publisher", batchId: publishClaim.batchId, fingerprintToken: unit.fingerprintToken, status: "PUBLISHED", documentContent: `# ${unit.id}\n`, operationId: op("publish") });
  await close(runId, publishClaim, fingerprints);
  const config = await submitReport(root, { runId, kind: "CONFIG", operationId: op("config"), reportJson: report(runId, "CONFIG", {}, reportFingerprints) }, agents.CONFIG);
  const coverage = await submitReport(root, { runId, kind: "COVERAGE", operationId: op("coverage"), reportJson: report(runId, "COVERAGE", {}, reportFingerprints) }, agents.COVERAGE);
  const boundary = await submitReport(root, { runId, kind: "BOUNDARY", operationId: op("boundary"), reportJson: report(runId, "BOUNDARY", {}, reportFingerprints) }, agents.BOUNDARY);
  const graphBuildInput = { runId, operationId: op("graph-build"), ...fingerprints };
  const graph = await buildGraphSnapshot(root, graphBuildInput);
  assert.deepEqual(await buildGraphSnapshot(root, graphBuildInput), graph, "构图重试必须幂等");
  await controlRun(root, { runId, action: "COMPLETE", operationId: op("complete"), configReportId: config.reportId, coverageReportId: coverage.reportId, boundaryReportId: boundary.reportId, ...fingerprints });
  return graph;
}

await initRun(root, { runId: "run-main", ...fp });
await planRun(root, { runId: "run-main", entriesJson: JSON.stringify([
  { id: "order-http-get", service: "order", adapter: "SPRING_MVC", target: "GET /orders", contextIds: ["prod-cn"] },
  { id: "billing-jms", service: "order", adapter: "JMS_STATIC_LISTENER", target: "billing.request", subscription: "billing-worker", deliverySemantics: "DIRECT", contextIds: ["prod-cn"] },
  { id: "kafka-a1", service: "order", adapter: "KAFKA_LISTENER", target: "main:orders", consumerGroup: "group-a", contextIds: ["prod-cn"] },
  { id: "kafka-a2", service: "order", adapter: "KAFKA_LISTENER", target: "main:orders", consumerGroup: "group-a", contextIds: ["prod-cn"] },
  { id: "kafka-b", service: "order", adapter: "KAFKA_LISTENER", target: "main:orders", consumerGroup: "group-b", contextIds: ["prod-cn"] },
  { id: "kafka-c", service: "order", adapter: "KAFKA_LISTENER", target: "main:orders", consumerGroup: "group-c", contextIds: ["prod-cn"] },
]), operationId: op("plan"), ...fp });
const graph = await publishRun("run-main");
assert(graph.topologyRootHash && graph.topologyNodeCount >= 5 && graph.topologyEdgeCount >= 4);
const mainManifest = JSON.parse(await readFile(join(root, "docs/spring-business/snapshots/run-main/manifest.json"), "utf8"));
assert(mainManifest.entrypoints.every((entry) => entry.kind !== "UNKNOWN"), "正式manifest不得丢失入口adapter类型");
assert.equal(mainManifest.entrypoints.find((entry) => entry.id === "order-http-get").kind, "SPRING_MVC");
assert.equal(mainManifest.entrypoints.find((entry) => entry.id === "billing-jms").kind, "JMS_STATIC_LISTENER");
assert.equal(mainManifest.services.find((service) => service.id === "order").root, "modules/order-service", "manifest必须保留真实服务相对根目录");
assert.equal((await queryGraphSnapshot(root, { runId: "run-main", query: "node", key: "order-http-get:service", limit: 10 })).rows[0].id, "order-http-get:service");
assert.equal((await queryGraphSnapshot(root, { runId: "run-main", query: "entry", key: "order-http-get", limit: 10 })).total, 2);
assert.equal((await queryGraphSnapshot(root, { runId: "run-main", query: "table", key: "db:main:table:sales.orders", limit: 10 })).total, 6);
assert.equal((await queryGraphSnapshot(root, { runId: "run-main", query: "service", key: "order", limit: 100 })).total, 12);
const graphPath = await queryGraphSnapshot(root, { runId: "run-main", query: "path", key: "order-http-get:controller", target: "db:main:table:sales.orders", mode: "STRICT_ENTRY", limit: 10 });
assert.equal(graphPath.paths[0].edgeIds.length, 2);

const legacyNodesPath = join(root, "docs/spring-business/snapshots/run-main/graph/nodes.jsonl");
const originalLegacyNodes = await readFile(legacyNodesPath);
const externalLegacyNodes = join(root, "legacy-nodes-hardlink.jsonl");
await writeFile(externalLegacyNodes, originalLegacyNodes);
await unlink(legacyNodesPath);
await link(externalLegacyNodes, legacyNodesPath);
await rejects(() => queryGraphSnapshot(root, { runId: "run-main", query: "node", key: "order-http-get:service", limit: 10 }), "多硬链");
await unlink(legacyNodesPath);
await writeFile(legacyNodesPath, originalLegacyNodes);
const node = await queryTopologySnapshot(root, { runId: "current", query: "node", key: "service:order", limit: 10 });
assert.equal(node.rows[0].type, "SERVICE");
const endpoint = await queryTopologySnapshot(root, { runId: "current", query: "node", key: "http-endpoint:order-http-get", limit: 10 });
assert.equal(endpoint.rows[0].type, "HTTP_ENDPOINT");
const jmsChannel = await queryTopologySnapshot(root, { runId: "current", query: "node", key: "channel:jms:billing.request", limit: 10 });
assert.equal(jmsChannel.rows[0].type, "MESSAGE_CHANNEL");
const jmsSubscription = await queryTopologySnapshot(root, { runId: "current", query: "node", key: "subscription:jms:billing.request:billing-worker", limit: 10 });
assert.equal(jmsSubscription.rows[0].type, "MESSAGE_SUBSCRIPTION");
const jmsNeighbors = await queryTopologySnapshot(root, { runId: "current", query: "neighbors", key: "subscription:jms:billing.request:billing-worker", direction: "out", limit: 10 });
assert(jmsNeighbors.rows.some((row) => row.type === "CONSUMES" && row.to === "entry:billing-jms"));
const kafkaCompeting = await queryTopologySnapshot(root, { runId: "current", query: "neighbors", key: "subscription:kafka:main:orders:group-a", direction: "out", limit: 10 });
assert.equal(kafkaCompeting.rows.length, 2);
assert(kafkaCompeting.rows.every((row) => row.type === "CONSUMES" && row.assurance === "POTENTIAL"));
for (const group of ["group-b", "group-c"]) {
  const fanout = await queryTopologySnapshot(root, { runId: "current", query: "neighbors", key: `subscription:kafka:main:orders:${group}`, direction: "out", limit: 10 });
  assert.equal(fanout.rows.length, 1);
  assert.equal(fanout.rows[0].assurance, "VERIFIED");
}
const explain = await queryTopologySnapshot(root, { runId: "current", query: "explain", key: "order-http-get:service", limit: 10 });
assert(explain.rows[0].provenance.some((row) => row.sourceKind === "CODE_GRAPH" || row.sourceKind === "PERSISTENCE_ADAPTER"));
assert(explain.rows[0].provenance.filter((row) => ["CODE_GRAPH", "PERSISTENCE_ADAPTER"].includes(row.sourceKind)).every((row) => row.validatorReportHashes.length > 0));
const explainPage1 = await queryTopologySnapshot(root, { runId: "current", query: "explain", key: "order-http-get:service", limit: 1 });
assert.equal(explainPage1.rows[0].edges.length, 1);
assert.equal(explainPage1.cutoffReason, "PAGE_LIMIT");
const explainPage2 = await queryTopologySnapshot(root, { runId: "current", query: "explain", key: "order-http-get:service", limit: 1, cursor: explainPage1.cursor });
assert.equal(explainPage2.rows[0].edges.length, 1);
const neighborsPage1 = await queryTopologySnapshot(root, { runId: "current", query: "neighbors", key: "order-http-get:service", limit: 1 });
assert.equal(neighborsPage1.complete, false);
assert.equal(neighborsPage1.cutoffReason, "PAGE_LIMIT");
assert(neighborsPage1.cursor);
const neighborsPage2 = await queryTopologySnapshot(root, { runId: "current", query: "neighbors", key: "order-http-get:service", limit: 1, cursor: neighborsPage1.cursor });
assert.equal(neighborsPage2.returnedCount, 1);
const currentPath = join(root, "docs/spring-business/current.json");
const currentPointer = JSON.parse(await readFile(currentPath, "utf8"));
await writeFile(currentPath, JSON.stringify({ ...currentPointer, indexHash: "sha256:tampered" }));
await rejects(() => queryTopologySnapshot(root, { runId: "current", query: "node", key: "service:order", limit: 1 }), "V2拓扑缺少COMPLETE自洽完整性根");
await writeFile(currentPath, JSON.stringify(currentPointer));

const baseline = await statusRun(root, "run-main");
const incrementalResolution = structuredClone(resolution);
incrementalResolution.contexts[0].values.find((row) => row.key === "billing.queue").valueHash = `sha256:${"b".repeat(64)}`;
incrementalResolution.resolutionContextHash = `sha256:${"c".repeat(64)}`;
const incrementalFp = { ...fp, resolutionContextHash: incrementalResolution.resolutionContextHash, resolutionSummary: incrementalResolution };
const incrementalReportFp = { ...reportFp, resolvedConfig: incrementalFp.resolutionContextHash };
await initRun(root, { runId: "run-incremental", mode: "INCREMENTAL", baseRunId: "run-main", ...incrementalFp });
await planRun(root, { runId: "run-incremental", entriesJson: JSON.stringify([{ id: "order-http-get", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }]), operationId: op("plan-inc"), ...incrementalFp });
const incrementalSets = { baseRunId: "run-main", baseGraphHash: baseline.graphHash, baseManifestHash: baseline.manifestHash, changedServices: [], changedConfigKeys: ["prod-cn:billing.queue"], reusableEntryIds: [], affectedEntryIds: ["order-http-get"], newEntryIds: [], tombstonedEntryIds: ["billing-jms", "kafka-a1", "kafka-a2", "kafka-b", "kafka-c"], workQueueEntryIds: ["order-http-get"] };
const unbound = await submitReport(root, { runId: "run-incremental", kind: "INCREMENTAL", operationId: op("inc-report-bad"), reportJson: report("run-incremental", "INCREMENTAL", incrementalSets, incrementalReportFp) }, agents.INCREMENTAL);
await rejects(() => seedIncrementalRun(root, { runId: "run-incremental", reportId: unbound.reportId, operationId: op("seed-bad"), ...incrementalFp }), "topologyRootHash");
const bound = await submitReport(root, { runId: "run-incremental", kind: "INCREMENTAL", operationId: op("inc-report"), reportJson: report("run-incremental", "INCREMENTAL", { ...incrementalSets, baseTopologyRootHash: baseline.topologyRootHash }, incrementalReportFp) }, agents.INCREMENTAL);
const seedInput = { runId: "run-incremental", reportId: bound.reportId, operationId: op("seed"), ...incrementalFp };
const seeded = await seedIncrementalRun(root, seedInput);
assert.deepEqual(await seedIncrementalRun(root, seedInput), seeded, "增量seed重试必须幂等");
assert.deepEqual(seeded.changedConfigKeys, ["prod-cn:billing.queue"]);
assert.deepEqual(seeded.affectedEntryIds, ["order-http-get"]);
await publishRun("run-incremental", incrementalFp, incrementalReportFp);
const incrementalComplete = await statusRun(root, "run-incremental");
const removedEntries = ["billing-jms", "kafka-a1", "kafka-a2", "kafka-b", "kafka-c"];
const expectedRemovedNodes = removedEntries.flatMap((id) => [`${id}:controller`, `${id}:service`]).sort();
const parseJsonl = (text) => text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const baselineEdges = parseJsonl(await readFile(join(root, "docs/spring-business/snapshots/run-main/graph/edges.jsonl"), "utf8"));
const incrementalEdges = new Set(parseJsonl(await readFile(join(root, "docs/spring-business/snapshots/run-incremental/graph/edges.jsonl"), "utf8")).map((edge) => edge.id));
const expectedRemovedEdges = baselineEdges.filter((edge) => !incrementalEdges.has(edge.id)).map((edge) => edge.id).sort();
assert.equal(expectedRemovedEdges.length, 10);
assert(baselineEdges.filter((edge) => expectedRemovedEdges.includes(edge.id)).every((edge) => edge.entryMembership.every((id) => removedEntries.includes(id))));
assert.deepEqual(incrementalComplete.tombstones.nodeIds, expectedRemovedNodes, "增量删除的node tombstone必须精确持久化");
assert.deepEqual(incrementalComplete.tombstones.edgeIds, expectedRemovedEdges, "增量删除的edge tombstone必须精确持久化");
assert.deepEqual(incrementalComplete.graphDelta.removedNodeIds, expectedRemovedNodes);
assert.deepEqual(incrementalComplete.graphDelta.removedEdgeIds, expectedRemovedEdges);
const incrementalManifest = JSON.parse(await readFile(join(root, "docs/spring-business/snapshots/run-incremental/manifest.json"), "utf8"));
assert.deepEqual(incrementalManifest.tombstones.nodeIds, expectedRemovedNodes);
assert.deepEqual(incrementalManifest.tombstones.edgeIds, expectedRemovedEdges);
const boundedDiff = await diffGraphSnapshots(root, { fromRunId: "run-main", toRunId: "run-incremental", limit: 1 });
assert.equal(boundedDiff.nodes.counts.removed, expectedRemovedNodes.length);
assert.equal(boundedDiff.nodes.rows.length, 1);
assert.equal(boundedDiff.nodes.truncated, true);

await initRun(root, { runId: "run-unresolved-base", ...fp });
await planRun(root, { runId: "run-unresolved-base", entriesJson: JSON.stringify([{ id: "external-dependent", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }]), operationId: op("plan-unresolved"), ...fp });
await publishRun("run-unresolved-base", fp, reportFp, "dynamic.destination");
const unresolvedBase = await statusRun(root, "run-unresolved-base");
await initRun(root, { runId: "run-unresolved-inc", mode: "INCREMENTAL", baseRunId: "run-unresolved-base", ...fp });
await planRun(root, { runId: "run-unresolved-inc", entriesJson: JSON.stringify([{ id: "external-dependent", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }]), operationId: op("plan-unresolved-inc"), ...fp });
const unsafeReuse = {
  baseRunId: "run-unresolved-base", baseGraphHash: unresolvedBase.graphHash, baseManifestHash: unresolvedBase.manifestHash, baseTopologyRootHash: unresolvedBase.topologyRootHash,
  changedServices: [], changedConfigKeys: [], reusableEntryIds: ["external-dependent"], affectedEntryIds: [], newEntryIds: [], tombstonedEntryIds: [], workQueueEntryIds: [],
};
const unsafeReuseReport = await submitReport(root, { runId: "run-unresolved-inc", kind: "INCREMENTAL", operationId: op("unresolved-report"), reportJson: report("run-unresolved-inc", "INCREMENTAL", unsafeReuse) }, agents.INCREMENTAL);
await rejects(() => seedIncrementalRun(root, { runId: "run-unresolved-inc", reportId: unsafeReuseReport.reportId, operationId: op("unresolved-seed"), ...fp }), "保守失效集合不一致");

await initRun(root, { runId: "run-control", batchSize: 1, ...fp });
await planRun(root, { runId: "run-control", entriesJson: JSON.stringify([{ id: "control-entry", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }]), operationId: op("control-plan"), ...fp });
const pauseOperation = op("pause-idempotent");
const paused = await controlRun(root, { runId: "run-control", action: "PAUSE", operationId: pauseOperation });
assert.equal(paused.phase, "PAUSED");
assert.deepEqual(await controlRun(root, { runId: "run-control", action: "PAUSE", operationId: pauseOperation }), paused, "同operationId应返回幂等结果");
await rejects(() => controlRun(root, { runId: "run-control", action: "FAIL", operationId: pauseOperation }), "operationId已用于不同请求");
assert.equal((await controlRun(root, { runId: "run-control", action: "RESUME", operationId: op("resume"), ...fp })).phase, "PLANNED");
const controlClaim = await claimBatch(root, { runId: "run-control", workerId: "control-worker", operationId: op("control-claim"), leaseSeconds: 30, ...fp });
const heartbeatOperation = op("heartbeat");
const heartbeat = await heartbeatBatch(root, { runId: "run-control", batchId: controlClaim.batchId, batchToken: controlClaim.batchToken, workerId: "control-worker", operationId: heartbeatOperation, leaseSeconds: 60 });
assert.equal(heartbeat.extended, 1);
assert.deepEqual(await heartbeatBatch(root, { runId: "run-control", batchId: controlClaim.batchId, batchToken: controlClaim.batchToken, workerId: "control-worker", operationId: heartbeatOperation, leaseSeconds: 60 }), heartbeat);
assert.equal((await controlRun(root, { runId: "run-control", action: "PAUSE", operationId: op("pause-active") })).phase, "PAUSE_REQUESTED");
await commitUnit(root, { runId: "run-control", entryId: "control-entry", workerId: "control-worker", batchId: controlClaim.batchId, fingerprintToken: controlClaim.units[0].fingerprintToken, status: "TRACED", traceResultJson: trace("run-control", "control-entry"), operationId: op("control-trace") });
const closedControl = await closeBatch(root, { runId: "run-control", batchId: controlClaim.batchId, batchToken: controlClaim.batchToken, operationId: op("control-close"), ...fp });
assert.equal(closedControl.phase, "PAUSED");
assert.equal((await controlRun(root, { runId: "run-control", action: "RESUME", operationId: op("resume-active"), ...fp })).phase, "TRACING");

await initRun(root, { runId: "run-recover", batchSize: 1, ...fp });
await planRun(root, { runId: "run-recover", entriesJson: JSON.stringify([{ id: "recover-entry", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }]), operationId: op("recover-plan"), ...fp });
const recoverClaim = await claimBatch(root, { runId: "run-recover", workerId: "crashed-worker", operationId: op("recover-claim"), ...fp });
const recoverStatePath = join(root, ".opencode/.cache/spring-business-tracer/runs/run-recover/run.json");
const recoverState = JSON.parse(await readFile(recoverStatePath, "utf8"));
recoverState.units["recover-entry"].leaseUntil = "2000-01-01T00:00:00.000Z";
await writeFile(recoverStatePath, JSON.stringify(recoverState, null, 2));
const recoverInput = { runId: "run-recover", operationId: op("recover"), ...fp };
const recovered = await recoverRun(root, recoverInput);
assert.deepEqual(await recoverRun(root, recoverInput), recovered, "恢复重试必须幂等");
assert.equal(recovered.recovered, 1);
assert.equal(recovered.closedBatches, 1);
assert.equal((await statusRun(root, "run-recover")).units["recover-entry"].status, "RETRYABLE_FAILED");
assert.equal((await claimBatch(root, { runId: "run-recover", workerId: "replacement-worker", operationId: op("recover-reclaim"), ...fp })).units[0].leaseStage, "TRACE");

await initRun(root, { runId: "run-stale", ...fp });
await planRun(root, { runId: "run-stale", entriesJson: JSON.stringify([{ id: "stale-entry", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }]), operationId: op("stale-plan"), ...fp });
await controlRun(root, { runId: "run-stale", action: "PAUSE", operationId: op("stale-pause") });
await rejects(() => controlRun(root, { runId: "run-stale", action: "RESUME", operationId: op("stale-resume"), ...fp, sourceSnapshot: "changed-source" }), "状态标记为STALE");
assert.equal((await statusRun(root, "run-stale")).phase, "STALE");

await initRun(root, { runId: "run-fail", ...fp });
assert.equal((await controlRun(root, { runId: "run-fail", action: "FAIL", operationId: op("fail") })).phase, "FAILED");

await initRun(root, { runId: "run-partial", batchSize: 1, ...fp });
await planRun(root, { runId: "run-partial", entriesJson: JSON.stringify([
  { id: "a-published", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] },
  { id: "b-blocked", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] },
]), operationId: op("partial-plan"), ...fp });
const partialTrace = await claimBatch(root, { runId: "run-partial", workerId: "partial-trace", operationId: op("partial-claim-trace"), limit: 1, ...fp });
await commitUnit(root, { runId: "run-partial", entryId: "a-published", workerId: "partial-trace", batchId: partialTrace.batchId, fingerprintToken: partialTrace.units[0].fingerprintToken, status: "TRACED", traceResultJson: trace("run-partial", "a-published"), operationId: op("partial-trace") });
await closeBatch(root, { runId: "run-partial", batchId: partialTrace.batchId, batchToken: partialTrace.batchToken, operationId: op("partial-close-trace"), ...fp });
const partialValidate = await claimBatch(root, { runId: "run-partial", workerId: "partial-validator", operationId: op("partial-claim-validate"), limit: 1, ...fp });
const partialState = await statusRun(root, "run-partial");
const partialReport = await submitReport(root, { runId: "run-partial", kind: "TRACE", entryId: "a-published", batchToken: partialValidate.units[0].fingerprintToken, operationId: op("partial-report"), reportJson: report("run-partial", "TRACE", { entryId: "a-published", traceHash: partialState.units["a-published"].artifactHash }) }, agents.TRACE);
await commitUnit(root, { runId: "run-partial", entryId: "a-published", workerId: "partial-validator", batchId: partialValidate.batchId, fingerprintToken: partialValidate.units[0].fingerprintToken, status: "VERIFIED", reportId: partialReport.reportId, operationId: op("partial-verify") });
await closeBatch(root, { runId: "run-partial", batchId: partialValidate.batchId, batchToken: partialValidate.batchToken, operationId: op("partial-close-validate"), ...fp });
const partialPublish = await claimBatch(root, { runId: "run-partial", workerId: "partial-publisher", operationId: op("partial-claim-publish"), limit: 1, ...fp });
await commitUnit(root, { runId: "run-partial", entryId: "a-published", workerId: "partial-publisher", batchId: partialPublish.batchId, fingerprintToken: partialPublish.units[0].fingerprintToken, status: "PUBLISHED", documentContent: "# partial\n", operationId: op("partial-publish") });
await closeBatch(root, { runId: "run-partial", batchId: partialPublish.batchId, batchToken: partialPublish.batchToken, operationId: op("partial-close-publish"), ...fp });
const partialBlocked = await claimBatch(root, { runId: "run-partial", workerId: "partial-blocker", operationId: op("partial-claim-blocked"), limit: 1, ...fp });
await commitUnit(root, { runId: "run-partial", entryId: "b-blocked", workerId: "partial-blocker", batchId: partialBlocked.batchId, fingerprintToken: partialBlocked.units[0].fingerprintToken, status: "BLOCKED", errorCode: "STATIC_EVIDENCE_INSUFFICIENT", operationId: op("partial-blocked") });
await closeBatch(root, { runId: "run-partial", batchId: partialBlocked.batchId, batchToken: partialBlocked.batchToken, operationId: op("partial-close-blocked"), ...fp });
assert.equal((await controlRun(root, { runId: "run-partial", action: "PARTIAL", operationId: op("partial"), ...fp })).phase, "PARTIAL");

const syntheticGraph = {
  nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
  edges: [
    { id: "AB", type: "JAVA_CALL", from: "A", to: "B", entryMembership: ["one"] },
    { id: "BC", type: "JAVA_CALL", from: "B", to: "C", entryMembership: ["two"] },
  ],
};
assert.equal(findSnapshotPaths(syntheticGraph, { key: "A", target: "C", mode: "STRICT_ENTRY" }).paths.length, 0);
const composedPath = findSnapshotPaths(syntheticGraph, { key: "A", target: "C", mode: "COMPOSED" }).paths[0];
assert.equal(composedPath.potential, true);
assert(composedPath.potentialReasons.includes("COMPOSED_CROSS_ENTRY"));

const topology = createTopology({ contextIds: ["prod-cn"], serviceSnapshots: { order: "x" }, units: {} }, [{ id: "publisher", type: "SYMBOL", entryMembership: ["e"], services: ["order"] }, { id: "listener", type: "SYMBOL", entryMembership: ["e"], services: ["worker"] }], [{ id: "legacy", type: "LOGICAL_BOUNDARY", from: "publisher", to: "listener", entryMembership: ["e"], services: ["order", "worker"], evidence: { kind: "KAFKA", channelKey: "main:orders", consumerGroup: "workers", deliverySemantics: "COMPETING_ONE_OF" } }]);
assert(topology.nodes.some((row) => row.type === "MESSAGE_CHANNEL") && topology.nodes.some((row) => row.type === "MESSAGE_SUBSCRIPTION"));
assert.deepEqual(topology.edges.filter((row) => ["PUBLISHES", "DELIVERS_TO", "CONSUMES"].includes(row.type)).map((row) => row.type).sort(), ["CONSUMES", "DELIVERS_TO", "PUBLISHES"]);
const surfaces = createTopology({ contextIds: ["prod-cn"], serviceSnapshots: { ingress: "x" }, units: {
  graph: { id: "graph", service: "ingress", adapter: "GRAPHQL_ANNOTATED_ROOT", target: "Query.order", validationHash: `sha256:${"1".repeat(64)}`, traceResult: { topologyFacts: [] } },
  quartz: { id: "quartz", service: "ingress", adapter: "QUARTZ_STATIC_JOB_TRIGGER", target: "reconcile", validationHash: `sha256:${"2".repeat(64)}`, traceResult: { topologyFacts: [] } },
  grpc: { id: "grpc", service: "ingress", adapter: "GRPC_UNARY_PROTO", target: "acme.Order/Find", validationHash: `sha256:${"3".repeat(64)}`, traceResult: { topologyFacts: [] } },
  jms: { id: "jms", service: "ingress", adapter: "JMS_STATIC_LISTENER", target: "billing.request", subscription: "billing-worker", validationHash: `sha256:${"4".repeat(64)}`, traceResult: { topologyFacts: [] } },
} }, [], []);
assert(["GRAPHQL_OPERATION", "JOB_TRIGGER", "RPC_OPERATION", "MESSAGE_CHANNEL", "MESSAGE_SUBSCRIPTION"].every((type) => surfaces.nodes.some((row) => row.type === type)));
assert(surfaces.edges.some((row) => row.type === "TRIGGERS"));
assert(surfaces.edges.some((row) => row.type === "CONSUMES" && row.to === "entry:jms"));
assert.throws(() => createTopology({ contextIds: ["prod-cn"], units: { bad: { id: "bad", service: "ingress", adapter: "SPRING_MVC", validationHash: "hash", traceResult: { topologyFacts: [{ type: "ARBITRARY", from: "entry:bad", to: "entry:bad", assurance: "VERIFIED", provenance: {} }] } } } }, [], []), /TOPOLOGY_FACT_INVALID/);
const cursor = graphTest.cursorFor(hashLike(graph.topologyRootHash), "query", 10);
function hashLike(value) { return value; }
assert.equal(graphTest.parseCursor(cursor, graph.topologyRootHash, "query"), 10);
await assert.rejects(async () => graphTest.parseCursor(cursor, "sha256:changed", "query"));

const migrationRoot = await mkdtemp(join(tmpdir(), "spring-migrate-v20-"));
await mkdir(join(migrationRoot, ".opencode"), { recursive: true });
const oldConfig = JSON.parse(await readFile(new URL("../../spring-business-tracer-workspace/iteration-5/v15-snapshot/spring-business-tracer.json", import.meta.url), "utf8"));
await writeFile(join(migrationRoot, ".opencode/spring-business-tracer.json"), JSON.stringify(oldConfig));
const dry = await migrateConfiguration(migrationRoot, {});
assert.equal(dry.status, "DRY_RUN");
assert.equal(dry.migrated.version, "2.0.0");
assert.equal(dry.migrated.graph.formatVersion, 2);
assert(dry.migrated.verification.validators.includes("config"));
assert.equal((await migrateConfiguration(migrationRoot, { apply: true })).status, "APPLIED");
assert.equal((await migrateConfiguration(migrationRoot, { apply: true })).status, "NOOP");

await rejects(() => initRun(root, { runId: "missing-context", ...fp, resolutionContextHash: "" }), "指纹");
await initRun(root, { runId: "input-limits", ...fp });
await rejects(() => planRun(root, { runId: "input-limits", entriesJson: `["${"x".repeat(8 * 1024 * 1024)}"]`, operationId: op("oversize-plan"), ...fp }), "entriesJson超过8MiB上限");
assert.equal((await statusRun(root, "input-limits")).phase, "CREATED");
await rejects(() => planRun(root, { runId: "input-limits", entriesJson: JSON.stringify([{ id: "bad-context", service: "order", adapter: "SPRING_MVC", contextIds: [{}] }]), operationId: op("bad-plan"), ...fp }), "contextIds非法");
assert.equal((await statusRun(root, "input-limits")).phase, "CREATED");

await initRun(root, { runId: "run-codegraph-evidence", batchSize: 1, ...fp });
await planRun(root, { runId: "run-codegraph-evidence", entriesJson: JSON.stringify([{ id: "evidence-entry", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }]), operationId: op("evidence-plan"), ...fp });
const evidenceClaim = await claimBatch(root, { runId: "run-codegraph-evidence", workerId: "evidence-worker", operationId: op("evidence-claim"), ...fp });
const evidenceCommit = (payload) => commitUnit(root, { runId: "run-codegraph-evidence", entryId: "evidence-entry", workerId: "evidence-worker", batchId: evidenceClaim.batchId, fingerprintToken: evidenceClaim.units[0].fingerprintToken, status: "TRACED", traceResultJson: JSON.stringify(payload), operationId: op("evidence-commit") });
const fakeLog = JSON.parse(trace("run-codegraph-evidence", "evidence-entry"));
fakeLog.queryLog[0].tool = "grep";
await rejects(() => evidenceCommit(fakeLog), "Code Graph");
const fakeJava = JSON.parse(trace("run-codegraph-evidence", "evidence-entry"));
fakeJava.javaEdges[0].tool = "grep";
await rejects(() => evidenceCommit(fakeJava), "Code Graph");
const fakeSpecial = JSON.parse(trace("run-codegraph-evidence", "evidence-entry"));
fakeSpecial.specialEdges = [{ from: "a", to: "b", kind: "FRAMEWORK", tool: "grep", query: { limit: 101 } }];
await rejects(() => evidenceCommit(fakeSpecial), "Code Graph");
await evidenceCommit(JSON.parse(trace("run-codegraph-evidence", "evidence-entry")));

const tamperRoot = await mkdtemp(join(tmpdir(), "spring-topology-tamper-v20-"));
const tamperMeta = await writeTopologyBundle(tamperRoot, { contextIds: ["prod-cn"], serviceSnapshots: { order: "x" }, units: {} }, [{ id: "A", type: "SYMBOL", entryMembership: [], services: ["order"] }], []);
assert.equal((await verifyTopologyBundle(tamperRoot)).topologyRootHash, tamperMeta.topologyRootHash);
assert.equal((await queryTopologyBundle(tamperRoot, { query: "node", key: "A", limit: 1 })).rows[0].id, "A");
const shard = tamperMeta.files.find((row) => row.path === `nodes/${graphTest.prefixOf("A")}.jsonl`);
const shardPath = join(tamperRoot, "v2", shard.path);
const originalShard = await readFile(shardPath);
await writeFile(join(tamperRoot, "v2", shard.path), "{\"tampered\":true}\n");
await rejects(() => verifyTopologyBundle(tamperRoot), "TOPOLOGY_SHARD_HASH_MISMATCH");
await rejects(() => queryTopologyBundle(tamperRoot, { query: "node", key: "A", limit: 1 }), "TOPOLOGY_SHARD_HASH_MISMATCH");
const outsideShard = join(tamperRoot, "outside-identical.jsonl");
await writeFile(outsideShard, originalShard);
await unlink(shardPath);
await symlink(outsideShard, shardPath);
await rejects(() => verifyTopologyBundle(tamperRoot), "TOPOLOGY_FILE_UNSAFE");
await rejects(() => queryTopologyBundle(tamperRoot, { query: "node", key: "A", limit: 1 }), "TOPOLOGY_FILE_UNSAFE");
await unlink(shardPath);
await writeFile(shardPath, originalShard);
await truncate(shardPath, 8 * 1024 * 1024 + 1);
await rejects(() => verifyTopologyBundle(tamperRoot), "TOPOLOGY_FILE_TOO_LARGE");
await rejects(() => queryTopologyBundle(tamperRoot, { query: "node", key: "A", limit: 1 }), "TOPOLOGY_FILE_TOO_LARGE");
const unsafeWriteRoot = await mkdtemp(join(tmpdir(), "spring-topology-write-v20-"));
const outsideDirectory = await mkdtemp(join(tmpdir(), "spring-topology-outside-v20-"));
await mkdir(join(unsafeWriteRoot, "v2"));
await symlink(outsideDirectory, join(unsafeWriteRoot, "v2/nodes"));
await rejects(() => writeTopologyBundle(unsafeWriteRoot, { contextIds: ["prod-cn"], units: {} }, [{ id: "unsafe", type: "SYMBOL", entryMembership: [], services: [] }], []), "TOPOLOGY_DIRECTORY_UNSAFE");

const parentSymlinkRoot = await mkdtemp(join(tmpdir(), "spring-topology-parent-link-v20-"));
const parentMeta = await writeTopologyBundle(parentSymlinkRoot, { contextIds: ["prod-cn"], units: {} }, [{ id: "parent-link", type: "SYMBOL", entryMembership: [], services: [] }], []);
const movedNodes = join(parentSymlinkRoot, "outside-nodes");
await rename(join(parentSymlinkRoot, "v2/nodes"), movedNodes);
await symlink(movedNodes, join(parentSymlinkRoot, "v2/nodes"));
await rejects(() => verifyTopologyBundle(parentSymlinkRoot), "TOPOLOGY_DIRECTORY_UNSAFE");
await rejects(() => queryTopologyBundle(parentSymlinkRoot, { query: "node", key: "parent-link", limit: 1 }), "TOPOLOGY_DIRECTORY_UNSAFE");
assert(parentMeta.topologyRootHash);

const rootSymlinkRoot = await mkdtemp(join(tmpdir(), "spring-topology-root-link-v20-"));
await writeTopologyBundle(rootSymlinkRoot, { contextIds: ["prod-cn"], units: {} }, [{ id: "root-link", type: "SYMBOL", entryMembership: [], services: [] }], []);
const movedV2 = join(rootSymlinkRoot, "outside-v2");
await rename(join(rootSymlinkRoot, "v2"), movedV2);
await symlink(movedV2, join(rootSymlinkRoot, "v2"));
await rejects(() => verifyTopologyBundle(rootSymlinkRoot), "TOPOLOGY_DIRECTORY_UNSAFE");
await rejects(() => queryTopologyBundle(rootSymlinkRoot, { query: "node", key: "root-link", limit: 1 }), "TOPOLOGY_DIRECTORY_UNSAFE");

const hardlinkReadRoot = await mkdtemp(join(tmpdir(), "spring-topology-hardlink-read-v20-"));
const hardlinkReadMeta = await writeTopologyBundle(hardlinkReadRoot, { contextIds: ["prod-cn"], units: {} }, [{ id: "hardlink-read", type: "SYMBOL", entryMembership: [], services: [] }], []);
const hardlinkReadShard = hardlinkReadMeta.files.find((row) => row.path.startsWith("nodes/"));
const hardlinkReadPath = join(hardlinkReadRoot, "v2", hardlinkReadShard.path);
const externalHardlinkFile = join(hardlinkReadRoot, "external-hardlink.jsonl");
await writeFile(externalHardlinkFile, await readFile(hardlinkReadPath));
await unlink(hardlinkReadPath);
await link(externalHardlinkFile, hardlinkReadPath);
await rejects(() => verifyTopologyBundle(hardlinkReadRoot), "TOPOLOGY_FILE_UNSAFE");
await rejects(() => queryTopologyBundle(hardlinkReadRoot, { query: "node", key: "hardlink-read", limit: 1 }), "TOPOLOGY_FILE_UNSAFE");

const hardlinkWriteRoot = await mkdtemp(join(tmpdir(), "spring-topology-hardlink-write-v20-"));
await mkdir(join(hardlinkWriteRoot, "v2"));
await mkdir(join(hardlinkWriteRoot, "v2/nodes"));
const externalSentinel = join(hardlinkWriteRoot, "outside-sentinel.txt");
await writeFile(externalSentinel, "outside-must-remain-unchanged");
const hardlinkTarget = join(hardlinkWriteRoot, "v2/nodes", `${graphTest.prefixOf("hardlink-write")}.jsonl`);
await link(externalSentinel, hardlinkTarget);
await writeTopologyBundle(hardlinkWriteRoot, { contextIds: ["prod-cn"], units: {} }, [{ id: "hardlink-write", type: "SYMBOL", entryMembership: [], services: [] }], []);
assert.equal(await readFile(externalSentinel, "utf8"), "outside-must-remain-unchanged");
assert.equal((await queryTopologyBundle(hardlinkWriteRoot, { query: "node", key: "hardlink-write", limit: 1 })).rows[0].id, "hardlink-write");
console.log("PASS: V2.0的18工具、配置/脱敏、Code Graph证据、状态全生命周期、provenance、增量/tombstone、有界diff、安全I/O与V1.5迁移动态测试");
