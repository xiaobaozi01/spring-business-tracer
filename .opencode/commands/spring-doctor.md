---
description: 检查Spring Business Tracer V2.0、配置上下文、Code Graph完整索引、多服务映射和状态工具
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer`，读取配置和 `references/codegraph-contract.md`，执行 Doctor。

Profile 从 `$ARGUMENTS` 读取，默认 `trace`；支持 `trace|scan|cross-service|impact|resume`。综合 Code Graph 工具只要能返回对应的符号、逐跳边、源码位置和反向边即可，不臆造独立工具名。

先检查实际工具schema。只有工具能显式接收`limit`且响应明确返回`resultCount/truncated/completionStatus/summaryOmittedCount`才可PASS；`maxFiles`不是limit，`... and N more`视为截断。列出每个service/sharedModule root及projectPath、索引身份和六类指纹。禁止自动初始化、刷新或重建Code Graph，也不得从自然语言输出补造完整性字段。任一必需能力缺失时`FAIL`。
