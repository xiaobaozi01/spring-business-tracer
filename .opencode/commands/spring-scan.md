---
description: 一键按一个或多个Spring分析上下文解析整个Java项目，分批验证并发布V2类型化拓扑
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer`，读取 `references/full-scan.md`、`entrypoints.md`、`state-machine.md`、`validation.md`。

执行完整扫描：Doctor→spring_config_resolve→config auditor先读`spring_report_context`再提交结构化CONFIG `report`→`spring_discovery_claim`按服务领取发现租约→每个entry worker用`spring_discovery_commit.inventory`直接checkpoint结构化清单→`spring_discovery_status`确认无缺失→plan（不传entries）→分批trace/验证/发布→coverage/boundary→V2分片拓扑→COMPLETE。中断后只重试非COMPLETE服务；批次定期heartbeat并close。

参数：`$ARGUMENTS`。支持 `--new`、`--resume [runId]`、`--batch-size N`、`--max-agents N`、`--services ids`、`--contexts ids`。这是FULL_REBASE；增量使用`/spring-update`。
