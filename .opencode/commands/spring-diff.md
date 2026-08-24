---
description: 比较两个同版V2 COMPLETE业务图快照，输出入口、节点、边、证据和归属变化
agent: spring-business-orchestrator
subtask: false
---

加载`spring-business-tracer`与`references/graph-snapshot.md`。解析`$ARGUMENTS`为`fromRunId toRunId [limit]`，调用`spring_graph_diff`。任一run非V2 COMPLETE、跨major或实际快照哈希不匹配时失败关闭。
