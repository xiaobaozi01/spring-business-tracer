---
description: 基于同版V2 COMPLETE快照一键增量重分析；按服务、共享模块与配置依赖闭包保守失效
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer`、`references/incremental.md`、`full-scan.md` 和 `validation.md`。参数：`$ARGUMENTS`，支持 `--base current|runId`、`--batch-size N`、`--max-agents N`。

执行INCREMENTAL：Doctor→CONFIG审计→创建run→全量重发现→incremental validator提交changedServices/changedSharedModules/changedConfigKeys与互斥集合→seed→处理affected/new→coverage/boundary→V2拓扑→COMPLETE。旧版baseline、adapter registry/索引语义变化或依赖证明不足时FULL_REBASE。
