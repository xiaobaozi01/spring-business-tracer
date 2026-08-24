---
description: 检查Spring Business Tracer V2.0、配置上下文、Code Graph完整索引、多服务映射和状态工具
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer`，读取配置和 `references/codegraph-contract.md`，执行 Doctor。

Profile 从 `$ARGUMENTS` 读取，默认 `trace`；支持 `trace|scan|cross-service|impact|resume`。综合 Code Graph 工具只要能返回对应的符号、逐跳边、源码位置和反向边即可，不臆造独立工具名。

列出实际工具、最小探针、每个 service root/codeGraphProjectPath、索引身份和配置/源码/索引/工具包四类指纹。调用查询必须显式传 limit 并确认未截断。禁止自动初始化、刷新或重建 Code Graph。任一 profile 必需能力缺失时 `FAIL`。
