---
description: 按V2类型化拓扑查询服务、入口、端点、消息通道、订阅、RPC和数据资源
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer` 与 `references/topology-v2.md`。解析 `$ARGUMENTS` 为 `node|neighbors key [--context id] [--cursor token] [--limit N]`，调用 `spring_topology_query`。结果必须展示 topologyRootHash、assurance、contextIds、complete/cutoffReason 和下一页 cursor；不得把 POTENTIAL 叙述为运行时必然执行。
