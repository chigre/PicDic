# PicDic
add-on Javascripts for managing scanned dictionaries for GoldenDict/Mdict on Android

**PicDic** 是一套面向 **GoldenDict Android** 和 **MDict Android** 的图片词典检索与嵌入框架。

它可以单独使用，也可以将扫描版词典与普通文字词典关联起来，在查询词条时自动定位到对应的图片页、栏和词条位置，并提供缩放、高亮、历史记录和词典管理等功能。

## 核心功能

* 扫描图片词典单独使用
* 文字词典与扫描图片词典联动
* 查询词自动定位到对应页和栏
* 目标词条自动高亮
* 双击 / 长按放大
* 多栏页面导航
* 左右虚拟裁剪
* 首列左对齐、末列右对齐
* 双侧安全边距
* 放大后仅纵向滑动
* 每本词典独立保存显示参数
* 多本文字词典共享一个 PicDic Runtime
* IndexedDB Hot Cache，加快连续查词
* GoldenDict Android 原生 `gdJumpTo()` 定位
* MDict 自定义滚动 fallback
* UI 按需加载，减少普通查词时的 JS 解析量

## GoldenDict / PicDic 目录结构（以及文本词典目录）

```text

GoldenDict/
├── .config/
│   └── article-style.css
│
├── SPA/
│   └── ES-ZH_NEraGDEC_V2026/
│       ├── ES-ZH_NEraGDEC_V2026.bmp
│       ├── ES-ZH_NEraGDEC_V2026.ifo
│       ├── ES-ZH_NEraGDEC_V2026.idx
│       ├── ES-ZH_NEraGDEC_V2026.dict.dz
│       └── ES-ZH_NEraGDEC_V2026.css
│
├── POR/
│   └── PT-ZH_DPC_V2026/
│       ├── PT-ZH_DPC_V2026.bmp
│       ├── PT-ZH_DPC_V2026.ifo
│       ├── PT-ZH_DPC_V2026.idx
│       ├── PT-ZH_DPC_V2026.dict.dz
│       └── PT-ZH_DPC_V2026.css
│ 
│ 
└── PicDic/
    ├── PicDic_DictionaryController.js
    ├── PicDic_search.js
    ├── PicDic_ui.js
    ├── PicDic_dictionary_list.js
    ├── PicDic_language_ref.js
    ├── PicDic_global_config.ini
    ├── PicDic_search.css
    │
    │
    ├── picdic-single.bmp          【“picdic”入口词条词典】
    ├── picdic-single.ifo          【“picdic”入口词条词典】
    ├── picdic-single.idx          【“picdic”入口词条词典】
    ├── picdic-single.dict         【“picdic”入口词条词典】
    │
    │
    ├── PicDic_ES-ZH_NEraGDEC/     【具体词典文件夹 1】
    │   ├── PicDic_ES-ZH_NEraGDEC.bmp
    │   ├── PicDic_ES-ZH_NEraGDEC.dsl
    │   ├── PicDic_ES-ZH_NEraGDEC.dsl.files.zip  【图片】
    │   ├── PicDic_ES-ZH_NEraGDEC_index.js  【索引JS】
    │   └── ES-ZH_NEraGDEC_config.js  【文本词典跳转切换到相应picdic时所需的配置文件】
    │
    │
    └── PicDic_PT-ZH_DPC/          【具体词典文件夹 2】
        ├── PicDic_PT-ZH_DPC.bmp
        ├── PicDic_PT-ZH_DPC.dsl
        ├── PicDic_PT-ZH_DPC.dsl.files.zip
        ├── PicDic_PT-ZH_DPC_index.js
        └── PT-ZH_DPC_config.js

```

`PicDic_ui.js` 不需要在 HTML 中单独引入，由 `PicDic_search.js` 在需要时自动加载。

### `PicDic_DictionaryController.js`

文字词典与 PicDic 之间的 Bridge。

负责：

* 获取当前查询词
* 创建 PicDic 控制按钮
* 管理文字 / QC / PicDic 显示状态
* 多个文字词典共享同一个 PicDic host
* GoldenDict / MDict 滚动适配

### `PicDic_search.js`

PicDic 核心模块。

负责：

* 索引与搜索
* Hot Cache
* 页面和栏定位
* 图片加载
* 缩放与手势
* 高亮
* Shared Runtime
* GoldenDict / MDict 环境适配

### `PicDic_ui.js`

按需加载的 UI 模块。

包含：

* 历史记录
* 词典管理
* Resource ID 设置
* 当前词典设置
* 全局设置
* 缓存管理

普通查词时不会加载该文件，只有首次打开相关 UI 时才加载。

### `PicDic_dictionary_list.js`

保存图片词典列表及其资源信息。

---

## Shared Runtime

PicDic 采用：

```text
Dictionary A ─┐
Dictionary B ─┼──► Shared PicDic Runtime
Dictionary C ─┘
```

同一页面无论出现多少支持 PicDic 的文字词典，都只维护一个图片词典 Runtime。

切换词典时复用同一个 host，仅切换当前字典、查询词和页面状态，避免重复加载和 DOM 冲突。

---

## Hot Cache

PicDic 使用 IndexedDB 保存轻量查询缓存。

查询时优先读取：

```text
word lookup
→ page
→ page positions
→ image
```

而不是每次恢复完整索引，因此从第二次查询开始可以明显减少加载和反序列化开销。

---

## 横向定位

所有横向定位统一采用：

```text
x
→ column
→ viewport position
```

外部查询、双击、长按和列导航共用同一套定位逻辑。

支持：

```text
左边裁剪
右边裁剪
双侧安全边距
```

其中左右裁剪使用原始图片像素，安全边距使用 viewport 宽度百分比。

---

## GoldenDict Android

GoldenDict 环境下优先使用 App 自身的：

```javascript
gdJumpTo(articleId)
```

完成文章定位。

因此 不应使用：

```css
display:none;
```

推荐GoldenDict android全局CSS（ GoldenDict/.config/article-style.css ）设置如下：

```css
# GoldenDict CSS 样式

a {
    text-decoration: none;
}

img {
    max-width: 100%;
}

body {
    margin-top: -5px;
}

.gdarticleref {
    display: block !important;
    height: 0 !important;
    min-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    overflow: hidden !important;
    visibility: hidden !important;
}

.gddictname {
    font-size: 1em;
    width: 100%;
    overflow-x: hidden;
    text-align: right;
    text-overflow: ellipsis;
    display: block;
    white-space: nowrap;
    color: #4480F8;
    background: #E0E8F0;
    border-radius: 0 0 0 6px;
}

.gdheadword {
    display: none !important;
}

.gdarticle {
    margin: 0;
    padding: 0;
    outline: red;
}

.gddefinition {
}

.dsl_article {
}

.dsl_definition {
}

.dsl_s_wav {
}

.dsl_m0 {
}

.dsl_p {
}

.stct_h {
}

.gdactivearticle .gddictname {
    border: 1px solid darkred;
    color: darkred;
    background-color: #FFF2EC;
}

.gddefinition + .gddictname,
.gddefinition + .gdheadword {
    display: none !important;
}

```


## Compatibility

目前主要面向：

* GoldenDict Android
* MDict Android

不同 Android WebView、GoldenDict / MDict 版本及词典资源结构可能存在差异，建议在实际设备上测试。

---

## License

PicDic 框架代码与具体词典资源建议分开管理。

请勿在公开仓库中直接发布受版权保护的商业词典扫描图片、正文或索引数据。
