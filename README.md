# DPY 桌宠 · 多模型独立版

基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 0.3.8 的 Windows x64 独立安装版。
保留原桌宠动画与交互，增加 ChatGPT 账号、DeepSeek API、豆包 API、腾讯 WorkBuddy / CodeBuddy 账号和 OpenAI 兼容接口。

## 安装与使用

从本仓库 Releases 下载 `DPY-Pet-Setup-版本-x64.exe`，双击安装。Windows 10/11 x64，无需自行安装 Node、Electron、Git、DSH 或腾讯 CLI。首次使用需联网，各用户自行登录账号或填写自己的 API Key。

账号、密钥和宠物配置保存在 `%APPDATA%\DPY-Pet`；密钥使用 Windows safeStorage 加密。
升级和卸载默认保留数据。不要把该数据目录发给别人。
原便携版的数据仍在原文件夹，安装版首次使用需要重新连接账号，不会擅自搬运便携版账号。

设置页提供「检查更新 → 下载更新 → 重启并安装」，来源固定为本仓库的正式 GitHub Releases。
退出时不会自动安装未确认的更新。更新组件验证下载文件的 SHA-512，禁止降级。
首次正式 Release 发布前，检查更新会提示尚未完成；不会影响桌宠使用。

## 构建

Windows x64，使用 Node.js **24.14.0**：

```powershell
npm ci --no-audit --no-fund
npm test
npm run build:win
```

产物位于 `dist/`，包括 EXE、对应 `.blockmap` 和 `latest.yml`。
构建脚本自动准备 Node、固定版本 CodeBuddy CLI 和 Electron **43.3.0**。
依赖受 lockfile 和精确版本约束；不从用户电脑复制账号数据。
Electron 使用展开目录是为了让内置 Node 与桌宠 helper 访问脚本与素材。
Windows 签名需要维护者提供自己的签名证书；当前本地版本未签名。

## 发布下一次更新

1. 修改代码并完成测试，把 `package.json` 的 `version` 改为更高版本。
2. 提交代码并推送 `v版本号` 标签，例如 `v1.3.1`。
3. GitHub Actions 在 Windows 构建，通过后发布 EXE、blockmap、latest.yml。
4. 已安装的用户在设置中检查更新并安装。

GitHub 仓库需公开，朋友才可直接获取更新。不要把个人 GitHub Token 打进安装包。
工作流手动运行只构建并保存 Artifact；只有版本标签触发正式发布。

## 与上游的关系

本仓库维护定制版；用户端更新完整安装包，不直接 `git pull` 原作者源码。
模型连接与更新代码集中在 `app/`，安装与发布位于 `scripts/` 和 `.github/workflows/`。
`dsh-pet` 原核心保持 npm 固定版本；仅在构建时给 `electron-helper/main.js` 应用 profile 隔离补丁。
以后升级上游，修改固定版本及 lockfile、检查补丁与兼容性、测试后再发版本。不会未经测试自动替换上游。

本软件使用 OpenAI Sign-in with ChatGPT Devkit 的**非商业许可证**，该组件仅适用于个人非商业使用；保留完整许可证与第三方声明，详见 `THIRD-PARTY-NOTICES.txt`、`licenses/` 和 `app/sdk/`。
