# Mineradio Remix

面向 Windows 的沉浸式音乐播放器二创版：保留粒子封面、电影歌词与空间化舞台，并优化网易云音乐、歌单加载、播放恢复和日常交互。

> 原作来源：XxHuberrr 的 [Mineradio](https://github.com/XxHuberrr/Mineradio)（Copyright (C) 2026 XxHuberrr，GPL-3.0）；本仓库为 2026-07-15 修改的非官方二创版。

## 已实现

- 网易云音乐登录、搜索、歌单与“我喜欢的音乐”直接播放
- 大歌单缓存、首屏优先与渐进渲染
- 默认从右侧展开且保持开启的歌单 / 队列面板
- 重启后恢复队列、歌曲、进度和播放模式
- 无缝切歌与可调交叉淡入淡出
- 封面主色联动歌词、播放器和粒子舞台
- 切歌时旧封面粒子解体、新封面重新聚合
- 克制的情绪视觉与原版镜头交互
- Wallpaper Engine 动态桌面：同步粒子、歌词和播放状态，由 App 控制，桌面图标仍可正常点击

## 运行

要求 Windows 10 / 11 x64、Node.js 与 npm。

```bash
npm ci
npm start
```

Wallpaper Engine 为可选依赖。安装并运行 Wallpaper Engine 后，在 App 的视觉设置中开启“桌面壁纸”；App 会尝试自动应用仓库内的 `wallpaper-engine/MineradioLive/project.json`。壁纸只负责渲染，歌曲切换和播放控制仍在 App 中完成。

## 构建

```bash
npm run build:win:dir
npm run build:win
```

构建产物位于 `dist/`。当前未配置代码签名，因此 Windows 可能显示“未知发布者”。

## 数据、字体与授权

登录 Cookie、播放历史、缓存和自定义内容仅保存在本机，不应提交到仓库；项目也不包含音乐文件。隐私说明见 [PRIVACY.md](./PRIVACY.md)。

Inter 与 JetBrains Mono 的许可见 [字体说明](./public/fonts/THIRD_PARTY_FONTS.md)；MiSans 不随公开仓库或安装包分发。

本修改版整体依据 [GNU GPL-3.0](./LICENSE) 发布，第三方项目与服务说明见 [NOTICE.md](./NOTICE.md)。发布二进制文件时，应同时提供对应版本的完整源代码。本软件按“现状”提供，不附带任何担保。
