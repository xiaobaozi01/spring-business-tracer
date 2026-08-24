---
description: 查询不可变V2图快照或显式选择live Code Graph；类型化拓扑优先使用spring-topology
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer` 和 `references/query-impact.md`。查询：`$ARGUMENTS`。

默认使用 `spring_graph_query` 查询当前 COMPLETE 快照的 node/entry/table/boundary/service/neighbors/path，结果带 graphHash、total、truncated。path 格式为 `path:<source>-><target>`，默认 STRICT_ENTRY，可选 direction、edgeTypes、maxDepth≤20、limit≤100；COMPOSED 结果必须明确标 potential。只有参数含 `--live` 时才在线查询 Code Graph；live callers/callees必须显式传 limit 并确认未截断。不得混淆“已发布快照事实”和“当前工作区静态事实”。
