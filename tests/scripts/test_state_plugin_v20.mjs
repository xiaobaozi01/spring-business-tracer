#!/usr/bin/env node
import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, realpath, rename, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import SpringBusinessStatePlugin from "../../.opencode/plugins/spring-business-state.js";
import { resolveAnalysisContexts } from "../../.opencode/plugins/spring-business/config-resolver.js";
import { createTopology, queryTopologyBundle, verifyTopologyBundle, writeTopologyBundle, __test as graphTest } from "../../.opencode/plugins/spring-business/graph-v2.js";

const { assertConfigurationSemantics, assertSafeConfigAgent, buildGraphSnapshot, claimBatch, claimDiscovery, closeBatch, commitDiscovery, commitUnit, computeWorkspaceFingerprints, controlRun, diffGraphSnapshots, discoveryStatus, entryStorageKey, executeCodeGraph, findSnapshotPaths, getReportContext, heartbeatBatch, heartbeatDiscovery, initRun, planRun, queryGraphSnapshot, queryTopologySnapshot, recoverExpiredDiscoveryLeases, recoverRun, runCodeGraphQuery, seedIncrementalRun, statusRun, submitReport, summarizeWorkspaceFingerprints } = SpringBusinessStatePlugin.__test;
const pluginHooks = await SpringBusinessStatePlugin();
assert.deepEqual(Object.keys(pluginHooks.tool).sort(), [
  "codegraph_bounded_query",
  "spring_config_resolve", "spring_discovery_claim", "spring_discovery_commit", "spring_discovery_heartbeat", "spring_discovery_status", "spring_graph_build", "spring_graph_diff", "spring_graph_query", "spring_report_submit",
  "spring_report_context",
  "spring_state_claim", "spring_state_close_batch", "spring_state_commit", "spring_state_control", "spring_state_fingerprint", "spring_state_heartbeat",
  "spring_state_init", "spring_state_plan", "spring_state_recover", "spring_state_seed", "spring_state_status", "spring_topology_query",
].sort(), "V2插件必须完整暴露23个CodeGraph、报告上下文、状态、配置、发现和图工具");
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
  serviceSnapshots: { order: "order-v1" }, serviceRoots: { order: "modules/order-service" }, sharedModuleSnapshots: {}, sharedModuleRoots: {}, indexMetadata: { order: { projectPath: "order", version: "1.5.0", index: { builtWithVersion: "1.5.0", currentExtractionVersion: 24 }, languages: ["java"] } }, queryLimit: 101,
  batchingPolicy: { batchSize: 10, retryLimit: 2, discoveryLeaseSeconds: 7200, leaseSeconds: 5400, heartbeatSeconds: 300 },
};
const batching = { batchSize: 10, retryLimit: 2, discoveryLeaseSeconds: 3600, leaseSeconds: 3600, heartbeatSeconds: 300 };
assert.doesNotThrow(() => assertConfigurationSemantics({ analysis: { maxBranches: 100 }, codeGraph: { queryLimit: 101, executable: "codegraph" }, batching }));
assert.throws(() => assertConfigurationSemantics({ analysis: { maxBranches: 100 }, codeGraph: { queryLimit: 100 }, batching }), /CONFIG_QUERY_LIMIT_MISMATCH/);
const monorepoRoot = await mkdtemp(join(tmpdir(), "spring-monorepo-fingerprint-v20-"));
await mkdir(join(monorepoRoot, ".opencode"), { recursive: true });
await mkdir(join(monorepoRoot, "service-a/src/main/java"), { recursive: true });
await writeFile(join(monorepoRoot, "service-a/src/main/java/App.java"), "class App {}\n");
const monorepoConfig = {
  analysis: { maxBranches: 100 }, codeGraph: { queryLimit: 101 }, batching,
  workspace: { services: [{ id: "service-a", root: "service-a", packages: ["com.acme"], aliases: ["service-a"] }], sharedModules: [] },
  analysisContexts: { defaultContext: "default", definitions: [{ id: "default", activeProfiles: [], propertySources: [], optionalSources: true }] },
  configResolution: {}, adapterRegistry: {},
};
await writeFile(join(monorepoRoot, ".opencode/spring-business-tracer.json"), JSON.stringify(monorepoConfig));
await rejects(() => computeWorkspaceFingerprints(monorepoRoot, { codeGraphStatus: async () => ({}), codeGraphVersion: async () => "1.5.0" }), "codeGraphProjectPath");
monorepoConfig.workspace.services[0].codeGraphProjectPath = ".";
await writeFile(join(monorepoRoot, ".opencode/spring-business-tracer.json"), JSON.stringify(monorepoConfig));
const seenProjectPaths = [];
const monorepoFingerprint = await computeWorkspaceFingerprints(monorepoRoot, { codeGraphStatus: async (projectPath) => { seenProjectPaths.push(projectPath); return { projectPath }; }, codeGraphVersion: async () => "1.5.0" });
assert.deepEqual(seenProjectPaths, [await realpath(monorepoRoot)], "共用根索引必须按显式codeGraphProjectPath检查");
assert.equal(monorepoFingerprint.serviceRootCount, 1);
assert.deepEqual(monorepoFingerprint.batchingPolicy, batching);
const compactFingerprint = summarizeWorkspaceFingerprints(monorepoFingerprint);
assert.equal(compactFingerprint.indexProjects.length, 1);
assert(!("resolutionSummary" in compactFingerprint), "公开指纹结果不得返回完整配置明细");
const boundedCallees = await runCodeGraphQuery(monorepoRoot, { mode: "callees", query: "App.run", projectPath: ".", limit: 101 }, {
  execRunner: async (binary, args) => {
    assert.equal(binary, "codegraph");
    assert.deepEqual(args, ["callees", "App.run", "-p", await realpath(monorepoRoot), "-l", "101", "-j"]);
    return { stdout: JSON.stringify({ symbol: "App.run", callees: [{ name: "save", kind: "method", filePath: "App.java", startLine: 1 }] }), stderr: "" };
  },
});
assert.equal(boundedCallees.resultCount, 1);
assert.equal(boundedCallees.truncated, false);
assert.equal(boundedCallees.completionStatus, "EXPLICIT_COMPLETE");
const windowsResult = await executeCodeGraph(monorepoRoot, ["query", "A & B"], { codeGraph: { executable: "C:\\Tools\\codegraph.cmd" } }, {
  platform: "win32", powerShellExecutable: "powershell.exe",
  execRunner: async (binary, args, options) => {
    assert.equal(binary, "powershell.exe");
    assert(!args.join(" ").includes("A & B"), "用户查询不能拼接进PowerShell脚本");
    const payload = JSON.parse(Buffer.from(options.env.SPRING_BUSINESS_CODEGRAPH_INVOCATION, "base64").toString("utf8"));
    assert.deepEqual(payload, { executable: "C:\\Tools\\codegraph.cmd", arguments: ["query", "A & B"] });
    return { stdout: "ok", stderr: "" };
  },
});
assert.equal(windowsResult.stdout, "ok");
await rejects(() => executeCodeGraph(monorepoRoot, ["status"], { codeGraph: { executable: "codegraph" } }, {
  platform: "win32", execRunner: async () => { const error = new Error("CommandNotFoundException: codegraph"); error.code = 1; throw error; },
}), "CODEGRAPH_COMMAND_NOT_FOUND");
await rejects(() => runCodeGraphQuery(monorepoRoot, { mode: "callees", query: "method:deadbeef", projectPath: ".", limit: 101 }, {
  execRunner: async () => ({ stdout: "ℹ Symbol not found\n", stderr: "" }),
}), "qualifiedName");
const cutoffQuery = await runCodeGraphQuery(monorepoRoot, { mode: "query", query: "kind:route", projectPath: ".", limit: 101 }, {
  execRunner: async () => ({ stdout: JSON.stringify(Array.from({ length: 101 }, (_, id) => ({ id }))), stderr: "" }),
});
assert.equal(cutoffQuery.truncated, true);
assert.equal(cutoffQuery.completionStatus, "LIMIT_REACHED");
assert.equal(cutoffQuery.summaryOmittedCount, 1);
const expiredDiscovery = { retryLimit: 2, discovery: { units: { order: { serviceId: "order", status: "LEASED", attempts: 1, leaseUntil: "2000-01-01T00:00:00.000Z", leaseOwner: "worker", leaseToken: "token" } } } };
assert.equal(recoverExpiredDiscoveryLeases(expiredDiscovery), 1);
assert.equal(expiredDiscovery.discovery.units.order.status, "RETRYABLE_FAILED");
const reportFp = { config: fp.configHash, source: fp.sourceSnapshot, index: fp.indexFingerprint, toolkit: fp.toolkitFingerprint, resolvedConfig: fp.resolutionContextHash, adapterRegistry: fp.adapterRegistryFingerprint };
const unsupportedRunDirectory = join(root, ".opencode/.cache/spring-business-tracer/runs/run-unsupported-schema");
await mkdir(unsupportedRunDirectory, { recursive: true });
await writeFile(join(unsupportedRunDirectory, "run.json"), JSON.stringify({ schemaVersion: "1.5", runId: "run-unsupported-schema", units: {}, discovery: { units: {} }, events: [] }));
await rejects(() => statusRun(root, "run-unsupported-schema"), "RUN_SCHEMA_VERSION_UNSUPPORTED");
const inventory = (runId, totalEntries = 1) => ({
  schemaVersion: "2.0", runId, serviceId: "order", fingerprints: reportFp, totalEntries,
  adapters: [{ name: "SPRING_MVC", enabled: true, count: 1 }], excludedCandidates: [],
  entries: [{ id: "discovered-order-get", serviceId: "order", adapter: "SPRING_MVC", adapterDefinitionVersion: "2.0.0", contextIds: ["prod-cn"], conditions: [], visibility: "PUBLIC", trigger: "GET /orders", symbolId: "OrderController#get", signature: "get()", file: "OrderController.java", line: 10, codeGraphQuery: { limit: 101 }, beanActivation: { effective: true, evidence: [{ annotation: "RestController" }] } }],
  queryLog: [{ tool: "codegraph_callees", args: { limit: 101 }, purpose: "入口身份", resultCount: 1, truncated: false, completionStatus: "EXPLICIT_COMPLETE", summaryOmittedCount: 0 }],
});
const initIdempotencyInput = { runId: "run-init-idempotent", operationId: op("init-idempotent"), ...fp };
const initializedOnce = await initRun(root, initIdempotencyInput);
assert.deepEqual(await initRun(root, initIdempotencyInput), initializedOnce, "run初始化重试必须精确幂等");
const strictJournalPath = join(root, ".opencode/.cache/spring-business-tracer/runs/run-init-idempotent/run.json");
const strictJournalState = JSON.parse(await readFile(strictJournalPath, "utf8"));
delete strictJournalState.recentOperations[initIdempotencyInput.operationId].operationType;
await writeFile(strictJournalPath, JSON.stringify(strictJournalState, null, 2));
await rejects(() => initRun(root, initIdempotencyInput), "OPERATION_ID_CONFLICT");
await rejects(() => initRun(root, { ...initIdempotencyInput, retryLimit: 3 }), "OPERATION_ID_CONFLICT");
await initRun(root, { runId: "run-discovery", operationId: op("discovery-init"), ...fp });
const discoveryClaim = await claimDiscovery(root, { runId: "run-discovery", workerId: "entry-worker-1", operationId: op("discovery-claim"), ...fp });
assert.equal(discoveryClaim.units.length, 1);
assert.equal((Date.parse(discoveryClaim.units[0].leaseUntil) - Date.parse(discoveryClaim.serverNow)) / 1000, 7200, "发现租约必须使用run冻结配置");
assert.equal(discoveryClaim.units[0].submissionContext.runId, "run-discovery");
assert.equal(discoveryClaim.units[0].submissionContext.serviceId, "order");
assert.equal(discoveryClaim.units[0].submissionContext.preferredParameter, "inventory");
const discoveryHeartbeatOperation = op("discovery-heartbeat");
const discoveryHeartbeat = await heartbeatDiscovery(root, { runId: "run-discovery", serviceId: "order", workerId: "entry-worker-1", leaseToken: discoveryClaim.units[0].leaseToken, operationId: discoveryHeartbeatOperation });
assert.equal(discoveryHeartbeat.leaseSeconds, 7200);
assert.deepEqual(await heartbeatDiscovery(root, { runId: "run-discovery", serviceId: "order", workerId: "entry-worker-1", leaseToken: discoveryClaim.units[0].leaseToken, operationId: discoveryHeartbeatOperation }), discoveryHeartbeat);
await rejects(() => commitDiscovery(root, { runId: "run-discovery", serviceId: "order", workerId: "entry-worker-1", leaseToken: discoveryClaim.units[0].leaseToken, operationId: op("discovery-type-error"), status: "COMPLETE", inventory: [], ...fp }, "spring-entry-worker"), "STRUCTURED_INPUT_TYPE_MISMATCH");
const wrongRunInventory = structuredClone(inventory("wrong-run"));
await rejects(() => commitDiscovery(root, { runId: "run-discovery", serviceId: "order", workerId: "entry-worker-1", leaseToken: discoveryClaim.units[0].leaseToken, operationId: op("discovery-wrong-run"), status: "COMPLETE", inventory: wrongRunInventory, ...fp }, "spring-entry-worker"), "INVENTORY_RUN_ID_MISMATCH");
const wrongFingerprintInventory = structuredClone(inventory("run-discovery"));
wrongFingerprintInventory.fingerprints.source = "stale-source";
await rejects(() => commitDiscovery(root, { runId: "run-discovery", serviceId: "order", workerId: "entry-worker-1", leaseToken: discoveryClaim.units[0].leaseToken, operationId: op("discovery-wrong-fingerprint"), status: "COMPLETE", inventory: wrongFingerprintInventory, ...fp }, "spring-entry-worker"), "FINGERPRINT_MISMATCH");
await rejects(() => commitDiscovery(root, { runId: "run-discovery", serviceId: "order", workerId: "entry-worker-1", leaseToken: discoveryClaim.units[0].leaseToken, operationId: op("discovery-bad-count"), status: "COMPLETE", inventory: inventory("run-discovery", 62), ...fp }, "spring-entry-worker"), "totalEntries");
const structuredInventory = structuredClone(inventory("run-discovery"));
delete structuredInventory.schemaVersion; delete structuredInventory.runId; delete structuredInventory.serviceId; delete structuredInventory.fingerprints;
const discoveryStatePath = join(root, ".opencode/.cache/spring-business-tracer/runs/run-discovery/run.json");
const discoveryState = JSON.parse(await readFile(discoveryStatePath, "utf8"));
discoveryState.discovery.units.order.leaseUntil = "2000-01-01T00:00:00.000Z";
await writeFile(discoveryStatePath, JSON.stringify(discoveryState, null, 2));
const committedDiscovery = await commitDiscovery(root, { runId: "run-discovery", serviceId: "order", workerId: "entry-worker-1", leaseToken: discoveryClaim.units[0].leaseToken, operationId: op("discovery-commit"), status: "COMPLETE", inventory: structuredInventory, ...fp }, "spring-entry-worker");
assert.equal(committedDiscovery.entryCount, 1);
assert.equal(committedDiscovery.lease.lateCommitAccepted, true, "未被重新领取的迟到发现结果应由fencing token安全接收");
assert.deepEqual((await discoveryStatus(root, "run-discovery")).remainingServices, []);
await planRun(root, { runId: "run-discovery", operationId: op("discovery-plan"), ...fp });
assert.deepEqual(Object.keys((await statusRun(root, "run-discovery")).units), ["discovered-order-get"]);
const checks = {
  TRACE: ["ENTRY_IDENTITY", "JAVA_EDGE_REPLAY", "PERSISTENCE_EVIDENCE", "NO_TEXT_EDGE", "QUERY_COMPLETENESS"],
  COVERAGE: ["ENTRY_SET_EQUAL", "ADAPTER_COVERAGE", "EXCLUSIONS_REVIEWED"],
  BOUNDARY: ["BOUNDARY_SET_EQUAL", "TWO_SIDED_EVIDENCE", "UNRESOLVED_ACCOUNTED"],
  CONFIG: ["CONFIG_PRECEDENCE", "PLACEHOLDER_RESOLUTION", "EXTERNALS_ACCOUNTED", "SECRETS_REDACTED"],
  INCREMENTAL: ["BASELINE_COMPLETE", "ENTRY_SET_REDISCOVERED", "SERVICE_CLOSURE_SAFE", "CONFIG_DEPENDENCY_CLOSURE", "CHANGED_SERVICES_EXACT", "TOMBSTONES_ACCOUNTED"],
};
const agents = { TRACE: "spring-trace-validator", COVERAGE: "spring-coverage-auditor", BOUNDARY: "spring-boundary-validator", CONFIG: "spring-config-auditor", INCREMENTAL: "spring-incremental-validator" };
function report(runId, kind, extra = {}, fingerprints = reportFp) {
  return { schemaVersion: "2.0", runId, kind, validator: agents[kind], decision: "ACCEPTED", fingerprints,
    checks: checks[kind].map((code) => ({ code, passed: true, evidence: [code] })),
    ...(kind === "CONFIG" ? { resolutionContextHash: fingerprints.resolvedConfig, contextIds: ["prod-cn"], resolutionLog: [{ contextId: "prod-cn", status: "RESOLVED" }], queryLog: [] } : { queryLog: [{ tool: "codegraph_callees", args: { limit: 101 }, resultCount: 1, truncated: false, completionStatus: "EXPLICIT_COMPLETE", summaryOmittedCount: 0 }] }),
    ...(kind === "BOUNDARY" ? { verifiedBoundaryIds: [] } : {}), ...extra };
}
function trace(runId, entryId, key = "billing.queue", fingerprints = reportFp, sharedModuleClosure = []) {
  return { schemaVersion: "2.0", runId, entryId, status: "TRACED", fingerprints, contextIds: ["prod-cn"], configDependencyIds: [key], serviceClosure: ["order"], sharedModuleClosure, sharedDependency: sharedModuleClosure.length > 0, unownedDependency: false, entrySymbol: `${entryId}:controller`,
    javaEdges: [{ from: `${entryId}:controller`, to: `${entryId}:service`, tool: "codegraph_callees", query: { limit: 101 }, file: "Controller.java", line: 10, receiverType: "com.acme.OrderService", targetDeclaringType: "com.acme.OrderService", receiverAssignableTypes: ["com.acme.OrderService"], receiverCompatibility: "VERIFIED", dispatch: "VIRTUAL" }], specialEdges: [], boundaries: [],
    persistence: [{ symbol: `${entryId}:service`, resource: "db:main:table:sales.orders", storeId: "main", resourceKind: "RELATIONAL_TABLE", operation: "READ", evidence: { file: "Repository.java", line: 20 } }],
    topologyFacts: [{ type: "DISPATCHES_TO", from: `entry:${entryId}`, to: `${entryId}:controller`, assurance: "VERIFIED", provenance: { file: "Controller.java", line: 1 } }], unresolvedFindings: [],
    queryLog: [{ tool: "codegraph_callees", args: { limit: 101 }, purpose: "callees", resultCount: 1, truncated: false, completionStatus: "EXPLICIT_COMPLETE", summaryOmittedCount: 0 }] };
}
async function close(runId, claim, override = fp) {
  return closeBatch(root, { runId, batchId: claim.batchId, batchToken: claim.batchToken, operationId: op("close"), ...override });
}
async function publishRun(runId, fingerprints = fp, reportFingerprints = reportFp, traceKey = "billing.queue", sharedModuleClosure = []) {
  const traceClaim = await claimBatch(root, { runId, workerId: "trace", operationId: op("claim"), ...fingerprints });
  for (const unit of traceClaim.units) await commitUnit(root, { runId, entryId: unit.id, workerId: "trace", batchId: traceClaim.batchId, fingerprintToken: unit.fingerprintToken, status: "TRACED", traceResult: trace(runId, unit.id, traceKey, reportFingerprints, sharedModuleClosure), operationId: op("trace") });
  await close(runId, traceClaim, fingerprints);
  const validationClaim = await claimBatch(root, { runId, workerId: "validator", operationId: op("claim"), ...fingerprints });
  const state = await statusRun(root, runId);
  for (const unit of validationClaim.units) {
    const accepted = await submitReport(root, { runId, kind: "TRACE", entryId: unit.id, batchToken: unit.fingerprintToken, operationId: op("report"), report: report(runId, "TRACE", { entryId: unit.id, traceHash: state.units[unit.id].artifactHash }, reportFingerprints) }, agents.TRACE);
    await commitUnit(root, { runId, entryId: unit.id, workerId: "validator", batchId: validationClaim.batchId, fingerprintToken: unit.fingerprintToken, status: "VERIFIED", reportId: accepted.reportId, operationId: op("verify") });
  }
  await close(runId, validationClaim, fingerprints);
  const publishClaim = await claimBatch(root, { runId, workerId: "publisher", operationId: op("claim"), ...fingerprints });
  for (const unit of publishClaim.units) await commitUnit(root, { runId, entryId: unit.id, workerId: "publisher", batchId: publishClaim.batchId, fingerprintToken: unit.fingerprintToken, status: "PUBLISHED", documentContent: `# ${unit.id}\n`, operationId: op("publish") });
  await close(runId, publishClaim, fingerprints);
  const config = await submitReport(root, { runId, kind: "CONFIG", operationId: op("config"), report: report(runId, "CONFIG", {}, reportFingerprints) }, agents.CONFIG);
  const coverage = await submitReport(root, { runId, kind: "COVERAGE", operationId: op("coverage"), report: report(runId, "COVERAGE", {}, reportFingerprints) }, agents.COVERAGE);
  const boundary = await submitReport(root, { runId, kind: "BOUNDARY", operationId: op("boundary"), report: report(runId, "BOUNDARY", {}, reportFingerprints) }, agents.BOUNDARY);
  const graphBuildInput = { runId, operationId: op("graph-build"), ...fingerprints };
  const graph = await buildGraphSnapshot(root, graphBuildInput);
  assert.deepEqual(await buildGraphSnapshot(root, graphBuildInput), graph, "构图重试必须幂等");
  await controlRun(root, { runId, action: "COMPLETE", operationId: op("complete"), configReportId: config.reportId, coverageReportId: coverage.reportId, boundaryReportId: boundary.reportId, ...fingerprints });
  return graph;
}

const protocolEntryId = "mall-admin:http:POST:/admin/login";
await initRun(root, { runId: "run-friendly-protocol", operationId: op("friendly-init"), batchSize: 1, ...fp });
await planRun(root, { runId: "run-friendly-protocol", entries: [{ id: protocolEntryId, service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }], operationId: op("friendly-plan"), ...fp });
const friendlyTraceClaim = await claimBatch(root, { runId: "run-friendly-protocol", workerId: "friendly-trace", operationId: op("friendly-trace-claim"), ...fp });
const structuredTrace = structuredClone(trace("run-friendly-protocol", protocolEntryId));
delete structuredTrace.schemaVersion; delete structuredTrace.runId; delete structuredTrace.entryId; delete structuredTrace.status; delete structuredTrace.fingerprints;
await commitUnit(root, { runId: "run-friendly-protocol", entryId: protocolEntryId, workerId: "friendly-trace", batchId: friendlyTraceClaim.batchId, fingerprintToken: friendlyTraceClaim.units[0].fingerprintToken, status: "TRACED", traceResult: structuredTrace, operationId: op("friendly-trace-commit") });
await close("run-friendly-protocol", friendlyTraceClaim);
const friendlyValidationClaim = await claimBatch(root, { runId: "run-friendly-protocol", workerId: "friendly-validator", operationId: op("friendly-validation-claim"), ...fp });
const friendlyUnit = friendlyValidationClaim.units[0];
const friendlyContext = await getReportContext(root, { runId: "run-friendly-protocol", kind: "TRACE", entryId: protocolEntryId, batchToken: friendlyUnit.fingerprintToken }, "spring-trace-validator");
assert.deepEqual(friendlyContext.requiredChecks, checks.TRACE);
assert.equal(friendlyContext.traceHash, (await statusRun(root, "run-friendly-protocol")).units[protocolEntryId].artifactHash);
await rejects(() => submitReport(root, { runId: "run-friendly-protocol", kind: "TRACE", entryId: protocolEntryId, batchToken: friendlyUnit.fingerprintToken, operationId: op("friendly-empty-checks"), report: { decision: "ACCEPTED", checks: [], queryLog: [] } }, agents.TRACE), "REPORT_CHECKS_EMPTY");
await rejects(() => submitReport(root, { runId: "run-friendly-protocol", kind: "TRACE", entryId: protocolEntryId, batchToken: friendlyUnit.fingerprintToken, operationId: op("friendly-wrong-header"), report: { schemaVersion: "2.0.0", decision: "ACCEPTED", checks: [] } }, agents.TRACE), "REPORT_SCHEMA_VERSION_MISMATCH");
const rejectedPayload = structuredClone(report("run-friendly-protocol", "TRACE"));
for (const key of ["schemaVersion", "runId", "kind", "validator", "fingerprints", "entryId", "traceHash"]) delete rejectedPayload[key];
rejectedPayload.decision = "REJECTED";
rejectedPayload.checks[0].passed = false;
const rejectedReport = await submitReport(root, { runId: "run-friendly-protocol", kind: "TRACE", entryId: protocolEntryId, batchToken: friendlyUnit.fingerprintToken, operationId: op("friendly-rejected-report"), report: rejectedPayload }, agents.TRACE);
assert.equal(rejectedReport.accepted, false);
await rejects(() => commitUnit(root, { runId: "run-friendly-protocol", entryId: protocolEntryId, workerId: "friendly-validator", batchId: friendlyValidationClaim.batchId, fingerprintToken: friendlyUnit.fingerprintToken, status: "VERIFIED", reportId: rejectedReport.reportId, operationId: op("friendly-rejected-verify") }), "TRACE_ACCEPTED_REPORT_REQUIRED");
const acceptedPayload = structuredClone(report("run-friendly-protocol", "TRACE"));
for (const key of ["schemaVersion", "runId", "kind", "validator", "fingerprints", "entryId", "traceHash"]) delete acceptedPayload[key];
const acceptedFriendly = await submitReport(root, { runId: "run-friendly-protocol", kind: "TRACE", entryId: protocolEntryId, batchToken: friendlyUnit.fingerprintToken, operationId: op("friendly-accepted-report"), report: acceptedPayload }, agents.TRACE);
assert.equal(acceptedFriendly.accepted, true);
await commitUnit(root, { runId: "run-friendly-protocol", entryId: protocolEntryId, workerId: "friendly-validator", batchId: friendlyValidationClaim.batchId, fingerprintToken: friendlyUnit.fingerprintToken, status: "VERIFIED", reportId: acceptedFriendly.reportId, operationId: op("friendly-verified") });
await close("run-friendly-protocol", friendlyValidationClaim);
const friendlyPublishClaim = await claimBatch(root, { runId: "run-friendly-protocol", workerId: "friendly-publisher", operationId: op("friendly-publish-claim"), ...fp });
await commitUnit(root, { runId: "run-friendly-protocol", entryId: protocolEntryId, workerId: "friendly-publisher", batchId: friendlyPublishClaim.batchId, fingerprintToken: friendlyPublishClaim.units[0].fingerprintToken, status: "PUBLISHED", documentContent: "# mall-admin login\n", operationId: op("friendly-published") });
await close("run-friendly-protocol", friendlyPublishClaim);
const friendlyStatus = await statusRun(root, "run-friendly-protocol");
assert(friendlyStatus.units[protocolEntryId].traceArtifactPath.includes(entryStorageKey(protocolEntryId)));
assert(friendlyStatus.units[protocolEntryId].documentRelativePath.endsWith(`${entryStorageKey(protocolEntryId)}.md`));
assert(!friendlyStatus.units[protocolEntryId].documentRelativePath.includes("/admin/login"));

await initRun(root, { runId: "run-main", ...fp });
await planRun(root, { runId: "run-main", entries: [
  { id: "order-http-get", service: "order", adapter: "SPRING_MVC", target: "GET /orders", contextIds: ["prod-cn"] },
  { id: "billing-jms", service: "order", adapter: "JMS_STATIC_LISTENER", target: "billing.request", subscription: "billing-worker", deliverySemantics: "DIRECT", contextIds: ["prod-cn"] },
  { id: "kafka-a1", service: "order", adapter: "KAFKA_LISTENER", target: "main:orders", consumerGroup: "group-a", contextIds: ["prod-cn"] },
  { id: "kafka-a2", service: "order", adapter: "KAFKA_LISTENER", target: "main:orders", consumerGroup: "group-a", contextIds: ["prod-cn"] },
  { id: "kafka-b", service: "order", adapter: "KAFKA_LISTENER", target: "main:orders", consumerGroup: "group-b", contextIds: ["prod-cn"] },
  { id: "kafka-c", service: "order", adapter: "KAFKA_LISTENER", target: "main:orders", consumerGroup: "group-c", contextIds: ["prod-cn"] },
], operationId: op("plan"), ...fp });
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
await planRun(root, { runId: "run-incremental", entries: [{ id: "order-http-get", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }], operationId: op("plan-inc"), ...incrementalFp });
const incrementalSets = { baseRunId: "run-main", baseGraphHash: baseline.graphHash, baseManifestHash: baseline.manifestHash, changedServices: [], changedSharedModules: [], changedConfigKeys: ["prod-cn:billing.queue"], reusableEntryIds: [], affectedEntryIds: ["order-http-get"], newEntryIds: [], tombstonedEntryIds: ["billing-jms", "kafka-a1", "kafka-a2", "kafka-b", "kafka-c"], workQueueEntryIds: ["order-http-get"] };
const unbound = await submitReport(root, { runId: "run-incremental", kind: "INCREMENTAL", operationId: op("inc-report-bad"), report: report("run-incremental", "INCREMENTAL", incrementalSets, incrementalReportFp) }, agents.INCREMENTAL);
await rejects(() => seedIncrementalRun(root, { runId: "run-incremental", reportId: unbound.reportId, operationId: op("seed-bad"), ...incrementalFp }), "topologyRootHash");
const bound = await submitReport(root, { runId: "run-incremental", kind: "INCREMENTAL", operationId: op("inc-report"), report: report("run-incremental", "INCREMENTAL", { ...incrementalSets, baseTopologyRootHash: baseline.topologyRootHash }, incrementalReportFp) }, agents.INCREMENTAL);
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

const sharedBaseFp = { ...fp, sourceSnapshot: "src-shared-v1", sharedModuleSnapshots: { common: "common-v1" }, sharedModuleRoots: { common: "modules/common" } };
const sharedBaseReportFp = { ...reportFp, source: sharedBaseFp.sourceSnapshot };
await initRun(root, { runId: "run-shared-base", ...sharedBaseFp });
await planRun(root, { runId: "run-shared-base", entries: [{ id: "shared-dependent", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }], operationId: op("shared-base-plan"), ...sharedBaseFp });
await publishRun("run-shared-base", sharedBaseFp, sharedBaseReportFp, "billing.queue", ["common"]);
const sharedBaseline = await statusRun(root, "run-shared-base");
const sharedCurrentFp = { ...sharedBaseFp, sourceSnapshot: "src-shared-v2", sharedModuleSnapshots: { common: "common-v2" } };
const sharedCurrentReportFp = { ...reportFp, source: sharedCurrentFp.sourceSnapshot };
await initRun(root, { runId: "run-shared-inc", mode: "INCREMENTAL", baseRunId: "run-shared-base", ...sharedCurrentFp });
await planRun(root, { runId: "run-shared-inc", entries: [{ id: "shared-dependent", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }], operationId: op("shared-inc-plan"), ...sharedCurrentFp });
const sharedSets = { baseRunId: "run-shared-base", baseGraphHash: sharedBaseline.graphHash, baseManifestHash: sharedBaseline.manifestHash, baseTopologyRootHash: sharedBaseline.topologyRootHash, changedServices: [], changedSharedModules: ["common"], changedConfigKeys: [], reusableEntryIds: [], affectedEntryIds: ["shared-dependent"], newEntryIds: [], tombstonedEntryIds: [], workQueueEntryIds: ["shared-dependent"] };
const sharedReport = await submitReport(root, { runId: "run-shared-inc", kind: "INCREMENTAL", operationId: op("shared-inc-report"), report: report("run-shared-inc", "INCREMENTAL", sharedSets, sharedCurrentReportFp) }, agents.INCREMENTAL);
const sharedSeed = await seedIncrementalRun(root, { runId: "run-shared-inc", reportId: sharedReport.reportId, operationId: op("shared-seed"), ...sharedCurrentFp });
assert.deepEqual(sharedSeed.changedSharedModules, ["common"]);
assert.deepEqual(sharedSeed.affectedEntryIds, ["shared-dependent"]);

await initRun(root, { runId: "run-unresolved-base", ...fp });
await planRun(root, { runId: "run-unresolved-base", entries: [{ id: "external-dependent", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }], operationId: op("plan-unresolved"), ...fp });
await publishRun("run-unresolved-base", fp, reportFp, "dynamic.destination");
const unresolvedBase = await statusRun(root, "run-unresolved-base");
await initRun(root, { runId: "run-unresolved-inc", mode: "INCREMENTAL", baseRunId: "run-unresolved-base", ...fp });
await planRun(root, { runId: "run-unresolved-inc", entries: [{ id: "external-dependent", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }], operationId: op("plan-unresolved-inc"), ...fp });
const unsafeReuse = {
  baseRunId: "run-unresolved-base", baseGraphHash: unresolvedBase.graphHash, baseManifestHash: unresolvedBase.manifestHash, baseTopologyRootHash: unresolvedBase.topologyRootHash,
  changedServices: [], changedSharedModules: [], changedConfigKeys: [], reusableEntryIds: ["external-dependent"], affectedEntryIds: [], newEntryIds: [], tombstonedEntryIds: [], workQueueEntryIds: [],
};
const unsafeReuseReport = await submitReport(root, { runId: "run-unresolved-inc", kind: "INCREMENTAL", operationId: op("unresolved-report"), report: report("run-unresolved-inc", "INCREMENTAL", unsafeReuse) }, agents.INCREMENTAL);
await rejects(() => seedIncrementalRun(root, { runId: "run-unresolved-inc", reportId: unsafeReuseReport.reportId, operationId: op("unresolved-seed"), ...fp }), "保守失效集合不一致");

await initRun(root, { runId: "run-control", batchSize: 1, ...fp });
await planRun(root, { runId: "run-control", entries: [{ id: "control-entry", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }], operationId: op("control-plan"), ...fp });
const pauseOperation = op("pause-idempotent");
const paused = await controlRun(root, { runId: "run-control", action: "PAUSE", operationId: pauseOperation });
assert.equal(paused.phase, "PAUSED");
assert.deepEqual(await controlRun(root, { runId: "run-control", action: "PAUSE", operationId: pauseOperation }), paused, "同operationId应返回幂等结果");
await rejects(() => controlRun(root, { runId: "run-control", action: "FAIL", operationId: pauseOperation }), "OPERATION_ID_CONFLICT");
assert.equal((await controlRun(root, { runId: "run-control", action: "RESUME", operationId: op("resume"), ...fp })).phase, "PLANNED");
const controlClaim = await claimBatch(root, { runId: "run-control", workerId: "control-worker", operationId: op("control-claim"), ...fp });
assert.equal((Date.parse(controlClaim.lease.leaseUntil) - Date.parse(controlClaim.lease.serverNow)) / 1000, 5400, "批次租约必须使用run冻结配置");
const heartbeatOperation = op("heartbeat");
const heartbeat = await heartbeatBatch(root, { runId: "run-control", batchId: controlClaim.batchId, batchToken: controlClaim.batchToken, workerId: "control-worker", operationId: heartbeatOperation, leaseSeconds: 60 });
assert.equal(heartbeat.extended, 1);
assert.deepEqual(await heartbeatBatch(root, { runId: "run-control", batchId: controlClaim.batchId, batchToken: controlClaim.batchToken, workerId: "control-worker", operationId: heartbeatOperation, leaseSeconds: 60 }), heartbeat);
const renewedHeartbeat = await heartbeatBatch(root, { runId: "run-control", batchId: controlClaim.batchId, batchToken: controlClaim.batchToken, workerId: "control-worker", operationId: op("heartbeat-renew"), leaseSeconds: 120 });
assert.equal(renewedHeartbeat.leaseSeconds, 120);
assert.equal((await controlRun(root, { runId: "run-control", action: "PAUSE", operationId: op("pause-active") })).phase, "PAUSE_REQUESTED");
const controlStatePath = join(root, ".opencode/.cache/spring-business-tracer/runs/run-control/run.json");
const controlState = JSON.parse(await readFile(controlStatePath, "utf8"));
controlState.units["control-entry"].leaseUntil = "2000-01-01T00:00:00.000Z";
await writeFile(controlStatePath, JSON.stringify(controlState, null, 2));
const lateControlCommit = await commitUnit(root, { runId: "run-control", entryId: "control-entry", workerId: "control-worker", batchId: controlClaim.batchId, fingerprintToken: controlClaim.units[0].fingerprintToken, status: "TRACED", traceResult: trace("run-control", "control-entry"), operationId: op("control-trace") });
assert.equal(lateControlCommit.lease.lateCommitAccepted, true, "未被重新领取的迟到批次结果应由fencing token安全接收");
const closedControl = await closeBatch(root, { runId: "run-control", batchId: controlClaim.batchId, batchToken: controlClaim.batchToken, operationId: op("control-close"), ...fp });
assert.equal(closedControl.phase, "PAUSED");
assert.equal((await controlRun(root, { runId: "run-control", action: "RESUME", operationId: op("resume-active"), ...fp })).phase, "TRACING");

await initRun(root, { runId: "run-recover", batchSize: 1, ...fp });
await planRun(root, { runId: "run-recover", entries: [{ id: "recover-entry", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }], operationId: op("recover-plan"), ...fp });
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
await rejects(() => commitUnit(root, { runId: "run-recover", entryId: "recover-entry", workerId: "crashed-worker", batchId: recoverClaim.batchId, fingerprintToken: recoverClaim.units[0].fingerprintToken, status: "TRACED", operationId: op("recover-stale-commit") }), "LEASE_FENCE_MISMATCH");
assert.equal((await claimBatch(root, { runId: "run-recover", workerId: "replacement-worker", operationId: op("recover-reclaim"), ...fp })).units[0].leaseStage, "TRACE");

await initRun(root, { runId: "run-stale", ...fp });
await planRun(root, { runId: "run-stale", entries: [{ id: "stale-entry", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }], operationId: op("stale-plan"), ...fp });
await controlRun(root, { runId: "run-stale", action: "PAUSE", operationId: op("stale-pause") });
await rejects(() => controlRun(root, { runId: "run-stale", action: "RESUME", operationId: op("stale-resume"), ...fp, sourceSnapshot: "changed-source" }), "状态标记为STALE");
assert.equal((await statusRun(root, "run-stale")).phase, "STALE");

await initRun(root, { runId: "run-fail", ...fp });
assert.equal((await controlRun(root, { runId: "run-fail", action: "FAIL", operationId: op("fail") })).phase, "FAILED");

await initRun(root, { runId: "run-partial", batchSize: 1, ...fp });
await planRun(root, { runId: "run-partial", entries: [
  { id: "a-published", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] },
  { id: "b-blocked", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] },
], operationId: op("partial-plan"), ...fp });
const partialTrace = await claimBatch(root, { runId: "run-partial", workerId: "partial-trace", operationId: op("partial-claim-trace"), limit: 1, ...fp });
await commitUnit(root, { runId: "run-partial", entryId: "a-published", workerId: "partial-trace", batchId: partialTrace.batchId, fingerprintToken: partialTrace.units[0].fingerprintToken, status: "TRACED", traceResult: trace("run-partial", "a-published"), operationId: op("partial-trace") });
await closeBatch(root, { runId: "run-partial", batchId: partialTrace.batchId, batchToken: partialTrace.batchToken, operationId: op("partial-close-trace"), ...fp });
const partialValidate = await claimBatch(root, { runId: "run-partial", workerId: "partial-validator", operationId: op("partial-claim-validate"), limit: 1, ...fp });
const partialState = await statusRun(root, "run-partial");
const partialReport = await submitReport(root, { runId: "run-partial", kind: "TRACE", entryId: "a-published", batchToken: partialValidate.units[0].fingerprintToken, operationId: op("partial-report"), report: report("run-partial", "TRACE", { entryId: "a-published", traceHash: partialState.units["a-published"].artifactHash }) }, agents.TRACE);
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

await rejects(() => initRun(root, { runId: "missing-context", ...fp, resolutionContextHash: "" }), "指纹");
await initRun(root, { runId: "input-limits", ...fp });
await rejects(() => planRun(root, { runId: "input-limits", entries: ["x".repeat(8 * 1024 * 1024)], operationId: op("oversize-plan"), ...fp }), "STRUCTURED_INPUT_TOO_LARGE");
assert.equal((await statusRun(root, "input-limits")).phase, "CREATED");
await rejects(() => planRun(root, { runId: "input-limits", entries: "[{\"id\":\"string-is-not-accepted\"}]", operationId: op("string-plan"), ...fp }), "STRUCTURED_INPUT_TYPE_MISMATCH");
await rejects(() => planRun(root, { runId: "input-limits", entries: { entries: [] }, operationId: op("wrong-type-plan"), ...fp }), "STRUCTURED_INPUT_TYPE_MISMATCH");
await rejects(() => planRun(root, { runId: "input-limits", entries: [{ id: " bad-entry ", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }], operationId: op("bad-entry-id"), ...fp }), "ENTRY_ID_INVALID");
await rejects(() => planRun(root, { runId: "input-limits", entries: [{ id: "bad-context", service: "order", adapter: "SPRING_MVC", contextIds: [{}] }], operationId: op("bad-plan"), ...fp }), "contextIds非法");
assert.equal((await statusRun(root, "input-limits")).phase, "CREATED");

await initRun(root, { runId: "run-codegraph-evidence", batchSize: 1, ...fp });
await planRun(root, { runId: "run-codegraph-evidence", entries: [{ id: "evidence-entry", service: "order", adapter: "SPRING_MVC", contextIds: ["prod-cn"] }], operationId: op("evidence-plan"), ...fp });
const evidenceClaim = await claimBatch(root, { runId: "run-codegraph-evidence", workerId: "evidence-worker", operationId: op("evidence-claim"), ...fp });
const evidenceCommit = (payload) => commitUnit(root, { runId: "run-codegraph-evidence", entryId: "evidence-entry", workerId: "evidence-worker", batchId: evidenceClaim.batchId, fingerprintToken: evidenceClaim.units[0].fingerprintToken, status: "TRACED", traceResult: payload, operationId: op("evidence-commit") });
const fakeLog = structuredClone(trace("run-codegraph-evidence", "evidence-entry"));
fakeLog.queryLog[0].tool = "grep";
await rejects(() => evidenceCommit(fakeLog), "Code Graph");
const fakeJava = structuredClone(trace("run-codegraph-evidence", "evidence-entry"));
fakeJava.javaEdges[0].tool = "grep";
await rejects(() => evidenceCommit(fakeJava), "Code Graph");
const incompatibleReceiver = structuredClone(trace("run-codegraph-evidence", "evidence-entry"));
incompatibleReceiver.javaEdges[0].receiverType = "java.util.List";
incompatibleReceiver.javaEdges[0].targetDeclaringType = "com.acme.OmsCartItemController";
incompatibleReceiver.javaEdges[0].receiverAssignableTypes = ["java.util.List", "java.util.Collection"];
await rejects(() => evidenceCommit(incompatibleReceiver), "receiverType");
const fakeSpecial = structuredClone(trace("run-codegraph-evidence", "evidence-entry"));
fakeSpecial.specialEdges = [{ from: "a", to: "b", kind: "FRAMEWORK", tool: "grep", query: { limit: 101 } }];
await rejects(() => evidenceCommit(fakeSpecial), "Code Graph");
await evidenceCommit(structuredClone(trace("run-codegraph-evidence", "evidence-entry")));

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
console.log("PASS: V2.0的23工具、Windows CodeGraph解析、租约心跳/fencing、严格结构化提交/诊断错误、CodeGraph有界适配器、发现checkpoint、配置/脱敏、receiver证据、状态全生命周期、provenance、增量/tombstone、有界diff与安全I/O动态测试");
