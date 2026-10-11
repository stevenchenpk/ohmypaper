# 国内镜像部署指南（未启用）

目的：让中国大陆用户更稳定地打开 ohmypaper。GitHub Pages（`*.github.io`）在国内时好时坏，所以准备两条路径。本文档对应的配置都已写好但**默认不生效**，账号和域名需要负责人本人注册。

## 结论速览

| | 路径 1：Cloudflare Pages + 自有域名 | 路径 2：ICP 备案 + 国内 CDN |
|---|---|---|
| 能否马上用 | 能，当天 | 需 1–3 周备案（待核实，各省管局不同） |
| 需要备案 | 不需要（服务器在境外） | 必须 |
| 国内访问质量 | 一般，不保证（待核实，需在国内实测） | 最好 |
| 费用 | Pages 有免费额度，域名另买，以官网为准 | 域名、云产品费用以官网为准 |

建议：先做路径 1 立刻可用，同时启动路径 2，备案通过后切换。

## 一、路径 1：Cloudflare Pages（无需备案）

仓库里的 `.github/workflows/mirror-cloudflare.yml` 在每次推送 `main` 时自动部署 `dist`。未配置下面的密钥时，该工作流会输出“未配置，跳过”，不会失败，也不影响 GitHub Pages。

1. 注册 Cloudflare 账号（https://dash.cloudflare.com ），验证邮箱。
2. 左侧 Workers & Pages，创建 Pages 项目，选“Direct Upload（直接上传）”，项目名例如 `ohmypaper`（随便取，记住它）。首次可随便上传一个文件占位。（界面文案以官网为准，待核实）
3. 在右上角头像，My Profile，API Tokens，Create Token，自定义权限只给 **Account / Cloudflare Pages / Edit**，其余都不要。保存生成的 Token（只显示一次）。
4. 在 Cloudflare 控制台首页或任一 Pages 页面右侧找到 **Account ID**。
5. 在 GitHub 仓库 Settings，Secrets and variables，Actions 里添加（名称必须完全一致）：
   - Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
   - Variables：`CF_PAGES_PROJECT`（值为第 2 步的项目名）
6. 在 Actions 页手动运行 “Mirror to Cloudflare Pages”，成功后得到 `https://<项目名>.pages.dev`。
7. 买域名（任意注册商均可，价格以官网为准），在 Pages 项目的 Custom domains 里绑定。域名 DNS 托管到 Cloudflare 最省事；DNS 记录由 Cloudflare 提示生成。HTTPS 证书自动签发。

注意：`*.pages.dev` 在国内可达性不稳定，甚至可能被干扰，**不要把它作为对外地址**，务必用自有域名。自有域名在国内的速度同样需要实测（待核实）。
如果将来想关闭：删掉上述任一密钥/变量即可。

## 二、路径 2：ICP 备案 + 国内 CDN

### 备案前提
- 一个域名，注册商需是国内服务商，或将域名转入国内注册商（待核实：部分云厂商接受境外域名，需按其要求）。
- 域名所有者完成实名认证，域名信息需与备案主体一致。
- 一个国内云产品作为备案对象（如腾讯云或阿里云的服务器/对象存储等，具体哪些产品可以申请备案以厂商官网为准，待核实）。备案由所购云厂商代为提交到各省通信管理局。
- 材料：身份证（个人）或营业执照（企业）、负责人手机号和人脸核验、网站名称与简介等。
- 周期：通常约 1–3 周，视省份而定（待核实）。管局审核前一般有云厂商初审。

### 个人还是企业
- 个人备案：材料简单，网站名称、内容限制较多，不能写带商业含义的名称。适合现阶段的公益工具。
- 企业备案：可以由设计公司主体来备，但本站是公益、非商业项目，主体与实际运营者不一致、网站内容与企业经营范围无关时，审核可能追问（待核实）。一般建议个人名义备案，除非要以公司品牌长期运营。
- 备案通过后，需把备案号放在网站页脚（需改 `index.html` 页脚，这属于展示内容，到时单独处理），并完成公安联网备案（待核实具体时限和要求）。

### 备案通过后，我们这边要改什么
1. 在腾讯云 COS 或阿里云 OSS 创建存储桶（公共读），开通 CDN，绑定已备案域名，配置 HTTPS 证书（云厂商可申请免费证书，条件以官网为准）。
2. 新增一个工作流：构建后用对应命令行工具（腾讯云 `coscli`，阿里云 `ossutil`）把 `dist/` 同步上传，并刷新 CDN 缓存。需要新增 GitHub Secrets：访问密钥 ID/Secret、桶名、地域（使用权限最小的子账号密钥）。该工作流在备案完成后再写，目前没有。
3. 域名 CNAME 指向 CDN；原 Cloudflare 路径可保留作为备份。

## 三、离线版

`npm run build:offline` 生成 `dist-offline/ohmypaper-offline.html`（约 23 KB，单文件，双击即可用）。可通过微信、网盘分发给无法访问镜像的同学。核验文献仍需联网（见下）。该文件不入库（已在 `.gitignore`）。

## 四、国内可用性审计

静态页面本身没有境外依赖：无外部字体（系统中文字体栈）、无 CDN 脚本、无 Google 服务、无统计脚本、无 GitHub 托管的运行时资源。构建产物仅 1 个 JS、1 个 CSS。

运行时需要访问的境外接口，**需在国内网络实测（待核实）**，若被屏蔽或很慢，核验功能会失败：
- `https://api.crossref.org`
- `https://api.openalex.org`
- `https://api.datacite.org`

页面中的普通链接（用户点击才访问，不影响加载）：doi.org、crossref.org、openalex.org、GitHub、worldcat.org，以及国内的知网、万方、百度学术、国家图书馆。

若上述接口在国内不通，后续可考虑一个境外/境内的转发代理（需要改应用逻辑，不属于本次范围）。
