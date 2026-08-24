# V2.0 跨服务与异步边界

## 两种不同的边

- `CODEGRAPH_JAVA_EDGE`：单个 Java 世界中的 caller→callee，必须由 Code Graph 返回。
- `LOGICAL_BOUNDARY`：进程、协议或异步调度之间的连接，由双方源码/配置证据匹配，不是 Java 调用边。

## 支持优先级

1. Feign/声明式 HTTP client → Controller route。
2. Rabbit/Kafka/JMS/RocketMQ publisher → listener。
3. Dubbo/gRPC contract → provider implementation。
4. Spring Event publisher → listener（默认同服务；共享事件类型必须唯一）。
5. RestTemplate/WebClient 等动态 URL 只有完整静态 method/path 才匹配。

## 规范边界键

```text
HTTP: METHOD + normalized path + target service
RABBIT: exchange + routing key + queue/binding
KAFKA channelKey: cluster alias + topic
KAFKA subscriptionKey: channelKey + consumer group
RPC: protocol + contract FQCN + method signature
EVENT: event FQCN + transaction phase
```

路径变量名归一为 `{}`，但 HTTP Method、静态 path 片段和 service identity 必须相等。property placeholder 只有能在工作区配置唯一解析时才展开，并保留配置证据。

## 验证

Boundary candidate 至少包含：

- 出站 Code Graph 路径到 client/publisher 方法；
- 出站注解/调用字面量/配置位置；
- 目标 service root；
- 入站入口符号、触发器与源码位置；
- 规范化 key 和匹配过程。

`spring-boundary-validator` 独立读取两侧证据。HTTP 只有 method、base URL/service alias、path 与目标 route 全部静态唯一时才能验证；RestTemplate/WebClient 始终是 `LOGICAL_BOUNDARY`，跨 helper 拼接、filter 改写、动态 URI 或配置冲突为 `UNRESOLVED/PARTIAL`。WebClient 静态可达不代表运行时一定订阅。

Kafka不以“多个listener”一概判歧义：不同consumer group是fan-out，同group多listener形成竞争subscription。V2图中消息关系规范化为publisher→channel→subscription→listener。静态JMS与gRPC unary进入verified；Gateway仅静态uri/Path/Method及已知filter可验证。动态topic、route、SpEL、streaming或cluster alias不唯一时PARTIAL。Kafka Streams仍experimental。

## 跨服务继续追踪

边界验证通过后，以目标入口符号为新 Code Graph 起点。文档同时保存 source service、target service 和各自 index/projectPath 身份。任一服务源码根未索引时 cross-service Doctor `FAIL`。
