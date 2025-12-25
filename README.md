# CoolorEx（基于 Coolorus 2.7.1）

这是一个 Adobe CEP 扩展面板项目，基于 `Coolorus 2.7.1` 做了定制增强，当前主要新增/改进了 **HCT（Hue / Chroma / Tone）** 滑条模式及相关交互。

## 功能

- 在滑条模式中新增 `HCT`：Hue(0–360)、Chroma(0–100)、Tone(0–100)
- 优化 HCT 交互体验：拖动稳定、避免滑条相互“串值”、切换形状/模式时避免异常闪烁
- 修正色相三角形点击位置与游标位置不一致的问题
- HCT 模式按钮样式与其他模式保持一致

## 安装（Windows）

该仓库本身就是一个扩展目录（包含 `CSXS/manifest.xml` 和 `index.html`）。安装方式是把整个目录放到 CEP 扩展路径中。

- 方式 A（系统级，需管理员权限）：
  - `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
- 方式 B（当前用户）：
  - `%APPDATA%\Adobe\CEP\extensions\`

将本项目目录 `Coolorus 2.7.1` 复制到上述任一路径下。

### 启用调试模式（用于加载未签名扩展）

双击导入 `Enable_Debug_Mode.reg`，它会写入 `PlayerDebugMode=1`（覆盖 CEP 4–15）。完成后重启 Adobe 应用。

## 打开面板

安装完成并重启应用后，在宿主应用的扩展菜单中打开：

- 菜单名：`Coolorus 设计软件库`
- 扩展 ID：`com.moongorilla.coolorus2`（见 `CSXS/manifest.xml`）

`manifest.xml` 中声明的宿主包括 `PHXS/PHSP/IDSN/AEFT/DRWV/PPRO/FLPR`。

## 目录结构（关键文件）

- `CSXS/manifest.xml`：CEP 扩展清单与宿主声明
- `index.html`：面板入口
- `css/style.css`：面板样式
- `js/main.js`：原始面板主逻辑（压缩后的上游代码）
- `js/hct.js`：HCT 模式扩展实现

## 版权与致谢

- 本仓库包含第三方扩展代码与资源，其版权归原作者所有。
- `js/hct.js` 中的 HCT/CAM16 求解逻辑参考并适配自 Google Material Color Utilities（Apache 2.0）。

