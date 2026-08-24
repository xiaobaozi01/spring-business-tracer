#!/usr/bin/env python3
"""Spring Business Tracer V2.0 的结构、动态状态与真实 Code Graph 验收。"""
from __future__ import annotations
import argparse, json, re, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / ".opencode/skills/spring-business-tracer"
V20 = ROOT / "tests/fixtures/v20-enterprise-system"
V15 = ROOT / "tests/fixtures/v15-business-system"
V10 = ROOT / "tests/fixtures/v05-commerce-system"
COMMANDS = {"spring-doctor", "spring-trace", "spring-scan", "spring-update", "spring-migrate", "spring-pause", "spring-resume", "spring-status", "spring-query", "spring-impact", "spring-diff", "spring-context", "spring-topology", "spring-explain"}
SUBAGENTS = {"spring-entry-worker", "spring-trace-worker", "spring-trace-validator", "spring-coverage-auditor", "spring-boundary-validator", "spring-incremental-validator", "spring-config-auditor"}

def check(ok: bool, message: str) -> None:
    if not ok: raise AssertionError(message)
def read(path: Path) -> str:
    check(path.is_file(), f"缺少文件：{path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")
def run(command: list[str], cwd: Path = ROOT) -> str:
    completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
    check(completed.returncode == 0, f"命令失败：{' '.join(command)}\n{completed.stderr or completed.stdout}")
    return completed.stdout

def run_opencode_config(binary: str) -> str:
    last = None
    for attempt in range(4):
        completed = subprocess.run([binary, "debug", "config"], cwd=ROOT, text=True, capture_output=True, check=False)
        if completed.returncode == 0: return completed.stdout
        last = completed
        if "wal_checkpoint" not in (completed.stderr + completed.stdout): break
        time.sleep(0.25 * (attempt + 1))
    check(False, f"OpenCode配置解析失败\n{last.stderr or last.stdout}")
    return ""

def codegraph_contract(fixture: Path, required: bool) -> tuple[int, int, int]:
    contract = json.loads(read(fixture / "codegraph-contract.json"))
    binary = shutil.which("codegraph")
    if not binary:
        check(not required, "要求真实CodeGraph但未安装")
        return len(contract["javaEdges"]), 0, len(contract.get("codeGraphSpecialEdges", []))
    status = json.loads(run([binary, "status", ".", "-j"], fixture))
    check(status["initialized"] and status["index"]["state"] == "complete", f"索引不完整：{fixture.name}")
    check(not any(status["pendingChanges"].values()) and status["worktreeMismatch"] is None and not status["index"].get("reindexRecommended"), f"索引漂移：{fixture.name}")
    cache: dict[str, list[dict]] = {}
    special_edges = [(row[0], row[1]) if isinstance(row, list) else (row["from"], row["to"]) for row in contract.get("codeGraphSpecialEdges", [])]
    for left, right in [*contract["javaEdges"], *special_edges]:
        source = contract["symbols"][left]["qname"]
        if source not in cache:
            cache[source] = json.loads(run([binary, "callees", source, "-p", ".", "-l", "101", "-j"], fixture)).get("callees", [])
            check(len(cache[source]) < 101, f"查询触顶：{source}")
        target = contract["symbols"][right]
        check(any(row.get("filePath") == target["file"] and row.get("startLine") == target["line"] for row in cache[source]), f"真实CodeGraph缺边：{left}->{right}")
    reverse = 0
    for access in contract.get("persistenceAccesses", []):
        symbol = contract["symbols"][access["symbol"]]["qname"]
        callers = json.loads(run([binary, "callers", symbol, "-p", ".", "-l", "101", "-j"], fixture)).get("callers", [])
        check(callers and len(callers) < 101, f"持久化反向探针失败：{symbol}")
        reverse += 1
    return len(contract["javaEdges"]), reverse, len(special_edges)

def evidence_parts(spec: str) -> list[tuple[Path, int]]:
    result = []
    for part in spec.split(" + "):
        path, line = part.rsplit(":", 1)
        target = V20 / path
        check(target.is_file() and line.isdigit(), f"证据不存在：{part}")
        lines = target.read_text(encoding="utf-8").splitlines()
        check(1 <= int(line) <= len(lines), f"证据行越界：{part}")
        result.append((target, int(line)))
    return result

def validate_structure() -> list[str]:
    config = json.loads(read(ROOT / ".opencode/spring-business-tracer.json"))
    check(config["version"] == "2.0.0" and config["language"] == "java", "不是Java-only V2")
    check(config["graph"]["formatVersion"] == 2 and config["graph"]["sharded"], "未启用V2分片拓扑")
    check(config["configResolution"] == {"externalSourcePolicy":"PARTIAL","environmentPolicy":"DENY","secretPolicy":"HASH_ONLY","executeSpel":False,"maxSourceBytes":1048576,"maxTotalBytes":8388608}, "配置解析安全策略错误")
    check({p.stem for p in (ROOT / ".opencode/commands").glob("*.md")} == COMMANDS, "命令集合错误")
    check({p.stem for p in (ROOT / ".opencode/agents").glob("*.md")} == SUBAGENTS | {"spring-business-orchestrator"}, "Agent集合错误")
    for path in (ROOT / ".opencode/agents").glob("*.md"):
        agent_text = read(path)
        check("grep: deny" in agent_text, f"{path.name}仍允许通用grep")
        check(all(f'"**/*.{suffix}": deny' in agent_text for suffix in ("properties", "yml", "yaml")), f"{path.name}仍可直接读取应用配置秘密")
        check("spring_config_resolve: allow" in agent_text, f"{path.name}缺少脱敏配置解析工具")
    opencode = shutil.which("opencode")
    if opencode:
        resolved = json.loads(run_opencode_config(opencode))
        permissions = resolved["agent"]["spring-business-orchestrator"]["permission"]
        check(permissions.get("spring_config_resolve") == "allow" and permissions.get("spring_topology_query") == "allow", "主Agent解析后权限缺少V2配置/拓扑工具")
    schemas = list((SKILL / "schemas").glob("*.schema.json"))
    check(len(schemas) == 21, f"Schema数量应为21，实际{len(schemas)}")
    skill = read(SKILL / "SKILL.md")
    check("version: 2.0.0" in skill and len(skill.splitlines()) < 500, "Skill版本或长度错误")
    run(["node", "tests/scripts/validate_schemas.mjs"])
    return ["Java-only V2、1主7子Agent、14命令、21 Schema与最小权限闭合"]

def validate_plugin() -> list[str]:
    plugin = read(ROOT / ".opencode/plugins/spring-business-state.js")
    resolver = read(ROOT / ".opencode/plugins/spring-business/config-resolver.js")
    graph = read(ROOT / ".opencode/plugins/spring-business/graph-v2.js")
    for token in ("resolutionContextHash", "adapterRegistryFingerprint", "changedConfigKeys", "spring_topology_query", "spring_config_resolve", "topologyRootHash", "CONFIG_PRECEDENCE"):
        check(token in plugin, f"插件缺少{token}")
    for token in ("MAX_SOURCE_BYTES", "PLACEHOLDER_CYCLE", "SECRET_KEY", "CONFIG_SOURCE_FORBIDDEN", "maxAliasCount: 0"):
        check(token in resolver, f"配置解析器缺少{token}")
    for token in ("MESSAGE_SUBSCRIPTION", "provenance", "adjacency-out", "CURSOR_SNAPSHOT_OR_QUERY_MISMATCH", "MAX_QUERY_MS"):
        check(token in graph, f"V2图缺少{token}")
    for forbidden in ("tree-sitter", "javaparser", "eclipse.jdt", "cypher"):
        check(forbidden not in (plugin + resolver + graph).lower(), f"疑似实现第二套代码图：{forbidden}")
    run(["node", "tests/scripts/test_state_plugin_v20.mjs"])
    return ["V2动态测试覆盖嵌套placeholder、秘密脱敏、配置审计、validator provenance、配置键增量、拓扑分片、cursor和V1.5迁移"]

def validate_fixture(required: bool) -> list[str]:
    contract = json.loads(read(V20 / "codegraph-contract.json"))
    check(len(contract["entries"]) == 5, "V2入口数量错误")
    check({e["adapter"] for e in contract["entries"]} == {"WEBFLUX_FUNCTIONAL_STATIC_HANDLER","GRAPHQL_ANNOTATED_ROOT","JMS_STATIC_LISTENER","QUARTZ_STATIC_JOB_TRIGGER","GRPC_UNARY_PROTO"}, "V2 adapter Profile错误")
    check({b["kind"] for b in contract["logicalBoundaries"]} == {"GATEWAY_HTTP", "JMS"}, "Gateway/JMS边界缺失")
    check(any(b["status"] == "PARTIAL" for b in contract["logicalBoundaries"]), "动态Gateway负例缺失")
    check(len(contract["frameworkDispatches"]) == 4 and {row["kind"] for row in contract["frameworkDispatches"]} == {"WEBFLUX_FUNCTIONAL", "GRAPHQL", "QUARTZ", "GRPC"}, "框架分派集合不闭合")
    for dispatch in contract["frameworkDispatches"]:
        check(dispatch["target"] in contract["symbols"], f"框架分派target未知：{dispatch['target']}")
        evidence_parts(dispatch["evidence"])
    for boundary in contract["logicalBoundaries"]:
        if boundary["status"] == "VERIFIED":
            check(all(boundary.get(key) for key in ("source", "target", "sourceEvidence", "targetEvidence")), f"VERIFIED边界缺少双侧证据：{boundary['kind']}")
            evidence_parts(boundary["sourceEvidence"]); evidence_parts(boundary["targetEvidence"])
    check(len(contract["negativeProfiles"]) == 5 and all(row["status"] == "PARTIAL" and row.get("reason") and row.get("evidence") for row in contract["negativeProfiles"]), "动态能力负例不闭合")
    for row in contract["negativeProfiles"]: evidence_parts(row["evidence"])
    check("@Component" in read(V20 / "ingress-service/src/main/java/com/acme/ingress/api/OrderHandler.java"), "functional handler不是Spring bean")
    check("@Component" in read(V20 / "worker-service/src/main/java/com/acme/worker/messaging/BillingListener.java"), "JMS listener不是Spring bean")
    check("SchedulerFactoryBean" in read(V20 / "worker-service/src/main/java/com/acme/worker/job/QuartzConfig.java") and "autowireBean" in read(V20 / "worker-service/src/main/java/com/acme/worker/job/AutowiringJobFactory.java"), "Quartz job wiring不闭合")
    proto = read(V20 / "rpc-service/src/main/proto/order.proto"); grpc_base = read(V20 / "rpc-service/src/main/java/com/acme/rpc/grpc/OrderQueryGrpcBase.java"); grpc_impl = read(V20 / "rpc-service/src/main/java/com/acme/rpc/grpc/OrderGrpcService.java")
    check("rpc Find (FindRequest) returns (FindReply)" in proto and "MethodType.UNARY" in grpc_base and "find(FindRequest request, StreamObserver<FindReply>" in grpc_impl, "gRPC proto/unary/provider签名不闭合")
    normal, reverse, special = codegraph_contract(V20, required)
    check(special == 0, "V2 Java边不应伪装成special edge")
    return [f"V2真实三服务夹具：5入口、{normal}条Java边、{reverse}个持久化反向探针、4类框架分派和Gateway/JMS上下文通过"]

def validate_regressions(required: bool) -> list[str]:
    v15, _, v15_special = codegraph_contract(V15, required)
    v10, _, v10_special = codegraph_contract(V10, required)
    check(v15 == 12 and v10 == 20 and v15_special == 2 and v10_special == 3, "V1.5/V1.0 CodeGraph回归边数变化")
    return ["V1.5三服务12+2条与V1.0四服务20+3条真实CodeGraph Java/特殊边无退化"]

def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--require-codegraph", action="store_true"); args = parser.parse_args()
    try: checks = validate_structure() + validate_plugin() + validate_fixture(args.require_codegraph) + validate_regressions(args.require_codegraph)
    except (AssertionError, OSError, KeyError, json.JSONDecodeError) as error:
        print(f"FAIL: {error}", file=sys.stderr); return 1
    for item in checks: print(f"PASS: {item}")
    print(f"\nV2.0确定性验收通过：{len(checks)}项"); return 0
if __name__ == "__main__": raise SystemExit(main())
