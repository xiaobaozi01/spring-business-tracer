# V2.0 持久化解析规则

## MyBatis XML

1. 从 Code Graph 到达 Mapper 接口方法。
2. 读取接口完整类名。
3. 匹配 XML `mapper namespace`。
4. 按方法名匹配 `select|insert|update|delete` 的 `id`。
5. 从 SQL 中提取表名和操作类型。
6. 记录 Mapper方法、XML文件、语句ID和行号。

方法重载、XML语句缺失或多个XML同时匹配时标记 `UNRESOLVED`。

## MyBatis 注解

读取 Mapper 方法上的 `@Select`、`@Insert`、`@Update`、`@Delete`。动态脚本仍需标记其动态部分。

## MyBatis-Plus

通过 Mapper 泛型实体或 Service 实体类型定位 `@TableName`。没有 `@TableName` 时，可以记录框架约定候选，但置信度为低，不能当作确定表名。

## JPA

1. 从 Repository 的泛型参数定位 Entity。
2. 读取 `@Table(name, schema)`；缺失时记录实体名约定候选。
3. `save` 根据上下文可能是 INSERT 或 UPDATE，无法区分时写 `UPSERT_OR_UPDATE`。
4. 派生查询方法记录为 READ，并保留方法名证据。
5. `@Query` 和原生 SQL 按语句解析。

## JdbcTemplate、NamedParameterJdbcTemplate 与直接 SQL

只解析静态可见的 SQL。对于字符串拼接、模板变量、动态表名：

- 提取确定部分；
- 将动态部分标记为 `DYNAMIC_TABLE`；
- 不猜测实际表名。

## CRUD 类型

使用：

```text
READ
INSERT
UPDATE
DELETE
UPSERT_OR_UPDATE
UNKNOWN
```

## 其它持久化边界

- jOOQ/R2DBC：只有静态可见的表对象或 SQL 才记录确定表；否则 `UNKNOWN/DYNAMIC_TABLE`。
- 存储过程：记录 procedure 名和调用证据；只有过程定义在工作区且能精确解析时才展开表。
- MongoDB、Redis、Elasticsearch：记录 collection/key pattern/index 作为“外部状态”，不要伪装成关系表。
- 多数据源：记录 datasource/transaction manager 证据；无法确认时不得把同名表合并。

## 数据资源身份

V2.0的verified关系存储范围统一身份为 `db:<storeId>:table:<namespace>.<name>`；storeId来自数据源/事务管理器，缺失时保留不确定性。不同数据源同名表不得合并；动态identifier使用DYNAMIC_TABLE/PARTIAL。表汇总必须引用入口、精确持久化symbol和原始SQL/XML/Entity证据。

JPA、MyBatis XML/注解和JdbcTemplate是V2 verified adapters。Mongo、Redis、Elasticsearch、R2DBC、jOOQ仍按外部状态候选记录。
