# 跨服务与持久化

## 跨服务匹配

Java调用到client/publisher的方法仍是Code Graph事实；从出站到接收端是独立的逻辑关系。每个匹配保留调用位置、发送配置/字面量、接收触发器与符号、目标服务以及规范键。

| 协议 | 匹配键与语义 |
|---|---|
| Feign / HTTP / RestTemplate / WebClient | 目标服务或别名 + HTTP method + 归一化path；变量名可归一为{}，静态片段不能忽略 |
| Gateway | 静态uri、Path/Method与可明确解释的路径改写；自定义filter未知时停止 |
| Rabbit | exchange + routing key + queue/binding |
| Kafka | cluster alias + topic，再按consumer group分订阅；不同group广播，同group多实例竞争 |
| JMS / RocketMQ | destination/topic + queue/topic语义 + subscription/group |
| gRPC / Dubbo | 协议 + 完整契约 + 方法签名；gRPC核对本地proto与provider |
| Spring Event | event完整类型 + 服务范围 + transaction phase |

目的地来自placeholder时按所选context追溯本地来源；环境、远程配置、SpEL或冲突值不猜。两端唯一且证据足够时继续目标入口；否则列外部/动态/歧义边界。WebClient静态可达不意味着一定被订阅，事件发布也不等于所有监听器必然执行。

## 数据库

- MyBatis XML：Mapper完整namespace与语句id对应，记录SQL表/CRUD及XML行号。多个匹配或重载不明时保留歧义。
- MyBatis注解：读取Select/Insert/Update/Delete及动态部分。MyBatis-Plus通过泛型Entity与TableName确认表，框架命名约定仅是候选。
- JPA：Repository泛型Entity与Table/schema、派生查询或Query/native SQL；save无法确定新增/更新时写“INSERT或UPDATE”。
- JdbcTemplate/NamedParameterJdbcTemplate：静态SQL可确认；字符串拼接或动态表名只记录确定部分，不猜最终表。
- 多数据源：以数据源/事务管理器 + schema + 表标识资源，不合并不同库同名表；数据源未知时明确标注。
- jOOQ/R2DBC、存储过程：只有本地静态表/SQL/过程定义可见时继续，否则作为外部状态。
- MongoDB、Redis、Elasticsearch：记录collection/key pattern/index，不能冒充关系表。

数据访问记录入口、精确持久化符号、操作、资源和来源证据，供table查询与反向impact定位。未知SQL或动态资源是PARTIAL，不应被总结成“无数据库访问”。
