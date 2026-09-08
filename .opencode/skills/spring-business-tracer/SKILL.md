---
name: spring-business-tracer
description: 用于 Java Spring 后端业务链路梳理、全量或增量扫描、分析进度恢复与诊断，基于已有 Code Graph。
compatibility: opencode
metadata:
  language: zh-CN
  version: "3.0"
---

# Spring 业务梳理

这是纯文档工具包。使用宿主原生工具、Task 和用户已安装的 Code Graph；不生成辅助代码、脚本、插件、JSON 协议或新索引。

## 共同证据规则

- Java 符号、caller/callee 和接口分派来自 Code Graph。已索引仓库先用 explore 定位；只有可核实的实际直接边才能进入调用链。
- 源码阅读/文本搜索只补充注解、方法内分支、配置、SQL/XML/Entity。不能用同名方法、字段类型或“只有一个实现类”补造调用边；核对 receiver 与目标声明类型。
- 查询有分页就继续取完，有截断/摘要省略就记录；不知道是否完整时明确写“未证明完整”，不编造 limit、计数或完整性字段。无对应能力时停止相关分支。
- Java调用、框架分派、跨进程逻辑关系分别记录。HTTP/MQ/RPC/Event 匹配需要双方证据；动态或歧义目标保留候选和缺口。
- 只读与任务相关的应用配置；不读取 `.env`、密钥或凭据文件。文档不保存密码、token、连接串凭据及其派生值，统一写“已隐藏”；不声称生成了不存在的hash。
- 事实、解释和未知分开。只有经过独立复核的事实进入正式结果；部分证据可以交付，但必须逐项标 PARTIAL。

## 根据当前任务加载

| 任务 | 操作知识 |
|---|---|
| doctor；首次分析前确认工具与范围 | [准备与配置](references/workspace.md) |
| trace / scan / update / pause / resume / status | [工作流](references/workflows.md) |
| query / impact / context / topology / explain / diff | `spring-query` |
| 分析者发现入口或追踪 | `spring-analysis` |
| 复核者检查分析结果或增量范围 | `spring-review` |
| 保存进度和交付 | [文档约定](references/artifacts.md) |

子 Agent 只需读本页的共同规则及自己的 Skill。其余资料在任务遇到相应问题时再读。

## 交接

主 Agent 给子任务：本次目的、服务/入口、上下文、已知符号、相关文件、分析范围、停止条件和返回格式。分析任务不接收其他分析者的推理；复核任务接收候选笔记，但自行取得证据。

默认顺序处理入口，每个入口完成就保存。仅在多个入口独立且当前宿主允许时并行 Task，所有写入仍由主 Agent 汇总完成。同一个 run 不由两个主会话同时写。
