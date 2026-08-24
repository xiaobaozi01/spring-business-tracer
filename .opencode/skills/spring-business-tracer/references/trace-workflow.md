# V2.0 单入口追踪

## 1. 规范化目标

```text
http:{METHOD}:{PATH}
method:{FQCN}#{METHOD}({PARAMETER_TYPES})
entry:{stable-entry-id}
```

存在重载时必须用参数类型消歧。HTTP 路由由类级与方法级 Mapping 组合；文本搜索只能产生候选，符号身份由 Code Graph 确认。

## 2. 渐进展开

每次查询当前方法的直接 callees 或综合工具中可还原的下一跳：

1. 保存工具名、查询参数、caller/callee身份和调用点。
2. 折叠 JDK、Spring框架、日志与简单 DTO，但保留被折叠节点列表。
3. 对项目业务符号继续展开；对重复符号记录回边并终止循环。
4. 到 Repository、Mapper、EntityManager、JdbcTemplate 或直接 SQL 时进入持久化解析。
5. 到 Feign/HTTP/MQ/RPC/Event 出站点时创建待验证 `LOGICAL_BOUNDARY` 候选。
6. 边界两侧唯一匹配并经 `spring-boundary-validator` 通过后，从目标入口继续 Code Graph 追踪。
7. 达到深度、分支或动态边界上限时停止该分支，状态为 `PARTIAL`。

完整路径摘要不能替代逐跳证据。每一跳必须能还原到 Code Graph 返回的直接边或明确标注的逻辑边界。

## 3. 接口实现

只接受：

- Code Graph implementation/override 关系；
- Code Graph 返回的实际 callee。

`@Primary`、`@Qualifier`、字段类型和“只有一个实现类”只能解释已确认目标，不能创建调用边。多个候选无法消歧时保留全部候选，标记 `UNRESOLVED`。

## 4. 分支与业务语义

- `if/switch`、异常、状态改变、事务、权限、幂等、锁、缓存和消息副作用不得折叠掉。
- 源码事实与业务语义推断分开；推断必须引用事实。
- 未被 Code Graph 覆盖的方法体读取可以解释当前方法内部条件，但不能推断另一个 Java 方法被调用。

## 5. 停止条件

- 达到数据库操作或明确证明无数据库访问；
- 跨服务目标唯一且已继续追踪到目标终点；
- 逻辑边界动态/歧义；
- Java动态分派无唯一目标；
- 循环或资源上限；
- Code Graph 返回不完整或指纹变化。

只有 `spring-trace-validator` 重新查询并确认 Java 边、持久化和证据后，结果才是 `VERIFIED`。Worker 自己不能验证自己。
