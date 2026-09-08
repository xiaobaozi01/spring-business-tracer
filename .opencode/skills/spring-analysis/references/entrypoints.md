# Spring 入口

| 类型 | 入口依据 | 必须区分 |
|---|---|---|
| MVC / 注解式 WebFlux | Controller + 类/方法级 Mapping | 路径组合、HTTP method、重载与profile |
| functional WebFlux | 静态predicate与具名handler/方法引用 | 动态router/lambda无法还原时PARTIAL |
| Kafka / Rabbit / JMS | listener注册、topic/queue/destination | 配置解析、consumer group、订阅/竞争语义 |
| RocketMQ | listener注解或注册 | 自定义容器、动态selector保留未知 |
| Scheduled | 有效Bean上的定时方法 | 注释代码、未注册Bean不算入口 |
| Quartz / XXL-Job | Job与静态Trigger / handler注册 | 运行时调度和DB trigger无证据时PARTIAL |
| Spring Event | 监听器及event类型/事务阶段 | 应用内部事件与跨进程消息分开 |
| gRPC / Dubbo | proto或接口契约与provider实现 | unary/streaming、动态服务暴露分开 |
| GraphQL | SDL与root resolver注册 | 下游SchemaMapping不重复算外部入口 |
| Runner | CommandLineRunner/ApplicationRunner有效Bean | 接口存在但未注册不算入口 |

入口清单每行记录稳定键（服务/触发器/完整签名）、类型、可见性、context、符号、源码位置、Bean生效证据。启用类型零命中也要注明检查范围。

Feign、RestTemplate/WebClient、消息producer是出站关系；普通Service方法是下游符号。被注释、profile不匹配、非Bean、未注册实现写排除原因。自定义框架或无法证明注册过程的候选保留未知，不声称覆盖了所有入口。

静态 GraphQL root、gRPC unary、functional handler、JMS目的地、Quartz Job/Trigger只有注册关系和触发器都明确时才能确认。动态路由、streaming、Kafka Streams、运行时注入等按实际证据报告，不预先赋予“已支持即正确”的标签。
