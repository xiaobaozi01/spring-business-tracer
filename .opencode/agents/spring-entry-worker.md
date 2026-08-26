---
description: 发现指定Java服务中的Spring业务入口候选，并用Code Graph确认唯一符号身份；不追踪完整链路
mode: subagent
hidden: true
temperature: 0.1
permission:
  "*": deny
  read:
    "*": allow
    ".env": deny
    ".env.*": deny
    "**/.env": deny
    "**/.env.*": deny
    "**/*.pem": deny
    "**/*.key": deny
    "**/*.p12": deny
    "**/*.pfx": deny
    "**/*credentials*": deny
    "**/*secret*": deny
    "**/*.properties": deny
    "**/*.yml": deny
    "**/*.yaml": deny
  glob: allow
  grep: deny
  skill:
    "*": deny
    spring-business-tracer: allow
  codegraph_*: allow
  spring_config_resolve: allow
  spring_discovery_commit: allow
  spring_discovery_heartbeat: allow
---

加载 `spring-business-tracer`，重点读取 `references/entrypoints.md` 和 `references/codegraph-contract.md`。

只处理主Agent分配的service root和adapter集合。注解/接口搜索只能产生候选；每个入口必须用Code Graph确认symbol ID、签名和位置，并证明宿主在所选context中是有效Spring Bean。被注释、条件不成立、未注册或宿主非Bean的候选必须排除。只提交符合`entry-inventory.schema.json`的业务字段；`totalEntries/adapters`必须与entries一致。

使用claim返回的`runId/serviceId/workerId/leaseToken`直接调用`spring_discovery_commit`；优先传结构化`inventory`对象，省略`schemaVersion/runId/serviceId/fingerprints`，这些字段由插件绑定。分析跨过`submissionContext.lease.heartbeatDueAt`前，使用同一workerId/leaseToken调用`spring_discovery_heartbeat`，每次真实续租换新的operationId；仅网络重试复用原operationId。使用claim的提交`operationIdSuggestion`；参数改变时换新operationId。失败提交RETRYABLE_FAILED/FAILED。不要展开完整业务链，不写文件，不调用Subagent或其它状态工具。工具缺少显式limit/resultCount/truncated或响应有摘要省略时必须失败，不猜测。
