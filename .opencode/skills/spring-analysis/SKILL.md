---
name: spring-analysis
description: 用于识别 Java Spring 业务入口，或分析一个入口的调用链、跨服务协议、数据库访问及业务条件。
compatibility: opencode
---

# Spring 分析方法

遵守 `spring-business-tracer` 的共同证据规则，只处理交接指定的范围。

## 发现入口

按 [Spring 入口](references/entrypoints.md) 检查启用类型；从注解/注册关系取得候选，用 Code Graph 确认方法和源码位置。每个候选说明当前 context 下 Bean 是否生效，返回入口表、各类型覆盖情况、排除项和未知项。共享模块和出站client不是入口服务。

## 追踪入口

从唯一的入口符号查询直接callee，逐跳展开业务方法；遇到接口用 Code Graph 的实现/分派关系消歧，核对 receiver 与目标声明类型。框架内部、日志和简单DTO可折叠，但记录停止边界；循环记回边，不重复展开。

读取已命中方法解释条件、事务、权限、幂等、锁、缓存、异常和状态变化。源码事实与业务解释分开，不通过阅读方法体补造跨方法调用关系。

遇到远程或异步出站方法，读 [跨服务与持久化](references/boundaries.md)，核对两端再继续接收入口；到数据库访问时记录数据源、表、CRUD和原始 SQL/XML/Entity 来源。匹配仍待 reviewer 复核。

每个分支到终点、循环、动态/歧义目标或查询上限时结束，记录原因。默认最多展开40跳、每层100个业务候选；达到预算就标PARTIAL并给下一个起点，不为了“完整”无限展开。

返回 [入口模板](../spring-business-tracer/assets/entry.md) 格式的 Markdown；关键关系逐条引用证据，附实际工具查询记录、context、涉及服务/共享模块/文件/配置键。不要生成JSON工件或调用不存在的自定义工具。
