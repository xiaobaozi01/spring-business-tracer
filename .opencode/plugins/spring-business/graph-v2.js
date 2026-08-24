import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

const FORMAT_VERSION = 2;
const PREFIX_LENGTH = 2;
const MAX_SHARD_BYTES = 8 * 1024 * 1024;
const MAX_QUERY_MS = 2_000;
const MAX_VISITS = 100_000;

async function safeReadTopologyFile(directory, relative, maximumBytes = MAX_SHARD_BYTES) {
  if (typeof relative !== "string" || !/^(?:meta\.json|(?:nodes|edges|provenance|adjacency-(?:in|out))\/[0-9a-f]{2}\.jsonl)$/.test(relative)) throw new Error("TOPOLOGY_FILE_PATH_INVALID");
  await assertTopologyDirectoryChain(directory, dirname(relative));
  const path = join(directory, relative);
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error("TOPOLOGY_FILE_UNSAFE");
  if (before.size > maximumBytes) throw new Error("TOPOLOGY_FILE_TOO_LARGE");
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > maximumBytes || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("TOPOLOGY_FILE_UNSAFE");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.nlink !== 1 || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || bytes.length !== opened.size) throw new Error("TOPOLOGY_FILE_CHANGED_DURING_READ");
    return bytes;
  } catch (error) {
    if (new Set(["ELOOP", "EMLINK"]).has(error?.code)) throw new Error("TOPOLOGY_FILE_UNSAFE");
    throw error;
  } finally {
    await handle?.close();
  }
}

async function assertTopologyDirectoryChain(directory, relativeParent = ".") {
  const rootInfo = await lstat(directory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("TOPOLOGY_DIRECTORY_UNSAFE");
  const rootReal = await realpath(directory);
  if (relativeParent === ".") return { rootInfo, parentInfo: rootInfo, rootReal };
  if (!/^(nodes|edges|provenance|adjacency-(?:in|out))$/.test(relativeParent)) throw new Error("TOPOLOGY_FILE_PATH_INVALID");
  const parent = join(directory, relativeParent);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error("TOPOLOGY_DIRECTORY_UNSAFE");
  const parentReal = await realpath(parent);
  if (parentReal !== join(rootReal, relativeParent)) throw new Error("TOPOLOGY_DIRECTORY_UNSAFE");
  return { rootInfo, parentInfo, rootReal };
}

async function ensureTopologyDirectory(path) {
  try { await mkdir(path); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("TOPOLOGY_DIRECTORY_UNSAFE");
}

async function safeWriteTopologyFile(directory, relative, value) {
  if (typeof relative !== "string" || !/^(?:meta\.json|(?:nodes|edges|provenance|adjacency-(?:in|out))\/[0-9a-f]{2}\.jsonl)$/.test(relative)) throw new Error("TOPOLOGY_FILE_PATH_INVALID");
  const bytes = Buffer.from(value);
  if (bytes.length > MAX_SHARD_BYTES) throw new Error("TOPOLOGY_FILE_TOO_LARGE");
  const path = join(directory, relative);
  const parent = dirname(path);
  await ensureTopologyDirectory(parent);
  const chain = await assertTopologyDirectoryChain(directory, dirname(relative));
  const temporary = join(parent, `.topology-${randomBytes(16).toString("hex")}.tmp`);
  let handle;
  let temporaryExists = false;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    temporaryExists = true;
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1) throw new Error("TOPOLOGY_FILE_UNSAFE");
    await handle.writeFile(bytes);
    await handle.sync();
    const after = await handle.stat();
    if (!after.isFile() || after.size !== bytes.length || after.dev !== opened.dev || after.ino !== opened.ino) throw new Error("TOPOLOGY_FILE_CHANGED_DURING_WRITE");
    await handle.close();
    handle = null;
    const parentAfter = await lstat(parent);
    if (!parentAfter.isDirectory() || parentAfter.isSymbolicLink() || parentAfter.dev !== chain.parentInfo.dev || parentAfter.ino !== chain.parentInfo.ino) throw new Error("TOPOLOGY_DIRECTORY_CHANGED_DURING_WRITE");
    await rename(temporary, path);
    temporaryExists = false;
  } catch (error) {
    if (new Set(["ELOOP", "EMLINK"]).has(error?.code)) throw new Error("TOPOLOGY_FILE_UNSAFE");
    throw error;
  } finally {
    await handle?.close();
    if (temporaryExists) await unlink(temporary).catch(() => {});
  }
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return value === undefined ? "null" : JSON.stringify(value);
}

function stableId(kind, parts) {
  return sha256(canonicalJson({ kind, parts }));
}

function prefixOf(id) {
  return createHash("sha256").update(id).digest("hex").slice(0, PREFIX_LENGTH);
}

function addNode(nodes, id, type, payload = {}) {
  const existing = nodes.get(id);
  if (existing && existing.type !== type) throw new Error(`TOPOLOGY_NODE_TYPE_CONFLICT:${id}`);
  nodes.set(id, { ...(existing ?? {}), id, type, ...payload,
    entryMembership: [...new Set([...(existing?.entryMembership ?? []), ...(payload.entryMembership ?? [])])].sort(),
    services: [...new Set([...(existing?.services ?? []), ...(payload.services ?? [])])].sort(),
    contextIds: [...new Set([...(existing?.contextIds ?? []), ...(payload.contextIds ?? [])])].sort(),
  });
}

function addProvenance(provenance, payload) {
  const normalized = { schemaVersion: "2.0", ...payload };
  const id = stableId("PROVENANCE", normalized);
  provenance.set(id, { id, ...normalized });
  return id;
}

function addEdge(edges, provenance, type, from, to, payload = {}) {
  const identity = { type, from, to, bindingKey: payload.bindingKey ?? null, contextIds: [...new Set(payload.contextIds ?? [])].sort() };
  const id = stableId("TOPOLOGY_EDGE", identity);
  const provenanceId = addProvenance(provenance, { edgeId: id, sourceKind: payload.sourceKind ?? "VERIFIED_TRACE", assurance: payload.assurance ?? "VERIFIED", evidence: payload.evidence ?? {}, validatorReportHashes: payload.validatorReportHashes ?? [] });
  const existing = edges.get(id);
  edges.set(id, { ...(existing ?? {}), id, type, from, to, bindingKey: identity.bindingKey,
    assurance: payload.assurance ?? existing?.assurance ?? "VERIFIED",
    entryMembership: [...new Set([...(existing?.entryMembership ?? []), ...(payload.entryMembership ?? [])])].sort(),
    services: [...new Set([...(existing?.services ?? []), ...(payload.services ?? [])])].sort(),
    contextIds: identity.contextIds,
    provenanceIds: [...new Set([...(existing?.provenanceIds ?? []), provenanceId])].sort(),
    semantics: payload.semantics ?? existing?.semantics ?? null,
  });
}

function channelType(kind) {
  return new Set(["KAFKA", "RABBIT", "JMS", "ROCKETMQ"]).has(kind);
}

const TOPOLOGY_FACT_EDGE_TYPES = new Set(["EXPOSES", "DISPATCHES_TO", "INVOKES_HTTP", "PUBLISHES", "DELIVERS_TO", "CONSUMES", "INVOKES_RPC", "TRIGGERS"]);

function projectEntrySurface(nodes, edges, provenance, unit, entryId, contextIds) {
  const adapter = unit.adapter ?? unit.kind ?? "UNKNOWN";
  const services = unit.service ? [unit.service] : [];
  const contexts = unit.contextIds ?? contextIds;
  const common = { entryMembership: [unit.id], services, contextIds: contexts, sourceKind: "ENTRY_INVENTORY", evidence: { entryId: unit.id, adapter, target: unit.target ?? null } };
  let surface = null;
  let nodeType = null;
  let dispatchType = "DISPATCHES_TO";
  if (new Set(["SPRING_MVC", "SPRING_WEBFLUX", "SPRING_WEBFLUX_ANNOTATED", "WEBFLUX_FUNCTIONAL_STATIC_HANDLER"]).has(adapter)) {
    surface = `http-endpoint:${unit.id}`; nodeType = "HTTP_ENDPOINT";
  } else if (adapter === "GRAPHQL_ANNOTATED_ROOT" || adapter === "GRAPHQL") {
    surface = `graphql-operation:${unit.id}`; nodeType = "GRAPHQL_OPERATION";
  } else if (new Set(["SCHEDULED", "QUARTZ", "QUARTZ_STATIC_JOB_TRIGGER", "XXL_JOB"]).has(adapter)) {
    surface = `job-trigger:${unit.id}`; nodeType = "JOB_TRIGGER"; dispatchType = "TRIGGERS";
  } else if (new Set(["GRPC", "GRPC_UNARY_PROTO", "DUBBO"]).has(adapter)) {
    surface = `rpc:${adapter.toLowerCase()}:${unit.target || unit.id}`; nodeType = "RPC_OPERATION";
  } else if (new Set(["KAFKA", "KAFKA_LISTENER", "RABBIT", "RABBIT_LISTENER", "JMS", "JMS_STATIC_LISTENER", "ROCKETMQ"]).has(adapter) && unit.target) {
    const protocol = adapter.split("_")[0].toLowerCase();
    const channel = `channel:${protocol}:${unit.target}`;
    const subscriptionKey = unit.consumerGroup || unit.subscription || unit.id;
    const subscription = `subscription:${protocol}:${unit.target}:${subscriptionKey}`;
    addNode(nodes, channel, "MESSAGE_CHANNEL", { services, entryMembership: [unit.id], contextIds: contexts, protocol: protocol.toUpperCase(), bindingKey: unit.target });
    addNode(nodes, subscription, "MESSAGE_SUBSCRIPTION", { services, entryMembership: [unit.id], contextIds: contexts, protocol: protocol.toUpperCase(), bindingKey: subscriptionKey, deliverySemantics: unit.deliverySemantics ?? "DIRECT" });
    const verified = { ...common, sourceKind: "FRAMEWORK_ADAPTER", validatorReportHashes: unit.validationHash ? [unit.validationHash] : [] };
    addEdge(edges, provenance, "DELIVERS_TO", channel, subscription, { ...verified, bindingKey: subscriptionKey, semantics: { deliverySemantics: unit.deliverySemantics ?? "DIRECT" } });
    addEdge(edges, provenance, "CONSUMES", subscription, entryId, { ...verified, bindingKey: subscriptionKey, assurance: unit.deliverySemantics === "COMPETING_ONE_OF" ? "POTENTIAL" : "VERIFIED" });
    return;
  }
  if (!surface) return;
  addNode(nodes, surface, nodeType, { services, entryMembership: [unit.id], contextIds: contexts, adapter, bindingKey: unit.target ?? unit.id });
  if (unit.service) addEdge(edges, provenance, "EXPOSES", `service:${unit.service}`, surface, common);
  addEdge(edges, provenance, dispatchType, surface, entryId, common);
}

export function createTopology(run, legacyNodes, legacyEdges) {
  const nodes = new Map();
  const edges = new Map();
  const provenance = new Map();
  const contextIds = run.contextIds ?? ["default"];
  const units = Object.values(run.units ?? {}).sort((a, b) => a.id.localeCompare(b.id));
  const messageGroups = new Map();
  for (const unit of units) {
    const adapter = unit.adapter ?? unit.kind ?? "UNKNOWN";
    if (!new Set(["KAFKA", "KAFKA_LISTENER", "RABBIT", "RABBIT_LISTENER", "JMS", "JMS_STATIC_LISTENER", "ROCKETMQ"]).has(adapter) || !unit.target) continue;
    const protocol = adapter.split("_")[0].toLowerCase();
    if (protocol === "kafka" && !unit.consumerGroup) throw new Error(`TOPOLOGY_MESSAGE_GROUP_REQUIRED:${unit.id}`);
    const subscriptionKey = unit.consumerGroup || unit.subscription || unit.id;
    const key = `${protocol}\0${unit.target}\0${subscriptionKey}`;
    messageGroups.set(key, (messageGroups.get(key) ?? 0) + 1);
  }
  for (const service of Object.keys(run.serviceSnapshots ?? {}).sort()) addNode(nodes, `service:${service}`, "SERVICE", { services: [service], contextIds });
  for (const originalUnit of units) {
    const protocol = (originalUnit.adapter ?? originalUnit.kind ?? "UNKNOWN").split("_")[0].toLowerCase();
    const subscriptionKey = originalUnit.consumerGroup || originalUnit.subscription || originalUnit.id;
    const groupSize = messageGroups.get(`${protocol}\0${originalUnit.target}\0${subscriptionKey}`) ?? 0;
    const unit = groupSize > 1 ? { ...originalUnit, deliverySemantics: "COMPETING_ONE_OF" } : originalUnit;
    const entryId = `entry:${unit.id}`;
    if (unit.service) addNode(nodes, `service:${unit.service}`, "SERVICE", { services: [unit.service], contextIds: unit.contextIds ?? contextIds });
    addNode(nodes, entryId, "ENTRY", { services: unit.service ? [unit.service] : [], entryMembership: [unit.id], contextIds: unit.contextIds ?? contextIds, adapter: unit.adapter ?? unit.kind ?? "UNKNOWN" });
    if (unit.service) addEdge(edges, provenance, "EXPOSES", `service:${unit.service}`, entryId, { entryMembership: [unit.id], services: [unit.service], contextIds: unit.contextIds ?? contextIds, sourceKind: "ENTRY_INVENTORY", evidence: { entryId: unit.id } });
    projectEntrySurface(nodes, edges, provenance, unit, entryId, contextIds);
    const trace = unit.traceResult;
    if (trace?.entrySymbol) {
      addNode(nodes, trace.entrySymbol, "JAVA_SYMBOL", { services: unit.service ? [unit.service] : [], entryMembership: [unit.id], contextIds: unit.contextIds ?? contextIds });
      addEdge(edges, provenance, "DISPATCHES_TO", entryId, trace.entrySymbol, { entryMembership: [unit.id], services: unit.service ? [unit.service] : [], contextIds: unit.contextIds ?? contextIds, sourceKind: "FRAMEWORK_ADAPTER", evidence: trace.entryEvidence ?? {}, validatorReportHashes: unit.validationHash ? [unit.validationHash] : [] });
    }
  }
  for (const node of legacyNodes) addNode(nodes, node.id, node.type === "TABLE" || node.type === "DATA_RESOURCE" ? "DATA_RESOURCE" : "JAVA_SYMBOL", { entryMembership: node.entryMembership, services: node.services, contextIds });
  for (const unit of units) {
    for (const fact of unit.traceResult?.topologyFacts ?? []) {
      if (!fact || !TOPOLOGY_FACT_EDGE_TYPES.has(fact.type) || !nodes.has(fact.from) || !nodes.has(fact.to) || !new Set(["VERIFIED", "CONDITIONAL", "POTENTIAL", "UNRESOLVED"]).has(fact.assurance) || !fact.provenance || typeof fact.provenance !== "object" || Array.isArray(fact.provenance)) throw new Error(`TOPOLOGY_FACT_INVALID:${unit.id}`);
      if (fact.assurance === "UNRESOLVED") throw new Error(`TOPOLOGY_FACT_UNRESOLVED:${unit.id}`);
      addEdge(edges, provenance, fact.type, fact.from, fact.to, { entryMembership: [unit.id], services: unit.service ? [unit.service] : [], contextIds: unit.contextIds ?? contextIds, sourceKind: "FRAMEWORK_ADAPTER", assurance: fact.assurance, evidence: fact.provenance, validatorReportHashes: unit.validationHash ? [unit.validationHash] : [] });
    }
  }
  for (const edge of legacyEdges) {
    const common = { entryMembership: edge.entryMembership, services: edge.services, contextIds: edge.evidence?.contextIds ?? contextIds, evidence: edge.evidence, validatorReportHashes: edge.evidence?.validatorReportHashes ?? [] };
    if (edge.type === "JAVA_CALL" || edge.type === "CODEGRAPH_SPECIAL") {
      addEdge(edges, provenance, edge.type, edge.from, edge.to, { ...common, sourceKind: "CODE_GRAPH", assurance: "VERIFIED" });
    } else if (edge.type === "PERSISTENCE") {
      addEdge(edges, provenance, "ACCESSES", edge.from, edge.to, { ...common, sourceKind: "PERSISTENCE_ADAPTER", assurance: "VERIFIED", semantics: { operation: edge.evidence?.operation ?? "UNKNOWN" } });
    } else if (edge.type === "LOGICAL_BOUNDARY") {
      const kind = edge.evidence?.kind ?? "UNKNOWN";
      const key = edge.evidence?.channelKey ?? edge.evidence?.key ?? `${edge.from}->${edge.to}`;
      if (channelType(kind)) {
        const channel = `channel:${kind.toLowerCase()}:${key}`;
        const subscriptionKey = edge.evidence?.consumerGroup ? `${key}:${edge.evidence.consumerGroup}` : edge.evidence?.key ?? key;
        const subscription = `subscription:${kind.toLowerCase()}:${subscriptionKey}`;
        addNode(nodes, channel, "MESSAGE_CHANNEL", { services: edge.services, entryMembership: edge.entryMembership, contextIds: common.contextIds, protocol: kind, bindingKey: key });
        addNode(nodes, subscription, "MESSAGE_SUBSCRIPTION", { services: edge.services, entryMembership: edge.entryMembership, contextIds: common.contextIds, protocol: kind, bindingKey: subscriptionKey, deliverySemantics: edge.evidence?.deliverySemantics ?? "DIRECT" });
        addEdge(edges, provenance, "PUBLISHES", edge.from, channel, { ...common, sourceKind: "PROTOCOL_BINDING", bindingKey: key });
        addEdge(edges, provenance, "DELIVERS_TO", channel, subscription, { ...common, sourceKind: "PROTOCOL_BINDING", bindingKey: subscriptionKey, semantics: { deliverySemantics: edge.evidence?.deliverySemantics ?? "DIRECT" } });
        addEdge(edges, provenance, "CONSUMES", subscription, edge.to, { ...common, sourceKind: "PROTOCOL_BINDING", bindingKey: subscriptionKey, assurance: edge.evidence?.deliverySemantics === "COMPETING_ONE_OF" ? "POTENTIAL" : "VERIFIED" });
      } else if (new Set(["GRPC", "DUBBO"]).has(kind)) {
        const rpc = `rpc:${kind.toLowerCase()}:${edge.evidence?.key ?? key}`;
        addNode(nodes, rpc, "RPC_OPERATION", { services: edge.services, entryMembership: edge.entryMembership, contextIds: common.contextIds, protocol: kind, bindingKey: edge.evidence?.key ?? key });
        addEdge(edges, provenance, "INVOKES_RPC", edge.from, rpc, { ...common, sourceKind: "PROTOCOL_BINDING", bindingKey: edge.evidence?.key ?? key });
        addEdge(edges, provenance, "DISPATCHES_TO", rpc, edge.to, { ...common, sourceKind: "PROTOCOL_BINDING", bindingKey: edge.evidence?.key ?? key });
      } else {
        addEdge(edges, provenance, new Set(["FEIGN_HTTP", "REST_TEMPLATE_HTTP", "WEBCLIENT_HTTP", "HTTP", "GATEWAY_HTTP"]).has(kind) ? "INVOKES_HTTP" : "DISPATCHES_TO", edge.from, edge.to, { ...common, sourceKind: "PROTOCOL_BINDING", bindingKey: edge.evidence?.key ?? key });
      }
    }
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    provenance: [...provenance.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function writeShards(directory, kind, rows) {
  const target = join(directory, kind);
  await ensureTopologyDirectory(target);
  const groups = new Map();
  for (const row of rows) groups.set(prefixOf(row.id), [...(groups.get(prefixOf(row.id)) ?? []), row]);
  const files = [];
  for (const [prefix, grouped] of [...groups.entries()].sort()) {
    const text = grouped.map(canonicalJson).join("\n") + "\n";
    if (Buffer.byteLength(text) > MAX_SHARD_BYTES) throw new Error(`TOPOLOGY_SHARD_TOO_LARGE:${kind}:${prefix}`);
    const relative = `${kind}/${prefix}.jsonl`;
    await safeWriteTopologyFile(directory, relative, text);
    files.push({ path: relative, bytes: Buffer.byteLength(text), rows: grouped.length, hash: sha256(text) });
  }
  return files;
}

function adjacencyRows(edges, direction) {
  const grouped = new Map();
  for (const edge of edges) {
    const key = direction === "out" ? edge.from : edge.to;
    grouped.set(key, [...(grouped.get(key) ?? []), { edgeId: edge.id, from: edge.from, to: edge.to, type: edge.type, assurance: edge.assurance, entryMembership: edge.entryMembership, contextIds: edge.contextIds }]);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, rows]) => ({ id, rows: rows.sort((a, b) => a.edgeId.localeCompare(b.edgeId)) }));
}

export async function writeTopologyBundle(graphDirectory, run, legacyNodes, legacyEdges) {
  const directory = join(graphDirectory, "v2");
  await ensureTopologyDirectory(directory);
  const topology = createTopology(run, legacyNodes, legacyEdges);
  const files = [
    ...await writeShards(directory, "nodes", topology.nodes),
    ...await writeShards(directory, "edges", topology.edges),
    ...await writeShards(directory, "provenance", topology.provenance),
    ...await writeShards(directory, "adjacency-out", adjacencyRows(topology.edges, "out")),
    ...await writeShards(directory, "adjacency-in", adjacencyRows(topology.edges, "in")),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const rootPayload = { schemaVersion: "2.0", formatVersion: FORMAT_VERSION, prefixLength: PREFIX_LENGTH, nodeCount: topology.nodes.length, edgeCount: topology.edges.length, provenanceCount: topology.provenance.length, contextIds: run.contextIds ?? ["default"], resolutionContextHash: run.resolutionContextHash, files };
  const topologyRootHash = sha256(canonicalJson(rootPayload));
  const meta = { ...rootPayload, topologyRootHash };
  await safeWriteTopologyFile(directory, "meta.json", `${canonicalJson(meta)}\n`);
  return meta;
}

async function readShard(directory, kind, id, meta) {
  const relative = `${kind}/${prefixOf(id)}.jsonl`;
  const descriptor = meta.files.find((file) => file.path === relative);
  if (!descriptor) return [];
  if (!Number.isInteger(descriptor.bytes) || descriptor.bytes < 0 || descriptor.bytes > MAX_SHARD_BYTES) throw new Error("TOPOLOGY_FILE_DESCRIPTOR_INVALID");
  const bytes = await safeReadTopologyFile(directory, relative);
  if (bytes.length !== descriptor.bytes || bytes.length > MAX_SHARD_BYTES || sha256(bytes) !== descriptor.hash) throw new Error("TOPOLOGY_SHARD_HASH_MISMATCH");
  return bytes.toString("utf8").split("\n").filter(Boolean).map(JSON.parse);
}

export async function verifyTopologyBundle(snapshotGraphDirectory) {
  const directory = join(snapshotGraphDirectory, "v2");
  const metaBytes = await safeReadTopologyFile(directory, "meta.json");
  const meta = JSON.parse(metaBytes.toString("utf8"));
  const withoutRoot = { ...meta };
  delete withoutRoot.topologyRootHash;
  if (meta.schemaVersion !== "2.0" || meta.formatVersion !== FORMAT_VERSION || sha256(canonicalJson(withoutRoot)) !== meta.topologyRootHash) throw new Error("TOPOLOGY_ROOT_HASH_MISMATCH");
  if (!Array.isArray(meta.files) || meta.files.length > 2_000) throw new Error("TOPOLOGY_FILE_LIST_INVALID");
  const seen = new Set();
  const nodeIds = new Set();
  const edges = new Map();
  const provenance = new Map();
  for (const descriptor of meta.files) {
    if (!descriptor || typeof descriptor.path !== "string" || !/^(nodes|edges|provenance|adjacency-(?:in|out))\/[0-9a-f]{2}\.jsonl$/.test(descriptor.path) || seen.has(descriptor.path)) throw new Error("TOPOLOGY_FILE_DESCRIPTOR_INVALID");
    seen.add(descriptor.path);
    if (!Number.isInteger(descriptor.bytes) || descriptor.bytes < 0 || descriptor.bytes > MAX_SHARD_BYTES || !Number.isInteger(descriptor.rows) || descriptor.rows < 0) throw new Error("TOPOLOGY_FILE_DESCRIPTOR_INVALID");
    const bytes = await safeReadTopologyFile(directory, descriptor.path);
    if (bytes.length !== descriptor.bytes || bytes.length > MAX_SHARD_BYTES || sha256(bytes) !== descriptor.hash) throw new Error("TOPOLOGY_SHARD_HASH_MISMATCH");
    const rows = bytes.toString("utf8").split("\n").filter(Boolean);
    if (rows.length !== descriptor.rows) throw new Error("TOPOLOGY_SHARD_ROW_COUNT_MISMATCH");
    const kind = descriptor.path.split("/", 1)[0];
    for (const row of rows) {
      const parsed = JSON.parse(row);
      if (kind === "nodes") {
        if (!parsed.id || nodeIds.has(parsed.id)) throw new Error("TOPOLOGY_NODE_ID_INVALID");
        nodeIds.add(parsed.id);
      } else if (kind === "edges") {
        if (!parsed.id || edges.has(parsed.id)) throw new Error("TOPOLOGY_EDGE_ID_INVALID");
        edges.set(parsed.id, parsed);
      } else if (kind === "provenance") {
        if (!parsed.id || provenance.has(parsed.id)) throw new Error("TOPOLOGY_PROVENANCE_ID_INVALID");
        provenance.set(parsed.id, parsed);
      }
    }
  }
  if (nodeIds.size !== meta.nodeCount || edges.size !== meta.edgeCount || provenance.size !== meta.provenanceCount) throw new Error("TOPOLOGY_META_COUNT_MISMATCH");
  for (const edge of edges.values()) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || !Array.isArray(edge.provenanceIds) || edge.provenanceIds.length === 0 || edge.provenanceIds.some((id) => !provenance.has(id))) throw new Error("TOPOLOGY_EDGE_REFERENCE_INVALID");
  }
  for (const record of provenance.values()) if (!edges.has(record.edgeId)) throw new Error("TOPOLOGY_PROVENANCE_REFERENCE_INVALID");
  return meta;
}

function cursorFor(rootHash, queryHash, offset) {
  const payload = Buffer.from(canonicalJson({ rootHash, queryHash, offset }), "utf8").toString("base64url");
  return `${payload}.${sha256(payload).slice(7)}`;
}

function parseCursor(token, rootHash, queryHash) {
  if (!token) return 0;
  if (typeof token !== "string" || token.length > 2048) throw new Error("CURSOR_INVALID");
  const [payload, digest, extra] = token.split(".");
  if (extra !== undefined || digest !== sha256(payload).slice(7)) throw new Error("CURSOR_INVALID");
  const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (value.rootHash !== rootHash || value.queryHash !== queryHash || !Number.isInteger(value.offset) || value.offset < 0) throw new Error("CURSOR_SNAPSHOT_OR_QUERY_MISMATCH");
  return value.offset;
}

export async function queryTopologyBundle(snapshotGraphDirectory, input) {
  const directory = join(snapshotGraphDirectory, "v2");
  const meta = JSON.parse((await safeReadTopologyFile(directory, "meta.json")).toString("utf8"));
  const withoutRoot = { ...meta }; delete withoutRoot.topologyRootHash;
  if (meta.schemaVersion !== "2.0" || meta.formatVersion !== FORMAT_VERSION || sha256(canonicalJson(withoutRoot)) !== meta.topologyRootHash) throw new Error("TOPOLOGY_ROOT_HASH_MISMATCH");
  const limit = input.limit === undefined ? 50 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("QUERY_LIMIT_INVALID");
  if (typeof input.key !== "string" || !input.key || input.key.length > 2048) throw new Error("QUERY_KEY_INVALID");
  const contextId = input.contextId ?? null;
  if (contextId && !meta.contextIds.includes(contextId)) throw new Error("CONTEXT_NOT_FOUND");
  const queryHash = sha256(canonicalJson({ query: input.query, key: input.key, contextId, direction: input.direction ?? "both" }));
  const offset = parseCursor(input.cursor, meta.topologyRootHash, queryHash);
  const started = Date.now();
  if (input.query === "explain") {
    const node = (await readShard(directory, "nodes", input.key, meta)).find((row) => row.id === input.key);
    if (!node || (contextId && !node.contextIds?.includes(contextId))) return { schemaVersion: "2.0", topologyRootHash: meta.topologyRootHash, queryHash, returnedCount: 0, complete: true, cutoffReason: null, rows: [], cursor: null };
    let adjacent = [...(await readShard(directory, "adjacency-out", input.key, meta)), ...(await readShard(directory, "adjacency-in", input.key, meta))].filter((row) => row.id === input.key).flatMap((row) => row.rows);
    if (contextId) adjacent = adjacent.filter((row) => !row.contextIds || row.contextIds.includes(contextId));
    const visitLimited = adjacent.length > MAX_VISITS;
    adjacent = adjacent.slice(0, MAX_VISITS);
    const pageAdjacent = adjacent.slice(offset, offset + limit);
    const edgeRows = [];
    const provenanceRows = [];
    let timedOut = false;
    for (const adjacentRow of pageAdjacent) {
      const edge = (await readShard(directory, "edges", adjacentRow.edgeId, meta)).find((row) => row.id === adjacentRow.edgeId);
      if (edge) {
        edgeRows.push(edge);
        for (const provenanceId of edge.provenanceIds ?? []) {
          const record = (await readShard(directory, "provenance", provenanceId, meta)).find((row) => row.id === provenanceId);
          if (record) provenanceRows.push(record);
        }
      }
      if (Date.now() - started > MAX_QUERY_MS) { timedOut = true; break; }
    }
    const morePage = !timedOut && offset + pageAdjacent.length < adjacent.length;
    const complete = !timedOut && !visitLimited && !morePage;
    const cutoffReason = timedOut ? "MAX_QUERY_MS" : visitLimited && !morePage ? "MAX_VISITS" : morePage ? "PAGE_LIMIT" : null;
    return { schemaVersion: "2.0", topologyRootHash: meta.topologyRootHash, queryHash, returnedCount: edgeRows.length, complete, cutoffReason, rows: [{ node, edges: edgeRows, provenance: provenanceRows }], cursor: morePage ? cursorFor(meta.topologyRootHash, queryHash, offset + pageAdjacent.length) : null };
  }
  let rows = [];
  let cutoffReason = null;
  if (input.query === "node") {
    rows = (await readShard(directory, "nodes", input.key, meta)).filter((row) => row.id === input.key);
  } else if (input.query === "neighbors") {
    const kinds = input.direction === "in" ? ["adjacency-in"] : input.direction === "out" ? ["adjacency-out"] : ["adjacency-out", "adjacency-in"];
    rows = (await Promise.all(kinds.map((kind) => readShard(directory, kind, input.key, meta)))).flat().filter((row) => row.id === input.key).flatMap((row) => row.rows);
    if (rows.length > MAX_VISITS) {
      rows = rows.slice(0, MAX_VISITS);
      cutoffReason = "MAX_VISITS";
    }
  } else {
    throw new Error("TOPOLOGY_QUERY_UNSUPPORTED");
  }
  if (contextId) rows = rows.filter((row) => !row.contextIds || row.contextIds.includes(contextId) || row.node?.contextIds?.includes(contextId));
  const page = rows.slice(offset, offset + limit);
  if (!cutoffReason && Date.now() - started > MAX_QUERY_MS) cutoffReason = "MAX_QUERY_MS";
  const complete = !cutoffReason && offset + page.length >= rows.length;
  const pageLimited = !cutoffReason && !complete;
  return { schemaVersion: "2.0", topologyRootHash: meta.topologyRootHash, queryHash, returnedCount: page.length, complete, cutoffReason: cutoffReason ?? (pageLimited ? "PAGE_LIMIT" : null), rows: page, cursor: pageLimited ? cursorFor(meta.topologyRootHash, queryHash, offset + page.length) : null };
}

export const __test = Object.freeze({ canonicalJson, createTopology, cursorFor, parseCursor, prefixOf, safeReadTopologyFile, safeWriteTopologyFile, sha256 });
