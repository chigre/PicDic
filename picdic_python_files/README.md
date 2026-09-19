# PicDic Builder

将扫描版词典的页码/词条索引转换为 **PicDic 图片索引、PicOnly 整页入口词典，以及可直接导入 GoldenDict Android / MDict Android 的宿主词典资源**。

当前 Builder 已不再只是把 `词典_index.txt` 转成 `词典_index.js`。它现在负责从一份原始索引同时完成：

- 生成 PicDic 页面/词条索引 `*_index.js`
- 生成 PicDic 入口 DSL
- 生成并更新 `PicDic_dictionary_list.js` 所需信息
- 生成新版 PicOnly 外部配置 `*_config.js`
- 生成 MDict 转换前入口文本
- 生成 GoldenDict / StarDict 转换前入口文本
- **可直接生成 StarDict `.ifo / .idx / .dict(.dz)`**
- StarDict 文件名自动加入语言对，例如 `.es-zh`、`.en-zh`、`.zh-zh`
- 可选将 `.dict` 直接压缩为 `.dict.dz`
- 中文繁体词典可自动生成简体宿主入口，同时保持 PicDic 内部真实繁体索引不变
- 简体入口采用 **OpenCC 短语优先 + 字级补充**
- 支持新版 **PicOnly 整页词典**：词条本身只承担“让宿主 APP 命中并把真实词头交给 PicDic”的作用，不再为每个词条重复创建一套 PicDic UI

---

## 1. 基本用法

把以下文件放在同一工作目录：

```text
__build_picdic.py
__build_picdic_config.txt
PicDic_dictionary_list.js        # 可选；存在时自动更新
词典名_index.txt
```

进入 CMD / Terminal，执行：

```bash
python __build_picdic.py
```

默认读取：

```text
__build_picdic_config.txt
```

也可以指定其他配置文件：

```bash
python __build_picdic.py --config PicDic_ES-ZH_MyDict_config.txt
```

或：

```bash
python __build_picdic.py -c PicDic_ES-ZH_MyDict_config.txt
```

程序会在 `__build_picdic.py` 所在目录下自动创建：

```text
<DICT_FILE_NAME>/
```

并把该词典的生成文件放入其中。

---

## 2. 可选依赖：直接生成 StarDict

如果只需要生成 `*_for_Stardict.txt`，不需要额外安装 PyGlossary。

如果希望 Builder 直接生成：

```text
.ifo
.idx
.dict
```

或：

```text
.ifo
.idx
.dict.dz
```

请先安装：

```bash
pip install -U pyglossary xxhash
```

然后在配置中启用：

```ini
GENERATE_STARDICT = 1
```

StarDict 写入沿用 `mdxtogd v2.11` 的 PyGlossary `Tabfile -> Stardict` 方式，PicDic 入口 HTML 使用：

```text
sametypesequence=h
```

因此 GoldenDict 可直接把词条内容作为 HTML 渲染。

---

## 3. Builder 会生成什么

假设配置为：

```ini
DICT_FILE_NAME = PicDic_ES-ZH_NEraGDEC
INDEX_LANGUAGE = spa
CONTENTS_LANGUAGE = zho
GENERATE_MDX = 1
GENERATE_STARDICT = 1
STARDICT_COMPRESS_DICT = 1
```

输出目录大致为：

```text
PicDic_ES-ZH_NEraGDEC/
├── PicDic_ES-ZH_NEraGDEC.dsl
├── PicDic_ES-ZH_NEraGDEC_index.js
├── PicDic_ES-ZH_NEraGDEC_config.js
│
├── PicDic_ES-ZH_NEraGDEC_for_Mdict.txt
├── PicDic_ES-ZH_NEraGDEC.es-zh_for_Stardict.txt
│
├── PicDic_ES-ZH_NEraGDEC.es-zh.ifo
├── PicDic_ES-ZH_NEraGDEC.es-zh.idx
└── PicDic_ES-ZH_NEraGDEC.es-zh.dict.dz
```

另外，扫描词典本身仍需自行准备：

```text
PicDic_ES-ZH_NEraGDEC.bmp
PicDic_ES-ZH_NEraGDEC.dsl.files.zip
```

如果脚本目录中存在：

```text
PicDic_dictionary_list.js
```

Builder 会自动更新其中对应词典条目，并按词典 ID 排序。

如果该文件不存在，Builder 会跳过自动更新，并在命令行输出应加入的词典信息，供手动复制。

---

## 4. 推荐配置文件

当前版本的 `__build_picdic_config.txt` 示例：

```ini
# ================================================================
# PicDic 扫描版图片词典 Builder
# ================================================================

# 【PicDic 内部词典 ID】
# 建议与 DICT_FILE_NAME 相同；必须与 PicDic_dictionary_list.js 中的键一致。
DICT_ID = PicDic_ZH-ZH_SanMinDCD

# 【词典文件名】
# 对应：
#   <DICT_FILE_NAME>.dsl
#   <DICT_FILE_NAME>.dsl.files.zip
#   <DICT_FILE_NAME>_index.js
#   输出文件夹名
DICT_FILE_NAME = PicDic_ZH-ZH_SanMinDCD

# 【词典显示名称】
DICT_NAME = 三民書局大辭典增訂版

# 【索引语言】
# 推荐 ISO 639-3，如：zho / eng / spa / por / fra / deu / ita / jpn / kor
INDEX_LANGUAGE = zho

# 【内容语言】
CONTENTS_LANGUAGE = zho

# 【词典栏数】
COLUMN_NUM = 3

# 【原始索引文件】
INDEX_FILE = PicDic_ZH-ZH_SanMinDCD_index.txt

# 【是否保留详细坐标】
# 1 = _index.js 保存 page + column + y + ord，可自动定位/高亮
# 0 = _index.js 只保存页码信息
WITH_COORDINATES = 1

# 【是否生成宿主词典转换前文本】
# 1 = 生成并保留：
#     *_for_Mdict.txt
#     *.<语言对>_for_Stardict.txt
# 0 = 不作为普通输出保留；但 GENERATE_STARDICT=1 时仍会生成 StarDict 所需文本
GENERATE_MDX = 1

# 【是否直接生成 StarDict】
# 1 = 直接生成 .ifo / .idx / .dict(.dz)
# 0 = 只生成转换前文本
GENERATE_STARDICT = 1

# 【是否压缩 StarDict .dict】
# 1 = 生成 .dict.dz
# 0 = 保留 .dict
STARDICT_COMPRESS_DICT = 1

# 【中文繁体索引是否生成简体宿主入口】
# auto = INDEX_LANGUAGE 为中文时自动启用
# 1    = 强制启用
# 0    = 关闭
GENERATE_SIMPLIFIED_ALIASES = auto

# 【单个真实词头最多生成多少个简体入口候选】
SIMPLIFIED_ALIAS_MAX_PER_WORD = 16

# 【OpenCC 短语优先】
# 1 = TSPhrases 最长短语匹配优先，再用字级转换补充
# 0 = 只用字级映射
OPENCC_PHRASE_FIRST_ALIASES = 1

# 【OpenCC TSPhrases 本地缓存】
OPENCC_TSPHRASES_FILE = opencc_data/TSPhrases.txt

# 【缺少 TSPhrases 时是否自动下载】
# 1 = 自动下载并缓存
# 0 = 不联网；缺失时退回字级模式
OPENCC_AUTO_DOWNLOAD_DATA = 1

# 【词条壳模式】
# picOnly    = 新版纯整页 PicDic，推荐
# standalone = 旧版每条词条内嵌完整 PicDic UI，仅兼容用
ENTRY_MODE = picOnly

# 【PicOnly 是否自动显示当前结果页最靠前的 PicDic 词典】
AUTO_ACTIVATE_PICONLY = 1

# 【PicDic 容器 ID】
# 可沿用旧词典 ISBN_xxxx，例如：
# CONTAINER_ID = ISBN_9787100028851
# 留空则使用 data-picdic-container，不写固定 id。
CONTAINER_ID =

# 【GoldenDict Android 的 PicDic 公共目录】
PICDIC_BASE_GOLDENDICT = file:///sdcard/GoldenDict/PicDic/

# 【共享 Controller 文件名】
CONTROLLER_FILE = PicDic_DictionaryController.js

# 【正文开始 / 结束标记】
BODY_START_MARKER = 正文开始
BODY_END_MARKER = 正文结束

# 【字段分隔符】
# 默认 Tab，一般不要修改
SEPARATOR = \t

# 【原始索引所在目录】
# 留空 = __build_picdic.py 所在目录
# 也可填写绝对路径或相对脚本目录的路径
INDEX_DIR =
```

---

## 5. 各配置项说明

### `DICT_ID`

PicDic 内部词典 ID。

它用于：

```text
PicDic_dictionary_list.js
PicDic runtime 当前词典识别
PicDic_DictionaryController.js 切换词典
```

一般建议：

```ini
DICT_ID = DICT_FILE_NAME
```

如果留空，程序会自动使用 `DICT_FILE_NAME`。

---

### `DICT_FILE_NAME`

词典的物理文件名和输出目录名。

例如：

```ini
DICT_FILE_NAME = PicDic_ES-ZH_NEraGDEC
```

对应：

```text
PicDic_ES-ZH_NEraGDEC/
PicDic_ES-ZH_NEraGDEC.dsl
PicDic_ES-ZH_NEraGDEC_index.js
PicDic_ES-ZH_NEraGDEC_config.js
```

不要把它与 `DICT_NAME` 混淆。

---

### `DICT_NAME`

用户在 PicDic / StarDict 中看到的词典显示名称。

StarDict 即使文件名为：

```text
PicDic_ES-ZH_NEraGDEC.es-zh.ifo
```

`.ifo` 内仍保持：

```text
bookname=<DICT_NAME>
```

语言对后缀只用于文件名，不会添加到显示名称。

---

### `INDEX_LANGUAGE` / `CONTENTS_LANGUAGE`

分别表示：

```text
INDEX_LANGUAGE     = 词头语言
CONTENTS_LANGUAGE  = 释义/内容语言
```

推荐使用 ISO 639-3：

```text
eng  英语
zho  中文
spa  西班牙语
por  葡萄牙语
fra  法语
deu  德语
ita  意大利语
jpn  日语
kor  韩语
rus  俄语
```

Builder 会尽可能映射为 ISO 639-1，用于 StarDict 文件名：

```text
spa + zho -> .es-zh
eng + zho -> .en-zh
por + zho -> .pt-zh
zho + zho -> .zh-zh
```

例如：

```text
PicDic_ES-ZH_NEraGDEC.es-zh.ifo
PicDic_ES-ZH_NEraGDEC.es-zh.idx
PicDic_ES-ZH_NEraGDEC.es-zh.dict.dz
```

如果某个语言代码无法可靠映射为 ISO 639-1，Builder 会保留原词典文件名，不强行猜测语言对。

---

### `COLUMN_NUM`

扫描页面栏数。

例如：

```ini
COLUMN_NUM = 2
```

或：

```ini
COLUMN_NUM = 3
```

当原始索引包含 `X / Y` 坐标时，Builder 会根据 X 自动推导词条所在栏，并写入 `_index.js`。

---

### `WITH_COORDINATES`

控制最终 `*_index.js` 是否保留详细坐标。

```ini
WITH_COORDINATES = 1
```

生成类似：

```json
{
  "pg": "0001",
  "col": 2,
  "y": 116.97,
  "ord": 3
}
```

可用于：

- 自动定位到页面对应栏
- 自动放大
- 目标词条高亮
- 同页多次出现时保持顺序

如果设为：

```ini
WITH_COORDINATES = 0
```

仍然可以生成整页 PicDic，只是不保存详细定位坐标。

注意：Builder 会自动检测原索引是否真正含坐标；`WITH_COORDINATES=1` 不能凭空为无坐标索引生成坐标。

---

### `GENERATE_MDX`

这是为兼容旧版本保留的配置名，目前含义实际是：

> 是否生成并保留 MDict / StarDict 的“宿主入口转换前文本”。

开启：

```ini
GENERATE_MDX = 1
```

会生成：

```text
<DICT_FILE_NAME>_for_Mdict.txt
<DICT_FILE_NAME>.<语言对>_for_Stardict.txt
```

推荐保持开启，方便：

- 人工检查生成词头
- 检查 HTML 入口
- 二次使用 MDict Builder / PyGlossary
- 排查宿主词典命中问题

---

### `GENERATE_STARDICT`

是否直接生成 StarDict。

```ini
GENERATE_STARDICT = 1
```

生成：

```text
.ifo
.idx
.dict 或 .dict.dz
```

关闭：

```ini
GENERATE_STARDICT = 0
```

则只生成转换前文本，可自行使用其他工具转换。

即使：

```ini
GENERATE_MDX = 0
GENERATE_STARDICT = 1
```

Builder 仍会在内部生成 StarDict 所需的转换前文本后再完成转换。

---

### `STARDICT_COMPRESS_DICT`

```ini
STARDICT_COMPRESS_DICT = 1
```

最终生成：

```text
.dict.dz
```

推荐用于 GoldenDict。

如果：

```ini
STARDICT_COMPRESS_DICT = 0
```

则最终保留：

```text
.dict
```

Builder 会清理同 basename 上一次构建留下的另一种 `.dict / .dict.dz`，避免两个版本混在一起。

---

## 6. 中文繁体词典：生成简体宿主入口

这是新版 Builder 的一个重要功能。

很多繁体扫描词典的真实索引是：

```text
法師
頭髮
發
髮
乾隆
```

但 GoldenDict 用户常直接输入：

```text
法师
头发
发
干隆
```

如果 StarDict 主词典只有繁体词头，宿主 APP 可能根本不会打开这本 PicDic。

Builder 因此可以给“宿主入口词典”额外生成简体别名，但 **绝不会改写 PicDic 内部真实索引**。

例如：

```text
宿主词头：法师
PicDic_SearchWord：法師
```

生成的 StarDict 入口 HTML 类似：

```html
法师	<div class="PicDic-container PicDic-pic-only" ...>
<PicDic_SearchWord style="display:none!important">法師</PicDic_SearchWord>
</div>...
```

因此运行流程变成：

```text
GoldenDict 搜索“法师”
        ↓
StarDict 简体入口命中
        ↓
PicDic_SearchWord 交给 PicDic：法師
        ↓
PicDic exact hot lookup：法師
        ↓
直接显示对应扫描页
```

宿主入口负责“让 APP 找到词典”；PicDic 仍使用原书的真实词头查图片。

---

## 7. 为什么采用“OpenCC 短语优先 + 字级补充”

如果只逐字繁转简，容易产生不自然甚至错误的查询入口。

例如：

```text
乾隆
```

不能简单变成：

```text
干隆
```

因此推荐：

```ini
OPENCC_PHRASE_FIRST_ALIASES = 1
```

处理顺序：

```text
繁体真实词头
↓
OpenCC TSPhrases 最长短语匹配
↓
命中的短语优先采用短语结果
↓
未命中的片段再做字级补充
↓
生成宿主简体入口
```

例如：

```text
計畫 -> 计划
乾隆 -> 乾隆
瞭解 -> 了解
頭髮 -> 头发
```

少数一对多关系也会保留宿主查询能力。例如：

```text
發 -> 发
髮 -> 发
```

最终一个宿主词头 `发` 可以包含多个：

```html
<PicDic_SearchWord>發</PicDic_SearchWord>
<PicDic_SearchWord>髮</PicDic_SearchWord>
```

进入 PicDic 后再做少量 exact lookup，不需要重新跑复杂中文搜索。

---

## 8. PicOnly：整页扫描词典入口模式

新版推荐：

```ini
ENTRY_MODE = picOnly
```

PicOnly 的宿主词条本身不再内嵌完整 PicDic UI。

每个词条只生成：

```text
PicDic 容器
+ PicDic_SearchWord
+ <DICT_FILE_NAME>_config.js
+ PicDic_DictionaryController.js
```

例如 GoldenDict：

```html
<div class="PicDic-container PicDic-pic-only"
     data-picdic-container="PicDic_ZH-ZH_SanMinDCD"
     data-picdic-dict-id="PicDic_ZH-ZH_SanMinDCD"
     data-picdic-mode="picOnly">
    <PicDic_SearchWord style="display:none!important">法師</PicDic_SearchWord>
</div>
<script src="file:///sdcard/GoldenDict/PicDic/PicDic_ZH-ZH_SanMinDCD/PicDic_ZH-ZH_SanMinDCD_config.js"></script>
<script src="file:///sdcard/GoldenDict/PicDic/PicDic_DictionaryController.js"></script>
```

MDict 则使用 MDD 内相对资源：

```html
<script src="PicDic_ZH-ZH_SanMinDCD_config.js"></script>
<script src="PicDic_DictionaryController.js"></script>
```

不写 Android 文件系统绝对路径。

---

## 9. 为什么 PicOnly 更适合纯扫描版词典

对于没有文字正文、没有逐词切图，只有整页扫描图的词典，旧模式如果每个 StarDict 词条都内嵌一套 PicDic UI，会造成：

- 重复 DOM
- 重复 JS / CSS 初始化
- 多本文典同时命中时冲突
- 页面体积增大
- 切换词典麻烦

PicOnly 改成：

```text
Dictionary A ─┐
Dictionary B ─┼──► Shared PicDic Host / Runtime
Dictionary C ─┘
```

同一 GoldenDict 结果页只使用一个 PicDic host。

默认：

```ini
AUTO_ACTIVATE_PICONLY = 1
```

则结果页中排在最前的 PicOnly 词典自动显示；其他 PicDic 词典可以点击词典标题左侧的 `📖` 切换。

Controller 会把同一个 PicDic host 移动到目标词典，而不是重新创建一套 UI。

再次点击当前词典的 `📖` 还可以隐藏 PicDic，方便继续查看 GoldenDict 下面其他词典结果。

---

## 10. `CONTAINER_ID`

如果以前的“文字 + 切图 + 整页”词典一直使用：

```html
<div id="ISBN_9787100028851" class="PicDic-container">
```

可以继续：

```ini
CONTAINER_ID = ISBN_9787100028851
```

Builder 会在外部 config 中写入：

```js
containerId: "ISBN_9787100028851"
```

如果留空：

```ini
CONTAINER_ID =
```

新版默认使用：

```html
data-picdic-container="<DICT_FILE_NAME>"
```

并通过 `containerSelector` 收集词条，HTML 结构更规范，也避免固定 ID 重复。

---

## 11. `<DICT_FILE_NAME>_config.js`

PicOnly 模式会自动生成：

```text
<DICT_FILE_NAME>_config.js
```

GoldenDict 和 MDict 共用同一份配置。

例如：

```js
window.PICDIC_CONFIG = {
    mode: "picOnly",
    autoActivate: true,
    dictId: "PicDic_ZH-ZH_SanMinDCD",
    wordSelector: "PicDic_SearchWord",
    containerSelector: "[data-picdic-container=\"PicDic_ZH-ZH_SanMinDCD\"]"
};
```

配置文件本身不再写死 GoldenDict / MDict 的资源 base。

资源路径由 `PicDic_DictionaryController.js` 根据宿主环境决定：

```text
GoldenDict -> file:///sdcard/GoldenDict/PicDic/
MDict      -> MDD 内相对资源
```

---

## 12. 原始 `词典_index.txt` 格式

Builder 支持两种主要格式。

### 类型一：无详细坐标 / 页末词索引

正文部分格式：

```text
page<TAB>entry
```

例如：

```text
0000_00	封面
0000_01	目录
正文开始
0001	abandon
0002	advanced
正文结束
1001	附录一
1002	附录二
```

这种索引可以生成：

- 页面列表
- 词头 -> 页码
- PicOnly 宿主入口词典

但不能提供精确到词条 Y 坐标的自动高亮。

---

### 类型二：带详细坐标的全索引

正文部分格式固定为：

```text
word<TAB>X<TAB>Y<TAB>page
```

例如：

```text
0000_00_1	封面
0000_00_2	内封
0000_00_3	版权
0000_00_4	编委
0000_00_5	目录
0000_01	前言
0000_03	体例说明
0000_07	略语表
0000_11	字母表
正文开始
a	0.99	34.51	0001
a	0.99	55.14	0001
a-	51.85	59.23	0001
aba	51.85	116.97	0001
aba	51.85	121.06	0001
abab	51.85	125.21	0001
ababán	51.85	131.35	0001
zwinglianismo	51.85	52.78	2297
zwingliano	51.85	56.87	2297
Zwinglio	51.85	61.15	2297
正文结束
2298	附录一 动词变位表
2298	1.规则动词变位
2300	2.连代动词变位
2302	3.动词的正字法变化|¹
2304	⁷|4.动词的重音变化|⁸⁻¹⁰
2309	5.一般不规则动词|²⁷⁻³⁰
2319	⁶³|6.特殊不规则动词|⁶⁴⁻⁶⁵
2329	附录二 数词表
2337	附录四 化学元素表
2341	附录五 计量单位表
2344	附录六 西汉译音表
2345	主要参考书目
```

字段含义：

```text
word = 词头
X    = 词条在页面上的横向位置
Y    = 词条在页面上的纵向位置
page = 扫描图片页码
```

Builder 会：

```text
X -> 自动计算 column
Y -> 保存纵向定位
同一 page 内顺序 -> ord
```

最终用于 PicDic 的自动定位和高亮。

---

## 13. 一个索引行对应多个词头：`@`

带坐标索引中，一个位置可以写多个等价入口：

```text
colour@color	12.5	36.2	0123
```

Builder 会拆成：

```text
colour -> 同一页/栏/坐标
color  -> 同一页/栏/坐标
```

这适合扫描页中多个拼写形式共用同一个词条位置的情况。

---

## 14. `正文开始` / `正文结束`

Builder 把索引分为：

```text
正文前特殊页
正文词条页
正文后特殊页
```

默认标记：

```ini
BODY_START_MARKER = 正文开始
BODY_END_MARKER = 正文结束
```

标记之外的：

```text
page<TAB>description
```

会进入 `special`，例如：

```text
0000_00	封面
0000_01	目录
2345	主要参考书目
```

这些页面仍会进入 PicDic 页面序列，但不会作为普通正文词头处理。

---

## 15. StarDict 文件名与语言对

新版 Builder 会根据：

```ini
INDEX_LANGUAGE
CONTENTS_LANGUAGE
```

自动生成语言对后缀。

例如：

```ini
DICT_FILE_NAME = PicDic_ES-ZH_NEraGDEC
INDEX_LANGUAGE = spa
CONTENTS_LANGUAGE = zho
```

输出：

```text
PicDic_ES-ZH_NEraGDEC.es-zh.ifo
PicDic_ES-ZH_NEraGDEC.es-zh.idx
PicDic_ES-ZH_NEraGDEC.es-zh.dict.dz
```

如果是：

```ini
INDEX_LANGUAGE = eng
CONTENTS_LANGUAGE = zho
```

则为：

```text
PicDic_EN-ZH_xxx.en-zh.*
```

如果是中文单语：

```ini
INDEX_LANGUAGE = zho
CONTENTS_LANGUAGE = zho
```

则为：

```text
PicDic_ZH-ZH_xxx.zh-zh.*
```

这样可以让宿主端的词典文件从文件名就具有明确语言对信息，同时 `.ifo` 的 `bookname` 仍只显示 `DICT_NAME`。

---

## 16. MDict 与 GoldenDict 入口的区别

两者使用相同的 PicDic 真实词头，但资源加载方式不同。

### GoldenDict Android

入口 HTML 使用绝对 PicDic 公共目录：

```text
file:///sdcard/GoldenDict/PicDic/
```

例如：

```html
<script src="file:///sdcard/GoldenDict/PicDic/PicDic_ES-ZH_NEraGDEC/PicDic_ES-ZH_NEraGDEC_config.js"></script>
<script src="file:///sdcard/GoldenDict/PicDic/PicDic_DictionaryController.js"></script>
```

### MDict Android

CSS / JS / 图片等资源通常从自己的 MDD 中读取，因此 Builder 使用相对资源名：

```html
<script src="PicDic_ES-ZH_NEraGDEC_config.js"></script>
<script src="PicDic_DictionaryController.js"></script>
```

不写 Android 存储路径。

---

## 17. 宿主词典与 PicDic 的职责分工

新版 PicDic 的核心思路是：

> **宿主 APP 负责“找到正确词头”，PicDic 负责“找到扫描页”。**

### 中文

```text
用户输入简体
↓
Builder 预先生成的简体 StarDict / MDict 入口命中
↓
PicDic_SearchWord 保存原书繁体真实词头
↓
PicDic exact hot lookup
↓
图片页 / 栏 / 坐标
```

### 西班牙语、葡萄牙语、英语、法语、德语等屈折语言

Builder 不需要在 PicDic 中重新实现词形还原。

例如用户在 GoldenDict 输入：

```text
hablaron
```

宿主 APP 若通过自身 morphology / Hunspell 规则还原并命中：

```text
hablar
```

则实际打开的 StarDict 词条中已经包含：

```html
<PicDic_SearchWord>hablar</PicDic_SearchWord>
```

之后 PicDic 只需要：

```text
hablar
→ exact hot lookup
→ 扫描页
```

如果宿主同一查询得到多个可能词条，GoldenDict 页面中可以出现多个对应入口；Controller 会收集实际出现的 `PicDic_SearchWord`，PicDic 再对这些真实词头做 exact lookup。

因此复杂语言学处理尽量留给宿主 APP，PicDic 专注扫描词典定位。

---

## 18. 推荐工作流

### A. 有完整坐标索引的扫描词典

推荐：

```ini
WITH_COORDINATES = 1
GENERATE_MDX = 1
GENERATE_STARDICT = 1
STARDICT_COMPRESS_DICT = 1
ENTRY_MODE = picOnly
```

运行：

```bash
python __build_picdic.py
```

最终得到：

```text
PicDic 索引 JS
PicOnly config JS
MDict 转换前文本
StarDict 转换前文本
StarDict 主词典
DSL
```

再补齐：

```text
.bmp
.dsl.files.zip
```

即可部署。

---

### B. 只有页码索引，没有坐标

可以：

```ini
WITH_COORDINATES = 0
ENTRY_MODE = picOnly
GENERATE_STARDICT = 1
```

仍然可以：

```text
宿主查词
→ PicDic 打开对应页面
```

只是不能精确自动定位/高亮到该页中的具体词条。

---

### C. 只想生成文本，不直接转换 StarDict

```ini
GENERATE_MDX = 1
GENERATE_STARDICT = 0
```

得到：

```text
*_for_Mdict.txt
*.<语言对>_for_Stardict.txt
```

后续可以自己使用 MDict Builder / PyGlossary 等工具。

---

### D. 直接生成压缩 StarDict

```ini
GENERATE_MDX = 1
GENERATE_STARDICT = 1
STARDICT_COMPRESS_DICT = 1
```

得到：

```text
.ifo
.idx
.dict.dz
```

---

## 19. 部署到 GoldenDict Android

典型结构：

```text
GoldenDict/
└── PicDic/
    ├── PicDic_DictionaryController.js
    ├── PicDic_search.js
    ├── PicDic_ui.js
    ├── PicDic_search.css
    ├── PicDic_dictionary_list.js
    ├── PicDic_language_ref.js
    ├── PicDic_global_config.ini
    │
    └── PicDic_ES-ZH_NEraGDEC/
        ├── PicDic_ES-ZH_NEraGDEC.dsl
        ├── PicDic_ES-ZH_NEraGDEC.dsl.files.zip
        ├── PicDic_ES-ZH_NEraGDEC.bmp
        ├── PicDic_ES-ZH_NEraGDEC_index.js
        └── PicDic_ES-ZH_NEraGDEC_config.js
```

直接生成的 StarDict 主词典：

```text
PicDic_ES-ZH_NEraGDEC.es-zh.ifo
PicDic_ES-ZH_NEraGDEC.es-zh.idx
PicDic_ES-ZH_NEraGDEC.es-zh.dict.dz
```

可放入 GoldenDict 正常扫描的词典目录。

---

## 20. 常见问题

### Q1. `GENERATE_STARDICT=1` 报没有 PyGlossary

安装：

```bash
pip install -U pyglossary xxhash
```

已经生成的 `*_for_Stardict.txt` 不会因此丢失。

---

### Q2. 为什么生成了 `.dict.dz` 而不是 `.dict`？

因为：

```ini
STARDICT_COMPRESS_DICT = 1
```

如果希望普通 `.dict`：

```ini
STARDICT_COMPRESS_DICT = 0
```

---

### Q3. 为什么 StarDict 文件名多了 `.es-zh`？

这是根据：

```ini
INDEX_LANGUAGE = spa
CONTENTS_LANGUAGE = zho
```

自动添加的语言对。

`.ifo` 中显示名称仍然是 `DICT_NAME`。

---

### Q4. 为什么中文生成了简体词头，但 `_index.js` 还是繁体？

这是有意设计。

```text
简体 = 宿主入口
繁体 = 扫描词典真实索引
```

这样 GoldenDict 可以用简体命中词典，而 PicDic 仍精确查询原书繁体词头。

---

### Q5. `PicDic_SearchWord` 应该写简体还是繁体？

写**转换前的真实 PicDic 词头**。

例如：

```text
GoldenDict 入口：法师
PicDic_SearchWord：法師
```

而不是再次写 `法师`。

---

### Q6. MDict 为什么没有 `_config_mdict.js`？

新版 GoldenDict / MDict 共用：

```text
<DICT_FILE_NAME>_config.js
```

MDict 通过 MDD 相对资源读取，不需要另一份绝对路径配置。

---

### Q7. 没有坐标能不能生成 PicOnly 主词典？

可以。

坐标只影响：

```text
精确定位 / 高亮
```

不影响：

```text
宿主词头 -> PicDic 页面
```

---

### Q8. 为什么 `PicDic_dictionary_list.js` 没自动更新？

只有当它位于 `__build_picdic.py` 同目录且包含有效：

```js
var picdic_dictList = {...}
```

时才会自动更新。

如果不存在，Builder 会跳过，并在控制台输出新词典条目供手动复制。

---

## 21. 最简推荐配置

对于现在的新 PicOnly 扫描词典，一般推荐：

```ini
DICT_ID = PicDic_ES-ZH_MyDict
DICT_FILE_NAME = PicDic_ES-ZH_MyDict
DICT_NAME = My Dictionary

INDEX_LANGUAGE = spa
CONTENTS_LANGUAGE = zho
COLUMN_NUM = 2
INDEX_FILE = PicDic_ES-ZH_MyDict_index.txt

WITH_COORDINATES = 1
GENERATE_MDX = 1
GENERATE_STARDICT = 1
STARDICT_COMPRESS_DICT = 1

GENERATE_SIMPLIFIED_ALIASES = auto
OPENCC_PHRASE_FIRST_ALIASES = 1
OPENCC_TSPHRASES_FILE = opencc_data/TSPhrases.txt
OPENCC_AUTO_DOWNLOAD_DATA = 1

ENTRY_MODE = picOnly
AUTO_ACTIVATE_PICONLY = 1
CONTAINER_ID =

PICDIC_BASE_GOLDENDICT = file:///sdcard/GoldenDict/PicDic/
CONTROLLER_FILE = PicDic_DictionaryController.js

BODY_START_MARKER = 正文开始
BODY_END_MARKER = 正文结束
SEPARATOR = \t
INDEX_DIR =
```

对于非中文词典：

```ini
GENERATE_SIMPLIFIED_ALIASES = auto
```

不会启用中文简体别名逻辑，因此无需单独修改。

---

## 22. 一句话理解新版 Builder

旧版主要是：

```text
词典_index.txt
→ 词典_index.js
```

新版已经变成：

```text
                     ┌─ PicDic *_index.js
                     ├─ PicDic DSL
                     ├─ PicOnly *_config.js
词典_index.txt ──────┼─ MDict 入口文本
                     ├─ StarDict 入口文本
                     ├─ StarDict .ifo / .idx / .dict(.dz)
                     └─ PicDic_dictionary_list.js 更新信息
```

它实际上已经是 **PicDic 扫描词典从原始索引到宿主入口词典的一体化构建工具**。
