# OpenChamber Docker 插件中文化整改 回顾

**创建时间**: 2026-10-31 17:34
**最后更新**: 2026-10-31 17:34
**作者**: 小满
**涉及阶段/模块**: openchamber-extension-docker（中文 fork）i18n 全链路整改 + ocr 审查闭环

> **摘要**: 本文档记录从「停止（Do…」按钮溢出截图出发，到 Remove 泄漏引发的系统性 i18n 清扫，经三轮 ocr 代码审查闭环（verdict FAIL → 整改 → PASS）的全过程经验，包括碰到的坑、怎么绕过去的、以及沉淀下来的策略。

---

## 一、背景

### 起始状态

- **上下文**: 上游 `openchamber/openchamber-extension-docker` 的中文 locale PR 提交后长期无动静，晨星决定自维护 fork `MorningStar0709/openchamber-extension-docker`（本地仓库 `/home/skyler/WorkPlace/AI/openchamber-extension-docker-zh`，origin=fork，upstream=官方，base `8229ff5`，fork main 已含 locale-follow 系列提交）。
- **触发问题**: 晨星截图（m00001）显示状态区按钮渲染为「停止（Do…」——译文 `停止（Down）` 的英文括注把按钮文本撑出边框。追问：「Remove 这个能不能也优化一下？我们看中文的时候不需要英文对照呀，或者我们有没有更好的方式？」
- **影响范围**: 插件全部中文界面（panel 面板、status 状态区、background `/docker` 帧、toast、菜单）；深层问题是「中文（English）」括注约定本身 + 服务端英文作业标签流向 UI 的成片泄漏。

### 结束状态

| 对比维度 | 起始 | 结束 |
|:---------|:----|:-----|
| 按钮括注 | 「停止（Do…」溢出 | 纯中文「停止」，约定整体废弃（项目 note 8e0ea65e 记录裁定） |
| 中文 UI 英文泄漏 | Remove 菜单、作业标签、toast、状态行成片泄漏 | SDK 边界显式 `t()` + 派生动词模式，守卫测试钉表（来源：i18n.test.ts 断言清单） |
| 审查质量 | 无门禁 | 三轮 ocr 闭环：9 条→7 条→0 条，`gate: deltas=2/3 verdict=PASS` |
| 测试基线 | 29 pass | 34 pass / 143 expect（来源：`bun test src`，17:2x 实测） |
| 分支 | origin/main = 8229ff5 | fix-down-button-label 4 commits（16:45–17:29），未推送 |

### 关键指标

| 指标 | 数值 |
|------|------|
| 提交数 / 变更规模 | 4 commits；4 + 12 + 11 + 9 文件（来源：`git show --stat`） |
| ocr 审查总投入 | 3 轮共 ~18.7M tokens（7.59M + 7.89M + 3.23M），cache-read 85–87%，合计 ~16.2 分钟（来源：run.log Summary 行） |
| 审查发现 | 首轮 9 条（裁定 6 真 3 驳回）→ 二轮 7 条（全真，归并 5 项）→ 闭环 0 条 |
| 回归 bug 新发现 | 2 个预存在 bug 顺手修复：zh「运行 秒」哨兵失效（stacks.ts:110）、background 帧 locale 冻结（background/main.ts） |

---

## 二、时间线

### 16:30–16:45 — Task 1：Down 括注溢出（eac0896）

**操作**：定位 `src/shared/i18n.ts:34` `'Down': '停止（Down）'` → 改纯「停止」。安全性论证：Down/Stop 互斥出现（`src/status/main.ts:60` `compose ? t('Down') : t('Stop')`）；确认弹窗本就译「停止 X？」；先例 Up/Start 同为「启动」。

**遇到问题**：无。build + tsc + 29 测试全绿后，从 origin/main 切新分支 `fix-down-button-label` 提交。

**教训**：删括注前先证明"英文对照不承载信息"（互斥性 + 弹窗兜底），而不是只看截图顺眼。

### 16:47–17:03 — Task 2：Remove 泄漏引发的系统性清扫（bab700b，12 文件）

**操作**：顺 Remove 泄漏挖出四类根因（详见 §三），补 `src/panel/home.ts` 菜单 `t('Remove…')`、engine/storage/main/status 边界、i18n 新增 RUNNING 动词表 + 派生正则模式、`src/panel/inside.ts:93` 的 `/Not a folder/` 测试改用原始错误消息（原实现测译文，中文下分支永不触发 = locale 行为 bug）。

**尝试方案**：
1. 失败式译文里对 reason 递归 `t(reason)` → ❌ 回退：`"container already started"` 会被 `^(.+) started$` 错译成「容器已经已启动」，reason 是 docker 原始输出必须保持 verbatim；
2. 加运行时"检测英文残留"守卫 → ❌ 否决：中文界面里 Docker/nginx/端口是合法英文，误报率不可控；改用静态守卫测试钉服务端动词表。

**解决**：commit bab700b；bundle 重建并同步已装扩展 `~/.config/openchamber/extensions/docker/{panel,status,background,service}/main.js`。

**教训**：翻译安全网（localizeTree）覆盖不到的地方——SDK 挂载的菜单、iframe 外的 toast、带尾随空格的组合串——就是泄漏的全部来源，按边界修而不是逐词打补丁。

### 17:04–17:11 — 首轮 ocr 审查（8229ff5..bab700b，high，6m56s）

**操作**：`ocr review --from 8229ff5 --to bab700b --background-file brief.md`（brief 写入硬约束：en 行为不变、bundle 是产物、reason 不递归译）。返回 9 条，人工裁定 6 真 3 驳回（`gate: deltas=0/3 findings=H3/M1/L2 verdict=FAIL`）。

**遇到问题**：晨星纠正（m00321）：「关于审查等级，我们没有规范吗？为什么要越级使用呢？」——「严格审查」指 Stage 2 裁定从严，不是升 effort 授权；implementation surface 规范 = medium。

**尝试方案**：在跑的 high 单是否杀掉重派 medium → ❌ 否决：同范围双份支出，跑完单、下轮守规范；教训存 memory `mem_1793437912289_0quzqf767`。

**解决**：按裁定修复 → commit bc89a6f（17:20）。首轮最有价值的裁定是**驳回工具建议**：H1 工具建议"只加裸键"不完整——三个 `Removing …` 会被泛动词式先行截获，必须 prune 专用失败式置于动词式**之前**。

**教训**：审查工具给的是候选不是判决；模式匹配类代码的修复要按截获顺序推演，否则修了个寂寞。

### 17:20–17:27 — 二轮 ocr 审查（bab700b..bc89a6f，medium，6m39s）

**操作**：`--resume` 首轮会话 → ❌ 被拒：resume 校验审查输入指纹，范围不同即拒（`Input fingerprint mismatch`）；改新会话 + brief 自带上下文。返回 7 条，逐条对码验证全部为真、0 误报（C1/C3/C4 同根合并）。

**遇到问题**：二轮抓出两个**预存在** bug（非本分支引入）：zh 下 `stateLine` 子分钟哨兵失效（`span()` 返回本地化 `'秒'`，`up === 'seconds'` 永不命中 → 渲染「运行 秒」）；background 帧 `onReady` 不 `setLocale` → `/docker` chip 与 resolve 错误冻结英文。

**解决**：双哨兵修法跟随库内先例（`format.ts:62` `ago()` 就是 `'seconds' || '秒'`），放弃自造 `isJustStarted()` 新 API 的方案——最小 diff 优先于漂亮抽象。→ commit 9486420（17:29）。

**教训**：守卫测试的松断言（`hasChinese` + `not.toContain(label)`）会被泛捕获模式蒙绿：改名片段 `'Removing dangling images'` 借动词式出中文、不含原 label，全绿但漏英文。防漂移必须精确 `toBe`。

### 17:30–17:32:43 — 闭环 pass（bc89a6f..9486420，medium，2m32s）

**操作**：`ocr review --from bc89a6f --to 9486420`，brief 列出 5 项整改对应 + 已知边界（iframe 推断未实测、chip text 中文单位可接受）防重复报。

**结果**：**0 findings**，`gate: deltas=2/3 verdict=PASS`。工作树干净，4 commits 待推送，已装扩展与 bundle 同步。

**教训**：闭环 pass 的 brief 写"勿重复报告"边界清单，能把第三轮压到 2 分半 / 3.2M tokens（首轮的一半不到）。

---

## 三、问题分级汇总

严重程度分级标准：

| 级别 | 含义 | 颜色 | 处理要求 |
|:----:|:-----|:----:|:---------|
| **P0** | 阻塞性，不解决无法继续 | 🔴 | 必须修复，纳入当前迭代 |
| **P1** | 影响效率或质量，有替代方案 | 🟡 | 排入待办，建议修复 |
| **P2** | 可绕过，信息级记录 | 🟢 | 记录即可，可选修复 |

| 级别 | 问题 | 根因 | 解决 | 未来策略 |
|:----:|:-----|:-----|:-----|:---------|
| 🟡 P1 | prune 失败 toast 漏英文/半翻译（`正在移除 unused images 失败：…`） | 服务端 `PRUNE` 裸标签无词典键 + 泛动词模式先行截获（i18n.ts 模式顺序） | 裸键 ×4 + prune 专用失败式置于动词式之前；守卫测精确 `toBe` | 正则模式表按"特化在前、泛化在后"排布，测试覆盖 `${label} failed:` 组合形态 |
| 🟡 P1 | localizeTree 改写日志/shell 输出（泛捕获式把 `worker started` 吞成半中文） | DOM 安全网无数据节点豁免；本分支新增 7 个泛模式扩大既有伤害面 | dom.ts:71 skip 扩为 `.output, .log-line, .cmd, .out, .exit, pre, code` | 翻译安全网必须有"数据区"黑名单；日志类 UI 一律 verbatim |
| 🟡 P1 | 组合状态行半翻译（`nginx · created, never 已启动`） | `${image} · ${stateLine}` 整串进 `t()`，`^(.+) started$` 贪婪捕获 | 组合点先译后拼（home.ts:123、container.ts:81、chip.ts:45）+ 模式收窄 `^([^·,]+) started$` 二道防线 | 组合串永不过 `t()`；在片段级翻译 |
| 🟡 P1 | zh「运行 秒」（预存在，二轮审查抓出） | `stateLine` 拿本地化输出 `'秒'` 与英文哨兵 `'seconds'` 比较，zh 下子分钟分支不可达 | 双哨兵 `'seconds' || '秒'`（跟随 `ago()` 先例）+ stacks.test.ts 双语钉 | 语言中立判断用数值（elapsed ms）或全哨兵枚举；禁止对本地化字符串做逻辑比较 |
| 🟡 P1 | `/docker` chip 与 resolve 错误冻结英文（预存在） | background 帧 `onReady` 只存 directory，漏 `setLocale(context.locale)`（panel/status 都有） | background/main.ts 补种子 + import | 每个独立渲染帧都要 locale 种子；新增帧时对照 checklist |
| 🟢 P2 | 守卫测试松断言蒙绿洞 | `hasChinese` + `not.toContain(label)` 可被借道泛模式的改名标签同时满足 | PRUNE_ZH 精确 toBe 表，未钉标签直接 throw | 防漂移测试断言"期望值"而非"特征" |
| 🟢 P2 | `Pulling ${clean}` 等表外裸字面量守卫扫不到 | actions.ts 三处模板串不在动词表内 | export `PULL_LABEL` 供测试 import（Removing/Starting 与表同串已覆盖） | 服务端流向 UI 的字面量必须出自可导出的表 |
| 🟢 P2 | 派生交替式未转义正则元字符 | `Object.keys(RUNNING).join('|')` 直插 `new RegExp` | `escapeAlt` map 后再 join | 由数据生成的正则一律转义交替项 |
| 🟢 P2 | 组合点改动一度漏 `import { t }`（提交前自查发现） | home/container/chip 三处同步改，import 只加在两个文件 | 补 chip.ts import，tsc rc=0 后提交 | 改完即跑 tsc，不攒批 |
| 🟢 P2 | ocr `--resume` 跨范围被拒 | resume 校验审查输入指纹（`Input fingerprint mismatch`） | 新会话 + brief 自带上下文 | 复审永远新会话，brief 承担上下文传递 |
| 🟢 P2 | minified bundle 验证 grep 函数名 0 命中误判"修复未进 bundle" | 函数名被 mangle | 改 grep 字符串字面量与调用形状（`{qe=e.directory,Qt(e.locale)}`）；中文串双向核 | bundle 验证只 grep 不可 mangle 之物：字面量、属性名 |

---

## 四、策略沉淀

### 4.1 i18n 泄漏按"边界"修，不按"词"修

**问题上下文**：中文界面零星出现英文（菜单项、toast、状态行），逐词补译文永远补不完。

**完整方案**：先给翻译管线画边界图——本插件 = 英文源串 → `t()`（精确词典 + 正则模式）→ `localizeTree` DOM 安全网。泄漏只可能来自安全网够不着的三类出口：

```
1. SDK 挂载点（mountMenu 菜单项点击时才创建、host.toast 渲染在 iframe 外）→ 创建处显式 t()
2. 组合串（`${image} · ${stateLine}`、`${meta.label} ` 尾随空格）→ 片段级先译后拼，整串不过 t()
3. 服务端英文流向 UI（job label、doneMessage）→ 动词表 + 派生模式，源头字面量 export 成表供守卫
```

**验证数据**：bab700b→9486420 三轮共 16 条发现全部按此三类归位修复，闭环 0 findings。

**适用条件**：任何"运行时后处理翻译"架构（DOM 扫描、proxy 包裹、monkey-patch 渲染）。

**反例/边界**：编译期 i18n（如 react-intl 消息目录）无安全网盲区问题，不适用第 1 类。

### 4.2 守卫测试钉"数据表"而非"现象"

**问题上下文**：词典 + 模式表是手工维护的，新增服务端动词忘了配译文会静默漏英文。

**完整方案**：

```ts
// i18n.test.ts：从源头 import 动词表，逐一生成了中文断言
for (const verb of [...Object.keys(PRESENT), ...Object.keys(STACK_PRESENT), PULL_LABEL]) {
  const out = t(`${verb} web…`);
  expect(out, verb).toMatch(/[\u4e00-\u9fff]/);   // 出中文
  expect(out, verb).not.toContain(verb);           // 不吃英文原文
}
// 松断言会被泛模式借道蒙绿 → 高风险表用精确值钉死
const PRUNE_ZH: Record<string, [running: string, failed: string]> = {
  'Removing unused images': ['正在移除未使用的镜像…', '移除未使用的镜像 失败：exit 1'], …
};
if (!expected) throw new Error(`prune label "${label}" needs an exact pin in i18n.test.ts`);
```

**验证数据**：34 pass / 143 expect；二轮审查 C2 指出松断言蒙绿洞后当场收紧，未再复发（来源：review.txt 17:27 + 9486420）。

**适用条件**：任何"表 + 派生行为"结构（动词表、路由白名单、错误码文案表）。

**反例/边界**：对纯展示文案做精确 toBe 会把翻译措辞变更也判红——展示串用特征断言，**协议/防漂移串用精确断言**。

### 4.3 审查闭环：findings → 裁定 → delta → 再 pass，每 delta 一轮

**问题上下文**：AI 写的大 diff（本例 4 commit / 36 文件次）直接合并风险高，但无限复审会失控。

**完整方案**：
1. 审查范围 = 上一轮裁定后的**新 delta**（`--from <上轮修复 commit> --to HEAD`），不重审已审面；
2. brief 必含：硬约束清单 + 整改对应表 + 「已知边界勿重复报」；
3. 工具发现 ≠ 判决：逐条对码验证（本次两轮共 16 条，首轮驳回 3 条误报/不完整建议，二轮 0 误报）；
4. 门规：最多 3 个 delta，每个 delta 配一轮 pass；收口报告写 `gate: deltas=N/3 findings=… verdict=…`；
5. effort 按 surface 规范定（implementation = medium），「严格审查」是裁定态度不是参数授权。

**验证数据**：3 轮 18.7M tokens（cache-read 85–87%）、16.2 分钟，H3→0 收敛；第三轮 2m32s 即净（来源：三个 run.log Summary 行）。

**适用条件**：≥10 文件或含正则/状态机的 diff。

**反例/边界**：`--resume` 不能换范围（指纹校验）；文档级小 diff 不必走满闭环。

### 4.4 minified bundle 验证法

**问题上下文**：构建产物入库（本仓库 bundle 随 commit），要证明"src 修复确实进了 bundle"，grep 函数名 0 命中导致误判。

**完整方案**：只 grep 不可 mangle 之物——字符串字面量与调用形状：

```bash
grep -oE '"seconds".{0,14}' background/main.js   # → "seconds"||r==="秒")return"just started"
grep -oE '.{0,20}\.locale.{0,20}' background/main.js  # → {qe=e.directory,Qt(e.locale)}
grep -c "运行 秒" panel/main.js status/main.js background/main.js  # 双向核：旧症状 0 命中
```

辅证：重跑 `bun run build` 后 `git status --porcelain` 为空 = bundle 与 src 完全同步。

**验证数据**：9486420 提交前 3 bundle 双向核实通过。

**适用条件**：任何"构建产物入库 + 需要免跑验证"的场景。

**反例/边界**：属性名也可能被 mangle（对象字面量 key 保留，局部函数名不保留）；别拿 `grep setLocale` 下结论。

---

## 五、待优化项 / 后续跟进

| 优先级 | 事项 | 工作量 | 收益 | 状态 |
|:------:|:-----|:-----:|:----:|:----:|
| P0 | 推送 `fix-down-button-label` 到 origin（fork）；关闭上游 PR 并留言转 fork 自维护 | 2 分钟 | 分支落地，他人可见 | ⬜ 待办（等晨星指令，推送/关 PR 均为外发操作） |
| P1 | 真机目验：重载 OpenChamber 看状态区按钮、Remove 菜单、prune toast、`/docker` chip 实际渲染 | 5 分钟 | 「菜单/toast 在 iframe 外」目前仅代码推断，未实测宿主行为 | ⬜ 待办 |
| P2 | docker 术语 tooltip：面板按钮 title 放英文原词（状态区 SDK control 不支持 title） | 0.5 小时 | 纯中文不丢术语可查性 | ⬜ 待办（可选） |
| P2 | 后续大 diff 复审沿用「delta 范围 + 边界清单 brief」，闭环 pass 已证明可压到 3 分钟内 | — | 审查成本减半 | ✅ 已固化为本仓库流程（见 §4.3） |

---

## 六、配套产出

| 产出 | 路径 | 说明 |
|:-----|:-----|:-----|
| 整改分支 | `fix-down-button-label`（4 commits：eac0896 → bab700b → bc89a6f → 9486420，base origin/main=8229ff5） | i18n 全链路修复，未推送 |
| 首轮审查包 | `/tmp/opencode/ocr-runs/ocdocker-zh-8229ff5-bab700b-20261031/`（brief.md + review.json，17:04–17:11） | high effort，9 条发现（文本格式非 JSON） |
| 二轮审查包 | `/tmp/opencode/ocr-runs/ocdocker-zh-bab700b-bc89a6f-20261031/`（brief/review/run.log） | medium，7 条发现，session 0eac3523 |
| 闭环审查包 | `/tmp/opencode/ocr-runs/ocdocker-zh-bc89a6f-9486420-20261031/`（同上） | medium，0 findings，session 3425a5c0 |
| 新增测试 | `src/shared/stacks.test.ts`；`src/shared/i18n.test.ts` 守卫段 | 双语子分钟钉 + PRUNE_ZH 精确表 + 括注/undefined 守卫 |
| 已装扩展 | `~/.config/openchamber/extensions/docker/{panel,status,background,service}/main.js` | 与 9486420 bundle 同步，重载即生效 |
| 项目 note | OpenChamber note `8e0ea65e`「docker 插件中文文案约定」 | 括注废弃裁定 + 泄漏根因分类 + 防漂移机制 |
| memory | `mem_1793437912289_0quzqf767` | 审查 effort 规范教训（严格审查 ≠ 越级授权） |
