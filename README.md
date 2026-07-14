<p align="center">
  <img src="docs/icon.png" width="132" alt="网络急救箱图标" />
</p>

<h1 align="center">网络急救箱</h1>

<p align="center">
  <strong>别再靠重启、换节点和反复开关 TUN 碰运气。</strong><br />
  看清是谁接管了 Windows 网络，安全修复代理、TUN、DNS 与路由冲突，改错也能一键回滚。
</p>

<p align="center">
  <a href="https://github.com/soberbw-hash/network-first-aid/releases/latest"><strong>下载最新版</strong></a>
  ·
  <a href="#它解决什么">它解决什么</a>
  ·
  <a href="#安全边界">安全边界</a>
</p>

<p align="center">
  <img alt="Windows 10 / 11" src="https://img.shields.io/badge/Windows-10%20%2F%2011-1675F2?logo=windows11&logoColor=white" />
  <a href="https://github.com/soberbw-hash/network-first-aid/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/soberbw-hash/network-first-aid?display_name=tag&sort=semver" /></a>
  <a href="https://github.com/soberbw-hash/network-first-aid/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/soberbw-hash/network-first-aid/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="Local first" src="https://img.shields.io/badge/data-local--only-15946F" />
</p>

![网络急救箱总览](docs/dashboard.png)

## 它解决什么

当 Clash、Mihomo、XSUS、sing-box、WireGuard 等工具先后接管过网络，Windows 很容易留下互相打架的系统代理、TUN 默认路由和 DNS。常见表现是：

- 不开代理时并非断网，但任何页面都加载得很慢；
- 手机使用同一节点正常，电脑却频繁 `timeout`；
- “连接代理”和 “TUN 模式”有时单开能用，有时必须一起开；
- 本地代理端口明明存在，Codex / ChatGPT 仍反复重连；
- 关掉代理软件后，系统代理或虚拟网卡配置没有恢复干净。

网络急救箱会把“本地代理是否工作”和“经代理访问外网是否成功”分开验证，再结合网卡、DNS、路由和进程状态给出有依据的修复建议。

## 一次体检，回答三个问题

1. **谁在接管网络？** 系统代理、WinHTTP、TUN 网卡、默认路由和监听端口一屏看清。
2. **为什么会超时？** 区分本地端口失效、代理出口失败、DNS 异常与残留路由。
3. **修复后能不能回去？** 每个写操作前自动创建快照，代理、DNS、Hosts 和防火墙均可选择性还原。

## 核心能力

- **只读网络体检**：检查网卡、DNS、系统代理、WinHTTP、默认路由、TUN、常见代理进程/服务、监听端口、Hosts 和真实连通性。
- **代理专项诊断**：识别多代理同时运行、失效的 localhost 代理、断开的 TUN 默认路由，并分别测试直连与代理出口。
- **15 项白名单修复**：覆盖 DNS、DHCP、WinHTTP、局域网绕过、网卡、Winsock、TCP/IP、Hosts、防火墙与网络组件重装。
- **修复前自动备份**：任何写操作前保存结构化网络快照；高风险操作强制备份并二次确认。
- **选择性还原**：代理、DNS、Hosts、防火墙可以单独恢复，不必一刀切重置所有配置。
- **本机审计记录**：检测、备份、修复、失败和还原记录只保存在当前电脑，不上传网络配置。

## 界面

| 总览与体检 | 修复操作预览 |
| --- | --- |
| ![总览](docs/dashboard.png) | ![修复预览](docs/repair-preview.png) |

界面使用 HarmonyOS Sans，图标与主界面采用珍珠白、雾蓝和钴蓝的轻量液态玻璃视觉；动画支持系统“减少动态效果”设置。

## 下载与运行

前往 [Releases](https://github.com/soberbw-hash/network-first-aid/releases/latest)：

- `Network-First-Aid-Setup-*.exe`：安装版，支持创建桌面快捷方式；
- `Network-First-Aid-Portable-*.exe`：免安装便携版，适合先试用。

软件目前没有商业代码签名，Windows SmartScreen 可能在首次启动时提示“未知发布者”。请只从本仓库 Release 下载，并核对 Release 中提供的 SHA-256。

## 安全边界

- 渲染进程不能提交 PowerShell 或任意命令，只能选择编译进程序的固定动作 ID；
- 低风险动作普通权限运行，需要修改系统配置时才触发 Windows UAC；
- “智能安全修复”不会关闭正在运行的 TUN，不会重置防火墙或整个网络栈；
- 高风险动作必须二次确认，并在执行前强制创建完整快照；
- `netcfg -d` 仅存在于“彻底重装网络组件”中，明确标记为最后手段。

## 本地开发

要求：Windows 10/11、Node.js 22+、Corepack。

```powershell
git clone https://github.com/soberbw-hash/network-first-aid.git
cd network-first-aid
corepack enable
corepack pnpm install
corepack pnpm dev
```

校验与打包：

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm dist:win
```

安装包和便携版会输出到 `release/`。

## 技术栈

Electron · React · TypeScript · Vite · PowerShell · electron-builder

## 反馈问题

提交 Issue 时请附上 Windows 版本、使用的代理软件、是否开启 TUN、错误截图，以及“操作记录”中对应条目。请先删除节点地址、订阅链接、账号或其他敏感信息。

> 本工具会修改系统网络配置。虽然所有写操作都尽量先创建快照，但在公司网络、VPN、特殊防火墙或远程服务器环境中，仍建议先手动备份并确保拥有备用连接方式。
