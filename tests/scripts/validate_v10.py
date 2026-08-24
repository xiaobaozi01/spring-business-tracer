#!/usr/bin/env python3
"""Spring Business Tracer V1.0 的确定性验收。"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / ".opencode/skills/spring-business-tracer"
FIXTURE = ROOT / "tests/fixtures/v05-commerce-system"
COMMANDS = {"spring-doctor", "spring-trace", "spring-scan", "spring-update", "spring-migrate", "spring-pause", "spring-resume", "spring-status", "spring-query", "spring-impact"}
SUBAGENTS = {"spring-entry-worker", "spring-trace-worker", "spring-trace-validator", "spring-coverage-auditor", "spring-boundary-validator", "spring-incremental-validator"}


def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def read(path: Path) -> str:
    check(path.is_file(), f"缺少文件：{path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def run(command: list[str], cwd: Path = ROOT) -> str:
    completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
    check(completed.returncode == 0, f"命令失败：{' '.join(command)}\n{completed.stderr or completed.stdout}")
    return completed.stdout


def validate_structure() -> list[str]:
    config = json.loads(read(ROOT / ".opencode/spring-business-tracer.json"))
    check(config["version"] == "1.0.0" and config["language"] == "java", "配置不是Java-only V1.0")
    check(config["incremental"]["strategy"] == "SERVICE_CLOSURE", "增量策略错误")
    check(config["codeGraph"]["queryLimit"] == config["analysis"]["maxBranches"] + 1, "查询哨兵上限错误")
    check(config["publication"]["snapshotDirectory"] == "docs/spring-business/snapshots", "快照目录错误")
    skill = read(SKILL / "SKILL.md")
    check("version: 1.0.0" in skill and len(skill.splitlines()) < 500, "Skill版本或长度错误")
    refs = {p.stem for p in (SKILL / "references").glob("*.md")}
    expected_refs = {"configuration", "codegraph-contract", "entrypoints", "trace-workflow", "persistence", "full-scan", "state-machine", "cross-service", "validation", "query-impact", "output-format", "contract-replay", "query-completeness", "incremental", "graph-snapshot", "migration", "publication-recovery"}
    check(expected_refs <= refs, f"reference缺失：{sorted(expected_refs - refs)}")
    schemas = {p.stem.removesuffix(".schema") for p in (SKILL / "schemas").glob("*.schema.json")}
    check({"config", "run", "entry-inventory", "trace-result", "verification", "boundary-link", "manifest", "audit", "graph-node", "graph-edge", "graph-meta"} == schemas, "V1 schema集合错误")
    check(not (ROOT / ".opencode/tools").exists(), "不得实现第二套Java分析工具")
    run(["node", "tests/scripts/validate_schemas.mjs"])
    return ["V1配置、17份reference、11份schema与Java-only/CodeGraph边界完整"]


def validate_agents_commands() -> list[str]:
    agents = {p.stem for p in (ROOT / ".opencode/agents").glob("*.md")}
    check(agents == SUBAGENTS | {"spring-business-orchestrator"}, f"Agent集合错误：{sorted(agents)}")
    primary = read(ROOT / ".opencode/agents/spring-business-orchestrator.md")
    check("mode: primary" in primary and "spring_graph_*: allow" in primary and "spring_migrate_config: allow" in primary, "主Agent权限缺失")
    check("spring_report_submit: allow" not in primary, "主Agent不应能伪造认证报告")
    for name in SUBAGENTS:
        text = read(ROOT / f".opencode/agents/{name}.md")
        check("mode: subagent" in text and '"*": deny' in text, f"{name}不是默认拒绝的Subagent")
        if name in {"spring-trace-validator", "spring-coverage-auditor", "spring-boundary-validator", "spring-incremental-validator"}:
            check("spring_report_submit: allow" in text, f"{name}缺少直接报告权限")
        else:
            check("spring_report_submit: allow" not in text, f"{name}不应提交认证报告")
    commands = {p.stem for p in (ROOT / ".opencode/commands").glob("*.md")}
    check(commands == COMMANDS, f"命令集合错误：{sorted(commands)}")
    for name in COMMANDS:
        text = read(ROOT / f".opencode/commands/{name}.md")
        check("agent: spring-business-orchestrator" in text and "subtask: false" in text, f"{name}绑定错误")
    return ["1个主Agent、6个隔离Subagent和10个命令权限闭合，报告来源不可由主Agent伪造"]


def validate_plugin() -> list[str]:
    text = read(ROOT / ".opencode/plugins/spring-business-state.js")
    for token in ("toolkitFingerprint", "serviceSnapshots", "operationReplay", "heartbeatBatch", "closeBatch", "seedIncrementalRun", "buildGraphSnapshot", "queryGraphSnapshot", "migrateConfiguration", "FINALIZING", "O_NOFOLLOW"):
        check(token in text, f"插件缺少：{token}")
    for forbidden in ("tree-sitter", "javaparser", "eclipse.jdt", "cypher"):
        check(forbidden not in text.lower(), f"插件疑似实现第二代码图：{forbidden}")
    check(text.count("export default SpringBusinessStatePlugin") == 1 and not re.search(r"^export\s+(?:async|const|function)", text, re.MULTILINE), "OpenCode插件入口必须只有default导出")
    run(["node", "--check", ".opencode/plugins/spring-business-state.js"])
    run(["node", "tests/scripts/test_state_plugin_v10.mjs"])
    return ["V1动态状态测试覆盖三阶段租约、认证报告、实际哈希、增量、图快照、迁移与安全路径"]


def validate_contract(required: bool) -> list[str]:
    contract = json.loads(read(FIXTURE / "codegraph-contract.json"))
    check(len(contract["entries"]) == 6 and len(contract["javaEdges"]) == 20, "四服务契约入口/Java边错误")
    check(len(contract["excludedCandidates"]) == 2 and all(x["reason"] == "OUTBOUND_FEIGN_CLIENT" for x in contract["excludedCandidates"]), "Feign出站route排除契约错误")
    check({x["kind"] for x in contract["logicalBoundaries"]} == {"FEIGN_HTTP", "RABBIT", "SPRING_EVENT"}, "跨服务边界类型错误")
    check(len(contract["tables"]) == 6, "持久化表数量错误")
    binary = shutil.which("codegraph")
    if not binary:
        check(not required, "要求真实CodeGraph但未安装")
        return ["四服务固定契约通过；未要求本机CodeGraph"]
    status = json.loads(run([binary, "status", ".", "-j"], FIXTURE))
    check(status["initialized"] and status["index"]["state"] == "complete", "CodeGraph索引不完整")
    check(not any(status["pendingChanges"].values()) and status["worktreeMismatch"] is None, "CodeGraph索引存在漂移")
    symbols = contract["symbols"]
    cache: dict[str, list[dict]] = {}
    for left, right in contract["javaEdges"]:
        source = symbols[left]["qname"]
        if source not in cache:
            result = json.loads(run([binary, "callees", source, "-p", ".", "-l", "101", "-j"], FIXTURE))
            cache[source] = result.get("callees", [])
            check(len(cache[source]) < 101, f"CodeGraph查询触顶：{source}")
        target = symbols[right]
        check(any(row.get("filePath") == target["file"] and row.get("startLine") == target["line"] for row in cache[source]), f"真实CodeGraph缺边：{left}->{right}")
    for edge in contract["codeGraphSpecialEdges"]:
        source = symbols[edge["from"]]["qname"]
        target = symbols[edge["to"]]
        result = json.loads(run([binary, "callees", source, "-p", ".", "-l", "101", "-j"], FIXTURE))
        rows = result.get("callees", [])
        check(any(row.get("filePath") == target["file"] and row.get("startLine") == target["line"] for row in rows), f"真实CodeGraph缺特殊边：{edge['from']}->{edge['to']}")
    fanout_symbol = "com.acme.order.service::WideGraphFixture::fanOut"
    sink_symbol = "com.acme.order.service::WideGraphFixture::sink"
    default_fanout = json.loads(run([binary, "callees", fanout_symbol, "-p", ".", "-j"], FIXTURE))["callees"]
    full_fanout = json.loads(run([binary, "callees", fanout_symbol, "-p", ".", "-l", "101", "-j"], FIXTURE))["callees"]
    full_fanin = json.loads(run([binary, "callers", sink_symbol, "-p", ".", "-l", "101", "-j"], FIXTURE))["callers"]
    check(len(default_fanout) == 20 and len(full_fanout) == 25 and len(full_fanin) == 25, "21+ fan-out/fan-in截断夹具未闭合")
    routes = json.loads(run([binary, "query", "", "-p", ".", "-k", "route", "-l", "101", "-j"], FIXTURE))
    route_files = [row["node"]["filePath"] for row in routes]
    clients = [path for path in route_files if "/client/" in path]
    controllers = [path for path in route_files if "/api/" in path]
    check(len(routes) == 5 and len(clients) == 2 and len(controllers) == 3, "真实route未形成3入口+2Feign排除")
    return ["真实CodeGraph完整索引、20条Java边、3条特殊边、25路fan-out/fan-in与5个route分类全部通过"]


def validate_multi_index(required: bool) -> list[str]:
    binary = shutil.which("codegraph")
    if not binary:
        check(not required, "要求双索引测试但未安装CodeGraph")
        return []
    with tempfile.TemporaryDirectory(prefix="spring-business-multi-index-") as directory:
        root = Path(directory)
        (root / ".opencode/plugins").mkdir(parents=True)
        services = []
        for name, class_name in (("service-a", "ServiceA"), ("service-b", "ServiceB")):
            source = root / name / "src/main/java/com/acme" / name[-1]
            source.mkdir(parents=True)
            (source / f"{class_name}.java").write_text(f"package com.acme.{name[-1]}; public class {class_name} {{ public void run() {{}} }}\n", encoding="utf-8")
            run([binary, "init", "."], root / name)
            services.append({"id": name, "root": name, "codeGraphProjectPath": name, "packages": [f"com.acme.{name[-1]}"], "aliases": [name]})
        config_path = root / ".opencode/spring-business-tracer.json"
        config_path.write_text(json.dumps({"version": "1.0.0", "workspace": {"services": services}, "codeGraph": {"queryLimit": 101}, "analysis": {"maxBranches": 100}}), encoding="utf-8")
        plugin_url = (ROOT / ".opencode/plugins/spring-business-state.js").as_uri()
        script = f'import plugin from "{plugin_url}"; console.log(JSON.stringify(await plugin.__test.computeWorkspaceFingerprints(process.argv[1])));'
        fingerprints = json.loads(run(["node", "--input-type=module", "-e", script, str(root)]))
        check(fingerprints["serviceRootCount"] == 2 and set(fingerprints["serviceSnapshots"]) == {"service-a", "service-b"}, "插件未识别双独立CodeGraph索引")
        for service, class_name in (("service-a", "ServiceA"), ("service-b", "ServiceB")):
            rows = json.loads(run([binary, "query", class_name, "-p", ".", "-l", "101", "-j"], root / service))
            check(rows and all(service in row["node"]["filePath"] or row["node"]["filePath"].startswith("src/") for row in rows), f"独立索引查询失败：{service}")
        duplicate = json.loads(config_path.read_text(encoding="utf-8"))
        duplicate["workspace"]["services"][1]["id"] = "service-a"
        config_path.write_text(json.dumps(duplicate), encoding="utf-8")
        completed = subprocess.run(["node", "--input-type=module", "-e", script, str(root)], text=True, capture_output=True, check=False)
        check(completed.returncode != 0 and "重复" in completed.stderr, "重复service id未失败关闭")
    return ["两个独立CodeGraph projectPath的身份/状态/查询与重复service id失败关闭通过"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-codegraph", action="store_true")
    args = parser.parse_args()
    try:
        checks = validate_structure() + validate_agents_commands() + validate_plugin() + validate_contract(args.require_codegraph) + validate_multi_index(args.require_codegraph)
    except (AssertionError, OSError, KeyError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    for item in checks:
        print(f"PASS: {item}")
    print(f"\nV1.0确定性验收通过：{len(checks)}项")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
