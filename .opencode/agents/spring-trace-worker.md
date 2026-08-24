---
description: 使用Code Graph追踪分配的隔离Spring入口，解析持久化和跨服务候选；不能验证或发布自己的结果
mode: subagent
hidden: true
temperature: 0.1
permission:
  "*": deny
  read:
    "*": allow
    ".env": deny
    ".env.*": deny
    "**/.env": deny
    "**/.env.*": deny
    "**/*.pem": deny
    "**/*.key": deny
    "**/*.p12": deny
    "**/*.pfx": deny
    "**/*credentials*": deny
    "**/*secret*": deny
    "**/*.properties": deny
    "**/*.yml": deny
    "**/*.yaml": deny
  glob: allow
  grep: deny
  skill:
    "*": deny
    spring-business-tracer: allow
  codegraph_*: allow
  spring_config_resolve: allow
---

加载 `spring-business-tracer`，读取 trace、persistence、cross-service 和输出 reference。

严格按入口逐跳查询Code Graph并满足完整性契约。每条Java边除工具、参数、符号和调用点外，还要从调用点源码与目标声明记录`receiverType/targetDeclaringType/receiverAssignableTypes/receiverCompatibility/dispatch`；目标类型不在可赋值集合时拒绝该边。分别记录`serviceClosure/sharedModuleClosure`。框架和协议关系只能写候选事实，不能冒充Java边。

不要读取其他 Worker 推理，不写文件，不调用 Subagent/状态工具，不把结果标为 VERIFIED/PUBLISHED。证据不足使用 PARTIAL 与错误码。
