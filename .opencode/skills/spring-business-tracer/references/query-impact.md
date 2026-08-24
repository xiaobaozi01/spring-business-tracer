# V2.0 查询与影响分析

## `/spring-query`

输入示例：

```text
symbol:com.acme.order.CheckoutService#create
entry:order-service|http|post-api-orders
table:inventory.stock_item
service:inventory-service
boundary:rabbit:order.created
```

默认通过不可变图快照查询已发布的入口、表、服务、边界和邻接边。参数含 `--live` 时才在线调用 Code Graph 的 callers、callees、paths 或综合 explore；live查询显式传limit并验证不截断。索引四指纹与快照不一致时只说明二者时点不同，不混合新旧事实。

## `/spring-impact`

输入：

```text
method:{FQCN}#{method}({params})
table:{schema.table}
entry:{entry-id}
boundary:{kind}:{key}
```

流程：

1. 运行 impact Doctor，caller/blast-radius 能力缺失即 `FAIL`。
2. 用 Code Graph 反向查询 Java callers，逐跳保存证据。
3. 命中已验证 `LOGICAL_BOUNDARY` 时，可从 target 反向到 source 或从 source 正向到 target。
4. 汇总受影响入口、服务、表、消息、定时任务和边界。
5. 对动态分派或未验证边界停止传播并标记 `PARTIAL`。

表影响不是通过 SQL 文本全仓搜索直接得出。先从已验证表文档找到持久化符号，再以这些符号为 Code Graph 起点查询 callers。

## 输出

```text
目标与方向
源码/索引指纹
受影响入口（严格集合）
受影响服务与数据库表
Java反向/正向路径
跨服务逻辑边界
Code Graph查询记录
未确认和停止传播点
```

结果是静态影响范围，不等价于运行时一定执行。不要把“可达”描述为“必然受影响”。
