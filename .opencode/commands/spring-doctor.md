---
description: 检查Spring Business Tracer V2.0、配置上下文、Code Graph完整索引、多服务映射和状态工具
agent: spring-business-orchestrator
subtask: false
---

加载 `spring-business-tracer`，直接读取工作区根目录的 `.opencode/spring-business-tracer.json` 和 `references/codegraph-contract.md`，执行 Doctor；不要搜索配置文件。

本次 Profile 已解析为 `$ARGUMENTS`。仅当解析结果为空时才使用 `trace`；非空时必须原样采用，禁止自行改回默认值。支持 `trace|scan|cross-service|impact|resume`。综合 Code Graph 工具只要能返回对应的符号、逐跳边、源码位置和反向边即可，不臆造独立工具名。

先调用 `spring_state_fingerprint`，再优先用 `codegraph_bounded_query` 执行 status 与最小 callee/caller 探针。成功的指纹结果及其 `indexMetadata` 是索引 complete/freshness 的机器证据，不得因 `explore` 响应没有状态字段而再次判定 freshness 缺失。多个模块共用同一 `codeGraphProjectPath` 时按唯一 projectPath 去重，每个唯一索引最多一次最小探针，禁止逐模块重复 explore。

对已知方法直接使用源码/Code Graph给出的 qualifiedName 调用 callees/callers；不要先做宽泛 `mode=query` 定位，也不要把 `method:<hash>` node ID 当 CLI 查询键。若 callee 落在接口方法上，再对该接口 qualifiedName 做一次有界 callees 探针确认实现分派。探针中发现同名候选时必须核对调用点 receiver 静态类型与目标 declaring type；不兼容边不能计入能力或业务链。

正式查询只有显式接收`limit`且响应明确返回`resultCount/truncated/completionStatus/summaryOmittedCount`才可PASS；`maxFiles`不是limit，`... and N more`视为截断。列出每个service/sharedModule root及projectPath、索引身份和六类指纹。禁止自动初始化、刷新或重建Code Graph，也不得从自然语言输出补造完整性字段。任一必需能力缺失时`FAIL`。
