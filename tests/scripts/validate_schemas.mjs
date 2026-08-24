#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "../../.opencode/node_modules/ajv/dist/2020.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const schemaRoot = join(root, ".opencode/skills/spring-business-tracer/schemas");
const names = (await readdir(schemaRoot)).filter((name) => name.endsWith(".schema.json")).map((name) => name.slice(0, -12)).sort();
const schemas = await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(schemaRoot, `${name}.schema.json`), "utf8"))));
const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const schema of schemas) ajv.addSchema(schema);
for (const schema of schemas) assert(ajv.getSchema(schema.$id), `schema未注册：${schema.$id}`);

const hash = `sha256:${"a".repeat(64)}`;
const fingerprints = { config: hash, source: hash, index: hash, toolkit: hash, resolvedConfig: hash, adapterRegistry: hash };
const evidence = { file: "A.java", line: 1 };
const boundary = { id: "b1", kind: "JMS", key: "main:queue:billing", source: "Publisher#send", target: "Listener#on", sourceEvidence: evidence, targetEvidence: [evidence], status: "VERIFIED" };
const queryLog = [{ tool: "codegraph_callees", args: { limit: 101 }, purpose: "验证Java调用边", resultCount: 1, truncated: false, completionStatus: "EXPLICIT_COMPLETE", summaryOmittedCount: 0 }];

const samples = {
  "analysis-context": { id: "prod-cn", activeProfiles: ["prod", "cn"], propertySources: ["src/main/resources/application.yml"] },
  "adapter-definition": { id: "CUSTOM_HTTP", annotationFqcns: ["com.acme.Entry"], interfaceFqcns: [], methodNames: [], triggerFields: ["path"], outboundOnly: false },
  config: JSON.parse(await readFile(join(root, ".opencode/spring-business-tracer.json"), "utf8")),
  run: { schemaVersion: "2.0", runId: "run-schema", phase: "PLANNED", configHash: hash, sourceSnapshot: hash, indexFingerprint: hash, toolkitFingerprint: hash, resolutionContextHash: hash, adapterRegistryFingerprint: hash, mode: "FULL", sharedModuleSnapshots: {}, discovery: { started: false, units: {} }, units: { entry: { id: "entry", service: "order", kind: "HTTP", status: "PENDING", attempts: 0, fingerprintToken: null } }, audits: { coverageHash: null, boundaryHash: null, configHash: null } },
  "entry-inventory": { schemaVersion: "2.0", runId: "run-schema", serviceId: "order", totalEntries: 1, fingerprints, adapters: [{ name: "SPRING_MVC", enabled: true, count: 1 }], excludedCandidates: [], entries: [{ id: "order:http:GET:/orders", serviceId: "order", adapter: "SPRING_MVC", adapterDefinitionVersion: "2.0.0", contextIds: ["prod-cn"], conditions: [], visibility: "PUBLIC", trigger: "GET /orders", symbolId: "OrderController#get", signature: "get()", file: "OrderController.java", line: 1, codeGraphQuery: { limit: 101 }, beanActivation: { effective: true, evidence: [{ annotation: "RestController" }] } }], queryLog },
  "boundary-link": boundary,
  "trace-result": { schemaVersion: "2.0", runId: "run-schema", entryId: "entry", fingerprints, status: "TRACED", contextIds: ["prod-cn"], configDependencyIds: ["billing.queue"], serviceClosure: ["order"], sharedModuleClosure: [], javaEdges: [{ from: "a", to: "b", tool: "codegraph_callees", query: { limit: 101 }, file: "A.java", line: 1, receiverType: "com.acme.Service", targetDeclaringType: "com.acme.Service", receiverAssignableTypes: ["com.acme.Service"], receiverCompatibility: "VERIFIED", dispatch: "VIRTUAL" }], boundaries: [boundary], persistence: [{ symbol: "b", resource: "db:main:table:sales.orders", storeId: "main", resourceKind: "RELATIONAL_TABLE", operation: "READ", evidence }], topologyFacts: [{ type: "DISPATCHES_TO", from: "entry", to: "a", assurance: "VERIFIED", provenance: evidence }], unresolvedFindings: [], queryLog },
  verification: { schemaVersion: "2.0", runId: "run-schema", kind: "TRACE", entryId: "entry", traceHash: hash, validator: "spring-trace-validator", decision: "ACCEPTED", fingerprints, checks: [{ code: "EDGE", passed: true, evidence: ["receipt"] }], queryLog },
  audit: { schemaVersion: "2.0", runId: "run-schema", kind: "CONFIG", validator: "spring-config-auditor", decision: "ACCEPTED", fingerprints, checks: ["CONFIG_PRECEDENCE", "PLACEHOLDER_RESOLUTION", "EXTERNALS_ACCOUNTED", "SECRETS_REDACTED"].map((code) => ({ code, passed: true, evidence: [code] })), queryLog, resolutionContextHash: hash, contextIds: ["prod-cn"], resolutionLog: [{ contextId: "prod-cn", status: "RESOLVED" }] },
  "graph-node": { id: "a", type: "SYMBOL", entryMembership: ["entry"], services: ["order"] },
  "graph-edge": { id: hash, type: "JAVA_CALL", from: "a", to: "b", entryMembership: ["entry"], services: ["order"], evidence: {}, evidenceHash: hash },
  "graph-meta": { schemaVersion: "2.0", runId: "run-schema", fingerprints, nodeCount: 2, edgeCount: 1, entryIds: ["entry"], topologyRootHash: hash, graphHash: hash },
  "graph-diff": { fromRunId: "a", toRunId: "b", fromGraphHash: hash, toGraphHash: hash, entries: { counts: { added: 0, removed: 0 }, total: 0, rows: [], truncated: false, complete: true }, nodes: { counts: { added: 0, removed: 0, changedEvidence: 0, changedMembership: 0 }, total: 0, rows: [], truncated: false, complete: true }, edges: { counts: { added: 0, removed: 0, changedEvidence: 0, changedMembership: 0 }, total: 0, rows: [], truncated: false, complete: true } },
  manifest: { schemaVersion: "2.0", toolkitVersion: "2.0.0", runId: "run-schema", graphHash: hash, fingerprints, contexts: [{ id: "prod-cn", contextHash: hash }], services: [{ id: "order", root: "order" }], sharedModules: [], entrypoints: [{ id: "entry", status: "PUBLISHED" }], tables: [], boundaries: [], codeGraphTools: ["codegraph_callees"], graph: { nodeCount: 2, edgeCount: 1, formatVersion: 2, topologyRootHash: hash }, tombstones: { entryIds: [], nodeIds: [], edgeIds: [] }, graphDelta: null, audits: { coverageHash: hash, boundaryHash: hash, configHash: hash } },
  "topology-node": { id: "service:order", type: "SERVICE", entryMembership: [], services: ["order"], contextIds: ["prod-cn"] },
  "topology-edge": { id: hash, type: "EXPOSES", from: "service:order", to: "entry:order", bindingKey: null, assurance: "VERIFIED", entryMembership: ["entry"], services: ["order"], contextIds: ["prod-cn"], provenanceIds: [hash], semantics: null },
  provenance: { id: hash, schemaVersion: "2.0", edgeId: hash, sourceKind: "ENTRY_INVENTORY", assurance: "VERIFIED", evidence: {}, validatorReportHashes: [] },
  "resolved-config": { schemaVersion: "2.0", defaultContext: "prod-cn", contexts: [{ id: "prod-cn", activeProfiles: ["prod"], values: [], unresolved: [], origins: [], contextHash: hash }], externalSourcePolicy: "PARTIAL", secretPolicy: "HASH_ONLY", resolutionContextHash: hash },
  "topology-query": { query: "node", key: "service:order", contextId: "prod-cn", limit: 50 },
  "topology-result": { schemaVersion: "2.0", runId: "run-schema", integrityModel: "SELF_CONSISTENCY_NOT_EXTERNAL_SIGNATURE", topologyRootHash: hash, queryHash: hash, returnedCount: 1, complete: true, cutoffReason: null, rows: [], cursor: null },
  "migration-report": { schemaVersion: "2.0", from: "1.5.0", to: "2.0.0", oldHash: hash, newHash: hash, legacyRuns: "LEGACY_READ_ONLY/FULL_REBASE_REQUIRED" },
};

assert.deepEqual(Object.keys(samples).sort(), names, "每份schema都必须有合法样例");
for (const name of names) {
  const validate = ajv.getSchema(`spring-business-tracer/${name}.schema.json`);
  assert.equal(validate(samples[name]), true, `${name}合法样例未通过：${ajv.errorsText(validate.errors)}`);
}

const invalidConfig = structuredClone(samples.config);
invalidConfig.configResolution.environmentPolicy = "ALLOW";
assert.equal(ajv.getSchema("spring-business-tracer/config.schema.json")(invalidConfig), false, "环境变量策略不可放宽");
const invalidAdapter = structuredClone(samples["adapter-definition"]);
invalidAdapter.script = "exec";
assert.equal(ajv.getSchema("spring-business-tracer/adapter-definition.schema.json")(invalidAdapter), false, "自定义adapter不能执行脚本");
const invalidTrace = structuredClone(samples["trace-result"]);
delete invalidTrace.configDependencyIds;
assert.equal(ajv.getSchema("spring-business-tracer/trace-result.schema.json")(invalidTrace), false, "trace必须绑定配置依赖");
const fourFingerprintTrace = structuredClone(samples["trace-result"]);
delete fourFingerprintTrace.fingerprints.resolvedConfig;
assert.equal(ajv.getSchema("spring-business-tracer/trace-result.schema.json")(fourFingerprintTrace), false, "trace必须绑定全部六类指纹");
const fourFingerprintInventory = structuredClone(samples["entry-inventory"]);
delete fourFingerprintInventory.fingerprints.adapterRegistry;
assert.equal(ajv.getSchema("spring-business-tracer/entry-inventory.schema.json")(fourFingerprintInventory), false, "入口清单必须绑定全部六类指纹");
const fakeToolTrace = structuredClone(samples["trace-result"]);
fakeToolTrace.javaEdges[0].tool = "grep";
assert.equal(ajv.getSchema("spring-business-tracer/trace-result.schema.json")(fakeToolTrace), false, "Java边不能伪装成非Code Graph证据");
const receiverlessTrace = structuredClone(samples["trace-result"]);
delete receiverlessTrace.javaEdges[0].receiverAssignableTypes;
assert.equal(ajv.getSchema("spring-business-tracer/trace-result.schema.json")(receiverlessTrace), false, "Java边必须带receiver可赋值类型证据");
const summarizedInventory = structuredClone(samples["entry-inventory"]);
summarizedInventory.queryLog[0].summaryOmittedCount = 4;
assert.equal(ajv.getSchema("spring-business-tracer/entry-inventory.schema.json")(summarizedInventory), false, "入口发现摘要省略不能伪装为完整");
const fakeToolVerification = structuredClone(samples.verification);
fakeToolVerification.queryLog[0].tool = "grep";
assert.equal(ajv.getSchema("spring-business-tracer/verification.schema.json")(fakeToolVerification), false, "验证报告必须使用Code Graph查询");
const invalidConfigAudit = structuredClone(samples.audit);
delete invalidConfigAudit.resolutionContextHash;
assert.equal(ajv.getSchema("spring-business-tracer/audit.schema.json")(invalidConfigAudit), false, "CONFIG audit必须绑定解析根");

console.log(`PASS: Ajv Draft 2020-12 校验 ${names.length} 份V2.0 schema及Code Graph证据等关键安全负例`);
