# APIManager 项目规范

## UI 图标：一律用 lucide-react，禁止 emoji / Unicode 图形字符

- 所有充当图标的视觉元素必须用 `lucide-react` 组件（继承 `currentColor`，`size` 取 11–14 与相邻文字字号匹配），**禁止**用 emoji（🔑 ✋ ⚡ ⚠ ⚙）或 Unicode 图形字符（↗ ▶ ✓ ✗ ◔ ▦ ↑ ↓）当图标。
- 原因：emoji 在 Windows/不同平台渲染成彩色位图，与 Phosphor Console 深色终端风冲突且颜色不可控；Unicode 符号跨平台字形不一致。SVG 图标单色跟随文字颜色，渲染一致。
- 文案中的箭头（如「设置 → 安全」、注释里的 `→`）是文字表达，不受此限。
- 图标与文字混排放在 `Button` 内即可（Button 基类已带 `inline-flex items-center gap-1`）；放非 flex 容器时外包 `inline-flex items-center gap-1` 的 span。
- 折叠箭头统一 `ChevronRight` + `rotate-90`（展开态）过渡，参考 `GroupSection.tsx`。
- 新增图标先查 lucide 里语义贴合的名字，与既有映射保持一致：签到 `Zap`、刷新 `RefreshCw`、密钥 `KeyRound`、编辑 `Pencil`、手动 `Hand`、外链 `ArrowUpRight`、重试 `RotateCcw`、警告/待验证 `TriangleAlert`、删除/关闭 `X`、成功 `Check`。
