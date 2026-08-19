<p align="center">
  <img src="docs/icon.png" width="132" alt="网络急救箱图标" />
</p>

<h1 align="center">网络急救箱</h1>

<p align="center">
  <strong>看清是谁接管了 Windows 网络，再安全地修复代理、TUN、DNS 与路由冲突。</strong><br />
  一键体检 · 白名单修复 · 自动备份 · 选择性回滚
</p>

<p align="center">
  <a href="https://github.com/soberbw-hash/network-first-aid/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/soberbw-hash/network-first-aid?display_name=tag&sort=semver" /></a>
  <a href="https://github.com/soberbw-hash/network-first-aid/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/soberbw-hash/network-first-aid/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="Windows 10 / 11" src="https://img.shields.io/badge/Windows-10%20%2F%2011-1675F2?logo=windows11&logoColor=white" />
  <img alt="Local only" src="https://img.shields.io/badge/data-local--only-15946F" />
  <a href="LICENSE"><img alt="Source available, all rights reserved" src="https://img.shields.io/badge/license-source--available%20%7C%20all%20rights%20reserved-64748B" /></a>
</p>

<p align="center">
  <a href="#下载与开始使用">下载</a> ·
  <a href="#它解决什么">适用场景</a> ·
  <a href="#核心能力">功能</a> ·
  <a href="#安全修复工作流">安全与回滚</a> ·
  <a href="#从源码开发">开发</a> ·
  <a href="#许可与第三方组件">许可</a>
</p>

![网络急救箱总览](docs/dashboard.png)

> [!IMPORTANT]
> 本工具会读取并在你确认后修改 Windows 网络配置。公司网络、远程服务器、专线、VPN 或定制防火墙环境可能有额外策略；执行高风险修复前，请确保拥有管理员授权和备用联网方式。

## 项目状态

- 当前正式版：`v0.1.1`。
- 支持平台：Windows 10 / 11 x64。
- 桌面架构：Tauri 2 + Rust + React + TypeScript。
- 数据策略：诊断、快照与操作日志默认只留在当前电脑，不提供账号、云同步或遥测。
- 发布方式：安装版与便携版均通过本仓库 [Releases](https://github.com/soberbw-hash/network-first-aid/releases/latest) 提供。

## 它解决什么

当 Clash、Mihomo、XSUS、sing-box、WireGuard 等工具先后接管过网络，Windows 可能同时残留系统代理、WinHTTP 代理、TUN 默认路由、虚拟网卡和自定义 DNS。它们单独看似正常，组合后却会互相打架。

典型表现包括：

- 不开代理时并非完全断网，但任何网页都加载很慢；
- 同一节点在手机正常，电脑却频繁 `timeout`；
- “系统代理”和“TUN 模式”有时必须同时开，有时同时开反而断网；
- 本地代理端口存在，但浏览器、Codex 或 ChatGPT 仍不断重连；
- 关闭代理软件后，系统代理、DNS 或虚拟路由没有恢复；
- 重置网络能短暂恢复，但不知道究竟改了什么，也无法安全回退。

网络急救箱不会把所有问题都归咎于“节点不行”。它把本地端口、代理出口、DNS、网卡、路由和进程拆开验证，再根据可观察证据给出对应建议。

## 它不是什么

- 不是代理客户端，不提供节点、订阅或代理服务；
- 不是网络加速器，不承诺提升带宽或降低游戏延迟；
- 不绕过单位、校园或地区网络策略；
- 不会在后台持续接管 DNS、代理或防火墙；
- 不会未经确认执行全量网络重置。

## 核心能力

| 能力 | 检查或处理的内容 | 设计原则 |
| --- | --- | --- |
| 网络体检 | 网卡、DNS、系统代理、WinHTTP、默认路由、TUN、监听端口、Hosts、相关进程和服务 | 先只读，后建议 |
| 代理专项诊断 | localhost 代理是否监听、代理出口是否可用、多代理是否冲突、TUN 路由是否残留 | 区分“本地端口可用”和“外网真的可达” |
| 白名单修复 | DNS、DHCP、WinHTTP、局域网绕过、网卡、Winsock、TCP/IP、Hosts、防火墙和网络组件 | 只允许预置动作 ID，不接受任意命令 |
| 自动快照 | 修复前记录代理、DNS、Hosts、防火墙等状态 | 写入前留退路 |
| 选择性还原 | 分别恢复代理、DNS、Hosts 或防火墙 | 不强迫用户一刀切 |
| 更新检查 | 主动读取本仓库最新正式 Release | 不后台静默替换程序 |
| 本机审计 | 记录检测、备份、修复、失败和还原结果 | 不上传网络配置 |

界面中每项修复都带有普通话场景说明，重点回答“什么时候该用”和“会改什么”，不要求用户先理解 Winsock、WinHTTP 或默认路由。

## 一次体检回答三个问题

1. **谁在接管网络？** 系统代理、WinHTTP、TUN 网卡、默认路由和常见代理进程一屏查看。
2. **为什么会超时？** 区分本地代理未监听、代理出口失败、DNS 异常、虚拟路由残留或多代理冲突。
3. **修复后能不能回去？** 写操作前创建结构化快照，支持按类别恢复关键设置。

## 下载与开始使用

前往 [Releases](https://github.com/soberbw-hash/network-first-aid/releases/latest) 下载：

- `Network-First-Aid-Setup-*.exe`：安装版，可创建开始菜单和桌面入口；
- `Network-First-Aid-Portable-*.exe`：免安装便携版，适合先试用或随身维护。

建议流程：

1. 只从本仓库 Release 下载，并核对 Release 提供的 SHA-256；
2. 第一次打开先运行“网络体检”，不要直接做高风险重置；
3. 根据异常项阅读对应修复说明；
4. 确认自动快照已成功创建后再执行写操作；
5. 修复后重新体检，并分别测试直连和代理访问；
6. 若结果变差，进入还原页选择受影响的配置类别回滚。

软件暂未购买商业代码签名，Windows SmartScreen 可能显示“未知发布者”。这不等于文件一定有问题，但应确保下载来源和校验值正确。

## 常见场景

### 关闭代理后网络仍然很慢

先检查系统代理和 WinHTTP 是否仍指向已经停止监听的本地端口，再检查 DNS 和默认路由。不要一开始就重置整个网络栈。

### TUN 开启后部分软件正常、部分软件超时

重点查看 TUN 网卡、默认路由优先级、DNS 去向和是否同时存在另一个代理进程。体检会把这些证据放在同一页中，便于判断冲突组合。

### 本地代理端口正常但外网不可达

这说明“客户端在监听”不等于“代理出口正常”。应分别测试直连和经代理访问，检查节点、上游连接或代理规则，而不是继续修复本地端口。

### 多个代理客户端轮流使用

先退出不需要的客户端，再检查残留系统代理、服务和虚拟网卡。避免在两个客户端同时运行时反复覆盖同一组设置。

## 安全修复工作流

网络急救箱把动作按影响范围区分，并对危险操作增加额外门槛：

- **只读检测**：收集状态并生成分析，不写系统配置；
- **低风险修复**：只调整明确目标，例如清理失效代理或恢复 DHCP/DNS；
- **需要管理员权限的修复**：仅在动作确实涉及系统级配置时触发 UAC；
- **高风险修复**：必须二次确认，并在执行前强制创建完整快照；
- **最后手段**：`netcfg -d` 只存在于“彻底重装网络组件”，会影响虚拟网卡和网络组件，不应作为日常第一选择。

关键安全边界：

- Renderer 不能提交 PowerShell 文本或任意命令，只能选择编译进程序的固定动作 ID；
- “智能安全修复”不会关闭正在工作的 TUN，不会默认重置防火墙或整个网络栈；
- 执行结果、耗时、输出摘要和失败原因会记录到本机审计日志；
- 还原支持按代理、DNS、Hosts、防火墙拆分，减少无关配置被覆盖的概率。

## 隐私与数据边界

- 不需要注册账号；
- 不收集分析数据，不接入广告或遥测 SDK；
- 诊断会读取本机网络相关状态，但不会主动上传；
- 快照和操作记录保存在本机；
- 更新检查仅在用户主动触发时访问 GitHub Release；
- 提交 Issue 前请删除节点地址、订阅链接、公司域名、设备名、账号和其它敏感信息。

## 界面预览

| 总览与体检 | 修复场景说明 |
| --- | --- |
| ![总览](docs/dashboard.png) | ![修复说明](docs/repair-help.png) |

| 修复前确认 | 更新检查 |
| --- | --- |
| ![修复预览](docs/repair-preview.png) | ![更新检查](docs/update-check.png) |

![支持作者界面](docs/support.png)

界面使用 HarmonyOS Sans，并尊重 Windows 的“减少动态效果”设置。字体许可见 `assets/HarmonyOS-Sans-LICENSE.txt`。

## 技术架构

```text
React / TypeScript Renderer
        │  仅提交固定动作 ID 和结构化参数
        ▼
Tauri IPC 边界
        │
        ▼
Rust 核心
  ├─ 诊断与证据分析
  ├─ 快照、审计与还原
  ├─ 权限和动作调度
  └─ 调用内置 PowerShell 资源
        │
        ▼
Windows 网络组件、注册表与系统命令
```

主要技术：Tauri 2、Rust、React、TypeScript、Vite、PowerShell 与 WebView2。

## 从源码开发

### 环境要求

- Windows 10 / 11；
- Node.js 22+ 与 Corepack；
- Rust `1.96.1`（仓库由 `rust-toolchain.toml` 固定）；
- Visual Studio 2022 C++ Build Tools；
- WebView2 Runtime（现代 Windows 10/11 通常已安装）。

### 安装与启动

```powershell
git clone https://github.com/soberbw-hash/network-first-aid.git
cd network-first-aid
corepack enable
corepack pnpm install
corepack pnpm dev
```

### 验证

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

### Windows 打包

```powershell
corepack pnpm dist:win
```

安装包和便携版输出到 `release/`。涉及系统配置的改动应至少验证：普通权限、管理员权限、快照失败、动作失败、还原成功和多网卡/TUN 环境。

## 项目结构

```text
src/renderer/                 React 桌面界面
src/shared/                   动作目录、类型契约、诊断分析与更新策略
src-tauri/src/                Rust 诊断、修复、快照、审计和更新逻辑
src-tauri/resources/          随程序打包的固定 PowerShell 资源
tests/                        诊断、安全与更新策略测试
docs/                         截图、发布说明与设计资料
scripts/package-windows.ps1   Windows 打包入口
```

## 问题反馈

提交 Issue 时建议包含：

- 网络急救箱版本与 Windows 版本；
- 使用的代理软件及版本；
- 是否开启系统代理、TUN、VPN 或虚拟网卡；
- 可复现步骤和预期/实际结果；
- 已脱敏的体检摘要、操作记录和错误截图。

不要公开上传订阅地址、节点凭据、内部域名、完整 Hosts、公司 VPN 配置或带用户名的本机路径。安全问题请优先阅读 [SECURITY.md](SECURITY.md)。

## 许可与第三方组件

本仓库为**源码可见的专有软件**，不是开放源代码软件。除第三方组件外，网络急救箱的源代码、界面、文档、品牌和构建资源均保留全部权利。普通用户可以按照 [LICENSE](LICENSE) 运行作者发布的未修改正式版本；未经书面许可，不得复制源码、制作和分发修改版、转售、托管为服务或用于商业产品。

完整条款见 [LICENSE](LICENSE)。第三方代码、字体、图标、系统组件和通过组件中心安装的软件继续适用各自许可证或服务条款，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

> 许可证可以约束代码、文档和品牌的使用，但不会自动垄断抽象的软件想法、通用功能或工作流程。需要商业合作、分发或二次开发授权时，请先取得版权所有者的书面许可。

