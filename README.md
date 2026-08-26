# Spring Business Tracer for OpenCode

项目级 OpenCode 工具包，使用已安装的 Code Graph 梳理 Java Spring 后端业务逻辑。

当前版本：`2.0.0`

## 接入项目

把本仓库的 `.opencode/` 复制到目标Java Spring项目根目录；可部署应用写入`workspace.services`，mall-common、mall-mbg等公共源码模块写入`workspace.sharedModules`，不能当服务。安装锁定依赖并重启OpenCode：

```bash
cd .opencode
npm ci
```

确认 Code Graph 已由你在目标项目中建立最新索引且 MCP 可连接，然后依次运行：

```text
/spring-doctor scan
/spring-scan --new
```

工具包不会自动初始化或刷新 Code Graph。

## V2.0 能力

- 从单个 HTTP/Java 入口追踪到 Service、Mapper/Repository 和数据库。
- 一键发现并解析整个项目的已支持业务入口。
- 按Spring profile/本地property source确定性解析placeholder，秘密值只输出hash；环境变量、`.env`、远程配置和SpEL失败关闭。
- verified能力细分到Profile：新增静态functional WebFlux、JMS listener、Quartz静态trigger、GraphQL root和gRPC unary；动态变体保持PARTIAL。
- 在所有服务源码均位于工作区并已被 Code Graph 索引时，继续追踪 Feign/HTTP、MQ、RPC 和 Event 跨服务边界。
- 入口发现先按服务租约并独立checkpoint，插件重算结构化清单数量；随后按TRACE/VALIDATE/PUBLISH三阶段租约处理。中断后只重试未完成服务/入口。
- 发现和分析租约都返回插件端`serverNow/heartbeatDueAt`并支持心跳；配置在run初始化时冻结，仍持有当前fencing token的迟到结果可安全提交。
- 配置、逐服务源码、Code Graph索引、工具包、解析上下文和adapter registry在批次边界防漂移。
- 由7个受限Subagent独立发现、追踪、配置复算和验证；认证报告只能由对应Validator/Auditor直接提交。
- 仅基于V2 COMPLETE基线，按serviceClosure、sharedModuleClosure与configDependencyIds保守增量复用；其他schemaVersion直接拒绝。
- 输出中文文档与V2类型化拓扑；SERVICE/ENTRY/端点/消息channel+subscription/RPC/Job/Data Resource分开建模，provenance单独分片。
- 精确节点、邻接和解释查询只读目标shard，稳定cursor绑定topologyRootHash；完整性明确为工作区内自洽校验而非外部签名。
- 识别Feign、RestTemplate、WebClient、Rabbit、Kafka和Spring Event双侧边界；Kafka按cluster/topic/group表达竞争消费语义。
- 支持JPA、MyBatis XML/注解和JdbcTemplate持久化证据，动态表名保守标记PARTIAL。
- `/spring-query` 默认查询已发布快照，`--live` 查询当前Code Graph；`/spring-impact` 分析静态影响范围。

## 命令

```text
/spring-doctor [trace|scan|cross-service|impact|resume]
/spring-trace http:POST:/api/orders
/spring-scan --new --batch-size 10
/spring-update --base current --batch-size 10
/spring-pause run-id
/spring-resume run-id
/spring-status run-id
/spring-query table:inventory.stock_item
/spring-query path:com.example.OrderController#create->inventory.stock_item
/spring-diff run-old run-new
/spring-context resolve prod-cn
/spring-topology neighbors service:order-service --context prod-cn
/spring-explain rpc:grpc:acme.order.OrderQuery/Find
/spring-query --live symbol:com.example.OrderService#create
/spring-impact table:inventory.stock_item
```

全项目命令在当前会话预算内持续处理；大项目会在入口单元边界 checkpoint，然后用 `/spring-resume` 继续。

## Agent 架构

一个主 Agent：`spring-business-orchestrator`。

七个隐藏、只读 Subagent：

1. `spring-entry-worker`：发现并用 Code Graph 确认入口。
2. `spring-trace-worker`：追踪隔离入口，生成待验证结果。
3. `spring-trace-validator`：独立重新查询 Code Graph 验证调用边和表。
4. `spring-coverage-auditor`：独立清点入口，检查遗漏/重复。
5. `spring-boundary-validator`：核对跨服务双方证据。
6. `spring-incremental-validator`：核对V1基线、入口重发现和服务闭包失效集合。
7. `spring-config-auditor`：独立复算Profile、placeholder、外部缺口和秘密脱敏。

Worker 不能验证自己，Validator 不能发布。主 Agent 通过状态插件顺序提交 checkpoint 和正式文档。

## 正确性边界

- Java 符号、caller/callee、接口实现和跨文件 Java 边只能来自 Code Graph。
- 文本搜索只用于入口候选、注解、配置、Mapper XML、SQL 和 Entity，不能生成调用边。
- Feign/MQ/RPC/Event 使用有两端证据的逻辑边界，明确区别于 Java 边。
- 没有当前命令需要的 Code Graph 能力或索引时失败关闭。
- Code Graph工具必须显式支持limit并明确返回resultCount/truncated；`maxFiles`或`and N more`摘要不能判为PASS。
- 每条Java边校验调用点receiver类型、目标声明类型和可赋值集合，拒绝同名方法误连。
- 状态插件只管理运行状态并计算源码字节指纹，不解析 Java 语义、不生成调用边，也不实现第二套代码图。
- Code Graph 索引不会被工具包自动初始化、刷新或升级。
- 静态functional WebFlux、JMS、Quartz、GraphQL root和gRPC unary有严格verified profile；动态router/destination/runtime wiring/streaming、Kafka Streams仍PARTIAL。
- Path 默认 STRICT_ENTRY，避免把不同入口各自验证的边拼成虚假业务链；COMPOSED 只表示潜在静态可达。
- 只支持当前V2 run与snapshot；其他schemaVersion直接拒绝，禁止跨版本seed和语义diff。

## 输出与状态

正式文档：

```text
docs/spring-business/
```

可恢复状态（已 gitignore）：

```text
.opencode/.cache/spring-business-tracer/runs/
```

只有独立验证通过或经安全证明复用的入口能进入正式快照。Validator/Auditor直接提交认证报告，状态插件校验OpenCode Agent身份、必需checks、查询记录和实际工件哈希。`graph/*.jsonl` 是可查询证据图，Java边仍只来自Code Graph。

## 测试

```bash
python3 tests/scripts/validate_v20.py --require-codegraph
node tests/scripts/validate_schemas.mjs
node tests/scripts/test_state_plugin_v20.mjs
python3 tests/scripts/compile_fixtures.py
```

固定 Code Graph 响应仅用于 `TEST_ONLY` 契约回放。真实集成取决于目标项目已初始化的 Code Graph 索引，先运行 `/spring-doctor`。

Windows若命令行能执行`codegraph`但OpenCode报告`CODEGRAPH_COMMAND_NOT_FOUND`，运行`Get-Command codegraph`并将得到的`codegraph.cmd`或`codegraph.exe`绝对路径配置到`.opencode/spring-business-tracer.json`的`codeGraph.executable`。持续租约过期通常不是Agent时区导致：检查claim/status返回的`serverNow/heartbeatDueAt/remainingSeconds`，确认执行Agent在续租时点前用新operationId调用对应heartbeat。
