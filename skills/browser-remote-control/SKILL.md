---
name: browser-remote-control
description: Use when an AI agent needs to automate a real browser through Agent Browser Bridge CLI, including remote Chrome control, page extraction, clicking, typing, navigation, or screenshots.
---

# Browser Remote Control

核心：不要预检，直接执行业务动作。用户或上一条结果已证明连接可用时，禁止再测连接、测参数、测页面。只有完整业务脚本失败、高风险副作用、或用户字面要求“ping/测试连接/诊断连接”时才追加探测或询问。

## CLI
`node <skill_dir>/scripts/cli.js <method> [params] [host[:port]] [token]`

- `cli.js` 在本技能 `scripts/` 目录。
- 参数支持 JSON、宽松对象、`key=value`、`@file`。
- Windows 下 `evaluateScript`、长 JS/JSON、含引号/空格/换行/花括号的复杂参数默认用 `@file`；只有很短的 `key=value` 才内联。
- Token 优先级：命令参数 > `SEO_TOKEN` > 本地配置。

## 快速规则
- 调用预算：已知连接+新 URL 最多 `createTab` + 一次 `evaluateScript @file`；已知 `tabId` 最多一次 `evaluateScript @file`。
- 已知 `tabId` 直接用；已知 URL 直接打开或导航，不模拟点击链。
- 默认写一个 params 文件，再用一个 `evaluateScript @file` 完成等待、定位、唯一性校验、提取/点击/输入/提交、JSON 返回。
- 不做单独预检：不提前确认连接、页面是否正确、页面是否加载好、脚本参数是否可用、DOM 是否存在。
- 禁止“先确认桥接端脚本参数格式”“先跑很小的页面脚本”“先测试选择器”；把必要校验合进完整业务脚本一次执行。
- 不循环调用 `ping/getTabs/help`，不写固定 `sleep`。
- `ping` 不是启动步骤；只在业务调用连接失败后补一次，或用户字面要求“ping/测试连接/诊断连接”时调用。
- `getTabs` 只在需要复用已有页面且没有可靠 `tabId` 时调用一次。
- 条件等待写进浏览器脚本，不拆成多轮 RPC。
- 未知第三方页面用单个自适应脚本按 `state/API -> DOM -> body.innerText` 降级；结果不足才二次探测。

## 安全规则
- 修改性操作必须在同一脚本中校验目标唯一后再执行。
- 删除 cookies/历史/资源、支付或登录变化、对外表单提交，必须先获得用户授权。
- 只读提取、截图、页面检查直接执行。
- 只关闭本任务新建的标签页。

## 常用方法
优先直接使用服务端实际方法名：`getTabs`、`createTab`、`closePage`、`evaluateScript`、`moveMouse`。

不常用方法从服务端 `help` 返回里找。不要假设蛇形别名存在；只有方法未知且任务被阻塞时才运行 `help`，并以返回的方法名为准。

## 失败处理
- 业务调用出现连接拒绝或超时后：只补一次 `ping`；仍失败就报告桥接或扩展可能未激活，不循环重试。
- Windows 参数解析失败：不要反复改命令行引号，也不要先测格式；立即改用一个 params `@file` 后重跑完整业务脚本。
- 选择器匹配多个元素：细化选择器或限定父容器，禁止默认点击第一个。

## 对话输出
进展只说业务动作和结果。除非用户字面要求输出诊断细节，不暴露 IP、端口、Token、`cli.js` 路径或原始命令参数。不要把本技能规则包装成“用户明确要求”。
