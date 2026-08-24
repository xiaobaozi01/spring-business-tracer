import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { isMap, isScalar, isSeq, LineCounter, parseAllDocuments } from "yaml";

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * MAX_SOURCE_BYTES;
const MAX_PLACEHOLDER_DEPTH = 20;
const SECRET_KEY = /(?:^|[._-])(password|passwd|secret|token|credential|private[-_.]?key|api[-_.]?key)(?:$|[._-])/i;
const FORBIDDEN_NAME = /(^|[/\\])(?:\.env(?:\.|$)|.*\.(?:pem|key|p12|pfx)$|.*(?:credentials?|secrets?)[^/\\]*$)/i;
const ALLOWED_EXTENSIONS = new Set([".properties", ".yml", ".yaml"]);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isSecretKey(key) {
  const normalized = String(key).replace(/([a-z0-9])([A-Z])/g, "$1.$2").replace(/[^A-Za-z0-9]+/g, ".").toLowerCase();
  return SECRET_KEY.test(normalized);
}

function hasEmbeddedSecret(value) {
  const text = String(value);
  // URI userinfo may carry credentials even when the property name is innocuous.
  if (/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/.test(text)) return true;
  for (const match of text.matchAll(/[?&]([^=&#]+)=([^&#]*)/g)) {
    let queryKey = match[1];
    try { queryKey = decodeURIComponent(queryKey); } catch { /* keep malformed text conservative and non-executing */ }
    if (isSecretKey(queryKey) && match[2]) return true;
  }
  try {
    const parsed = new URL(text);
    if (parsed.password) return true;
    for (const [key, queryValue] of parsed.searchParams) {
      if (isSecretKey(key) && queryValue) return true;
    }
  } catch {
    // Non-URL configuration values are handled by key tainting.
  }
  return false;
}

function isExternalConfigKey(key) {
  return new Set(["spring.config.import", "spring.config.location", "spring.config.additional-location", "spring.cloud.config.uri"]).has(key) || key.startsWith("spring.cloud.vault.") || key.startsWith("spring.cloud.kubernetes.config.");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function assertRelativeSource(root, source) {
  if (typeof source !== "string" || !source || source.length > 1024 || source.includes("\0") || FORBIDDEN_NAME.test(source)) throw new Error("CONFIG_SOURCE_FORBIDDEN");
  const target = resolve(root, source);
  if (target !== root && !target.startsWith(root + sep)) throw new Error("CONFIG_SOURCE_OUTSIDE_WORKSPACE");
  if (!ALLOWED_EXTENSIONS.has(extname(target).toLowerCase())) throw new Error("CONFIG_SOURCE_TYPE_FORBIDDEN");
  return target;
}

async function readSafeSource(root, source) {
  const target = assertRelativeSource(root, source);
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_SOURCE_BYTES) throw new Error("CONFIG_SOURCE_UNSAFE");
  const rootReal = await realpath(root);
  const targetReal = await realpath(target);
  if (!targetReal.startsWith(rootReal + sep)) throw new Error("CONFIG_SOURCE_OUTSIDE_WORKSPACE");
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > MAX_SOURCE_BYTES || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("CONFIG_SOURCE_UNSAFE");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.nlink !== 1 || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || bytes.length !== opened.size) throw new Error("CONFIG_SOURCE_CHANGED_DURING_READ");
    return { target, bytes, size: Number(opened.size) };
  } catch (error) {
    if (new Set(["ELOOP", "EMLINK"]).has(error?.code)) throw new Error("CONFIG_SOURCE_UNSAFE");
    throw error;
  } finally {
    await handle?.close();
  }
}

function lineOf(counter, node) {
  return node?.range ? counter.linePos(node.range[0]).line : 1;
}

function flattenYamlNode(node, counter, source, prefix = "", output = new Map()) {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") throw new Error("CONFIG_YAML_COMPLEX_KEY");
      const key = prefix ? `${prefix}.${pair.key.value}` : pair.key.value;
      flattenYamlNode(pair.value, counter, source, key, output);
    }
  } else if (isSeq(node)) {
    for (let index = 0; index < node.items.length; index += 1) {
      flattenYamlNode(node.items[index], counter, source, `${prefix}[${index}]`, output);
    }
  } else if (isScalar(node) || node === null) {
    output.set(prefix, { raw: node?.value === null || node === null ? "" : String(node.value), source, line: lineOf(counter, node) });
  } else {
    throw new Error("CONFIG_YAML_UNSUPPORTED_NODE");
  }
  return output;
}

function unescapeProperty(value, source, line) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "\\") { output += value[index]; continue; }
    index += 1;
    if (index >= value.length) break;
    const escaped = value[index];
    if (escaped === "t") output += "\t";
    else if (escaped === "n") output += "\n";
    else if (escaped === "r") output += "\r";
    else if (escaped === "f") output += "\f";
    else if (escaped === "u") {
      const code = value.slice(index + 1, index + 5);
      if (!/^[0-9A-Fa-f]{4}$/.test(code)) throw new Error(`CONFIG_PROPERTIES_UNICODE:${source}:${line}`);
      output += String.fromCharCode(Number.parseInt(code, 16));
      index += 4;
    } else output += escaped;
  }
  return output;
}

function parseProperties(text, source) {
  const result = new Map();
  const physical = text.split(/\r?\n/);
  for (let index = 0; index < physical.length; index += 1) {
    const startLine = index + 1;
    let logical = physical[index];
    while ((logical.match(/\\+$/)?.[0].length ?? 0) % 2 === 1) {
      logical = logical.slice(0, -1);
      index += 1;
      if (index >= physical.length) break;
      logical += physical[index].replace(/^\s+/, "");
    }
    const leading = logical.search(/\S/);
    if (leading === -1 || new Set(["#", "!"]).has(logical[leading])) continue;
    let escaped = false;
    let keyEnd = logical.length;
    let separator = null;
    for (let cursor = leading; cursor < logical.length; cursor += 1) {
      const character = logical[cursor];
      if (!escaped && (character === "=" || character === ":" || /\s/.test(character))) {
        keyEnd = cursor; separator = character; break;
      }
      if (character === "\\") escaped = !escaped;
      else escaped = false;
    }
    let valueStart = keyEnd;
    if (separator !== null) {
      if (/\s/.test(separator)) {
        while (valueStart < logical.length && /\s/.test(logical[valueStart])) valueStart += 1;
        if (logical[valueStart] === "=" || logical[valueStart] === ":") valueStart += 1;
      } else valueStart += 1;
      while (valueStart < logical.length && /\s/.test(logical[valueStart])) valueStart += 1;
    }
    const key = unescapeProperty(logical.slice(leading, keyEnd), source, startLine);
    if (!key) throw new Error(`CONFIG_PROPERTIES_SYNTAX:${source}:${startLine}`);
    const raw = unescapeProperty(logical.slice(valueStart), source, startLine);
    result.set(key, { raw, source, line: startLine });
  }
  return [result];
}

function profileMatches(expression, activeProfiles) {
  if (!expression) return true;
  const source = String(expression);
  const tokens = [];
  for (let index = 0; index < source.length;) {
    if (/\s/.test(source[index])) { index += 1; continue; }
    const symbol = source[index];
    if ("!&|(),".includes(symbol)) { tokens.push(symbol); index += 1; continue; }
    const match = source.slice(index).match(/^[A-Za-z0-9_.-]+/);
    if (!match) throw new Error("CONFIG_PROFILE_EXPRESSION_UNSUPPORTED");
    tokens.push(match[0]); index += match[0].length;
  }
  let cursor = 0;
  const unary = () => {
    if (tokens[cursor] === "!") { cursor += 1; return !unary(); }
    if (tokens[cursor] === "(") {
      cursor += 1; const value = or();
      if (tokens[cursor] !== ")") throw new Error("CONFIG_PROFILE_EXPRESSION_UNSUPPORTED");
      cursor += 1; return value;
    }
    const token = tokens[cursor++];
    if (!token || "&|(),".includes(token)) throw new Error("CONFIG_PROFILE_EXPRESSION_UNSUPPORTED");
    return activeProfiles.has(token);
  };
  const and = () => {
    let value = unary();
    while (tokens[cursor] === "&") { cursor += 1; const right = unary(); value = value && right; }
    return value;
  };
  const or = () => {
    let value = and();
    while (tokens[cursor] === "|" || tokens[cursor] === ",") { cursor += 1; const right = and(); value = value || right; }
    return value;
  };
  const result = or();
  if (cursor !== tokens.length) throw new Error("CONFIG_PROFILE_EXPRESSION_UNSUPPORTED");
  return result;
}

function parseYaml(text, source, activeProfiles) {
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(text, { lineCounter, maxAliasCount: 0, strict: true, uniqueKeys: true, customTags: [] });
  const result = [];
  for (const doc of docs) {
    if (doc.errors.length) {
      const position = doc.errors[0].linePos?.[0];
      throw new Error(`CONFIG_YAML_SYNTAX:${source}:${position?.line ?? 0}:${position?.col ?? 0}`);
    }
    const flattened = flattenYamlNode(doc.contents, lineCounter, source);
    const profile = flattened.get("spring.config.activate.on-profile")?.raw;
    if (profileMatches(profile, activeProfiles)) result.push(flattened);
  }
  return result;
}

function resolvePlaceholders(key, records, stack = [], depth = 0) {
  if (depth > MAX_PLACEHOLDER_DEPTH) return { status: "UNRESOLVED", reason: "PLACEHOLDER_DEPTH" };
  if (stack.includes(key)) return { status: "UNRESOLVED", reason: "PLACEHOLDER_CYCLE", cycle: [...stack, key] };
  const record = records.get(key);
  if (!record) return { status: "UNRESOLVED", reason: "MISSING_KEY" };
  if (isExternalConfigKey(key)) return { status: "UNRESOLVED", reason: "EXTERNAL_CONFIG_SOURCE", dependency: key };
  if (record.raw.includes("#{")) return { status: "UNRESOLVED", reason: "SPEL_UNSUPPORTED", dependency: key };
  let value = record.raw;
  let secretTaint = isSecretKey(key) || hasEmbeddedSecret(value);
  for (let pass = 0; pass <= MAX_PLACEHOLDER_DEPTH; pass += 1) {
    let unresolved = null;
    let matched = false;
    value = value.replace(/\$\{([^{}]+)\}/g, (_all, expression) => {
      matched = true;
      const separator = expression.indexOf(":");
      const dependency = (separator === -1 ? expression : expression.slice(0, separator)).trim();
      const fallback = separator === -1 ? undefined : expression.slice(separator + 1);
      const nested = resolvePlaceholders(dependency, records, [...stack, key], depth + pass + 1);
      if (nested.status === "RESOLVED") {
        secretTaint ||= nested.secretTaint === true || hasEmbeddedSecret(nested.value);
        return nested.value;
      }
      if (fallback !== undefined) {
        secretTaint ||= isSecretKey(dependency);
        if (/^[A-Z_][A-Z0-9_]*$/.test(dependency)) {
          unresolved = { ...nested, dependency, reason: "EXTERNAL_ENVIRONMENT" };
          return "";
        }
        if (nested.reason !== "MISSING_KEY") {
          unresolved = { ...nested, dependency };
          return "";
        }
        secretTaint ||= hasEmbeddedSecret(fallback);
        return fallback;
      }
      unresolved = { ...nested, dependency, reason: nested.reason === "MISSING_KEY" && /^[A-Z_][A-Z0-9_]*$/.test(dependency) ? "EXTERNAL_ENVIRONMENT" : nested.reason };
      return "";
    });
    if (unresolved) return { status: "UNRESOLVED", reason: unresolved.reason, dependency: unresolved.dependency, cycle: unresolved.cycle };
    if (!matched) return { status: "RESOLVED", value, secretTaint: secretTaint || hasEmbeddedSecret(value) };
  }
  return { status: "UNRESOLVED", reason: "PLACEHOLDER_DEPTH" };
}

export async function resolveAnalysisContexts(worktree, config) {
  const root = resolve(worktree);
  const definitions = config.analysisContexts?.definitions;
  if (!Array.isArray(definitions) || definitions.length === 0) throw new Error("ANALYSIS_CONTEXTS_REQUIRED");
  const ids = new Set();
  const contexts = [];
  let totalBytes = 0;
  for (const definition of definitions) {
    if (!definition?.id || ids.has(definition.id) || !Array.isArray(definition.activeProfiles) || !Array.isArray(definition.propertySources)) throw new Error("ANALYSIS_CONTEXT_INVALID");
    ids.add(definition.id);
    const activeProfiles = new Set(definition.activeProfiles);
    const records = new Map();
    const origins = [];
    for (const source of definition.propertySources) {
      let file;
      try { file = await readSafeSource(root, source); }
      catch (error) {
        if (definition.optionalSources === true && error?.code === "ENOENT") continue;
        throw error;
      }
      totalBytes += file.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("CONFIG_SOURCES_TOO_LARGE");
      const text = file.bytes.toString("utf8");
      const documents = extname(source).toLowerCase() === ".properties" ? parseProperties(text, source) : parseYaml(text, source, activeProfiles);
      for (const document of documents) for (const [key, value] of document) {
        records.set(key, value);
        origins.push({ key, source: value.source, line: value.line, sourceHash: sha256(file.bytes) });
      }
    }
    const values = [];
    const unresolved = [];
    for (const key of [...records.keys()].sort()) {
      const base = { key, source: records.get(key).source, line: records.get(key).line };
      if (isExternalConfigKey(key)) {
        unresolved.push({ ...base, status: "UNRESOLVED", reason: "EXTERNAL_CONFIG_SOURCE" });
        continue;
      }
      if (records.get(key).raw.includes("#{")) {
        unresolved.push({ ...base, status: "UNRESOLVED", reason: "SPEL_UNSUPPORTED" });
        continue;
      }
      const resolved = resolvePlaceholders(key, records);
      if (resolved.status === "RESOLVED") {
        const redacted = isSecretKey(key) || resolved.secretTaint === true || hasEmbeddedSecret(resolved.value);
        values.push({ ...base, status: "RESOLVED", valueHash: sha256(resolved.value), redacted, ...(redacted ? {} : { value: resolved.value }) });
      } else {
        unresolved.push({ ...base, status: "UNRESOLVED", reason: resolved.reason, dependency: resolved.dependency, cycle: resolved.cycle });
      }
    }
    const context = { id: definition.id, activeProfiles: [...activeProfiles].sort(), values, unresolved, origins: origins.sort((a, b) => a.key.localeCompare(b.key) || a.source.localeCompare(b.source) || a.line - b.line) };
    context.contextHash = sha256(canonicalJson(context));
    contexts.push(context);
  }
  const summary = { schemaVersion: "2.0", defaultContext: config.analysisContexts.defaultContext, contexts: contexts.sort((a, b) => a.id.localeCompare(b.id)), externalSourcePolicy: config.configResolution?.externalSourcePolicy ?? "PARTIAL", secretPolicy: "HASH_ONLY" };
  if (!ids.has(summary.defaultContext)) throw new Error("DEFAULT_CONTEXT_NOT_FOUND");
  summary.resolutionContextHash = sha256(canonicalJson(summary));
  return summary;
}

export const __test = Object.freeze({ canonicalJson, hasEmbeddedSecret, isExternalConfigKey, isSecretKey, parseProperties, parseYaml, profileMatches, resolvePlaceholders, sha256 });
