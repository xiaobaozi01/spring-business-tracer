# V2.0 类型化应用拓扑

V2拓扑是已验证trace的投影，不创建新Java事实。Java `caller→callee` 仍只来自Code Graph；框架分派、配置路由和协议匹配使用独立边类型与provenance。

节点：`SERVICE/ENTRY/JAVA_SYMBOL/HTTP_ENDPOINT/MESSAGE_CHANNEL/MESSAGE_SUBSCRIPTION/RPC_OPERATION/JOB_TRIGGER/GRAPHQL_OPERATION/DATA_RESOURCE`。

边：`EXPOSES/DISPATCHES_TO/JAVA_CALL/CODEGRAPH_SPECIAL/INVOKES_HTTP/PUBLISHES/DELIVERS_TO/CONSUMES/INVOKES_RPC/TRIGGERS/ACCESSES`。

Kafka/Rabbit/JMS/RocketMQ规范化为 `publisher→channel→subscription→listener`；group/durable subscription和竞争消费语义挂在subscription。gRPC/Dubbo使用RPC_OPERATION。Gateway静态route是INVOKES_HTTP。未认证候选只进findings，不进入V2可信拓扑。

每条边的身份不包含行号或证据；provenance单独保存 `sourceKind/assurance/evidence/validatorReportHashes`。assurance为 `VERIFIED/CONDITIONAL/POTENTIAL/UNRESOLVED`，路径等级不得高于最弱边。

输出按ID hash前2位分片：nodes、edges、provenance、adjacency-in/out。精确节点和邻接查询只读目标shard并校验该shard hash；分页cursor绑定topologyRootHash和queryHash，切换快照或参数后拒绝。结果返回 `complete/cutoffReason/returnedCount`，不能把截断的观察数叙述为总数。

meta与shard统一走有界no-follow读取：拒绝任一父目录symlink、文件symlink/多硬链和大于8MiB文件，读取前后复验文件身份。分片写入在安全同目录中使用独占临时文件和原子替换，避免跟随旧路径。

`/spring-explain`读取相邻边及provenance。完整性模型是工作区内的自洽字节哈希校验，不是外部签名，不能宣称抵御有权限同时改写run与快照的攻击者或防回滚。
