---
name: spring-business-tracer
description: 使用已安装的Code Graph梳理Java Spring项目或多服务工作区在不同Spring Profile下的全部业务入口、服务调用、跨服务协议、数据库资源和配置依赖，生成中文文档及带provenance的可查询类型化拓扑；支持一键全量/增量扫描、暂停恢复、分批验证、分片查询、解释、影响分析与旧版本迁移。
license: MIT
compatibility: opencode
metadata:
  language: zh-CN
  version: 2.0.0
---

# Spring Business Tracer V2.0

## 不可变原则

- 仅支持 Java；不实现 Java parser、LSP 调用图或第二套代码图。
- Java 符号、caller/callee、接口实现和跨文件 Java 边只能来自用户已安装并已完成索引的 Code Graph。
- grep/glob/read 只发现入口候选和读取注解、配置、XML、SQL、Entity、路由等非 Java 边证据。
- `codeGraph.queryLimit` 必须严格等于 `analysis.maxBranches+1`；查询要显式传该 `limit`，且工具明确返回 `resultCount/truncated/completionStatus/summaryOmittedCount`。`maxFiles` 不能替代 `limit`；出现“and N more”等摘要省略一律 FAIL/PARTIAL。
- 跨进程关系是 `LOGICAL_BOUNDARY`，必须有发送端、接收端和唯一规范 key 的双侧证据；不能任选目标。
- Validator/Auditor 必须自行调用 `spring_report_submit`；主 Agent 无权提交认证报告。
- 正式完成必须基于实际工件字节、实际文档字节和确定性图快照，而不是调用者声明的哈希。
- profile、placeholder和本地property source由确定性配置解析器处理；不读取环境变量、`.env`、秘密文件或远程配置，不执行SpEL。
- V2绑定配置、源码、Code Graph、工具包、解析上下文和adapter registry指纹；任一漂移都不能静默复用。

## 入口范围

从全部启用 adapter 发现 Controller/WebFlux、MQ listener、定时任务、Spring Event、RPC/GraphQL、Runner 等入口。V2按能力Profile验证，新增静态functional WebFlux、JMS、Quartz、GraphQL root与gRPC unary；动态路由、目的地和streaming仍保守标记。Feign client、HTTP client、producer不是业务入口。

详见 [入口发现](references/entrypoints.md)、[V2能力Profile](references/adapter-profiles-v2.md)、[Code Graph契约](references/codegraph-contract.md) 和 [查询完整性](references/query-completeness.md)。

## 多服务拓扑

可部署服务配置在 `workspace.services`，公共源码模块配置在 `workspace.sharedModules`，不能伪装成服务。服务间源码都存在时，先用边界 key 定位接收端，再从接收入口继续 Code Graph 追踪。trace分别记录`serviceClosure/sharedModuleClosure`；无法归属依赖仍禁止增量复用。

详见 [跨服务](references/cross-service.md)、[持久化](references/persistence.md)、[配置](references/configuration.md) 和 [配置上下文](references/config-resolution.md)。

## 全量工作流

`/spring-scan`：Doctor → 解析上下文/CONFIG审计 → 按服务领取入口发现租约并逐服务checkpoint → 覆盖审计 → 从checkpoint确定性plan → 分批 TRACE/VALIDATE/PUBLISH → 边界/覆盖审计 → V2拓扑快照 → COMPLETE。中断后只重领缺失或租约过期的服务。

每一阶段都重新领取租约。批次处理中定时 heartbeat；本批全部提交后 close，close 时校验配置、源码、Code Graph索引、工具包、解析上下文和adapter registry。Worker只产候选trace；Validator独立回放。发布只能读取VERIFIED报告绑定的trace，文档先写staging，COMPLETE后原子发布。

详见 [全项目扫描](references/full-scan.md)、[单入口追踪](references/trace-workflow.md)、[验证](references/validation.md)、[状态机](references/state-machine.md) 和 [发布恢复](references/publication-recovery.md)。

## 增量工作流

`/spring-update` 只接受V2 COMPLETE baseline。插件比较逐服务源码、逐共享模块源码与解析配置键；只有 `serviceClosure` 不触达 changedServices、`sharedModuleClosure` 不触达 changedSharedModules、`configDependencyIds` 不触达 changedConfigKeys 且没有未归属依赖才可 REUSED。旧版baseline、adapter registry或索引语义变化均FULL_REBASE。

详见 [增量分析](references/incremental.md)。

## 暂停、恢复和幂等

状态最小单元是入口的当前阶段：`PENDING → TRACE → TRACED → VALIDATE → VERIFIED → PUBLISH → PUBLISHED`。崩溃后租约过期会回到原阶段；`operationId` 防止重复提交。PAUSE 停止新领取，close 后进入 PAUSED；RESUME/RECOVER 可恢复租约、批次和 FINALIZING 发布事务。旧 V0.5 run 只读，显示 FULL_REBASE_REQUIRED。

## 图与查询

V2把已验证trace投影为类型化拓扑：SERVICE/ENTRY/JAVA_SYMBOL/HTTP_ENDPOINT/MESSAGE_CHANNEL/MESSAGE_SUBSCRIPTION/RPC_OPERATION/JOB_TRIGGER/DATA_RESOURCE及相应协议边。provenance单独分片；精确查询和邻接只读目标shard，cursor绑定topologyRootHash。`/spring-explain`返回证据。Java边仍只来自Code Graph。

详见 [V2拓扑](references/topology-v2.md)、[图快照](references/graph-snapshot.md)、[查询与影响](references/query-impact.md) 和 [输出格式](references/output-format.md)。

## 配置迁移

`/spring-migrate` 默认 dry-run，支持 V0.5/V1.0/V1.5 配置升级到V2。旧run/snapshot只读，不伪造V2 provenance，首次V2必须FULL_REBASE。详见 [迁移](references/migration.md)。

契约回放仅用于明确测试并标为 `TEST_ONLY`，见 [契约回放](references/contract-replay.md)。
