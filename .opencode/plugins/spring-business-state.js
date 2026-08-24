import { tool } from "@opencode-ai/plugin";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { resolveAnalysisContexts } from "./spring-business/config-resolver.js";
import { queryTopologyBundle, verifyTopologyBundle, writeTopologyBundle } from "./spring-business/graph-v2.js";

const SCHEMA_VERSION = "2.0";
const TOOLKIT_VERSION = "2.0.0";
const MAX_STRUCTURED_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_GRAPH_BYTES = 64 * 1024 * 1024;
const MAX_GRAPH_ROWS = 500_000;
const MAX_PATH_VISITS = 100_000;
const CACHE_RELATIVE = ".opencode/.cache/spring-business-tracer/runs";
const PRIMARY_AGENT = "spring-business-orchestrator";
const SAFE_CONFIG_AGENTS = new Set([
  PRIMARY_AGENT,
  "spring-boundary-validator",
  "spring-config-auditor",
  "spring-coverage-auditor",
  "spring-entry-worker",
  "spring-incremental-validator",
  "spring-trace-validator",
  "spring-trace-worker",
]);
const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const WORKER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const OPERATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;
const ENTRY_ADAPTERS = new Set(["SPRING_MVC", "SPRING_WEBFLUX", "SPRING_WEBFLUX_ANNOTATED", "WEBFLUX_FUNCTIONAL_STATIC_HANDLER", "KAFKA", "KAFKA_LISTENER", "RABBIT", "RABBIT_LISTENER", "JMS", "JMS_STATIC_LISTENER", "ROCKETMQ", "SCHEDULED", "QUARTZ", "QUARTZ_STATIC_JOB_TRIGGER", "XXL_JOB", "SPRING_EVENT", "DUBBO", "GRPC", "GRPC_UNARY_PROTO", "GRAPHQL", "GRAPHQL_ANNOTATED_ROOT", "APPLICATION_RUNNER", "KAFKA_STREAMS"]);
const execFileAsync = promisify(execFile);
const SOURCE_EXTENSIONS = new Set([".java", ".xml", ".sql", ".properties", ".yml", ".yaml", ".json", ".gradle", ".kts", ".proto", ".graphql", ".graphqls", ".conf", ".toml"]);
const ALWAYS_IGNORED_DIRECTORIES = new Set([".git", ".codegraph", ".opencode", "node_modules"]);
const BUILD_DIRECTORIES = new Set(["target", "build", "out"]);
const COMMIT_STATES = new Set([
  "TRACED",
  "VERIFIED",
  "PUBLISHED",
  "RETRYABLE_FAILED",
  "BLOCKED",
  "FAILED",
]);
const ACTIVE_UNIT_STATES = new Set(["LEASED"]);
const REPORT_SPECS = {
  TRACE: {
    agent: "spring-trace-validator",
    checks: ["ENTRY_IDENTITY", "JAVA_EDGE_REPLAY", "PERSISTENCE_EVIDENCE", "NO_TEXT_EDGE", "QUERY_COMPLETENESS"],
  },
  COVERAGE: {
    agent: "spring-coverage-auditor",
    checks: ["ENTRY_SET_EQUAL", "ADAPTER_COVERAGE", "EXCLUSIONS_REVIEWED"],
  },
  BOUNDARY: {
    agent: "spring-boundary-validator",
    checks: ["BOUNDARY_SET_EQUAL", "TWO_SIDED_EVIDENCE", "UNRESOLVED_ACCOUNTED"],
  },
  INCREMENTAL: {
    agent: "spring-incremental-validator",
    checks: ["BASELINE_COMPLETE", "ENTRY_SET_REDISCOVERED", "SERVICE_CLOSURE_SAFE", "CONFIG_DEPENDENCY_CLOSURE", "CHANGED_SERVICES_EXACT", "TOMBSTONES_ACCOUNTED"],
  },
  CONFIG: {
    agent: "spring-config-auditor",
    checks: ["CONFIG_PRECEDENCE", "PLACEHOLDER_RESOLUTION", "EXTERNALS_ACCOUNTED", "SECRETS_REDACTED"],
  },
};

function nowIso() {
  return new Date().toISOString();
}

function assertIdentifier(value, pattern, label) {
  if (!pattern.test(value)) throw new Error(`${label}格式非法`);
}

function assertPrimary(context) {
  if (context.agent !== PRIMARY_AGENT) {
    throw new Error(`状态工具只允许${PRIMARY_AGENT}调用`);
  }
}

function assertSafeConfigAgent(context) {
  if (!SAFE_CONFIG_AGENTS.has(context.agent)) throw new Error(`Agent ${context.agent}不能解析配置上下文`);
}

function cacheRoot(worktree) {
  const root = resolve(worktree);
  const target = resolve(root, CACHE_RELATIVE);
  if (!target.startsWith(root + sep)) throw new Error("状态目录越出工作区");
  return target;
}

function runPaths(worktree, runId) {
  assertIdentifier(runId, RUN_ID, "runId");
  const directory = join(cacheRoot(worktree), runId);
  return {
    directory,
    state: join(directory, "run.json"),
    lock: join(directory, ".lock"),
  };
}

async function ensureSafeRunDirectory(worktree, runId, create = true) {
  assertIdentifier(runId, RUN_ID, "runId");
  const root = resolve(worktree);
  const rootReal = await realpath(root);
  let current = root;
  for (const segment of [".opencode", ".cache", "spring-business-tracer", "runs", runId]) {
    current = join(current, segment);
    if (create) {
      await mkdir(current, { recursive: false }).catch((error) => {
        if (error?.code !== "EEXIST") throw error;
      });
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`状态路径包含符号链接或非目录：${current}`);
    const currentReal = await realpath(current);
    if (currentReal !== rootReal && !currentReal.startsWith(rootReal + sep)) throw new Error("状态目录越出工作区");
  }
}

async function ensureSafeCacheBase(worktree) {
  const root = resolve(worktree);
  const rootReal = await realpath(root);
  let current = root;
  for (const segment of [".opencode", ".cache", "spring-business-tracer"]) {
    current = join(current, segment);
    await mkdir(current, { recursive: false }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`缓存路径包含符号链接或非目录：${current}`);
    const currentReal = await realpath(current);
    if (currentReal !== rootReal && !currentReal.startsWith(rootReal + sep)) throw new Error("缓存目录越出工作区");
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return `sha256:${hash.digest("hex")}`;
}

async function collectSourceFiles(root, directory = root, collected = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const relative = path.slice(root.length + 1).split(sep);
      const insideSourceTree = relative.includes("src");
      const generatedOutput = relative[0] === "docs" && relative[1] === "spring-business";
      if (!ALWAYS_IGNORED_DIRECTORIES.has(entry.name) && !generatedOutput && !(BUILD_DIRECTORIES.has(entry.name) && !insideSourceTree)) {
        await collectSourceFiles(root, path, collected);
      }
      continue;
    }
    const extension = entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : "";
    if (SOURCE_EXTENSIONS.has(extension) || new Set(["pom.xml", "settings.gradle", "build.gradle"]).has(entry.name)) {
      collected.push(path);
    }
  }
  return collected;
}

async function defaultCodeGraphStatus(root) {
  const { stdout, stderr } = await execFileAsync("codegraph", ["status", root, "-j"], {
    cwd: root,
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (stderr.trim()) throw new Error(`Code Graph status失败：${stderr.trim()}`);
  const status = JSON.parse(stdout);
  const pending = status.pendingChanges ?? {};
  const expectedPath = await realpath(root);
  const actualPath = status.projectPath ? await realpath(status.projectPath) : null;
  const compatibleVersion = typeof status.version === "string" && status.index?.builtWithVersion === status.version;
  const extractionVersion = Number.isInteger(status.index?.currentExtractionVersion) && status.index.currentExtractionVersion > 0;
  const compatibleExtraction = status.index?.builtWithExtractionVersion === status.index?.currentExtractionVersion;
  const javaIndexed = Array.isArray(status.languages) && status.languages.includes("java");
  if (!status.initialized || actualPath !== expectedPath || !compatibleVersion || !extractionVersion || !compatibleExtraction || !javaIndexed ||
      status.index?.state !== "complete" || Object.values(pending).some((value) => Number(value) !== 0) ||
      status.worktreeMismatch !== null || status.index?.reindexRecommended) {
    throw new Error(`Code Graph索引不完整或存在待同步变化：${root}`);
  }
  return status;
}

async function defaultCodeGraphVersion(root) {
  const { stdout, stderr } = await execFileAsync("codegraph", ["--version"], {
    cwd: root,
    timeout: 10_000,
    maxBuffer: 256 * 1024,
  });
  return `${stdout}\n${stderr}`.trim();
}

async function computeSourceSnapshot(root, files) {
  const aggregate = createHash("sha256");
  for (const path of files) {
    const key = path.slice(root.length + 1);
    const before = await stat(path, { bigint: true });
    const contentHash = sha256([await readFile(path)]);
    const after = await stat(path, { bigint: true });
    const beforeSignature = [before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs].join(":");
    const afterSignature = [after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].join(":");
    if (beforeSignature !== afterSignature) throw new Error(`计算指纹期间源码发生变化：${key}`);
    aggregate.update(key);
    aggregate.update("\0");
    aggregate.update(contentHash);
    aggregate.update("\0");
  }
  return `sha256:${aggregate.digest("hex")}`;
}

async function collectToolkitFiles(root) {
  const files = [];
  const collect = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!new Set(["node_modules", ".cache", "spring-business-tracer-workspace"]).has(entry.name)) await collect(path);
      } else {
        files.push(path);
      }
    }
  };
  for (const relativeRoot of [".opencode/skills/spring-business-tracer", ".opencode/agents", ".opencode/commands", ".opencode/plugins"]) {
    const absoluteRoot = join(root, relativeRoot);
    try {
      await collect(absoluteRoot);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return [...new Set(files)].sort();
}

async function computeWorkspaceFingerprints(worktree, options = {}) {
  const root = resolve(worktree);
  const configPath = join(root, ".opencode/spring-business-tracer.json");
  const config = await readJson(configPath);
  const configuredServices = config.workspace?.services?.length
    ? config.workspace.services
    : [{ id: "workspace", root: ".", codeGraphProjectPath: "." }];
  const services = [];
  const serviceIds = new Set();
  for (const service of configuredServices) {
    if (typeof service.id !== "string" || !service.id || serviceIds.has(service.id)) throw new Error(`服务id缺失或重复：${service.id}`);
    if (typeof service.root !== "string" || !service.root || service.root.includes("\0")) throw new Error(`服务${service.id}的root非法`);
    serviceIds.add(service.id);
    const serviceRoot = resolve(root, service.root);
    if (serviceRoot !== root && !serviceRoot.startsWith(root + sep)) throw new Error("服务源码根越出工作区");
    const serviceReal = await realpath(serviceRoot);
    const rootReal = await realpath(root);
    if (serviceReal !== rootReal && !serviceReal.startsWith(rootReal + sep)) throw new Error("服务源码根符号链接越出工作区");
    const projectPath = resolve(root, service.codeGraphProjectPath ?? service.root);
    const projectReal = await realpath(projectPath);
    if (projectReal !== rootReal && !projectReal.startsWith(rootReal + sep)) throw new Error("Code Graph projectPath越出工作区");
    services.push({ id: service.id, root: serviceReal, relativeRoot: service.root, projectPath: projectReal });
  }
  const statusRunner = options.codeGraphStatus ?? defaultCodeGraphStatus;
  const versionRunner = options.codeGraphVersion ?? defaultCodeGraphVersion;
  const indexParts = [];
  indexParts.push("codegraph-version", "\0", await versionRunner(root), "\0");
  const serviceSnapshots = Object.create(null);
  const serviceRoots = Object.create(null);
  const indexMetadata = Object.create(null);
  const allFiles = [];
  for (const service of services) {
    const files = await collectSourceFiles(service.root, service.root, []);
    const uniqueFiles = [...new Set(files)].sort();
    allFiles.push(...uniqueFiles);
    serviceSnapshots[service.id] = await computeSourceSnapshot(service.root, uniqueFiles);
    serviceRoots[service.id] = service.relativeRoot;
    const status = await statusRunner(service.projectPath);
    const normalizedStatus = typeof status === "string" ? { legacyText: status } : status;
    indexMetadata[service.id] = normalizedStatus;
    indexParts.push(service.id, "\0", canonicalJson(normalizedStatus), "\0");
  }
  const uniqueFiles = [...new Set(allFiles)].sort();
  const toolkitFiles = await collectToolkitFiles(root);
  const resolution = await resolveAnalysisContexts(root, config);
  const adapterRegistryFingerprint = sha256([canonicalJson(config.adapterRegistry ?? {})]);
  const queryLimit = Number(config.codeGraph?.queryLimit ?? Number(config.analysis?.maxBranches ?? 100) + 1);
  if (!Number.isInteger(queryLimit) || queryLimit < 2 || queryLimit > 1000) throw new Error("配置codeGraph.queryLimit必须为2到1000的整数");
  return {
    configHash: sha256([canonicalJson(config)]),
    sourceSnapshot: await computeSourceSnapshot(root, uniqueFiles),
    indexFingerprint: sha256(indexParts),
    toolkitFingerprint: await computeSourceSnapshot(root, toolkitFiles),
    resolutionContextHash: resolution.resolutionContextHash,
    adapterRegistryFingerprint,
    contextIds: resolution.contexts.map((context) => context.id),
    resolutionSummary: resolution,
    serviceSnapshots,
    serviceRoots,
    indexMetadata,
    sourceFileCount: uniqueFiles.length,
    serviceRootCount: services.length,
    queryLimit,
  };
}

async function readJson(path) {
  return JSON.parse((await readRegularFile(path, MAX_GRAPH_BYTES)).toString("utf8"));
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function atomicWriteText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function ensureSafeDirectoryChain(root, relativeDirectory, create = true) {
  const rootReal = await realpath(root);
  let current = root;
  for (const segment of relativeDirectory.split("/").filter(Boolean)) {
    current = join(current, segment);
    if (create) {
      await mkdir(current, { recursive: false }).catch((error) => {
        if (error?.code !== "EEXIST") throw error;
      });
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`目录链包含符号链接或非目录：${current}`);
    const currentReal = await realpath(current);
    if (currentReal !== rootReal && !currentReal.startsWith(rootReal + sep)) throw new Error("目录链越出工作区");
  }
  return current;
}

async function acquireLock(lockPath) {
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      const token = randomUUID();
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: nowIso() }), "utf8");
      await handle.sync();
      return { handle, token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 30_000) {
          let ownerAlive = false;
          try {
            const owner = await readJson(lockPath);
            if (Number.isInteger(owner.pid)) {
              try {
                process.kill(owner.pid, 0);
                ownerAlive = true;
              } catch (ownerError) {
                if (ownerError?.code !== "ESRCH") ownerAlive = true;
              }
            }
          } catch {
            ownerAlive = false;
          }
          if (!ownerAlive) await unlink(lockPath);
        }
      } catch (statError) {
        if (statError?.code !== "ENOENT") throw statError;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
  throw new Error("状态锁等待超时");
}

async function withRunLock(worktree, runId, callback) {
  await ensureSafeRunDirectory(worktree, runId);
  const paths = runPaths(worktree, runId);
  const lock = await acquireLock(paths.lock);
  try {
    return await callback(paths);
  } finally {
    await lock.handle.close();
    try {
      const owner = await readJson(paths.lock);
      if (owner.token === lock.token) await unlink(paths.lock);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function updateCounters(run) {
  const counts = {};
  for (const unit of Object.values(run.units)) {
    counts[unit.status] = (counts[unit.status] ?? 0) + 1;
  }
  run.counts = counts;
  run.updatedAt = nowIso();
  if (run.events.length > 2000) run.events = run.events.slice(-2000);
}

function assertCurrentRun(run) {
  if (run.schemaVersion !== SCHEMA_VERSION) throw new Error(`旧版run ${run.schemaVersion}只读；V2.0要求FULL_REBASE，不能直接复用分析结论`);
}

function recoverExpiredLeases(run, timestamp = Date.now()) {
  let recovered = 0;
  for (const unit of Object.values(run.units)) {
    if (unit.status === "LEASED" && Date.parse(unit.leaseUntil) <= timestamp) {
      const stage = unit.leaseStage ?? unit.retryStage ?? "TRACE";
      const attempts = unit.stageAttempts?.[stage] ?? unit.attempts;
      unit.status = attempts > run.retryLimit ? "FAILED" : "RETRYABLE_FAILED";
      unit.retryStage = stage;
      unit.leaseOwner = null;
      unit.leaseUntil = null;
      unit.fingerprintToken = null;
      unit.batchId = null;
      unit.lastError = unit.status === "FAILED" ? "RETRY_LIMIT_EXCEEDED" : "LEASE_EXPIRED";
      recovered += 1;
    }
  }
  return recovered;
}

function operationReplay(run, input) {
  if (!input.operationId) return null;
  assertIdentifier(input.operationId, OPERATION_ID, "operationId");
  const digest = sha256([canonicalJson({ ...input, operationId: undefined })]);
  const existing = run.recentOperations?.[input.operationId];
  if (!existing) return { digest };
  if (existing.digest !== digest) throw new Error("operationId已用于不同请求");
  return { digest, result: existing.result };
}

function recordOperation(run, input, digest, resultValue) {
  if (!input.operationId) return;
  const storedResult = resultValue === run
    ? { runId: run.runId, phase: run.phase, counts: { ...run.counts } }
    : structuredClone(resultValue);
  run.recentOperations[input.operationId] = { digest, at: nowIso(), result: storedResult };
  const ids = Object.keys(run.recentOperations);
  if (ids.length > 2000) {
    for (const id of ids.slice(0, ids.length - 2000)) delete run.recentOperations[id];
  }
}

function fingerprintMatches(run, input) {
  return (
    run.configHash === input.configHash &&
    run.sourceSnapshot === input.sourceSnapshot &&
    run.indexFingerprint === input.indexFingerprint &&
    run.toolkitFingerprint === input.toolkitFingerprint &&
    run.resolutionContextHash === input.resolutionContextHash &&
    run.adapterRegistryFingerprint === input.adapterRegistryFingerprint
  );
}

function leaseFingerprintToken(run, unit, workerId, leaseUntil) {
  return sha256([
    run.runId, "\0", unit.id, "\0", String(unit.attempts), "\0", workerId, "\0", leaseUntil, "\0",
    run.configHash, "\0", run.sourceSnapshot, "\0", run.indexFingerprint, "\0", run.toolkitFingerprint, "\0", run.resolutionContextHash, "\0", run.adapterRegistryFingerprint, "\0", randomUUID(),
  ]);
}

async function requireFreshFingerprints(run, input, paths, eventType) {
  if (fingerprintMatches(run, input)) return;
  run.phase = "STALE";
  run.pauseRequested = false;
  run.events.push({ at: nowIso(), type: eventType });
  updateCounters(run);
  await atomicWriteJson(paths.state, run);
  throw new Error("运行指纹已变化，状态标记为STALE");
}

function assertFingerprintObject(value, run, label) {
  if (!value || typeof value !== "object") throw new Error(`${label}缺少fingerprints`);
  if (value.config !== run.configHash || value.source !== run.sourceSnapshot || value.index !== run.indexFingerprint || value.toolkit !== run.toolkitFingerprint || value.resolvedConfig !== run.resolutionContextHash || value.adapterRegistry !== run.adapterRegistryFingerprint) {
    throw new Error(`${label}指纹与当前运行不一致`);
  }
}

function assertPassedChecks(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须包含非空checks`);
  if (value.some((check) => !check || check.passed !== true || typeof check.code !== "string" || !check.code || !Array.isArray(check.evidence))) {
    throw new Error(`${label}包含未通过或非法check`);
  }
}

const CODE_GRAPH_TOOL = /^codegraph_[a-z][a-z0-9_]*$/;

function isCodeGraphTool(value) {
  return typeof value === "string" && CODE_GRAPH_TOOL.test(value);
}

function assertCompleteQueryLog(value, run, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label}必须包含非空queryLog`);
  for (const query of value) {
    const limit = Number(query?.args?.limit);
    const resultCount = Number(query?.resultCount);
    if (!isCodeGraphTool(query?.tool) || !Number.isInteger(limit) || limit !== run.queryLimit || !Number.isInteger(resultCount) || resultCount < 0 || resultCount >= limit || query.truncated !== false) {
      throw new Error(`${label}的每条Code Graph查询必须使用limit=${run.queryLimit}，记录resultCount<limit且truncated=false`);
    }
  }
}

function assertTraceEdges(value, run) {
  const queryTools = new Set(value.queryLog.map((query) => query.tool));
  if (!Array.isArray(value.javaEdges) || value.javaEdges.some((edge) =>
    typeof edge?.from !== "string" || !edge.from || typeof edge?.to !== "string" || !edge.to ||
    !isCodeGraphTool(edge?.tool) || !queryTools.has(edge.tool) || Number(edge?.query?.limit) !== run.queryLimit ||
    typeof edge?.file !== "string" || !edge.file || !Number.isInteger(edge?.line) || edge.line < 1)) {
    throw new Error("traceResult包含非法Java边：每条边必须绑定本次Code Graph查询、源码文件和正行号");
  }
  if (value.specialEdges !== undefined && (!Array.isArray(value.specialEdges) || value.specialEdges.some((edge) =>
    typeof edge?.from !== "string" || !edge.from || typeof edge?.to !== "string" || !edge.to ||
    typeof edge?.kind !== "string" || !edge.kind || !isCodeGraphTool(edge?.tool) || !queryTools.has(edge.tool) ||
    Number(edge?.query?.limit) !== run.queryLimit))) {
    throw new Error("traceResult包含非法特殊边：每条边必须绑定本次Code Graph查询");
  }
}

function parseStructuredJson(text, label, expected = "object") {
  if (typeof text !== "string" || !text.trim()) throw new Error(`${label}不能为空`);
  if (Buffer.byteLength(text) > MAX_STRUCTURED_INPUT_BYTES) throw new Error(`${label}超过8MiB上限`);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || (expected === "array" ? !Array.isArray(value) : Array.isArray(value))) throw new Error();
    return value;
  } catch {
    throw new Error(`${label}不是合法JSON${expected === "array" ? "数组" : "对象"}`);
  }
}

async function readRegularFile(path, maximumBytes = MAX_GRAPH_BYTES) {
  let handle;
  try {
    const lexicalInfo = await lstat(path);
    if (lexicalInfo.isSymbolicLink() || !lexicalInfo.isFile() || lexicalInfo.nlink !== 1) throw new Error(`拒绝读取符号链接、多硬链或非普通文件：${path}`);
    if (lexicalInfo.size > maximumBytes) throw new Error(`文件超过${maximumBytes}字节资源上限：${path}`);
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maximumBytes || info.dev !== lexicalInfo.dev || info.ino !== lexicalInfo.ino) throw new Error(`路径不是安全普通文件：${path}`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.nlink !== 1 || after.dev !== info.dev || after.ino !== info.ino || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs || bytes.length !== info.size) throw new Error(`读取期间文件发生变化：${path}`);
    return bytes;
  } catch (error) {
    if (error?.code === "ELOOP") throw new Error(`拒绝读取符号链接：${path}`);
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readWorkspaceArtifact(worktree, relativePath, allowedPrefix, maximumBytes = MAX_GRAPH_BYTES) {
  if (typeof relativePath !== "string" || !relativePath.startsWith(allowedPrefix)) throw new Error(`工件路径必须位于${allowedPrefix}`);
  const root = resolve(worktree);
  const target = resolve(root, relativePath);
  if (!target.startsWith(root + sep)) throw new Error("工件路径越出工作区");
  let current = root;
  for (const segment of relativePath.split("/").slice(0, -1)) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`工件路径包含符号链接或非目录：${current}`);
  }
  return readRegularFile(target, maximumBytes);
}

function validateTraceResult(run, unit, text) {
  const value = parseStructuredJson(text, "traceResultJson");
  if (value.schemaVersion !== SCHEMA_VERSION || value.runId !== run.runId || value.entryId !== unit.id || value.status !== "TRACED") {
    throw new Error("traceResult版本、runId、entryId或status不匹配");
  }
  assertFingerprintObject(value.fingerprints, run, "traceResult");
  assertCompleteQueryLog(value.queryLog, run, "traceResult");
  assertTraceEdges(value, run);
  if (!Array.isArray(value.serviceClosure) || value.serviceClosure.length === 0 || !value.serviceClosure.includes(unit.service)) {
    throw new Error("traceResult缺少包含入口服务的serviceClosure");
  }
  const knownServices = new Set(Object.keys(run.serviceSnapshots));
  if (value.serviceClosure.some((service) => !knownServices.has(service))) throw new Error("serviceClosure包含未知服务");
  if (!Array.isArray(value.boundaries) || value.boundaries.some((boundary) => !boundary?.id || !boundary?.kind || !boundary?.source || !new Set(["CANDIDATE", "VERIFIED", "UNRESOLVED", "REJECTED"]).has(boundary?.status))) {
    throw new Error("traceResult包含非法逻辑边界");
  }
  if (!Array.isArray(value.persistence) || value.persistence.some((item) => !item?.symbol || !item?.resource || !item?.storeId || item?.resourceKind !== "RELATIONAL_TABLE" || !item?.operation || !item?.evidence)) {
    throw new Error("traceResult包含缺少storeId/resourceKind/evidence的持久化事实");
  }
  if (!Array.isArray(value.contextIds) || value.contextIds.length === 0 || value.contextIds.some((id) => !run.contextIds.includes(id))) throw new Error("traceResult缺少合法contextIds");
  if (!Array.isArray(value.configDependencyIds) || value.configDependencyIds.some((id) => typeof id !== "string" || !id)) throw new Error("traceResult缺少configDependencyIds");
  if (!Array.isArray(value.topologyFacts) || !Array.isArray(value.unresolvedFindings)) throw new Error("traceResult缺少topologyFacts或unresolvedFindings");
  return value;
}

async function writeTraceArtifact(paths, run, unit, value) {
  const relative = `artifacts/${unit.id}/trace.json`;
  await ensureSafeDirectoryChain(paths.directory, dirname(relative).split(sep).join("/"));
  const path = join(paths.directory, relative);
  await atomicWriteJson(path, value);
  const bytes = await readRegularFile(path, MAX_STRUCTURED_INPUT_BYTES);
  return { relative, hash: sha256([bytes]) };
}

async function initRun(worktree, input) {
  const runId = input.runId || `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  assertIdentifier(runId, RUN_ID, "runId");
  if (!input.configHash || !input.sourceSnapshot || !input.indexFingerprint || !input.toolkitFingerprint || !input.resolutionContextHash || !input.adapterRegistryFingerprint) {
    throw new Error("V2五类分析指纹和adapter registry指纹不能为空");
  }
  const mode = input.mode ?? "FULL";
  if (!new Set(["FULL", "INCREMENTAL"]).has(mode)) throw new Error("mode必须是FULL或INCREMENTAL");
  if (mode === "INCREMENTAL" && !input.baseRunId) throw new Error("INCREMENTAL run必须指定baseRunId");
  if (mode === "FULL" && input.baseRunId) throw new Error("FULL run不能指定baseRunId");
  if (input.baseRunId) assertIdentifier(input.baseRunId, RUN_ID, "baseRunId");
  const batchSize = Number(input.batchSize ?? 10);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("batchSize必须为1到100的整数");
  }
  const retryLimit = Number(input.retryLimit ?? 2);
  if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 10) {
    throw new Error("retryLimit必须为0到10的整数");
  }
  const queryLimit = Number(input.queryLimit ?? 101);
  if (!Number.isInteger(queryLimit) || queryLimit < 2 || queryLimit > 1000) throw new Error("queryLimit必须为2到1000的整数");
  return withRunLock(worktree, runId, async (paths) => {
    try {
      await stat(paths.state);
      if (input.operationId) {
        const existing = await readJson(paths.state);
        assertCurrentRun(existing);
        const replay = operationReplay(existing, input);
        if (replay?.result) return replay.result;
      }
      throw new Error(`run已存在：${runId}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const createdAt = nowIso();
    const run = {
      schemaVersion: SCHEMA_VERSION,
      runId,
      phase: "CREATED",
      resumePhase: null,
      pauseRequested: false,
      configHash: input.configHash,
      sourceSnapshot: input.sourceSnapshot,
      indexFingerprint: input.indexFingerprint,
      toolkitFingerprint: input.toolkitFingerprint,
      resolutionContextHash: input.resolutionContextHash,
      adapterRegistryFingerprint: input.adapterRegistryFingerprint,
      contextIds: input.contextIds ?? [],
      resolutionSummary: input.resolutionSummary ?? null,
      serviceSnapshots: input.serviceSnapshots ?? {},
      serviceRoots: input.serviceRoots ?? {},
      indexMetadata: input.indexMetadata ?? {},
      queryLimit,
      mode,
      baseRunId: input.baseRunId ?? null,
      graphHash: null,
      manifestHash: null,
      indexHash: null,
      graphDelta: null,
      tombstones: { entryIds: [], nodeIds: [], edgeIds: [] },
      reports: {},
      batches: {},
      recentOperations: {},
      batchSize,
      retryLimit,
      createdAt,
      updatedAt: createdAt,
      counts: {},
      audits: { coverageHash: null, boundaryHash: null, configHash: null },
      units: {},
      events: [{ at: createdAt, type: "RUN_CREATED" }],
    };
    // Match the exact JSON representation persisted in the operation journal so
    // retries cannot differ only because in-memory objects contained undefined.
    const resultValue = JSON.parse(JSON.stringify(run));
    const replay = operationReplay(run, input);
    recordOperation(run, input, replay?.digest, resultValue);
    await atomicWriteJson(paths.state, run);
    return resultValue;
  });
}

async function planRun(worktree, input) {
  return withRunLock(worktree, input.runId, async (paths) => {
    const run = await readJson(paths.state);
    assertCurrentRun(run);
    const replay = operationReplay(run, input);
    if (replay?.result) return replay.result;
    if (!fingerprintMatches(run, input)) {
      run.phase = "STALE";
      run.events.push({ at: nowIso(), type: "PLAN_FINGERPRINT_MISMATCH" });
      updateCounters(run);
      await atomicWriteJson(paths.state, run);
      throw new Error("运行指纹不一致，拒绝静默重新规划");
    }
    if (run.phase !== "CREATED") {
      throw new Error(`当前阶段不能规划：${run.phase}`);
    }
    const entries = parseStructuredJson(input.entriesJson, "entriesJson", "array");
    if (!Array.isArray(entries) || entries.length === 0) throw new Error("entries必须是非空数组");
    const ids = new Set();
    const units = Object.create(null);
    for (const entry of entries) {
      if (!entry || typeof entry.id !== "string") throw new Error("入口缺少id");
      assertIdentifier(entry.id, RUN_ID, "entryId");
      if (ids.has(entry.id)) throw new Error(`入口ID重复：${entry.id}`);
      if (typeof entry.service !== "string" || !Object.hasOwn(run.serviceSnapshots, entry.service)) throw new Error(`入口${entry.id} service不在workspace服务集合`);
      if (typeof entry.adapter !== "string" || !ENTRY_ADAPTERS.has(entry.adapter)) throw new Error(`入口${entry.id} adapter不在白名单`);
      if (!Array.isArray(entry.contextIds) || entry.contextIds.length === 0 || new Set(entry.contextIds).size !== entry.contextIds.length || entry.contextIds.some((id) => typeof id !== "string" || !run.contextIds.includes(id))) throw new Error(`入口${entry.id} contextIds非法`);
      if (entry.target !== undefined && (typeof entry.target !== "string" || entry.target.length > 2048)) throw new Error(`入口${entry.id} target非法`);
      if (entry.channelKey !== undefined && (typeof entry.channelKey !== "string" || !entry.channelKey || entry.channelKey.length > 2048)) throw new Error(`入口${entry.id} channelKey非法`);
      if (entry.target && entry.channelKey && entry.target !== entry.channelKey) throw new Error(`入口${entry.id} target与channelKey冲突`);
      if (entry.consumerGroup !== undefined && entry.consumerGroup !== null && (typeof entry.consumerGroup !== "string" || !entry.consumerGroup || entry.consumerGroup.length > 512)) throw new Error(`入口${entry.id} consumerGroup非法`);
      if (entry.subscription !== undefined && entry.subscription !== null && (typeof entry.subscription !== "string" || !entry.subscription || entry.subscription.length > 512)) throw new Error(`入口${entry.id} subscription非法`);
      if (entry.deliverySemantics !== undefined && entry.deliverySemantics !== null && !new Set(["DIRECT", "FAN_OUT", "COMPETING_ONE_OF"]).has(entry.deliverySemantics)) throw new Error(`入口${entry.id} deliverySemantics非法`);
      ids.add(entry.id);
      const previous = Object.hasOwn(run.units, entry.id) ? run.units[entry.id] : null;
      units[entry.id] = previous ?? {
        id: entry.id,
        service: entry.service ?? "unknown",
        kind: entry.kind ?? entry.adapter,
        adapter: entry.adapter ?? entry.kind ?? "UNKNOWN",
        contextIds: Array.isArray(entry.contextIds) && entry.contextIds.length ? [...new Set(entry.contextIds)].sort() : run.contextIds,
        target: entry.target ?? entry.channelKey ?? "",
        consumerGroup: entry.consumerGroup ?? null,
        subscription: entry.subscription ?? null,
        deliverySemantics: entry.deliverySemantics ?? null,
        status: "PENDING",
        attempts: 0,
        leaseOwner: null,
        leaseUntil: null,
        fingerprintToken: null,
        artifactHash: null,
        validationHash: null,
        documentHash: null,
        lastError: null,
        serviceClosure: [],
        sharedDependency: false,
        unownedDependency: false,
        reusedFromRunId: null,
        reuseProofHash: null,
        retryStage: null,
        stageAttempts: { TRACE: 0, VALIDATE: 0, PUBLISH: 0 },
      };
    }
    run.units = units;
    run.phase = "PLANNED";
    run.pauseRequested = false;
    run.events.push({ at: nowIso(), type: "RUN_PLANNED", entries: entries.length });
    updateCounters(run);
    const resultValue = { runId: run.runId, phase: run.phase, counts: run.counts };
    recordOperation(run, input, replay?.digest, resultValue);
    await atomicWriteJson(paths.state, run);
    return resultValue;
  });
}

async function claimBatch(worktree, input) {
  assertIdentifier(input.workerId, WORKER_ID, "workerId");
  return withRunLock(worktree, input.runId, async (paths) => {
    const run = await readJson(paths.state);
    assertCurrentRun(run);
    const replay = operationReplay(run, input);
    if (replay?.result) return replay.result;
    if (new Set(["STALE", "FAILED", "COMPLETE", "PARTIAL"]).has(run.phase)) {
      throw new Error(`当前运行不可领取：${run.phase}`);
    }
    if (!new Set(["PLANNED", "TRACING", "VALIDATING", "PUBLISHING", "PAUSE_REQUESTED", "PAUSED"]).has(run.phase)) {
      throw new Error(`运行尚未规划，不能领取：${run.phase}`);
    }
    await requireFreshFingerprints(run, input, paths, "CLAIM_FINGERPRINT_MISMATCH");
    const recovered = recoverExpiredLeases(run);
    const openBatch = Object.values(run.batches).find((batch) => batch.status === "OPEN");
    if (openBatch) throw new Error(`必须先关闭或恢复批次：${openBatch.id}`);
    if (run.pauseRequested || run.phase === "PAUSED") {
      run.phase = "PAUSED";
      updateCounters(run);
      await atomicWriteJson(paths.state, run);
      return { runId: run.runId, phase: run.phase, recovered, units: [] };
    }
    const requested = Number(input.limit ?? run.batchSize);
    const limit = Math.max(1, Math.min(run.batchSize, Number.isInteger(requested) ? requested : run.batchSize));
    const leaseSeconds = Math.max(30, Math.min(3600, Number(input.leaseSeconds ?? 600)));
    const claimableStage = (unit) => {
      if (unit.status === "PENDING") return "TRACE";
      if (unit.status === "TRACED") return "VALIDATE";
      if (unit.status === "VERIFIED") return "PUBLISH";
      if (unit.status === "RETRYABLE_FAILED") return unit.retryStage ?? "TRACE";
      return null;
    };
    const selected = Object.values(run.units)
      .filter((unit) => claimableStage(unit))
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit);
    const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    const batchId = selected.length ? `batch-${randomUUID()}` : null;
    for (const unit of selected) {
      const stage = claimableStage(unit);
      unit.status = "LEASED";
      unit.leaseStage = stage;
      unit.leaseOwner = input.workerId;
      unit.leaseUntil = leaseUntil;
      unit.batchId = batchId;
      unit.attempts += 1;
      unit.stageAttempts[stage] = (unit.stageAttempts[stage] ?? 0) + 1;
      unit.fingerprintToken = leaseFingerprintToken(run, unit, input.workerId, leaseUntil);
    }
    if (selected.length > 0) {
      const stages = [...new Set(selected.map((unit) => unit.leaseStage))];
      run.phase = stages.includes("TRACE") ? "TRACING" : stages.includes("VALIDATE") ? "VALIDATING" : "PUBLISHING";
      run.batches[batchId] = {
        id: batchId,
        token: sha256([batchId, "\0", randomUUID()]),
        status: "OPEN",
        openedAt: nowIso(),
        closedAt: null,
        workerId: input.workerId,
        unitIds: selected.map((unit) => unit.id),
        fingerprints: { configHash: run.configHash, sourceSnapshot: run.sourceSnapshot, indexFingerprint: run.indexFingerprint, toolkitFingerprint: run.toolkitFingerprint },
      };
    }
    run.events.push({ at: nowIso(), type: "BATCH_CLAIMED", batchId, workerId: input.workerId, entries: selected.map((unit) => unit.id) });
    updateCounters(run);
    const resultValue = { runId: run.runId, phase: run.phase, batchId, batchToken: batchId ? run.batches[batchId].token : null, recovered, units: selected };
    recordOperation(run, input, replay?.digest, resultValue);
    await atomicWriteJson(paths.state, run);
    return resultValue;
  });
}

async function commitUnit(worktree, input) {
  assertIdentifier(input.workerId, WORKER_ID, "workerId");
  if (!COMMIT_STATES.has(input.status)) throw new Error(`不支持的提交状态：${input.status}`);
  return withRunLock(worktree, input.runId, async (paths) => {
    const run = await readJson(paths.state);
    assertCurrentRun(run);
    const replay = operationReplay(run, input);
    if (replay?.result) return replay.result;
    if (new Set(["COMPLETE", "PARTIAL", "FAILED", "STALE"]).has(run.phase)) {
      throw new Error(`终态运行不能提交单元：${run.phase}`);
    }
    const unit = Object.hasOwn(run.units, input.entryId) ? run.units[input.entryId] : null;
    if (!unit) throw new Error(`入口不存在：${input.entryId}`);
    if (!input.fingerprintToken || input.fingerprintToken !== unit.fingerprintToken) {
      throw new Error("提交指纹令牌与领取批次不一致");
    }
    if (unit.status !== "LEASED" || unit.leaseOwner !== input.workerId) {
      throw new Error("提交者不是当前租约持有者");
    }
    if (input.batchId !== unit.batchId || run.batches[input.batchId]?.status !== "OPEN") throw new Error("提交批次不匹配或已关闭");
    if (Date.parse(unit.leaseUntil) <= Date.now()) {
      const stage = unit.leaseStage;
      unit.status = unit.stageAttempts[stage] > run.retryLimit ? "FAILED" : "RETRYABLE_FAILED";
      unit.retryStage = stage;
      unit.leaseOwner = null;
      unit.leaseUntil = null;
      unit.fingerprintToken = null;
      unit.lastError = unit.status === "FAILED" ? "RETRY_LIMIT_EXCEEDED" : "LEASE_EXPIRED";
      updateCounters(run);
      await atomicWriteJson(paths.state, run);
      throw new Error("租约已过期，拒绝旧worker提交");
    }
    const expected = { TRACE: "TRACED", VALIDATE: "VERIFIED", PUBLISH: "PUBLISHED" }[unit.leaseStage];
    if (!new Set([expected, "RETRYABLE_FAILED", "BLOCKED", "FAILED"]).has(input.status)) {
      throw new Error(`阶段${unit.leaseStage}不能提交${input.status}`);
    }
    const exhausted = input.status === "RETRYABLE_FAILED" && unit.stageAttempts[unit.leaseStage] > run.retryLimit;
    let artifact;
    if (input.status === "TRACED") {
      const trace = validateTraceResult(run, unit, input.traceResultJson);
      artifact = await writeTraceArtifact(paths, run, unit, trace);
      unit.artifactHash = artifact.hash;
      unit.traceArtifactPath = artifact.relative;
      unit.serviceClosure = [...new Set(trace.serviceClosure)].sort();
      unit.configDependencyIds = [...new Set(trace.configDependencyIds)].sort();
      unit.contextIds = [...new Set(trace.contextIds)].sort();
      unit.sharedDependency = trace.sharedDependency === true;
      unit.unownedDependency = trace.unownedDependency === true;
    } else if (input.status === "VERIFIED") {
      const report = run.reports[input.reportId];
      if (!report || report.kind !== "TRACE" || report.entryId !== unit.id || report.traceHash !== unit.artifactHash || report.batchToken !== unit.fingerprintToken) {
        throw new Error("缺少与当前入口、trace和验证租约绑定的独立报告");
      }
      unit.validationHash = report.hash;
    } else if (input.status === "PUBLISHED") {
      if (typeof input.documentContent !== "string" || !input.documentContent.trim()) throw new Error("PUBLISH必须提供非空documentContent");
      if (Buffer.byteLength(input.documentContent) > MAX_DOCUMENT_BYTES) throw new Error("documentContent超过2MiB上限");
      const prefix = `docs/spring-business/.staging/${run.runId}/`;
      const documentRelativePath = `${prefix}entrypoints/${unit.id}.md`;
      const root = resolve(worktree);
      const parent = await ensureSafeDirectoryChain(root, dirname(documentRelativePath).split(sep).join("/"));
      await atomicWriteText(join(parent, `${unit.id}.md`), input.documentContent);
      const bytes = await readWorkspaceArtifact(worktree, documentRelativePath, prefix, MAX_DOCUMENT_BYTES);
      unit.documentHash = sha256([bytes]);
      unit.documentRelativePath = documentRelativePath;
    }
    const committedStage = unit.leaseStage;
    unit.status = exhausted ? "FAILED" : input.status;
    unit.retryStage = input.status === "RETRYABLE_FAILED" ? committedStage : null;
    unit.leaseOwner = null;
    unit.leaseUntil = null;
    unit.leaseStage = null;
    unit.fingerprintToken = null;
    unit.lastError = exhausted ? "RETRY_LIMIT_EXCEEDED" : input.errorCode || null;
    if (run.pauseRequested) {
      run.phase = "PAUSE_REQUESTED";
    } else {
      run.phase = input.status === "VERIFIED" ? "VALIDATING" : input.status === "PUBLISHED" ? "PUBLISHING" : run.phase;
    }
    run.events.push({ at: nowIso(), type: "UNIT_COMMITTED", batchId: input.batchId, entryId: input.entryId, stage: committedStage, status: unit.status });
    updateCounters(run);
    const resultValue = { runId: run.runId, phase: run.phase, unit, counts: run.counts };
    recordOperation(run, input, replay?.digest, resultValue);
    await atomicWriteJson(paths.state, run);
    return resultValue;
  });
}

async function submitReport(worktree, input, contextAgent) {
  const spec = REPORT_SPECS[input.kind];
  if (!spec || spec.agent !== contextAgent) throw new Error(`Agent ${contextAgent}不能提交${input.kind}报告`);
  return withRunLock(worktree, input.runId, async (paths) => {
    const run = await readJson(paths.state);
    assertCurrentRun(run);
    const replay = operationReplay(run, input);
    if (replay?.result) return replay.result;
    const report = parseStructuredJson(input.reportJson, "reportJson");
    if (report.schemaVersion !== SCHEMA_VERSION || report.runId !== run.runId || report.kind !== input.kind || report.validator !== contextAgent || report.decision !== "ACCEPTED") {
      throw new Error("报告版本、runId、kind、validator或decision不匹配");
    }
    assertFingerprintObject(report.fingerprints, run, "独立报告");
    assertPassedChecks(report.checks, "独立报告");
    const codes = new Set(report.checks.map((check) => check.code));
    if (spec.checks.some((code) => !codes.has(code))) throw new Error(`报告缺少必需check：${spec.checks.filter((code) => !codes.has(code)).join(",")}`);
    if (report.checks.some((check) => check.evidence.length === 0)) throw new Error("独立报告的evidence不能为空");
    if (input.kind === "CONFIG") {
      if (!Array.isArray(report.resolutionLog) || report.resolutionLog.length === 0) throw new Error("CONFIG报告缺少resolutionLog");
    } else {
      assertCompleteQueryLog(report.queryLog, run, "独立报告");
    }
    if (input.kind === "TRACE") {
      const unit = Object.hasOwn(run.units, input.entryId) ? run.units[input.entryId] : null;
      if (!unit || unit.status !== "LEASED" || unit.leaseStage !== "VALIDATE" || unit.fingerprintToken !== input.batchToken) {
        throw new Error("TRACE报告没有绑定当前VALIDATE租约");
      }
      if (report.entryId !== unit.id || report.traceHash !== unit.artifactHash) throw new Error("TRACE报告未绑定当前trace工件");
    }
    if (input.kind === "BOUNDARY" && (!Array.isArray(report.verifiedBoundaryIds) || new Set(report.verifiedBoundaryIds).size !== report.verifiedBoundaryIds.length)) throw new Error("BOUNDARY报告缺少唯一verifiedBoundaryIds集合");
    if (input.kind === "INCREMENTAL" && ["changedServices", "reusableEntryIds", "affectedEntryIds", "newEntryIds", "tombstonedEntryIds", "workQueueEntryIds"].some((key) => !Array.isArray(report[key]))) throw new Error("INCREMENTAL报告缺少闭合集合");
    if (input.kind === "CONFIG" && (report.resolutionContextHash !== run.resolutionContextHash || canonicalJson(report.contextIds) !== canonicalJson(run.contextIds))) throw new Error("CONFIG报告未绑定当前解析上下文");
    const reportId = `report-${input.kind.toLowerCase()}-${randomUUID()}`;
    const stored = {
      id: reportId,
      kind: input.kind,
      agent: contextAgent,
      entryId: report.entryId ?? null,
      traceHash: report.traceHash ?? null,
      batchToken: input.batchToken ?? null,
      payload: report,
      hash: sha256([canonicalJson(report)]),
      createdAt: nowIso(),
    };
    run.reports[reportId] = stored;
    run.events.push({ at: nowIso(), type: "REPORT_SUBMITTED", reportId, kind: input.kind, agent: contextAgent });
    const resultValue = { reportId, hash: stored.hash, kind: input.kind };
    recordOperation(run, input, replay?.digest, resultValue);
    updateCounters(run);
    await atomicWriteJson(paths.state, run);
    return resultValue;
  });
}

async function closeBatch(worktree, input) {
  return withRunLock(worktree, input.runId, async (paths) => {
    const run = await readJson(paths.state);
    assertCurrentRun(run);
    const replay = operationReplay(run, input);
    if (replay?.result) return replay.result;
    const batch = run.batches[input.batchId];
    if (!batch || batch.token !== input.batchToken) throw new Error("批次不存在或token不匹配");
    if (batch.status === "CLOSED") return { runId: run.runId, batchId: batch.id, status: "CLOSED", phase: run.phase };
    const active = batch.unitIds.filter((id) => run.units[id]?.status === "LEASED");
    if (active.length) throw new Error(`批次仍有${active.length}个活动租约`);
    await requireFreshFingerprints(run, input, paths, "BATCH_CLOSE_FINGERPRINT_MISMATCH");
    batch.status = "CLOSED";
    batch.closedAt = nowIso();
    for (const id of batch.unitIds) if (run.units[id]) run.units[id].batchId = null;
    if (run.pauseRequested) run.phase = "PAUSED";
    run.events.push({ at: nowIso(), type: "BATCH_CLOSED", batchId: batch.id });
    updateCounters(run);
    const resultValue = { runId: run.runId, batchId: batch.id, status: batch.status, phase: run.phase };
    recordOperation(run, input, replay?.digest, resultValue);
    await atomicWriteJson(paths.state, run);
    return resultValue;
  });
}

async function heartbeatBatch(worktree, input) {
  assertIdentifier(input.workerId, WORKER_ID, "workerId");
  return withRunLock(worktree, input.runId, async (paths) => {
    const run = await readJson(paths.state);
    assertCurrentRun(run);
    const replay = operationReplay(run, input);
    if (replay?.result) return replay.result;
    const batch = run.batches[input.batchId];
    if (!batch || batch.status !== "OPEN" || batch.token !== input.batchToken || batch.workerId !== input.workerId) throw new Error("不能续租非当前OPEN批次");
    const seconds = Math.max(30, Math.min(3600, Number(input.leaseSeconds ?? 600)));
    const leaseUntil = new Date(Date.now() + seconds * 1000).toISOString();
    let extended = 0;
    for (const id of batch.unitIds) {
      const unit = run.units[id];
      if (unit?.status === "LEASED" && unit.leaseOwner === input.workerId) {
        unit.leaseUntil = leaseUntil;
        extended += 1;
      }
    }
    const resultValue = { runId: run.runId, batchId: batch.id, extended, leaseUntil };
    recordOperation(run, input, replay?.digest, resultValue);
    run.events.push({ at: nowIso(), type: "BATCH_HEARTBEAT", batchId: batch.id, extended });
    updateCounters(run);
    await atomicWriteJson(paths.state, run);
    return resultValue;
  });
}

async function recoverRun(worktree, input) {
  return withRunLock(worktree, input.runId, async (paths) => {
    const run = await readJson(paths.state);
    assertCurrentRun(run);
    const replay = operationReplay(run, input);
    if (replay?.result) return replay.result;
    if (run.phase === "FINALIZING") {
      await finalizeSnapshot(worktree, run, paths);
      const resultValue = { runId: run.runId, phase: run.phase, finalized: true };
      recordOperation(run, input, replay?.digest, resultValue);
      await atomicWriteJson(paths.state, run);
      return resultValue;
    }
    if (run.phase === "COMPLETE" && run.publication && !run.publication.currentUpdated) {
      await verifyGraphAtPrefix(worktree, run, `docs/spring-business/snapshots/${run.runId}/graph/`);
      await verifyDocumentsAtPrefix(worktree, run, `docs/spring-business/snapshots/${run.runId}/`);
      await verifyPublicationBundle(worktree, run, `docs/spring-business/snapshots/${run.runId}/`);
      await publishCurrentPointer(worktree, run);
      run.publication.currentUpdated = true;
      updateCounters(run);
      await atomicWriteJson(paths.state, run);
      const resultValue = { runId: run.runId, phase: run.phase, currentRecovered: true };
      recordOperation(run, input, replay?.digest, resultValue);
      await atomicWriteJson(paths.state, run);
      return resultValue;
    }
    await requireFreshFingerprints(run, input, paths, "RECOVER_FINGERPRINT_MISMATCH");
    const recovered = recoverExpiredLeases(run);
    let closedBatches = 0;
    for (const batch of Object.values(run.batches)) {
      if (batch.status === "OPEN" && batch.unitIds.every((id) => run.units[id]?.status !== "LEASED")) {
        batch.status = "CLOSED";
        batch.closedAt = nowIso();
        for (const id of batch.unitIds) if (run.units[id]) run.units[id].batchId = null;
        closedBatches += 1;
      }
    }
    if (run.pauseRequested && !Object.values(run.units).some((unit) => unit.status === "LEASED")) run.phase = "PAUSED";
    run.events.push({ at: nowIso(), type: "RUN_RECOVERED", recovered, closedBatches });
    updateCounters(run);
    const resultValue = { runId: run.runId, phase: run.phase, recovered, closedBatches };
    recordOperation(run, input, replay?.digest, resultValue);
    await atomicWriteJson(paths.state, run);
    return resultValue;
  });
}

async function seedIncrementalRun(worktree, input) {
  return withRunLock(worktree, input.runId, async (paths) => {
    const run = await readJson(paths.state);
    assertCurrentRun(run);
    const replay = operationReplay(run, input);
    if (replay?.result) return replay.result;
    if (run.phase !== "PLANNED" || run.mode !== "INCREMENTAL" || !run.baseRunId) throw new Error("只有已规划的INCREMENTAL run可以seed");
    await requireFreshFingerprints(run, input, paths, "INCREMENTAL_SEED_FINGERPRINT_MISMATCH");
    const report = run.reports[input.reportId];
    if (!report || report.kind !== "INCREMENTAL") throw new Error("缺少独立增量验证报告");
    const basePaths = runPaths(worktree, run.baseRunId);
    await ensureSafeRunDirectory(worktree, run.baseRunId, false);
    const base = await readJson(basePaths.state);
    if (base.schemaVersion !== SCHEMA_VERSION || base.phase !== "COMPLETE" || !base.graphHash || !base.manifestHash || !base.topologyRootHash) throw new Error("baseline必须是带graph/manifest/topology三根的同版COMPLETE run");
    if (base.configHash !== run.configHash || base.toolkitFingerprint !== run.toolkitFingerprint || base.adapterRegistryFingerprint !== run.adapterRegistryFingerprint) throw new Error("工具包配置或adapter registry变化要求FULL_REBASE");
    const indexSemantics = (metadata = {}) => Object.fromEntries(Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b)).map(([id, status]) => [id, {
      projectPath: status.projectPath ?? null,
      version: status.version ?? null,
      builtWithVersion: status.index?.builtWithVersion ?? null,
      currentExtractionVersion: status.index?.currentExtractionVersion ?? null,
      backend: status.backend ?? null,
      languages: [...(status.languages ?? [])].sort(),
    }]));
    if (canonicalJson(indexSemantics(base.indexMetadata)) !== canonicalJson(indexSemantics(run.indexMetadata))) {
      throw new Error("Code Graph项目身份或索引语义变化要求FULL_REBASE");
    }
    const serviceIds = new Set([...Object.keys(base.serviceSnapshots ?? {}), ...Object.keys(run.serviceSnapshots ?? {})]);
    const changedServices = [...serviceIds].filter((id) => base.serviceSnapshots?.[id] !== run.serviceSnapshots?.[id]).sort();
    const resolvedValues = (summary) => {
      const map = new Map();
      for (const context of summary?.contexts ?? []) {
        const originHashes = new Map((context.origins ?? []).map((origin) => [origin.key, origin.sourceHash ?? "NO_ORIGIN_HASH"]));
        for (const value of context.values ?? []) map.set(`${context.id}:${value.key}`, `RESOLVED:${value.valueHash}`);
        for (const value of context.unresolved ?? []) map.set(`${context.id}:${value.key}`, `UNRESOLVED:${value.reason}:${originHashes.get(value.key) ?? "NO_ORIGIN_HASH"}`);
      }
      return map;
    };
    const baseValues = resolvedValues(base.resolutionSummary);
    const currentValues = resolvedValues(run.resolutionSummary);
    const configKeys = new Set([...baseValues.keys(), ...currentValues.keys()]);
    const changedConfigKeys = [...configKeys].filter((key) => baseValues.get(key) !== currentValues.get(key)).sort();
    const unresolvedKeys = new Set();
    for (const summary of [base.resolutionSummary, run.resolutionSummary]) {
      for (const context of summary?.contexts ?? []) {
        for (const value of context.unresolved ?? []) {
          unresolvedKeys.add(value.key);
          unresolvedKeys.add(`${context.id}:${value.key}`);
        }
      }
    }
    const reusable = [];
    const affectedExisting = [];
    const newEntryIds = [];
    for (const unit of Object.values(run.units)) {
      const old = Object.hasOwn(base.units, unit.id) ? base.units[unit.id] : null;
      const safe = old && new Set(["PUBLISHED", "REUSED"]).has(old.status) && old.traceArtifactPath && old.documentHash &&
        Array.isArray(old.serviceClosure) && old.serviceClosure.length > 0 && !old.sharedDependency && !old.unownedDependency &&
        old.serviceClosure.every((service) => !changedServices.includes(service)) && Array.isArray(old.configDependencyIds) &&
        old.configDependencyIds.every((key) => !unresolvedKeys.has(key) && !changedConfigKeys.includes(key) && !changedConfigKeys.some((changed) => changed.endsWith(`:${key}`)));
      if (safe) reusable.push(unit.id);
      else if (old) affectedExisting.push(unit.id);
      else newEntryIds.push(unit.id);
    }
    reusable.sort();
    affectedExisting.sort();
    newEntryIds.sort();
    const tombstonedEntryIds = Object.keys(base.units).filter((id) => !Object.hasOwn(run.units, id)).sort();
    const workQueueEntryIds = [...affectedExisting, ...newEntryIds].sort();
    const payload = report.payload;
    if (payload.baseRunId !== base.runId || payload.baseGraphHash !== base.graphHash || payload.baseManifestHash !== base.manifestHash || payload.baseTopologyRootHash !== base.topologyRootHash) throw new Error("增量报告未绑定当前baseline、graphHash、manifestHash及topologyRootHash");
    if (canonicalJson(payload.changedServices ?? []) !== canonicalJson(changedServices) || canonicalJson(payload.changedConfigKeys ?? []) !== canonicalJson(changedConfigKeys) || canonicalJson(payload.reusableEntryIds ?? []) !== canonicalJson(reusable) || canonicalJson(payload.affectedEntryIds ?? []) !== canonicalJson(affectedExisting) || canonicalJson(payload.newEntryIds ?? []) !== canonicalJson(newEntryIds) || canonicalJson(payload.workQueueEntryIds ?? []) !== canonicalJson(workQueueEntryIds) || canonicalJson(payload.tombstonedEntryIds ?? []) !== canonicalJson(tombstonedEntryIds)) {
      throw new Error("增量报告与插件保守失效集合不一致");
    }
    for (const id of reusable) {
      const old = base.units[id];
      const oldPrefix = `docs/spring-business/.staging/${base.runId}/`;
      const snapshotPrefix = `docs/spring-business/snapshots/${base.runId}/`;
      if (typeof old.documentRelativePath !== "string" || (!old.documentRelativePath.startsWith(snapshotPrefix) && !old.documentRelativePath.startsWith(oldPrefix))) {
        throw new Error(`baseline入口${id}缺少规范文档路径`);
      }
      const oldSnapshotPath = old.documentRelativePath.startsWith(snapshotPrefix)
        ? old.documentRelativePath
        : old.documentRelativePath.replace(oldPrefix, snapshotPrefix);
      const documentBytes = await readWorkspaceArtifact(worktree, oldSnapshotPath, snapshotPrefix, MAX_DOCUMENT_BYTES);
      if (sha256([documentBytes]) !== old.documentHash) throw new Error(`baseline入口${id}文档哈希不匹配`);
      const newDocumentPath = oldSnapshotPath.replace(snapshotPrefix, `docs/spring-business/.staging/${run.runId}/`);
      const newAbsolute = resolve(worktree, newDocumentPath);
      await ensureSafeDirectoryChain(resolve(worktree), dirname(newDocumentPath).split(sep).join("/"));
      await atomicWriteText(newAbsolute, documentBytes);
      Object.assign(run.units[id], {
        status: "REUSED",
        artifactHash: old.artifactHash,
        validationHash: old.validationHash,
        documentHash: old.documentHash,
        traceArtifactPath: old.traceArtifactPath,
        documentRelativePath: newDocumentPath,
        serviceClosure: old.serviceClosure,
        configDependencyIds: old.configDependencyIds,
        contextIds: old.contextIds,
        reusedFromRunId: base.runId,
        reuseProofHash: report.hash,
      });
    }
    run.changedServices = changedServices;
    run.changedConfigKeys = changedConfigKeys;
    run.tombstones.entryIds = tombstonedEntryIds;
    run.incrementalSets = { reusableEntryIds: reusable, affectedEntryIds: affectedExisting, newEntryIds, tombstonedEntryIds, workQueueEntryIds };
    run.incrementalReportId = input.reportId;
    run.events.push({ at: nowIso(), type: "INCREMENTAL_SEEDED", baseRunId: base.runId, reusable: reusable.length, affectedExisting: affectedExisting.length, newEntries: newEntryIds.length, changedServices, changedConfigKeys });
    updateCounters(run);
    const resultValue = { runId: run.runId, baseRunId: base.runId, changedServices, changedConfigKeys, reusableEntryIds: reusable, affectedEntryIds: affectedExisting, newEntryIds, tombstonedEntryIds, workQueueEntryIds };
    recordOperation(run, input, replay?.digest, resultValue);
    await atomicWriteJson(paths.state, run);
    return resultValue;
  });
}

async function loadUnitTrace(worktree, run, unit) {
  const sourceRunId = unit.reusedFromRunId ?? run.runId;
  await ensureSafeRunDirectory(worktree, sourceRunId, false);
  const sourcePaths = runPaths(worktree, sourceRunId);
  if (typeof unit.traceArtifactPath !== "string" || !unit.traceArtifactPath.startsWith(`artifacts/${unit.id}/`)) throw new Error(`入口${unit.id}缺少安全trace工件路径`);
  const path = resolve(sourcePaths.directory, unit.traceArtifactPath);
  if (!path.startsWith(sourcePaths.directory + sep)) throw new Error("trace工件越出run目录");
  const bytes = await readRegularFile(path, MAX_STRUCTURED_INPUT_BYTES);
  if (sha256([bytes]) !== unit.artifactHash) throw new Error(`入口${unit.id}的trace工件哈希不匹配`);
  return JSON.parse(bytes.toString("utf8"));
}

function addGraphNode(nodes, id, type, entryId, services) {
  if (typeof id !== "string" || !id) throw new Error("图节点ID不能为空");
  const existing = nodes.get(id) ?? { id, type, entryMembership: [], services: [] };
  existing.entryMembership = [...new Set([...existing.entryMembership, entryId])].sort();
  existing.services = [...new Set([...existing.services, ...services])].sort();
  nodes.set(id, existing);
}

function addGraphEdge(edges, type, from, to, entryId, services, payload) {
  const semanticKey = type === "LOGICAL_BOUNDARY"
    ? `${type}\0${payload?.kind ?? ""}\0${payload?.channelKey ?? payload?.key ?? payload?.id ?? ""}\0${payload?.consumerGroup ?? ""}\0${payload?.deliverySemantics ?? "DIRECT"}\0${from}\0${to}`
    : type === "PERSISTENCE"
      ? `${type}\0${payload?.storeId ?? "default"}\0${payload?.resource ?? to}\0${payload?.operation ?? "UNKNOWN"}\0${from}`
      : `${type}\0${from}\0${to}`;
  const id = sha256([semanticKey]);
  const evidenceHash = sha256([canonicalJson(payload)]);
  const existing = edges.get(id) ?? { id, type, from, to, evidence: payload, evidenceHash, entryMembership: [], services: [] };
  if (existing.evidenceHash !== evidenceHash) {
    const variants = [...new Map([...(existing.evidenceVariants ?? [existing.evidence]), payload].map((value) => [canonicalJson(value), value])).values()]
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
    existing.evidenceVariants = variants;
    existing.evidenceHash = sha256([canonicalJson(variants)]);
  }
  existing.entryMembership = [...new Set([...existing.entryMembership, entryId])].sort();
  existing.services = [...new Set([...existing.services, ...services])].sort();
  edges.set(id, existing);
}

async function buildGraphSnapshot(worktree, input) {
  return withRunLock(worktree, input.runId, async (paths) => {
    const run = await readJson(paths.state);
    assertCurrentRun(run);
    const replay = operationReplay(run, input);
    if (replay?.result) return replay.result;
    await requireFreshFingerprints(run, input, paths, "GRAPH_BUILD_FINGERPRINT_MISMATCH");
    if (Object.values(run.batches).some((batch) => batch.status === "OPEN")) throw new Error("存在未关闭批次，不能构建图快照");
    const incomplete = Object.values(run.units).filter((unit) => !new Set(["PUBLISHED", "REUSED"]).has(unit.status));
    if (incomplete.length) throw new Error(`仍有${incomplete.length}个入口未发布或复用`);
    const nodes = new Map();
    const edges = new Map();
    const topologyTraces = Object.create(null);
    const acceptedBoundaryReports = new Map(Object.values(run.reports)
      .filter((report) => report.kind === "BOUNDARY" && report.payload?.decision === "ACCEPTED")
      .flatMap((report) => (report.payload?.verifiedBoundaryIds ?? []).map((id) => [id, report.hash])));
    for (const unit of Object.values(run.units).sort((left, right) => left.id.localeCompare(right.id))) {
      const trace = await loadUnitTrace(worktree, run, unit);
      topologyTraces[unit.id] = trace;
      if (trace.schemaVersion !== SCHEMA_VERSION && unit.reusedFromRunId === null) throw new Error(`入口${unit.id} trace版本错误`);
      if (typeof unit.validationHash !== "string" || !unit.validationHash) throw new Error(`入口${unit.id}缺少TRACE validator报告哈希`);
      const services = unit.serviceClosure;
      const traceReportHashes = [unit.validationHash];
      for (const edge of trace.javaEdges ?? []) {
        addGraphNode(nodes, edge.from, "SYMBOL", unit.id, services);
        addGraphNode(nodes, edge.to, "SYMBOL", unit.id, services);
        addGraphEdge(edges, "JAVA_CALL", edge.from, edge.to, unit.id, services, { ...edge, validatorReportHashes: traceReportHashes });
      }
      for (const edge of trace.specialEdges ?? []) {
        addGraphNode(nodes, edge.from, "SYMBOL", unit.id, services);
        addGraphNode(nodes, edge.to, "SYMBOL", unit.id, services);
        addGraphEdge(edges, "CODEGRAPH_SPECIAL", edge.from, edge.to, unit.id, services, { ...edge, validatorReportHashes: traceReportHashes });
      }
      for (const boundary of trace.boundaries ?? []) {
        const boundaryReportHash = acceptedBoundaryReports.get(boundary.id);
        if (!boundaryReportHash) throw new Error(`入口${unit.id}的逻辑边界${boundary.id}没有认证BOUNDARY报告`);
        const targets = Array.isArray(boundary.targets) ? boundary.targets : [boundary.target];
        if (!boundary.source || targets.length === 0 || targets.some((target) => typeof target !== "string" || !target)) throw new Error(`入口${unit.id}包含非法逻辑边界端点`);
        if (boundary.kind === "KAFKA" && (!boundary.channelKey || !boundary.consumerGroup || (targets.length > 1 && boundary.deliverySemantics !== "COMPETING_ONE_OF"))) throw new Error(`入口${unit.id}的Kafka边界缺少cluster/topic/group或竞争消费语义`);
        addGraphNode(nodes, boundary.source, "SYMBOL", unit.id, services);
        for (const target of [...new Set(targets)].sort()) {
          addGraphNode(nodes, target, "SYMBOL", unit.id, services);
          addGraphEdge(edges, "LOGICAL_BOUNDARY", boundary.source, target, unit.id, services, { ...boundary, status: "VERIFIED", target, targets, validatorReportHashes: [...traceReportHashes, boundaryReportHash].sort() });
        }
      }
      for (const persistence of trace.persistence ?? []) {
        addGraphNode(nodes, persistence.symbol, "SYMBOL", unit.id, services);
        addGraphNode(nodes, persistence.resource, "TABLE", unit.id, services);
        addGraphEdge(edges, "PERSISTENCE", persistence.symbol, persistence.resource, unit.id, services, { ...persistence, validatorReportHashes: traceReportHashes });
      }
    }
    const nodeRows = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
    const edgeRows = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
    const graphDirectory = `docs/spring-business/.staging/${run.runId}/graph`;
    const absoluteGraph = await ensureSafeDirectoryChain(resolve(worktree), graphDirectory);
    const topologyMeta = await writeTopologyBundle(absoluteGraph, {
      ...run,
      units: Object.fromEntries(Object.entries(run.units).map(([id, unit]) => [id, { ...unit, traceResult: topologyTraces[id] }])),
    }, nodeRows, edgeRows);
    await verifyTopologyBundle(absoluteGraph);
    const meta = {
      schemaVersion: SCHEMA_VERSION,
      runId: run.runId,
      fingerprints: { config: run.configHash, source: run.sourceSnapshot, index: run.indexFingerprint, toolkit: run.toolkitFingerprint, resolvedConfig: run.resolutionContextHash, adapterRegistry: run.adapterRegistryFingerprint },
      nodeCount: nodeRows.length,
      edgeCount: edgeRows.length,
      entryIds: Object.keys(run.units).sort(),
      topologyRootHash: topologyMeta.topologyRootHash,
    };
    const nodesText = nodeRows.map((row) => canonicalJson(row)).join("\n") + (nodeRows.length ? "\n" : "");
    const edgesText = edgeRows.map((row) => canonicalJson(row)).join("\n") + (edgeRows.length ? "\n" : "");
    const graphHash = sha256([canonicalJson(meta), "\0", nodesText, "\0", edgesText]);
    meta.graphHash = graphHash;
    await atomicWriteJson(join(absoluteGraph, "meta.json"), meta);
    await atomicWriteText(join(absoluteGraph, "nodes.jsonl"), nodesText);
    await atomicWriteText(join(absoluteGraph, "edges.jsonl"), edgesText);
    if (run.mode === "INCREMENTAL" && run.baseRunId) {
      const baseGraph = await resolveTrustedGraph(worktree, run.baseRunId);
      const nodeChanges = classifySnapshotRows(baseGraph.nodes, nodeRows);
      const edgeChanges = classifySnapshotRows(baseGraph.edges, edgeRows);
      run.graphDelta = {
        baseRunId: baseGraph.runId,
        baseGraphHash: baseGraph.meta.graphHash,
        addedNodeIds: nodeChanges.added,
        removedNodeIds: nodeChanges.removed,
        changedEvidenceEdgeIds: edgeChanges.changedEvidence,
        changedMembershipEdgeIds: edgeChanges.changedMembership,
        addedEdgeIds: edgeChanges.added,
        removedEdgeIds: edgeChanges.removed,
      };
      run.tombstones.nodeIds = nodeChanges.removed;
      run.tombstones.edgeIds = edgeChanges.removed;
    }
    run.graphHash = graphHash;
    run.graphMeta = meta;
    run.topologyRootHash = topologyMeta.topologyRootHash;
    run.events.push({ at: nowIso(), type: "GRAPH_BUILT", graphHash, nodes: nodeRows.length, edges: edgeRows.length });
    updateCounters(run);
    const resultValue = { runId: run.runId, graphHash, topologyRootHash: topologyMeta.topologyRootHash, nodeCount: nodeRows.length, edgeCount: edgeRows.length, topologyNodeCount: topologyMeta.nodeCount, topologyEdgeCount: topologyMeta.edgeCount, graphDirectory };
    recordOperation(run, input, replay?.digest, resultValue);
    await atomicWriteJson(paths.state, run);
    return resultValue;
  });
}

async function parseJsonLines(path) {
  const bytes = await readRegularFile(path, MAX_GRAPH_BYTES);
  const rows = bytes.toString("utf8").split("\n").filter(Boolean);
  if (rows.length > MAX_GRAPH_ROWS) throw new Error("图行数超过资源上限");
  return rows.map((line) => JSON.parse(line));
}

async function resolveTrustedGraph(worktree, requestedRunId) {
  const root = resolve(worktree);
  let runId = requestedRunId;
  let pointer = null;
  if (!runId || runId === "current") {
    pointer = await readJson(join(root, "docs/spring-business/current.json"));
    runId = pointer.runId;
  }
  assertIdentifier(runId, RUN_ID, "runId");
  const graphDirectory = await ensureSafeDirectoryChain(root, `docs/spring-business/snapshots/${runId}/graph`, false);
  const meta = await readJson(join(graphDirectory, "meta.json"));
  const nodesBytes = await readRegularFile(join(graphDirectory, "nodes.jsonl"), MAX_GRAPH_BYTES);
  const edgesBytes = await readRegularFile(join(graphDirectory, "edges.jsonl"), MAX_GRAPH_BYTES);
  if (nodesBytes.length + edgesBytes.length > MAX_GRAPH_BYTES) throw new Error("图快照超过64MiB资源上限");
  const nodesText = nodesBytes.toString("utf8");
  const edgesText = edgesBytes.toString("utf8");
  const withoutHash = { ...meta };
  delete withoutHash.graphHash;
  const actualGraphHash = sha256([canonicalJson(withoutHash), "\0", nodesText, "\0", edgesText]);
  await ensureSafeRunDirectory(worktree, runId, false);
  const completedRun = await readJson(runPaths(worktree, runId).state);
  if (completedRun.schemaVersion !== SCHEMA_VERSION || completedRun.phase !== "COMPLETE" || completedRun.graphHash !== meta.graphHash || completedRun.topologyRootHash !== meta.topologyRootHash ||
      actualGraphHash !== meta.graphHash || (pointer && (pointer.schemaVersion !== SCHEMA_VERSION || pointer.graphHash !== meta.graphHash || pointer.topologyRootHash !== meta.topologyRootHash || pointer.manifestHash !== completedRun.manifestHash || pointer.indexHash !== completedRun.indexHash || pointer.snapshot !== `docs/spring-business/snapshots/${runId}`))) {
    throw new Error("已发布图快照缺少COMPLETE可信根或哈希不匹配");
  }
  await verifyPublicationBundle(worktree, completedRun, `docs/spring-business/snapshots/${runId}/`);
  const nodes = nodesText.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const edges = edgesText.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  if (nodes.length !== meta.nodeCount || edges.length !== meta.edgeCount || nodes.length > MAX_GRAPH_ROWS || edges.length > MAX_GRAPH_ROWS) throw new Error("图meta计数与实际JSONL不一致或超过资源上限");
  const nodeIds = new Set();
  for (const node of nodes) {
    if (!node?.id || nodeIds.has(node.id)) throw new Error("图包含空或重复node id");
    nodeIds.add(node.id);
  }
  const edgeIds = new Set();
  for (const edge of edges) {
    if (!edge?.id || edgeIds.has(edge.id) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error("图包含重复edge id或悬空端点");
    edgeIds.add(edge.id);
  }
  return { runId, run: completedRun, meta, nodes, edges };
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  if (value !== undefined && typeof value !== "number") throw new Error(`${label}必须是数字`);
  const number = value === undefined ? fallback : value;
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${label}必须为${minimum}到${maximum}的整数`);
  return number;
}

function findSnapshotPaths(graph, input) {
  if (typeof input.key !== "string" || !input.key || input.key.length > 2048 || typeof input.target !== "string" || !input.target || input.target.length > 2048) throw new Error("path必须提供合法source和target");
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (!nodeIds.has(input.key) || !nodeIds.has(input.target)) throw new Error("NODE_NOT_FOUND");
  const maxDepth = boundedInteger(input.maxDepth, 12, 1, 20, "maxDepth");
  const maxPaths = boundedInteger(input.limit, 20, 1, 100, "limit");
  const direction = input.direction ?? "out";
  if (!new Set(["in", "out", "both"]).has(direction)) throw new Error("direction非法");
  const edgeTypes = input.edgeTypes?.length ? new Set(input.edgeTypes) : null;
  const allowedTypes = new Set(["JAVA_CALL", "CODEGRAPH_SPECIAL", "LOGICAL_BOUNDARY", "PERSISTENCE"]);
  if (edgeTypes && [...edgeTypes].some((type) => !allowedTypes.has(type))) throw new Error("edgeTypes包含未知类型");
  if (input.key === input.target) return { total: 1, truncated: false, resourceLimit: null, paths: [{ nodes: [input.key], edgeIds: [], entryMembership: [] }] };
  const adjacency = new Map();
  const add = (from, to, edge) => adjacency.set(from, [...(adjacency.get(from) ?? []), { to, edge }]);
  for (const edge of graph.edges) {
    if (edgeTypes && !edgeTypes.has(edge.type)) continue;
    if (direction !== "in") add(edge.from, edge.to, edge);
    if (direction !== "out") add(edge.to, edge.from, edge);
  }
  for (const rows of adjacency.values()) rows.sort((a, b) => a.edge.id.localeCompare(b.edge.id) || a.to.localeCompare(b.to));
  const strictEntry = input.mode !== "COMPOSED";
  const queue = [{ node: input.key, nodes: [input.key], edges: [], membership: null, potentialReasons: [] }];
  const paths = [];
  let visits = 0;
  let shortest = null;
  while (queue.length && paths.length <= maxPaths) {
    const current = queue.shift();
    if (shortest !== null && current.edges.length >= shortest) continue;
    if (current.edges.length >= maxDepth) continue;
    for (const next of adjacency.get(current.node) ?? []) {
      visits += 1;
      if (visits > MAX_PATH_VISITS) return { total: paths.length, truncated: true, resourceLimit: "MAX_PATH_VISITS", paths: paths.slice(0, maxPaths) };
      if (current.nodes.includes(next.to)) continue;
      const memberships = new Set(next.edge.entryMembership ?? []);
      const shared = current.membership === null ? memberships : new Set([...current.membership].filter((id) => memberships.has(id)));
      if (strictEntry && shared.size === 0) continue;
      const competition = next.edge.type === "LOGICAL_BOUNDARY" && next.edge.evidence?.deliverySemantics === "COMPETING_ONE_OF";
      const potentialReasons = [...new Set([...current.potentialReasons, ...(!strictEntry ? ["COMPOSED_CROSS_ENTRY"] : []), ...(competition ? ["COMPETING_ONE_OF"] : [])])].sort();
      const candidate = { node: next.to, nodes: [...current.nodes, next.to], edges: [...current.edges, next.edge.id], membership: shared, potentialReasons };
      if (next.to === input.target) {
        shortest = candidate.edges.length;
        paths.push({ nodes: candidate.nodes, edgeIds: candidate.edges, entryMembership: [...shared].sort(), potential: potentialReasons.length > 0, potentialReasons });
      } else queue.push(candidate);
    }
  }
  paths.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  return { total: paths.length, truncated: paths.length > maxPaths, resourceLimit: null, paths: paths.slice(0, maxPaths) };
}

async function queryGraphSnapshot(worktree, input) {
  const graph = await resolveTrustedGraph(worktree, input.runId);
  if (input.query === "path") {
    const pathResult = findSnapshotPaths(graph, input);
    return { runId: graph.runId, graphHash: graph.meta.graphHash, mode: input.mode ?? "STRICT_ENTRY", ...pathResult };
  }
  const limit = boundedInteger(input.limit, 100, 1, 500, "limit");
  let resultRows;
  if (input.query === "node") resultRows = graph.nodes.filter((node) => node.id === input.key);
  else if (input.query === "entry") resultRows = graph.edges.filter((edge) => edge.entryMembership.includes(input.key));
  else if (input.query === "table") resultRows = graph.edges.filter((edge) => edge.type === "PERSISTENCE" && edge.to === input.key);
  else if (input.query === "boundary") resultRows = graph.edges.filter((edge) => edge.type === "LOGICAL_BOUNDARY" && (edge.id === input.key || edge.evidence?.id === input.key));
  else if (input.query === "service") resultRows = graph.edges.filter((edge) => edge.services.includes(input.key));
  else if (input.query === "neighbors") resultRows = graph.edges.filter((edge) => input.direction === "in" ? edge.to === input.key : input.direction === "out" ? edge.from === input.key : edge.from === input.key || edge.to === input.key);
  else throw new Error(`不支持的快照查询：${input.query}`);
  return { runId: graph.runId, graphHash: graph.meta.graphHash, total: resultRows.length, truncated: resultRows.length > limit, rows: resultRows.slice(0, limit) };
}

async function queryTopologySnapshot(worktree, input) {
  let runId = input.runId;
  let pointer = null;
  const root = resolve(worktree);
  if (!runId || runId === "current") {
    pointer = await readJson(join(root, "docs/spring-business/current.json"));
    runId = pointer.runId;
  }
  assertIdentifier(runId, RUN_ID, "runId");
  await ensureSafeRunDirectory(worktree, runId, false);
  const run = await readJson(runPaths(worktree, runId).state);
  if (run.schemaVersion !== SCHEMA_VERSION || run.phase !== "COMPLETE" || !run.topologyRootHash || !run.manifestHash ||
      (pointer && (pointer.schemaVersion !== SCHEMA_VERSION || pointer.topologyRootHash !== run.topologyRootHash || pointer.graphHash !== run.graphHash || pointer.manifestHash !== run.manifestHash || pointer.indexHash !== run.indexHash || pointer.snapshot !== `docs/spring-business/snapshots/${runId}`))) {
    throw new Error("V2拓扑缺少COMPLETE自洽完整性根");
  }
  await verifyPublicationBundle(worktree, run, `docs/spring-business/snapshots/${runId}/`);
  const graphDirectory = await ensureSafeDirectoryChain(root, `docs/spring-business/snapshots/${runId}/graph`, false);
  const answer = await queryTopologyBundle(graphDirectory, input);
  if (answer.topologyRootHash !== run.topologyRootHash) throw new Error("拓扑查询根与run不匹配");
  return { runId, integrityModel: "SELF_CONSISTENCY_NOT_EXTERNAL_SIGNATURE", ...answer };
}

function classifySnapshotRows(fromRows, toRows) {
  const from = new Map(fromRows.map((row) => [row.id, row]));
  const to = new Map(toRows.map((row) => [row.id, row]));
  const added = [...to.keys()].filter((id) => !from.has(id)).sort();
  const removed = [...from.keys()].filter((id) => !to.has(id)).sort();
  const changedEvidence = [];
  const changedMembership = [];
  for (const id of [...from.keys()].filter((key) => to.has(key)).sort()) {
    const before = from.get(id);
    const after = to.get(id);
    if (before.evidenceHash !== after.evidenceHash) changedEvidence.push(id);
    if (canonicalJson(before.entryMembership ?? []) !== canonicalJson(after.entryMembership ?? []) || canonicalJson(before.services ?? []) !== canonicalJson(after.services ?? [])) changedMembership.push(id);
  }
  return { added, removed, changedEvidence, changedMembership };
}

function boundedSnapshotChanges(changes, limit) {
  const all = [
    ...changes.added.map((id) => ({ change: "ADDED", id })),
    ...changes.removed.map((id) => ({ change: "REMOVED", id })),
    ...changes.changedEvidence.map((id) => ({ change: "CHANGED_EVIDENCE", id })),
    ...changes.changedMembership.map((id) => ({ change: "CHANGED_MEMBERSHIP", id })),
  ];
  return {
    counts: {
      added: changes.added.length,
      removed: changes.removed.length,
      changedEvidence: changes.changedEvidence.length,
      changedMembership: changes.changedMembership.length,
    },
    total: all.length,
    rows: all.slice(0, limit),
    truncated: all.length > limit,
    complete: all.length <= limit,
  };
}

async function diffGraphSnapshots(worktree, input) {
  const limit = boundedInteger(input.limit, 100, 1, 500, "limit");
  const fromGraph = await resolveTrustedGraph(worktree, input.fromRunId);
  const toGraph = await resolveTrustedGraph(worktree, input.toRunId);
  const nodeChanges = boundedSnapshotChanges(classifySnapshotRows(fromGraph.nodes, toGraph.nodes), limit);
  const edgeChanges = boundedSnapshotChanges(classifySnapshotRows(fromGraph.edges, toGraph.edges), limit);
  const fromEntries = new Set(fromGraph.meta.entryIds ?? []);
  const toEntries = new Set(toGraph.meta.entryIds ?? []);
  const entryRows = [...[...toEntries].filter((id) => !fromEntries.has(id)).sort().map((id) => ({ change: "ADDED", id })), ...[...fromEntries].filter((id) => !toEntries.has(id)).sort().map((id) => ({ change: "REMOVED", id }))];
  const entries = { counts: { added: entryRows.filter((row) => row.change === "ADDED").length, removed: entryRows.filter((row) => row.change === "REMOVED").length }, total: entryRows.length, rows: entryRows.slice(0, limit), truncated: entryRows.length > limit, complete: entryRows.length <= limit };
  return { fromRunId: fromGraph.runId, toRunId: toGraph.runId, fromGraphHash: fromGraph.meta.graphHash, toGraphHash: toGraph.meta.graphHash, entries, nodes: nodeChanges, edges: edgeChanges };
}

function requireStoredReport(run, reportId, kind) {
  const report = run.reports[reportId];
  if (!report || report.kind !== kind || report.payload?.decision !== "ACCEPTED") throw new Error(`缺少已认证${kind}报告`);
  return report;
}

async function verifyGraphAtPrefix(worktree, run, prefix) {
  const metaBytes = await readWorkspaceArtifact(worktree, `${prefix}meta.json`, prefix, MAX_METADATA_BYTES);
  const nodesBytes = await readWorkspaceArtifact(worktree, `${prefix}nodes.jsonl`, prefix, MAX_GRAPH_BYTES);
  const edgesBytes = await readWorkspaceArtifact(worktree, `${prefix}edges.jsonl`, prefix, MAX_GRAPH_BYTES);
  const meta = JSON.parse(metaBytes.toString("utf8"));
  const withoutHash = { ...meta };
  delete withoutHash.graphHash;
  const actual = sha256([canonicalJson(withoutHash), "\0", nodesBytes.toString("utf8"), "\0", edgesBytes.toString("utf8")]);
  if (actual !== run.graphHash || meta.graphHash !== run.graphHash) throw new Error("图快照实际字节哈希不匹配");
  const graphDirectory = await ensureSafeDirectoryChain(resolve(worktree), prefix.replace(/\/$/, ""), false);
  const topologyMeta = await verifyTopologyBundle(graphDirectory);
  if (topologyMeta.topologyRootHash !== run.topologyRootHash || meta.topologyRootHash !== run.topologyRootHash) throw new Error("类型化拓扑实际分片根哈希不匹配");
  return meta;
}

async function verifyStagedGraph(worktree, run) {
  return verifyGraphAtPrefix(worktree, run, `docs/spring-business/.staging/${run.runId}/graph/`);
}

async function verifyDocumentsAtPrefix(worktree, run, prefix) {
  for (const unit of Object.values(run.units)) {
    const bytes = await readWorkspaceArtifact(worktree, `${prefix}entrypoints/${unit.id}.md`, prefix, MAX_DOCUMENT_BYTES);
    if (sha256([bytes]) !== unit.documentHash) throw new Error(`入口${unit.id}发布文档哈希不匹配`);
  }
}

function escapeMarkdown(value) {
  return String(value).replace(/[\\`*_{}\[\]()<>#+.!|\r\n]/g, (character) => `\\${character === "\n" || character === "\r" ? " " : character}`);
}

async function writePublicationBundle(worktree, run) {
  const prefix = `docs/spring-business/.staging/${run.runId}/`;
  const graphPrefix = `${prefix}graph/`;
  const nodes = (await readWorkspaceArtifact(worktree, `${graphPrefix}nodes.jsonl`, graphPrefix, MAX_GRAPH_BYTES)).toString("utf8").split("\n").filter(Boolean).map(JSON.parse);
  const edges = (await readWorkspaceArtifact(worktree, `${graphPrefix}edges.jsonl`, graphPrefix, MAX_GRAPH_BYTES)).toString("utf8").split("\n").filter(Boolean).map(JSON.parse);
  const tableMap = new Map();
  const boundaries = [];
  const tools = new Set();
  for (const edge of edges) {
    if (edge.type === "PERSISTENCE") {
      const item = tableMap.get(edge.to) ?? { name: edge.to, storeId: edge.evidence?.storeId ?? "default", resourceKind: edge.evidence?.resourceKind ?? "RELATIONAL_TABLE", operations: [], evidence: [] };
      item.operations = [...new Set([...item.operations, edge.evidence?.operation ?? "UNKNOWN"])].sort();
      item.evidence.push({ edgeId: edge.id, symbol: edge.from, evidenceHash: edge.evidenceHash });
      item.evidence.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
      tableMap.set(edge.to, item);
    } else if (edge.type === "LOGICAL_BOUNDARY") {
      boundaries.push({ id: edge.id, kind: edge.evidence?.kind ?? "UNKNOWN", key: edge.evidence?.key ?? edge.evidence?.channelKey ?? "", source: edge.from, target: edge.to, status: "VERIFIED", deliverySemantics: edge.evidence?.deliverySemantics ?? "DIRECT", consumerGroup: edge.evidence?.consumerGroup ?? null, evidence: [edge.evidenceHash] });
    }
  }
  for (const unit of Object.values(run.units)) {
    const trace = await loadUnitTrace(worktree, run, unit);
    for (const query of trace.queryLog ?? []) if (query.tool) tools.add(query.tool);
  }
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    toolkitVersion: TOOLKIT_VERSION,
    runId: run.runId,
    graphHash: run.graphHash,
    fingerprints: { config: run.configHash, source: run.sourceSnapshot, index: run.indexFingerprint, toolkit: run.toolkitFingerprint, resolvedConfig: run.resolutionContextHash, adapterRegistry: run.adapterRegistryFingerprint },
    contexts: run.resolutionSummary?.contexts?.map((context) => ({ id: context.id, activeProfiles: context.activeProfiles, contextHash: context.contextHash, unresolvedCount: context.unresolved.length })) ?? [],
    services: Object.keys(run.serviceSnapshots).sort().map((id) => ({ id, root: run.serviceRoots?.[id] ?? id, sourceHash: run.serviceSnapshots[id] })),
    entrypoints: Object.values(run.units).sort((a, b) => a.id.localeCompare(b.id)).map((unit) => ({ id: unit.id, service: unit.service, kind: unit.kind, status: unit.status, documentHash: unit.documentHash })),
    tables: [...tableMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    boundaries: boundaries.sort((a, b) => a.id.localeCompare(b.id)),
    codeGraphTools: [...tools].sort(),
    graph: { nodeCount: nodes.length, edgeCount: edges.length, formatVersion: 2, topologyRootHash: run.topologyRootHash },
    tombstones: run.tombstones,
    graphDelta: run.graphDelta,
    audits: { coverageHash: run.audits.coverageHash, boundaryHash: run.audits.boundaryHash, configHash: run.audits.configHash },
  };
  const root = resolve(worktree);
  const stage = await ensureSafeDirectoryChain(root, `docs/spring-business/.staging/${run.runId}`);
  await atomicWriteJson(join(stage, "manifest.json"), manifest);
  const lines = [
    `# Spring 业务快照 ${escapeMarkdown(run.runId)}`,
    "",
    `- 图哈希：\`${run.graphHash}\``,
    `- 入口：${manifest.entrypoints.length}`,
    `- 数据表：${manifest.tables.length}`,
    `- 跨服务边界：${manifest.boundaries.length}`,
    `- 删除入口：${manifest.tombstones.entryIds.length}`,
    "",
    "## 入口",
    "",
    ...manifest.entrypoints.map((entry) => `- [${escapeMarkdown(entry.id)}](entrypoints/${encodeURIComponent(entry.id)}.md) — ${escapeMarkdown(entry.kind)} / ${escapeMarkdown(entry.service)}`),
    "",
  ];
  await atomicWriteText(join(stage, "index.md"), `${lines.join("\n")}\n`);
  run.manifestHash = sha256([await readWorkspaceArtifact(worktree, `${prefix}manifest.json`, prefix, MAX_METADATA_BYTES)]);
  run.indexHash = sha256([await readWorkspaceArtifact(worktree, `${prefix}index.md`, prefix, MAX_METADATA_BYTES)]);
}

async function verifyPublicationBundle(worktree, run, prefix) {
  const manifestBytes = await readWorkspaceArtifact(worktree, `${prefix}manifest.json`, prefix, MAX_METADATA_BYTES);
  const indexBytes = await readWorkspaceArtifact(worktree, `${prefix}index.md`, prefix, MAX_METADATA_BYTES);
  if (sha256([manifestBytes]) !== run.manifestHash || sha256([indexBytes]) !== run.indexHash) throw new Error("manifest或index实际字节哈希不匹配");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.runId !== run.runId || manifest.graphHash !== run.graphHash || manifest.graph?.topologyRootHash !== run.topologyRootHash || manifest.graph?.nodeCount !== run.graphMeta?.nodeCount || manifest.graph?.edgeCount !== run.graphMeta?.edgeCount || canonicalJson(manifest.tombstones) !== canonicalJson(run.tombstones)) throw new Error("manifest与运行自洽完整性根不一致");
  return manifest;
}

async function publishCurrentPointer(worktree, run) {
  const root = resolve(worktree);
  const output = await ensureSafeDirectoryChain(root, "docs/spring-business");
  await atomicWriteJson(join(output, "current.json"), {
    schemaVersion: SCHEMA_VERSION,
    runId: run.runId,
    graphHash: run.graphHash,
    topologyRootHash: run.topologyRootHash,
    manifestHash: run.manifestHash,
    indexHash: run.indexHash,
    snapshot: run.snapshotRelativePath,
    completedAt: run.updatedAt,
  });
}

async function finalizeSnapshot(worktree, run, paths) {
  const root = resolve(worktree);
  await ensureSafeDirectoryChain(root, "docs/spring-business/.staging", false);
  const staging = resolve(root, `docs/spring-business/.staging/${run.runId}`);
  const snapshots = await ensureSafeDirectoryChain(root, "docs/spring-business/snapshots");
  const snapshot = join(snapshots, run.runId);
  try {
    const info = await lstat(snapshot);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("快照目标不是安全目录");
    await verifyGraphAtPrefix(worktree, run, `docs/spring-business/snapshots/${run.runId}/graph/`);
    await verifyDocumentsAtPrefix(worktree, run, `docs/spring-business/snapshots/${run.runId}/`);
    await verifyPublicationBundle(worktree, run, `docs/spring-business/snapshots/${run.runId}/`);
  } catch (error) {
    if (error?.code === "ENOENT") {
      const stagingInfo = await lstat(staging);
      if (stagingInfo.isSymbolicLink() || !stagingInfo.isDirectory()) throw new Error("staging不是安全目录");
      await verifyGraphAtPrefix(worktree, run, `docs/spring-business/.staging/${run.runId}/graph/`);
      await verifyDocumentsAtPrefix(worktree, run, `docs/spring-business/.staging/${run.runId}/`);
      await verifyPublicationBundle(worktree, run, `docs/spring-business/.staging/${run.runId}/`);
      await rename(staging, snapshot);
      await verifyGraphAtPrefix(worktree, run, `docs/spring-business/snapshots/${run.runId}/graph/`);
      await verifyDocumentsAtPrefix(worktree, run, `docs/spring-business/snapshots/${run.runId}/`);
      await verifyPublicationBundle(worktree, run, `docs/spring-business/snapshots/${run.runId}/`);
    }
    else throw error;
  }
  run.snapshotRelativePath = `docs/spring-business/snapshots/${run.runId}`;
  for (const unit of Object.values(run.units)) {
    if (typeof unit.documentRelativePath === "string") {
      unit.documentRelativePath = unit.documentRelativePath.replace(`docs/spring-business/.staging/${run.runId}/`, `${run.snapshotRelativePath}/`);
    }
  }
  run.phase = "COMPLETE";
  run.pauseRequested = false;
  run.events.push({ at: nowIso(), type: "SNAPSHOT_FINALIZED", snapshot: run.snapshotRelativePath });
  updateCounters(run);
  await atomicWriteJson(paths.state, run);
  await publishCurrentPointer(worktree, run);
  run.publication.currentUpdated = true;
  updateCounters(run);
  await atomicWriteJson(paths.state, run);
}

async function controlRun(worktree, input) {
  const action = input.action;
  if (!new Set(["PAUSE", "RESUME", "COMPLETE", "PARTIAL", "FAIL"]).has(action)) throw new Error(`不支持的控制动作：${action}`);
  return withRunLock(worktree, input.runId, async (paths) => {
    const run = await readJson(paths.state);
    assertCurrentRun(run);
    const replay = operationReplay(run, input);
    if (replay?.result) return replay.result;
    if (new Set(["COMPLETE", "PARTIAL", "FAILED", "STALE"]).has(run.phase)) {
      throw new Error(`终态运行不可控制：${run.phase}`);
    }
    if (action === "PAUSE") {
      run.resumePhase = run.phase;
      run.pauseRequested = true;
      run.phase = Object.values(run.units).some((unit) => ACTIVE_UNIT_STATES.has(unit.status)) || Object.values(run.batches).some((batch) => batch.status === "OPEN") ? "PAUSE_REQUESTED" : "PAUSED";
    } else if (action === "RESUME") {
      if (!new Set(["PAUSED", "PAUSE_REQUESTED"]).has(run.phase)) {
        throw new Error(`只有暂停中的运行可以恢复：${run.phase}`);
      }
      if (!fingerprintMatches(run, input)) {
        run.phase = "STALE";
        run.pauseRequested = false;
        run.events.push({ at: nowIso(), type: "RESUME_FINGERPRINT_MISMATCH" });
        updateCounters(run);
        await atomicWriteJson(paths.state, run);
        throw new Error("运行指纹已变化，状态标记为STALE；请新建运行或显式重新规划");
      }
      recoverExpiredLeases(run);
      for (const batch of Object.values(run.batches)) {
        if (batch.status === "OPEN" && batch.unitIds.every((id) => run.units[id]?.status !== "LEASED")) {
          batch.status = "CLOSED";
          batch.closedAt = nowIso();
        }
      }
      run.pauseRequested = false;
      run.phase = run.resumePhase && !new Set(["COMPLETE", "PARTIAL", "FAILED", "STALE"]).has(run.resumePhase) ? run.resumePhase : "PLANNED";
      run.resumePhase = null;
    } else if (action === "COMPLETE") {
      await requireFreshFingerprints(run, input, paths, "COMPLETE_FINGERPRINT_MISMATCH");
      if (Object.keys(run.units).length === 0) throw new Error("没有入口单元，不能COMPLETE");
      if (Object.values(run.batches).some((batch) => batch.status === "OPEN")) throw new Error("存在未关闭批次，不能COMPLETE");
      const incomplete = Object.values(run.units).filter((unit) => !new Set(["PUBLISHED", "REUSED"]).has(unit.status));
      if (incomplete.length > 0) throw new Error(`仍有${incomplete.length}个入口未发布，不能COMPLETE`);
      const coverage = requireStoredReport(run, input.coverageReportId, "COVERAGE");
      const boundary = requireStoredReport(run, input.boundaryReportId, "BOUNDARY");
      const config = requireStoredReport(run, input.configReportId, "CONFIG");
      if (!run.graphHash) throw new Error("缺少确定性图快照");
      await verifyStagedGraph(worktree, run);
      for (const unit of Object.values(run.units)) {
        const bytes = await readWorkspaceArtifact(worktree, unit.documentRelativePath, `docs/spring-business/.staging/${run.runId}/`, MAX_DOCUMENT_BYTES);
        if (sha256([bytes]) !== unit.documentHash) throw new Error(`入口${unit.id}发布文档哈希不匹配`);
      }
      run.audits = { coverageHash: coverage.hash, boundaryHash: boundary.hash, configHash: config.hash };
      await writePublicationBundle(worktree, run);
      await verifyPublicationBundle(worktree, run, `docs/spring-business/.staging/${run.runId}/`);
      run.phase = "FINALIZING";
      run.publication = { staging: `docs/spring-business/.staging/${run.runId}`, snapshot: `docs/spring-business/snapshots/${run.runId}`, currentUpdated: false };
      run.events.push({ at: nowIso(), type: "RUN_FINALIZING" });
      updateCounters(run);
      await atomicWriteJson(paths.state, run);
      await finalizeSnapshot(worktree, run, paths);
      const resultValue = { runId: run.runId, phase: run.phase, graphHash: run.graphHash, snapshot: run.snapshotRelativePath };
      recordOperation(run, input, replay?.digest, resultValue);
      await atomicWriteJson(paths.state, run);
      return resultValue;
    } else if (action === "PARTIAL") {
      const units = Object.values(run.units);
      if (units.length === 0 || units.some((unit) => ACTIVE_UNIT_STATES.has(unit.status))) {
        throw new Error("PARTIAL要求已有入口且不存在活动租约/验证/发布单元");
      }
      const delivered = (unit) => new Set(["PUBLISHED", "REUSED"]).has(unit.status);
      if (!units.some(delivered) || units.every(delivered)) {
        throw new Error("PARTIAL要求至少一个已发布单元和至少一个未交付缺口");
      }
      await requireFreshFingerprints(run, input, paths, "PARTIAL_FINGERPRINT_MISMATCH");
      run.phase = "PARTIAL";
      run.pauseRequested = false;
    } else {
      run.phase = "FAILED";
      run.pauseRequested = false;
    }
    run.events.push({ at: nowIso(), type: `RUN_${action}` });
    updateCounters(run);
    const resultValue = { runId: run.runId, phase: run.phase, counts: run.counts };
    recordOperation(run, input, replay?.digest, resultValue);
    await atomicWriteJson(paths.state, run);
    return resultValue;
  });
}

async function statusRun(worktree, runId) {
  await ensureSafeRunDirectory(worktree, runId, false);
  const paths = runPaths(worktree, runId);
  const run = await readJson(paths.state);
  updateCounters(run);
  return { ...run, legacyReadOnly: run.schemaVersion !== SCHEMA_VERSION, fullRebaseRequired: run.schemaVersion !== SCHEMA_VERSION };
}

async function migrateConfiguration(worktree, input = {}) {
  const root = resolve(worktree);
  await ensureSafeCacheBase(root);
  const lock = await acquireLock(join(root, ".opencode/.cache/spring-business-tracer/.migration.lock"));
  try {
    const configPath = join(root, ".opencode/spring-business-tracer.json");
    const current = await readJson(configPath);
    if (current.version === TOOLKIT_VERSION) {
      for (const legacyVersion of ["1.5.0", "1.0.0", "0.5.0"]) {
        const backupName = `.opencode/spring-business-tracer.v${legacyVersion.replace(/\.0$/, "")}.json`;
        try {
          const backup = await readJson(join(root, backupName));
          const journalPath = join(root, `.opencode/.cache/spring-business-tracer/migration-${legacyVersion}-to-${TOOLKIT_VERSION}.json`);
          const expected = { oldHash: sha256([canonicalJson(backup)]), newHash: sha256([canonicalJson(current)]) };
          let journal = null;
          try { journal = await readJson(journalPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
          if (journal && (journal.from !== legacyVersion || journal.to !== TOOLKIT_VERSION || journal.oldHash !== expected.oldHash || journal.newHash !== expected.newHash)) throw new Error("迁移journal与实际备份/配置哈希不一致");
          if (!journal || journal.state === "PREPARED") {
            if (input.apply !== true) return { status: "RECOVERY_REQUIRED", from: legacyVersion, to: TOOLKIT_VERSION, changed: false };
            await atomicWriteJson(journalPath, { schemaVersion: SCHEMA_VERSION, from: legacyVersion, to: TOOLKIT_VERSION, ...expected, legacyRuns: "LEGACY_READ_ONLY/FULL_REBASE_REQUIRED", state: "APPLIED", recoveredAt: nowIso() });
            return { status: "RECOVERED", from: legacyVersion, to: TOOLKIT_VERSION, changed: false, backup: backupName };
          }
          if (journal.state !== "APPLIED") throw new Error(`迁移journal状态非法：${journal.state}`);
          return { status: "NOOP", from: TOOLKIT_VERSION, to: TOOLKIT_VERSION, changed: false };
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      return { status: "NOOP", from: TOOLKIT_VERSION, to: TOOLKIT_VERSION, changed: false };
    }
    if (!new Set(["0.5.0", "1.0.0", "1.5.0"]).has(current.version)) throw new Error(`不支持的配置迁移版本：${current.version}`);
    const requiredObjects = ["workspace", "output", "codeGraph", "analysis", "entrypoints", "crossService", "batching", "resume", "verification"];
    if (current.language !== "java" || requiredObjects.some((key) => !current[key] || typeof current[key] !== "object" || Array.isArray(current[key])) ||
        current.codeGraph.allowNativeCallGraphFallback !== false || current.codeGraph.allowTextSearchCallGraphFallback !== false ||
        current.crossService.requireTwoSidedEvidence !== true || current.verification.publishOnlyVerified !== true) {
      throw new Error("旧配置缺少必需字段或违反安全不变量，拒绝迁移");
    }
    const enabled = current.entrypoints?.enabledAdapters ?? [];
    const maxBranches = current.analysis?.maxBranches;
    if (!Array.isArray(enabled) || !Array.isArray(current.workspace.services) || !Array.isArray(current.verification.validators) ||
        !Number.isInteger(maxBranches) || maxBranches < 1 || maxBranches >= 1000 ||
        !Number.isInteger(current.batching.batchSize) || current.batching.batchSize < 1 || current.batching.batchSize > 100 ||
        !Number.isInteger(current.batching.leaseSeconds) || current.batching.leaseSeconds < 30 ||
        !Number.isInteger(current.batching.retryLimit) || current.batching.retryLimit < 0 || current.batching.retryLimit > 10 ||
        current.output.directory !== "docs/spring-business" || current.resume.stateDirectory !== CACHE_RELATIVE) {
      throw new Error("旧配置字段类型或范围非法，拒绝迁移");
    }
    const verifiedMap = {
      SPRING_MVC: "SPRING_MVC", SPRING_WEBFLUX: "SPRING_WEBFLUX_ANNOTATED", KAFKA: "KAFKA_LISTENER", RABBIT: "RABBIT_LISTENER",
      JMS: "JMS_STATIC_LISTENER", SCHEDULED: "SCHEDULED", QUARTZ: "QUARTZ_STATIC_JOB_TRIGGER", SPRING_EVENT: "SPRING_EVENT",
      GRPC: "GRPC_UNARY_PROTO", GRAPHQL: "GRAPHQL_ANNOTATED_ROOT", APPLICATION_RUNNER: "APPLICATION_RUNNER",
    };
    const verified = [...new Set(enabled.map((name) => verifiedMap[name]).filter(Boolean))];
    const migrated = {
      ...current,
      version: TOOLKIT_VERSION,
      workspace: {
        ...current.workspace,
        services: (current.workspace?.services ?? []).map((service) => ({
          ...service,
          codeGraphProjectPath: service.codeGraphProjectPath ?? service.root,
          packages: service.packages ?? [],
          aliases: service.aliases ?? [service.id],
        })),
      },
      codeGraph: { ...current.codeGraph, queryLimit: maxBranches + 1, requireCompleteStatus: true },
      analysisContexts: { defaultContext: "default", definitions: [{ id: "default", activeProfiles: ["default"], propertySources: [], optionalSources: true }] },
      configResolution: { externalSourcePolicy: "PARTIAL", environmentPolicy: "DENY", secretPolicy: "HASH_ONLY", executeSpel: false, maxSourceBytes: 1048576, maxTotalBytes: 8388608 },
      adapterRegistry: { builtInVersion: TOOLKIT_VERSION, allowScripts: false, customDefinitions: [] },
      entrypoints: { ...current.entrypoints, verifiedAdapters: verified, experimentalAdapters: enabled.filter((name) => !verifiedMap[name]) },
      crossService: { ...current.crossService, verifiedKinds: ["FEIGN_HTTP", "REST_TEMPLATE_HTTP", "WEBCLIENT_HTTP", "GATEWAY_HTTP", "RABBIT", "KAFKA", "JMS", "GRPC", "SPRING_EVENT"], kafka: { requireClusterAlias: true, consumerGroupSemantics: true, dynamicDestinationPolicy: "PARTIAL" } },
      persistence: { verifiedAdapters: ["JPA", "MYBATIS_XML", "MYBATIS_ANNOTATION", "JDBC_TEMPLATE"], dynamicIdentifierPolicy: "PARTIAL" },
      incremental: { enabled: true, strategy: "SERVICE_CLOSURE", requireFullEntryRediscovery: true, legacyBaselinePolicy: "FULL_REBASE" },
      publication: { stagingDirectory: "docs/spring-business/.staging", snapshotDirectory: "docs/spring-business/snapshots", currentPointer: "docs/spring-business/current.json", writeIndex: true, writeManifest: true },
      graph: { formatVersion: 2, sharded: true, shardPrefixLength: 2, diffEnabled: true, pathQueryMaxDepth: 20, pathQueryMaxResults: 100, recordTombstones: true, cursorBoundToSnapshot: true, queryWallClockMs: 2000, maxShardBytes: 8388608 },
      batching: { ...current.batching, heartbeatSeconds: 120, requireClose: true, operationJournalLimit: 2000 },
      resume: { ...current.resume, requireToolkitFingerprint: true },
      verification: { ...current.verification, validators: [...new Set([...(current.verification.validators ?? []), "incremental", "config"])] },
    };
    if (!Number.isInteger(migrated.codeGraph.queryLimit) || migrated.codeGraph.queryLimit < 2 || migrated.codeGraph.queryLimit > 1000 || migrated.incremental.strategy !== "SERVICE_CLOSURE" ||
        !migrated.verification.validators.includes("incremental") || !migrated.verification.validators.includes("config") || migrated.resume.requireToolkitFingerprint !== true || migrated.graph.formatVersion !== 2) {
      throw new Error("V2.0迁移结果未通过安全不变量校验");
    }
    const report = {
      schemaVersion: SCHEMA_VERSION,
      from: current.version,
      to: TOOLKIT_VERSION,
      oldHash: sha256([canonicalJson(current)]),
      newHash: sha256([canonicalJson(migrated)]),
      legacyRuns: "LEGACY_READ_ONLY/FULL_REBASE_REQUIRED",
    };
    if (input.apply !== true) return { status: "DRY_RUN", changed: true, migrated, report };
    const backupName = `.opencode/spring-business-tracer.v${current.version.replace(/\.0$/, "")}.json`;
    const backupPath = join(root, backupName);
    try {
      const backup = await readJson(backupPath);
      if (canonicalJson(backup) !== canonicalJson(current)) throw new Error("现有旧版备份与待迁移配置不一致");
    } catch (error) {
      if (error?.code === "ENOENT") await atomicWriteJson(backupPath, current);
      else throw error;
    }
    const journalPath = join(root, `.opencode/.cache/spring-business-tracer/migration-${current.version}-to-${TOOLKIT_VERSION}.json`);
    try {
      const existingJournal = await readJson(journalPath);
      if (existingJournal.oldHash !== report.oldHash || existingJournal.newHash !== report.newHash || !new Set(["PREPARED", "APPLIED"]).has(existingJournal.state)) throw new Error("现有迁移journal与待迁移内容不一致");
    } catch (error) {
      if (error?.code === "ENOENT") await atomicWriteJson(journalPath, { ...report, state: "PREPARED", preparedAt: nowIso() });
      else throw error;
    }
    await atomicWriteJson(configPath, migrated);
    await atomicWriteJson(journalPath, { ...report, state: "APPLIED", appliedAt: nowIso() });
    return { status: "APPLIED", changed: true, backup: backupName, report };
  } finally {
    await lock.handle.close();
    try {
      const owner = await readJson(join(root, ".opencode/.cache/spring-business-tracer/.migration.lock"));
      if (owner.token === lock.token) await unlink(join(root, ".opencode/.cache/spring-business-tracer/.migration.lock"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function result(value) {
  return JSON.stringify(value, null, 2);
}

const SpringBusinessStatePlugin = async () => ({
  tool: {
    spring_state_fingerprint: tool({
      description: "只读计算配置、逐服务源码、Code Graph索引、工具包、解析上下文与adapter registry指纹",
      args: {},
      async execute(_args, context) {
        assertPrimary(context);
        return result(await computeWorkspaceFingerprints(context.worktree));
      },
    }),
    spring_state_init: tool({
      description: "幂等创建V2.0 FULL或INCREMENTAL运行；旧版run保持只读",
      args: {
        runId: tool.schema.string(),
        operationId: tool.schema.string(),
        mode: tool.schema.enum(["FULL", "INCREMENTAL"]).optional(),
        baseRunId: tool.schema.string().optional(),
        batchSize: tool.schema.number().int().min(1).max(100).optional(),
        retryLimit: tool.schema.number().int().min(0).max(10).optional(),
      },
      async execute(args, context) {
        assertPrimary(context);
        const fingerprints = await computeWorkspaceFingerprints(context.worktree);
        return result(await initRun(context.worktree, { ...args, ...fingerprints }));
      },
    }),
    spring_state_plan: tool({
      description: "冻结入口清单并创建可恢复分析单元；entriesJson必须来自已验证入口清单",
      args: {
        runId: tool.schema.string(),
        entriesJson: tool.schema.string(),
        operationId: tool.schema.string(),
      },
      async execute(args, context) {
        assertPrimary(context);
        const fingerprints = await computeWorkspaceFingerprints(context.worktree);
        return result(await planRun(context.worktree, { ...args, ...fingerprints }));
      },
    }),
    spring_state_claim: tool({
      description: "领取一个隔离批次并设置租约；支持回收过期租约",
      args: {
        runId: tool.schema.string(),
        workerId: tool.schema.string(),
        operationId: tool.schema.string(),
        limit: tool.schema.number().int().min(1).max(100).optional(),
        leaseSeconds: tool.schema.number().int().min(30).max(3600).optional(),
      },
      async execute(args, context) {
        assertPrimary(context);
        const fingerprints = await computeWorkspaceFingerprints(context.worktree);
        return result(await claimBatch(context.worktree, { ...args, ...fingerprints }));
      },
    }),
    spring_state_commit: tool({
      description: "幂等提交当前TRACE/VALIDATE/PUBLISH阶段；工件哈希由插件实际计算",
      args: {
        runId: tool.schema.string(),
        entryId: tool.schema.string(),
        workerId: tool.schema.string(),
        operationId: tool.schema.string(),
        batchId: tool.schema.string(),
        fingerprintToken: tool.schema.string(),
        status: tool.schema.enum(["TRACED", "VERIFIED", "PUBLISHED", "RETRYABLE_FAILED", "BLOCKED", "FAILED"]),
        traceResultJson: tool.schema.string().optional(),
        reportId: tool.schema.string().optional(),
        documentContent: tool.schema.string().optional(),
        errorCode: tool.schema.string().optional(),
      },
      async execute(args, context) {
        assertPrimary(context);
        return result(await commitUnit(context.worktree, args));
      },
    }),
    spring_state_heartbeat: tool({
      description: "延长当前OPEN批次内仍活动的租约",
      args: { runId: tool.schema.string(), batchId: tool.schema.string(), batchToken: tool.schema.string(), workerId: tool.schema.string(), operationId: tool.schema.string(), leaseSeconds: tool.schema.number().int().min(30).max(3600).optional() },
      async execute(args, context) {
        assertPrimary(context);
        return result(await heartbeatBatch(context.worktree, args));
      },
    }),
    spring_state_close_batch: tool({
      description: "批次末重算V2全部指纹并原子关闭批次；漂移则整个run进入STALE",
      args: { runId: tool.schema.string(), batchId: tool.schema.string(), batchToken: tool.schema.string(), operationId: tool.schema.string() },
      async execute(args, context) {
        assertPrimary(context);
        const fingerprints = await computeWorkspaceFingerprints(context.worktree);
        return result(await closeBatch(context.worktree, { ...args, ...fingerprints }));
      },
    }),
    spring_state_recover: tool({
      description: "恢复过期租约、未关闭批次或FINALIZING/current发布事务",
      args: { runId: tool.schema.string(), operationId: tool.schema.string() },
      async execute(args, context) {
        assertPrimary(context);
        const status = await statusRun(context.worktree, args.runId);
        const fingerprints = new Set(["FINALIZING", "COMPLETE"]).has(status.phase) ? {} : await computeWorkspaceFingerprints(context.worktree);
        return result(await recoverRun(context.worktree, { ...args, ...fingerprints }));
      },
    }),
    spring_report_submit: tool({
      description: "由受限Validator/Auditor直接提交带Agent身份、必需checks和非空证据的认证报告",
      args: {
        runId: tool.schema.string(),
        kind: tool.schema.enum(["TRACE", "COVERAGE", "BOUNDARY", "INCREMENTAL", "CONFIG"]),
        operationId: tool.schema.string(),
        entryId: tool.schema.string().optional(),
        batchToken: tool.schema.string().optional(),
        reportJson: tool.schema.string(),
      },
      async execute(args, context) {
        return result(await submitReport(context.worktree, args, context.agent));
      },
    }),
    spring_state_seed: tool({
      description: "用同版COMPLETE baseline按逐服务闭包保守复用并记录入口tombstone；旧版禁止seed",
      args: { runId: tool.schema.string(), reportId: tool.schema.string(), operationId: tool.schema.string() },
      async execute(args, context) {
        assertPrimary(context);
        const fingerprints = await computeWorkspaceFingerprints(context.worktree);
        return result(await seedIncrementalRun(context.worktree, { ...args, ...fingerprints }));
      },
    }),
    spring_graph_build: tool({
      description: "从已验证trace工件的确定性并集构建JSONL证据图，不推断新Java边",
      args: { runId: tool.schema.string(), operationId: tool.schema.string() },
      async execute(args, context) {
        assertPrimary(context);
        const fingerprints = await computeWorkspaceFingerprints(context.worktree);
        return result(await buildGraphSnapshot(context.worktree, { ...args, ...fingerprints }));
      },
    }),
    spring_graph_query: tool({
      description: "只读查询已完成快照的node/entry/table/boundary/service/neighbors或有界最短路径",
      args: {
        runId: tool.schema.string().optional(),
        query: tool.schema.enum(["node", "entry", "table", "boundary", "service", "neighbors", "path"]),
        key: tool.schema.string(),
        target: tool.schema.string().optional(),
        direction: tool.schema.enum(["in", "out", "both"]).optional(),
        mode: tool.schema.enum(["STRICT_ENTRY", "COMPOSED"]).optional(),
        edgeTypes: tool.schema.array(tool.schema.enum(["JAVA_CALL", "CODEGRAPH_SPECIAL", "LOGICAL_BOUNDARY", "PERSISTENCE"])).optional(),
        maxDepth: tool.schema.number().int().min(1).max(20).optional(),
        limit: tool.schema.number().int().min(1).max(500).optional(),
      },
      async execute(args, context) {
        assertPrimary(context);
        return result(await queryGraphSnapshot(context.worktree, args));
      },
    }),
    spring_topology_query: tool({
      description: "按目标shard查询V2类型化拓扑节点、邻接和provenance；游标绑定topologyRootHash",
      args: {
        runId: tool.schema.string().optional(),
        query: tool.schema.enum(["node", "neighbors", "explain"]),
        key: tool.schema.string(),
        contextId: tool.schema.string().optional(),
        direction: tool.schema.enum(["in", "out", "both"]).optional(),
        cursor: tool.schema.string().optional(),
        limit: tool.schema.number().int().min(1).max(500).optional(),
      },
      async execute(args, context) {
        assertPrimary(context);
        return result(await queryTopologySnapshot(context.worktree, args));
      },
    }),
    spring_config_resolve: tool({
      description: "确定性解析仓库内Spring profile/property placeholder；不读取环境变量、.env、密钥或远程配置",
      args: {},
      async execute(_args, context) {
        assertSafeConfigAgent(context);
        const config = await readJson(join(resolve(context.worktree), ".opencode/spring-business-tracer.json"));
        return result(await resolveAnalysisContexts(context.worktree, config));
      },
    }),
    spring_graph_diff: tool({
      description: "只读比较两个同版V2 COMPLETE快照的入口、节点、边及证据/归属变化",
      args: {
        fromRunId: tool.schema.string(),
        toRunId: tool.schema.string(),
        limit: tool.schema.number().int().min(1).max(500).optional(),
      },
      async execute(args, context) {
        assertPrimary(context);
        return result(await diffGraphSnapshots(context.worktree, args));
      },
    }),
    spring_migrate_config: tool({
      description: "dry-run或原子迁移V0.5/V1.0/V1.5配置到V2.0；旧run保持只读且要求FULL_REBASE",
      args: { apply: tool.schema.boolean().optional() },
      async execute(args, context) {
        assertPrimary(context);
        return result(await migrateConfiguration(context.worktree, args));
      },
    }),
    spring_state_control: tool({
      description: "幂等暂停、恢复、原子完成快照、标记PARTIAL或FAIL",
      args: {
        runId: tool.schema.string(),
        action: tool.schema.enum(["PAUSE", "RESUME", "COMPLETE", "PARTIAL", "FAIL"]),
        operationId: tool.schema.string(),
        coverageReportId: tool.schema.string().optional(),
        boundaryReportId: tool.schema.string().optional(),
        configReportId: tool.schema.string().optional(),
      },
      async execute(args, context) {
        assertPrimary(context);
        const fingerprints = new Set(["RESUME", "COMPLETE", "PARTIAL"]).has(args.action)
          ? await computeWorkspaceFingerprints(context.worktree)
          : {};
        return result(await controlRun(context.worktree, { ...args, ...fingerprints }));
      },
    }),
    spring_state_status: tool({
      description: "读取V2.0运行；旧版run仅显示LEGACY_READ_ONLY/FULL_REBASE_REQUIRED",
      args: { runId: tool.schema.string() },
      async execute(args, context) {
        assertPrimary(context);
        return result(await statusRun(context.worktree, args.runId));
      },
    }),
  },
});

Object.defineProperty(SpringBusinessStatePlugin, "__test", {
  value: Object.freeze({
    buildGraphSnapshot, claimBatch, closeBatch, commitUnit, computeWorkspaceFingerprints,
    controlRun, diffGraphSnapshots, findSnapshotPaths, heartbeatBatch, initRun, migrateConfiguration, planRun,
    assertSafeConfigAgent, queryGraphSnapshot, queryTopologySnapshot, recoverRun, resolveTrustedGraph, seedIncrementalRun, statusRun, submitReport,
  }),
  enumerable: false,
});

export default SpringBusinessStatePlugin;
