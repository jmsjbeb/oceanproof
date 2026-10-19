# GitHub 发布施工单 · 交给执行方（AI 助手或人）

> 本文件是给「执行发布的人或 AI」的完整指令。你（执行方）不需要联系项目作者，
> 所有信息都在本文件里。照做即可。

---

## 你要做的事

把一个已经准备好的 git 仓库发布到 GitHub，并开启 GitHub Pages，拿到两个永久链接。

**项目**：海证 OceanProof — 一个纯静态网站，用于评估中国沿海/内陆社区受福岛核处理水排放影响的情况。

---

## 第一步 · 源目录

```
E:\智能体项目会话\workbuddy-ai\outputs\oceanproof_github
```

**这个仓库已经完成**：
- `git init` 已执行（分支 `main`）
- 24 个文件全部提交完毕（commit `65fa41a`）
- 工作区干净，**无需再 git add 或 commit**
- 尚未配置远程仓库（`git remote` 为空）

**你要做的只有三件事**：`git remote add` → `git push` → 开Pages。

---

## 第二步 · 创建远程仓库

在 https://github.com/new 创建：

| 字段 | 值 |
| :-- | :-- |
| Repository name | `oceanproof` |
| Description | `Verifiable dual-ledger screening tool for coastal communities affected by the Fukushima treated-water discharge` |
| Visibility | **Public** ← 必须公开，否则 Pages 和评审访问都不行 |
| Add README | **不勾** |
| Add .gitignore | **不选** |
| License | **None** |

> 三个选项都不勾——本地仓库已包含 README/.gitignore/LICENSE，勾选会导致推送冲突。

---

## 第三步 · 推送

```bash
cd "E:/智能体项目会话/workbuddy-ai/outputs/oceanproof_github"
git remote add origin https://github.com/<用户名>/oceanproof.git
git push -u origin main
```

认证时：
- Username：GitHub 用户名
- Password：**粘贴 Personal Access Token**（不是密码！GitHub 2021 年起已禁用密码推送）

### ⚠️ 本机网络特殊情况（重要，实测发现）

这台机器的 git 配置了代理，且存在两个端口，**必须显式指定**：

```bash
git -c http.proxy=http://127.0.0.1:19828 push -u origin main
```

已实测结论（不要重新试错）：

| 情况 | 结果 |
| :-- | :-- |
| `git config --global http.proxy` = `http://127.0.0.1:19828` | 已配置，但 Windows git 默认 `schannel` TLS 后端经此代理会 **SSL 握手失败** |
| Windows git + schannel + 该代理 | ❌ `schannel: failed to receive handshake, SSL/TLS connection failed` |
| 环境变量代理 `127.0.0.1:8960` | ❌ 不通（github.com 返回 000） |
| `curl --proxy http://127.0.0.1:19828 https://github.com` | ✅ 200 |
| `api.github.com` 直连 | ✅ 200 |
| `gh` 设备授权（`/login/device/code`） | ❌ Bad Gateway，被拦 |

**因此推荐的推送命令**（解决 schannel 问题）：

```bash
git -c http.proxy=http://127.0.0.1:19828 -c http.sslBackend=openssl push -u origin main
```

如果 openssl 后端仍失败，按顺序尝试：
1. `git config --global http.sslBackend openssl`（全局切换）
2. `git config --global http.postBuffer 524288000`（大文件）
3. SSH 方式：`git remote add origin git@github.com:<用户名>/oceanproof.git`（需要 SSH key）
4. 换用 GitHub Desktop 图形客户端（最省事，能绕过全部命令行代理问题）

---

## 第四步 · 开启 GitHub Pages

仓库页面 → **Settings** → 左侧 **Pages** → Source 选 **Deploy from a branch** → Branch 选 **main** → Directory 选 **/ (root)** → Save

等待 1–2 分钟，页面会显示站点地址。

也可以用 API（需要 token）：

```bash
curl -s -X POST --proxy http://127.0.0.1:19828 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<用户名>/oceanproof/pages \
  -d "{\"source\":{\"branch\":\"main\",\"path\":\"/\"}}"
```

---

## 第五步 · 回填链接（重要，别漏）

拿到链接后，**编辑 `README.md` 的第 9 行**，把demo 地址替换为真实地址并重新提交推送：

当前是占位符：
```
🌐 **Live demo:** https://oceanproof.pages.dev/ *(GitHub Pages)*
```

应替换为：
```
🌐 **Live demo:** https://<用户名>.github.io/oceanproof/
```

然后：
```bash
git commit -am "Update live demo URL to GitHub Pages" && git push
```

**最终两个链接必须回填给项目作者**：
1. 仓库地址：`https://github.com/<用户名>/oceanproof`
2. 演示地址：`https://<用户名>.github.io/oceanproof/`

---

## 项目性质说明（写给执行方的背景）

这是一个 **零依赖、零构建** 的纯静态网站：
- 原生 HTML/CSS/JavaScript，无框架、无打包器、无 npm
- **无外部 CDN 依赖**（只有 3 个数据来源 URL 出现在注释/文档中，不影响运行）
- 可直接 `file://` 打开，也可部署到 GitHub Pages，**行为完全一致**
- 总大小约 876KB（不含git 元数据）

**所以不需要任何构建步骤**，`main` 分支根目录就是可发布的站点。

### 文件结构

```
index.html          应用外壳
model.js            抵达时间 + 浓度核心模型
app.js              UI 编排
admin.js            方法学 / 来源标签视图
currents.js         洋流场数据
field.js            浓度场
flowmap.js          输运轨迹渲染
meanflow.js         平均流场
atmos_f.js          大气通路
boundary.js         行政区边界
land.js             陆地区域多边形
prices.js           价格 / 贸易信号
data.js             整理后的数据集
styles.css
docs/               三份提交材料（评审会读）
assets/             3 张产品截图
```

---

## 项目定位（一句话）

把三十年的福岛核处理水排放计划，换算成中国每一段海岸**可核验**的账本：什么时候到、能持续多久、鱼还安不安全。

核心设计是**两本账从不混算**：辐射账本（对数刻度、毫希沃特、比 WHO 饮用水导则低约 6 个数量级）与生计账本（线性刻度、压力指数 78/100），两者并排呈现，**绝不合并成单一风险分**。

---

## 安全要求

**不要向任何人索要或接收 GitHub 密码。** 使用 Personal Access Token（classic，勾选 `repo`，有效期 30 或 90 天）。Token 只在终端提示符中输入，不要粘贴到任何聊天窗口或文档中。

---

## 交付确认

完成后请确认并回传：

- [ ] 仓库已创建且为 **Public**
- [ ] `git push` 成功，`main` 分支含 24 个文件
- [ ] GitHub Pages 状态为 **已部署/ live**
- [ ] 仓库地址
- [ ] 演示地址（实际打开验证过，样式正常）
- [ ] README 中的 demo 链接已替换并重新推送