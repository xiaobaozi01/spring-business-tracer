# V2.0 业务入口发现

## 原则

入口适配器通过注解、接口或配置发现候选；候选方法必须由Code Graph唯一确认符号身份和源码位置，并证明宿主是所选context中的有效Spring Bean。整类或Bean注解被注释、条件不成立、配置未注册、宿主非Bean时必须写入排除清单。发现候选不是创建Java调用边。

## 默认 adapters

| Adapter | 候选证据 | 规范触发器 |
|---|---|---|
| SPRING_MVC / WEBFLUX | `@Controller/@RestController` + Mapping | `HTTP METHOD path` |
| KAFKA | `@KafkaListener` | group + topic |
| RABBIT | `@RabbitListener` | queue/exchange/routing key |
| JMS | `@JmsListener` | destination |
| ROCKETMQ | listener注解/接口 | topic + selector/group |
| SCHEDULED | `@Scheduled` | cron/fixedDelay/fixedRate + zone |
| QUARTZ | `Job#execute` + Job配置 | job/trigger identity |
| XXL_JOB | `@XxlJob` | handler name |
| SPRING_EVENT | `@EventListener`、`@TransactionalEventListener`、`ApplicationListener` | event FQCN + phase |
| DUBBO | provider注解/接口 | contract + method |
| GRPC | `ImplBase` override | service + RPC method |
| GRAPHQL | Query/Mutation/Subscription Mapping | operation + field |
| APPLICATION_RUNNER | `CommandLineRunner/ApplicationRunner` | bean + run |

V2按能力Profile验证：既有MVC、注解式WebFlux、Kafka/Rabbit listener、Scheduled、Spring Event和具名Runner，加上静态functional WebFlux、JMS listener、Quartz静态Job/Trigger、GraphQL root与gRPC unary。严格边界见 `adapter-profiles-v2.md`。动态predicate/lambda、destination、runtime wiring或streaming不强认。入口ID必须包含service identity，条件化入口保存contextIds与conditions。

其余 adapter 仍可发现候选，但属于 experimental：没有完整证据就标 `PARTIAL/UNSUPPORTED_ADAPTER`。自定义注解只在配置显式列出时启用。

## 清单字段

每个服务的清单作为独立checkpoint保存；插件从`entries`重算`totalEntries`和各adapter count，不接受自然语言编号或自报总数。每个入口保存：

```text
id, serviceId, adapter, visibility, trigger,
symbolId, signature, file, line, beanActivation,
candidateEvidence, codeGraphQuery, exclusions
```

`visibility` 使用 `PUBLIC/INTERNAL/BACKGROUND`。稳定 ID 不能依赖发现顺序。

## 独立覆盖审计

`spring-entry-worker` 与 `spring-coverage-auditor` 分别发现一次。主 Agent 比较集合：

- `missing = audit - worker`
- `extra = worker - audit`
- duplicate trigger / duplicate symbol
- 候选未被 Code Graph 确认
- 启用 adapter 没有报告发现数量

有 missing、重复或未确认项时不能冻结 inventory。无法识别的自定义框架写入“不支持入口类型”，run 为 `PARTIAL`，不得声称覆盖所有可能入口。
