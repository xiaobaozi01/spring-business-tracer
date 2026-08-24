---
description: 解释V2拓扑节点及相邻边为什么存在，返回Code Graph、配置、协议与Validator provenance
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer` 与 `references/topology-v2.md`。目标：`$ARGUMENTS`。调用 `spring_topology_query query=explain`，按 edge → assurance → context → provenance 展示证据。明确完整性模型是工作区内自洽校验，不宣称外部签名或抗恶意回滚。
