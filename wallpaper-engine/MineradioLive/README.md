# Mineradio Live（Wallpaper Engine）

这是 Mineradio 的被动桌面渲染端：只显示与 App 一致的封面粒子、环境粒子和 3D 歌词，不播放音频，也不会抢占桌面鼠标。歌曲与视觉设置仍由 Mineradio App 控制。

## 更新壁纸文件

双击本目录的 `stage.cmd`，或在 PowerShell 中运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\stage.ps1
```

脚本会把仓库根目录 `public` 的当前版本复制到本项目的 `app` 目录，并自动排除不随公开版分发的 MiSans。随后在 Wallpaper Engine 中打开本目录的 `project.json`。Mineradio App 运行时，壁纸会通过 `127.0.0.1:17368` 自动同步；App 暂未运行时，壁纸保留静态粒子背景并自动等待重连。
