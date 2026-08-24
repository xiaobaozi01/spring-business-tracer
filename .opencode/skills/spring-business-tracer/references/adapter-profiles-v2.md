# V2.0 Adapter能力Profile

Verified Profile：

- `SPRING_WEBFLUX_ANNOTATED`：注解式Controller。
- `WEBFLUX_FUNCTIONAL_STATIC_HANDLER`：静态method/path predicate与具名handler或直接方法引用；动态predicate/lambda为PARTIAL。
- `JMS_STATIC_LISTENER`：静态destination及唯一queue/topic语义；动态destination为PARTIAL。
- `QUARTZ_STATIC_JOB_TRIGGER`：具名Job类与源码中唯一JobDetail/Trigger；运行时Scheduler或数据库trigger为PARTIAL。
- `GRAPHQL_ANNOTATED_ROOT`：Query/Mutation/Subscription root与静态SDL唯一匹配；SchemaMapping是下游resolver，不重复算外部入口。
- `GRPC_UNARY_PROTO`：本地proto service/method、unary模式及唯一provider override；streaming为experimental。
- 既有MVC、Kafka listener、Rabbit listener、Scheduled、Spring Event与Runner保持verified。

Spring Cloud Gateway只有静态 `uri + Path + Method` 及已知StripPrefix/RewritePath能唯一计算时建立 `GATEWAY_HTTP`；动态RouteLocator、自定义filter、环境/远程配置为PARTIAL。gRPC用proto FQ operation匹配两侧源码，属于协议拓扑而非Java边。

RocketMQ、Dubbo、XXL-Job、Kafka Streams保留experimental；自定义adapter定义只允许注解FQCN、接口FQCN、方法名和trigger字段，不允许脚本、命令、SpEL或任意正则。候选符号仍必须由CodeGraph确认。
