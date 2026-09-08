---
name: spring-query
description: 用于查询已记录的 Spring 业务入口、数据库访问、服务拓扑及证据，比较分析版本、查看配置上下文或追查静态影响范围。
compatibility: opencode
---

# 业务查询

遵守 `spring-business-tracer` 的共同证据规则。默认从 `docs/spring-business/current.md` 找到已发布run，只读它的索引、相关服务页和入口笔记；不启动扫描，不要求Code Graph在线。用户指定run时直接读取该run。

| 命令 | 操作 |
|---|---|
| query | 根据symbol/entry/table/service/boundary定位索引与原始笔记，返回关系、context、复核状态和证据链接 |
| topology node / neighbors | 从拓扑节点/关系表定位目标与相邻关系；按service/context/direction过滤，按相关服务页分段返回 |
| explain | 解释一条关系或节点为何存在，追到源码/Code Graph查询/配置来源和复核意见 |
| context list / resolve / explain | 根据workspace列出context；读取相关本地声明解释profile与placeholder，按 [配置规则](../spring-business-tracer/references/workspace.md) 保留未知和隐藏秘密 |
| diff run-old run-new | 按稳定入口键和关系身份比较新增、删除、业务变化、仅证据位置变化；context/scope不同先标明，移出范围不能算删除 |
| query --live | 根据用户目标查询当前Code Graph，区分当前事实与旧笔记；不悄悄改写已发布版本 |
| impact | 确认caller能力；由指定Java符号逐跳反查，经过已确认跨服务关系继续；从表出发先在笔记中找持久化符号 |

默认path必须共享同一入口归属，不把不同业务的局部边拼成一条真实流程。显式COMPOSED及竞争消费路径只能解释为潜在静态可达；动态/未复核边是传播停止点。

大结果每次只展开用户相关的服务或有限行数，明确尚未读到的页和下一步定位点；没有全部读取就不声称总数。无需制造cursor token或哈希分页协议。查不到就说明当前记录范围；不能借查询请求偷偷触发全量重分析。

impact结果附受影响入口、服务、表、具体路径、证据和停止点；静态可达不等于运行时必然执行。证据/文档过期时显式说明，用户要当前结论则执行在线复查。
