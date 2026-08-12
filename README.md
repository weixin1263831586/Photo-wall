# Photo Wall

一个完全在浏览器本地运行的形状照片拼贴工具。上传照片后，可将照片自动填充进地图、爱心、人像、文字或自定义图片轮廓，并通过拖拽调整照片顺序。

## 功能

- 任意轮廓蒙版填充，照片不会超出形状边界
- 照片数量驱动的自适应填充密度
- 大小图自动混排，可将重点照片标星并优先放入大图格位
- 画布拖拽交换与照片列表拖拽排序
- 紧密方格、错落拼贴、自然分布三种排版
- 圆形、方形、六边形和爱心照片样式
- 26 种预设轮廓，涵盖基础几何、婚礼纪念、生日、毕业、旅行、音乐和宠物主题
- 文字、数字及自定义图片轮廓
- 人像智能抠图：角落背景采样、边缘扩散、肤色保护、噪点清理与剪影填实
- Logo/黑白图轮廓提取、阈值调整、反选与边缘平滑
- 智能色彩排序和随机重排
- 智能格位匹配综合照片比例、清晰度、对比度、视觉焦点和重点标记，并减少相邻重复
- 轮廓距离场辅助选择大图区域，细窄边缘自动保留小图
- 画布顶部常驻主操作，随时添加、重排和导出
- 30 步撤销/重做，并支持常用键盘快捷键
- PNG / JPG / WebP 导出，可选 1×～3× 清晰度、透明/纯色/自定义背景与文件名
- 导出支持紧贴轮廓、3:4 常用照片和 9:16 手机竖屏比例
- 导出设置提供实时效果预览，比例、透明度和背景颜色与下载结果一致
- 蒙版、密度搜索与渲染顺序缓存优化，改善数百至 1000 张照片时的排版响应
- 智能匹配预计算照片/格位特征，并在照片未用完前跳过已分配项；本机基准中 1000 张照片由约 220 ms 降至约 30 ms
- 编辑画布缓存静态合成层，鼠标悬停和拖拽只绘制高亮与拖动预览，不再逐帧重画全部照片
- 照片导入分析显著区域、对比度和清晰度，裁切时优先保留视觉主体
- 导出自动移除编辑态描边、悬停和轮廓辅助层
- 最多 1000 张照片，批量导入时自动优化分辨率和内存占用
- 根据屏幕宽度、设备内存和 CPU 自动调整导入尺寸、解码并发、分析 Worker、画布 DPR、撤销深度和导出像素上限
- 历史记录淘汰后自动释放不再引用的图片 Blob URL，多轮导入/删除不会持续占用旧图片内存
- 重复照片、超大文件和最大照片数量保护
- 桌面端和移动端响应式支持
- 图片仅在本地浏览器处理，不会上传到服务器

## 本地运行

项目不依赖构建工具，使用任意静态文件服务器即可运行：

```bash
python3 -m http.server 4173
```

打开 <http://localhost:4173>。

也可以使用 Vite 开发服务器：

```bash
npm install
npm run dev
```

也可以使用重启脚本在后台启动；它会安全停止占用该端口的旧 Python HTTP 服务：

```bash
./restart-server.sh        # 默认端口 4173
./restart-server.sh 8080   # 指定其他端口
```

## 使用方法

1. 选择预设轮廓，或输入文字、上传自定义轮廓图片。
2. 一次上传一张或多张照片。
3. 调整排版方式、照片形状、大小图混排、填充密度和间距；需要突出某张照片时，点击缩略图左上角的星标。
4. 在画布上将照片拖到另一张照片上即可交换位置。
5. 点击画布右上角“导出图片”，选择格式、清晰度和背景后保存。

## 快捷键

- `Ctrl/⌘ + Z`：撤销
- `Ctrl/⌘ + Shift + Z` 或 `Ctrl/⌘ + Y`：重做
- `Esc`：关闭轮廓编辑、导出设置或照片预览
- `←` / `→`：在照片预览中切换上一张/下一张

## 技术实现

项目使用原生 HTML、CSS、JavaScript 和 Canvas API。照片先覆盖轮廓包围区域，再通过统一二值蒙版裁切，以保证边缘完整且没有照片越界。

核心能力已按职责拆分：

- **智能布局（SmartPlacement + DistanceTransform）**：综合照片比例、视觉特征与重点标记完成格位评分和去重分配，并利用轮廓边界距离场将大图优先放入内部开阔区域。
- **图片分析（PhotoAnalyzer + Web Worker）**：分析照片的色彩、清晰度、对比度和视觉焦点；批量像素计算在 Worker 中执行，失败时自动回退主线程。
- **撤销与重做（HistoryManager）**：独立管理编辑状态、撤销/重做栈及历史资源释放。
- **照片库界面（PhotoLibrary）**：负责照片列表的增量渲染、拖拽排序、重点标记和预览交互。
- **质量保障**：包含 Node.js 单元测试、Playwright 端到端测试，以及覆盖 100 / 500 / 1000 张照片的布局性能基准。

运行单元测试和 100 / 500 / 1000 张照片的智能匹配基准：

```bash
npm test
npm run benchmark
```

首次运行端到端测试需安装 Playwright 浏览器，之后可直接执行：

```bash
npx playwright install chromium
npm run test:e2e
```

## Windows 桌面版

项目已接入 Tauri 2，桌面版沿用同一套 Canvas、ES Module 和 Web Worker。Windows 中保存项目和导出图片会使用系统“另存为”对话框。

在 Windows 10/11 安装以下环境：

1. Node.js 22
2. Rust stable（通过 rustup 安装）
3. Visual Studio 2022 Build Tools，并勾选“使用 C++ 的桌面开发”
4. Microsoft Edge WebView2 Runtime（Windows 10/11 通常已包含）

开发运行和构建安装包：

```powershell
npm install
npm run desktop:dev
npm test
npm run desktop:build
```

NSIS 安装包输出到：

```text
src-tauri\target\release\bundle\nsis\照片拼贴墙_1.0.0_x64-setup.exe
```

推送 `v*` 标签或手动触发 GitHub Actions 的 `Build Windows App`，也会在 Windows runner 上构建并上传安装包 artifact。

## Android / iOS

可以做成手机应用。当前 Tauri 2 工程已复用同一套前端与 Rust 入口，原生文件对话框、响应式布局、安全区、触摸画布和长按拖动照片排序均已接入。手机宽度下会将画布置于上方、编辑面板置于下方，并按设备能力降低图片导入尺寸、Worker 并发、编辑画布 DPR 和撤销栈深度。

Android 需要 Android Studio、Android SDK、NDK 和 Rust Android targets：

```bash
npm run android:init
npm run android:dev
npm run android:build
```

iOS 只能在 macOS + Xcode 上构建：

```bash
npm run ios:init
npm run ios:dev
npm run ios:build
```

移动端建议照片数量：4 GB 内存设备约 100～300 张，高端设备可尝试 500～1000 张。实际限制取决于照片分辨率和系统 WebView 可用内存。

当前移动端属于“可初始化、可真机调试”的工程状态。正式上架前还需要在目标设备执行 `android:init` / `ios:init`，配置应用签名、商店资料和相册权限，并重点验证数百张照片导入、后台切换恢复及 2×/3× 导出的内存占用。Android 可在 Windows、macOS 或 Linux 上开发；iOS 构建与签名必须使用 macOS + Xcode。
