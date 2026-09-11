# Android 版 GoldenDict 所需的 PicDic 入口词条的StarDict词典文件资源。

## 一、StarDict 词典：picdic-single

目录结构：

```text
picdic-single/
├── README.md
├── picdic-single.ifo
├── picdic-single.idx
├── picdic-single.dict
└── picdic-single.bmp
```

* 仅包含 `picdic` 一个入口词条。

## 二、手机 GoldenDict 资源

每一个PicDic词典包括的文件内容如下，放在手机 SD 卡相应目录下：

```text
GoldenDict/PicDic/PicDic_ES-ZH_NEraGDEC/
├── PicDic_ES-ZH_NEraGDEC.bmp
├── PicDic_ES-ZH_NEraGDEC.dsl
├── PicDic_ES-ZH_NEraGDEC.dsl.files.zip
├── PicDic_ES-ZH_NEraGDEC_index.js
└── PicDic_ES-ZH_NEraGDEC_config.js
```

### 文件说明

| 文件                                    | 说明                                       |
| ------------------------------------- | ---------------------------------------- |
| `PicDic_ES-ZH_NEraGDEC.bmp`           | 图片资源空壳 DSL 的图标                           |
| `PicDic_ES-ZH_NEraGDEC.dsl`           | 图片资源空壳 DSL                               |
| `PicDic_ES-ZH_NEraGDEC.dsl.files.zip` | 图片资源压缩包                                  |
| `PicDic_ES-ZH_NEraGDEC_index.js`      | 图片词典的索引 JS 文件，分为页末单词索引和全索引，可通过 Python 转换 |
| `PicDic_ES-ZH_NEraGDEC_config.js`     | 图片词典的自定义设置，非必需                           |

## 安装说明

1. 将 `picdic-single/` 中的 `.ifo`、`.idx`、`.dict` 文件放入 StarDict / GoldenDict 词典目录。
2. 在手机 SD 卡的 `GoldenDict/PicDic/` 目录下创建 `PicDic_ES-ZH_NEraGDEC` 文件夹。
3. 在 GoldenDict 中添加对应词典路径并启用。



# 使用 PyGlossary 将 Tabfile 转换为 StarDict 词典

## 1. 新建 Tabfile 文本文件

新建一个 **UTF-8 编码、无 BOM** 的文本文件，例如：

```text
ES-ZH_NEraGDEC_V2026_stardict.txt
```

该文件用于保存待转换的词典词条内容。

---

## 2. 使用 PyGlossary 转换为 StarDict 格式

进入 CMD 命令行，在词典文件所在目录执行：

```bash
pyglossary ES-ZH_NEraGDEC_V2026_stardict.txt ES-ZH_NEraGDEC_V2026.ifo --read-format=Tabfile --write-format=Stardict
```

其中：

* `ES-ZH_NEraGDEC_V2026_stardict.txt`：原始 Tabfile 词典文件
* `ES-ZH_NEraGDEC_V2026.ifo`：输出的 StarDict 词典文件
* `--read-format=Tabfile`：指定输入格式为 Tabfile
* `--write-format=Stardict`：指定输出格式为 StarDict

转换完成后，将生成 StarDict 所需的相关词典文件。

---

## 3. 词典文件放置位置

生成后的词典文件可放置在 GoldenDict 对应目录，例如：

```text
sdcard/GoldenDict/SPA/ES-ZH_NEraGDEC_V2026/
```

示例目录结构：

```text
sdcard/
└── GoldenDict/
    └── SPA/
        └── ES-ZH_NEraGDEC_V2026/
            ├── ES-ZH_NEraGDEC_V2026.ifo
            ├── ES-ZH_NEraGDEC_V2026.idx
            ├── ES-ZH_NEraGDEC_V2026.dict
            └── ES-ZH_NEraGDEC_V2026.css
```

实际生成的文件扩展名可能因 PyGlossary 的输出设置而有所不同。

---

## 4. Tabfile 词条格式

Tabfile 中，每个词条通常占一行，基本格式为：

```text
词头<TAB>词条正文
```

即：

```text
entry	HTML内容
```

词头和正文之间使用 **Tab 制表符** 分隔。

词条正文内部的换行使用：

```text
\n
```

表示。

---

## 5. Entries 示例

以下为实际词条示例：

```text
hacienda	<link rel="stylesheet" href="file:///sdcard/GoldenDict/SPA/ES-ZH_NEraGDEC_V2026/ES-ZH_NEraGDEC_V2026.css">\n<div id="ISBN_9787100028851" class="PicDic-container">\n<PicDic_SearchWord>hacienda</PicDic_SearchWord>\n<PicDic_TEXT>\n<PTZH_PART_MAIN><ID>z067455</ID>\n<HW_AREA><PTZH_ENTRY>hacienda</PTZH_ENTRY> </HW_AREA>\n<PTZH_CX><PTZH_CX_DETAIL>f.</PTZH_CX_DETAIL></PTZH_CX>\n<PTZH_DEF><PTZH_DEF_NUM>1.</PTZH_DEF_NUM> 庄园, 田庄:</PTZH_DEF>\n<PTZH_EXAMPLE><PTZH_EXAMPLE_PT>El sólo no puede administrar su ~.</PTZH_EXAMPLE_PT> <PTZH_EXAMPLE_ZH> 他一个人管理不了自己的庄园。</PTZH_EXAMPLE_ZH></PTZH_EXAMPLE>\n<PTZH_EXAMPLE><PTZH_EXAMPLE_PT>Pronto acrecentó su ~.</PTZH_EXAMPLE_PT> <PTZH_EXAMPLE_ZH> 很快他就扩充了自己的田庄。</PTZH_EXAMPLE_ZH></PTZH_EXAMPLE>\n<PTZH_DEF><PTZH_DEF_NUM>2.</PTZH_DEF_NUM> 田产, 财产:</PTZH_DEF>\n<PTZH_EXAMPLE><PTZH_EXAMPLE_PT>Perdió toda su ~ en el juego.</PTZH_EXAMPLE_PT> <PTZH_EXAMPLE_ZH> 他在赌博中输光了所有的家产。</PTZH_EXAMPLE_ZH></PTZH_EXAMPLE>\n<PTZH_DEF><PTZH_DEF_NUM>3.</PTZH_DEF_NUM> 国家财产; 国民收入:</PTZH_DEF>\n<PTZH_EXAMPLE><PTZH_EXAMPLE_PT>defraudar a la ~</PTZH_EXAMPLE_PT> <PTZH_EXAMPLE_ZH> 骗取国家财产</PTZH_EXAMPLE_ZH></PTZH_EXAMPLE>\n<PTZH_EXAMPLE><PTZH_EXAMPLE_PT>Con las últimas medidas económicas el gobierno pretende sanear la ~.</PTZH_EXAMPLE_PT> <PTZH_EXAMPLE_ZH> 政府采取新的经济措施以求改善国家财政状况。</PTZH_EXAMPLE_ZH></PTZH_EXAMPLE>\n<PTZH_DEF><PTZH_DEF_NUM>4.</PTZH_DEF_NUM> 财政部:</PTZH_DEF>\n<PTZH_EXAMPLE><PTZH_EXAMPLE_PT>Con la subida de los impuestos, ~ debe haber recaudado sumas astronómicas.</PTZH_EXAMPLE_PT> <PTZH_EXAMPLE_ZH> 通过提高税收, 财政部一定收到了巨额钱款。</PTZH_EXAMPLE_ZH></PTZH_EXAMPLE>\n<PTZH_EXAMPLE><PTZH_EXAMPLE_PT>tener que hacer unos pagos en ~</PTZH_EXAMPLE_PT> <PTZH_EXAMPLE_ZH> 到财政部门去付几笔钱</PTZH_EXAMPLE_ZH></PTZH_EXAMPLE>\n<PTZH_DEF><PTZH_DEF_NUM>5.</PTZH_DEF_NUM> <PTZH_CX_DETAIL>pl.</PTZH_CX_DETAIL> 家务</PTZH_DEF>\n<PTZH_DEF><PTZH_DEF_NUM>6.</PTZH_DEF_NUM> 行动; 事情; 事件</PTZH_DEF>\n<PTZH_DEF><PTZH_DEF_NUM>7.</PTZH_DEF_NUM> 〈古〉 交易, 生意, 买卖</PTZH_DEF>\n<PTZH_DEF><PTZH_DEF_NUM>8.</PTZH_DEF_NUM> 畜群, 牧畜</PTZH_DEF>\n<PTZH_DEF><PTZH_DEF_NUM>9.</PTZH_DEF_NUM> «Argent.» 牛群</PTZH_DEF>\n<PTZH_DEF><PTZH_DEF_NUM>10.</PTZH_DEF_NUM> «Cuba» 牲口圈</PTZH_DEF>\n<PTZH_DEF><PTZH_DEF_NUM>11.</PTZH_DEF_NUM> «Méx.» 〔矿〕 用于</PTZH_DEF>\n<PTZH_EXAMPLE><PTZH_EXAMPLE_PT>~ de beneficio</PTZH_EXAMPLE_PT> <PTZH_EXAMPLE_ZH> 炼银厂</PTZH_EXAMPLE_ZH></PTZH_EXAMPLE>\n<PTZH_DEF><PTZH_DEF_NUM>12.</PTZH_DEF_NUM> «P. Rico» 炼糖厂</PTZH_DEF></PTZH_PART_MAIN>\n<PTZH_PART_LOC>\n<PTZH_LOC><PTZH_LOC_PT>~ pública</PTZH_LOC_PT> <PTZH_LOC_ZH>国家财产</PTZH_LOC_ZH></PTZH_LOC>\n<PTZH_LOC><PTZH_LOC_PT>derramar la ~</PTZH_LOC_PT> <PTZH_LOC_ZH>破坏财产; 挥霍财产</PTZH_LOC_ZH></PTZH_LOC>\n<PTZH_LOC><PTZH_LOC_PT>hacer buena ~</PTZH_LOC_PT> <PTZH_LOC_ZH>〈讽〉 犯了错误</PTZH_LOC_ZH></PTZH_LOC>\n<PTZH_LOC><PTZH_LOC_PT>Ministerio de Hacienda</PTZH_LOC_PT> <PTZH_LOC_ZH>财政部</PTZH_LOC_ZH></PTZH_LOC>\n<PTZH_LOC><PTZH_LOC_PT>ministro de ~</PTZH_LOC_PT> <PTZH_LOC_ZH>财政部长</PTZH_LOC_ZH></PTZH_LOC>\n<PTZH_LOC><PTZH_LOC_PT>real ~</PTZH_LOC_PT> <PTZH_LOC_ZH>⇨ <PTZH_LOC_PT_ref>~ pública</PTZH_LOC_PT_ref></PTZH_LOC_ZH></PTZH_LOC></PTZH_PART_LOC>\n</PicDic_TEXT>\n<PicDic_QC><img class="PIC_QC" src="content://mobi.goldendict.android/resource/d8b78f0c794016d04dfe6bbf6622cf55/1129_WW_023(1).png"></PicDic_QC>\n<script src="file:///sdcard/GoldenDict/PicDic/PicDic_ES-ZH_NEraGDEC/ES-ZH_NEraGDEC_config.js"></script>\n<script src="file:///sdcard/GoldenDict/PicDic/PicDic_DictionaryController.js"></script>\n</div>\n</>
haciente	<link rel="stylesheet" href="file:///sdcard/GoldenDict/SPA/ES-ZH_NEraGDEC_V2026/ES-ZH_NEraGDEC_V2026.css">\n<div id="ISBN_9787100028851" class="PicDic-container">\n<PicDic_SearchWord>haciente</PicDic_SearchWord>\n<PicDic_TEXT>\n<PTZH_PART_MAIN><ID>z067456</ID>\n<HW_AREA><PTZH_ENTRY>haciente</PTZH_ENTRY> </HW_AREA>\n<PTZH_CX><PTZH_CX_DETAIL>adj.s.</PTZH_CX_DETAIL></PTZH_CX><PTZH_DEF_UNIQ> 〈古〉 干活的 (人), 做事的 (人)</PTZH_DEF_UNIQ></PTZH_PART_MAIN>\n</PicDic_TEXT>\n<PicDic_QC><img class="PIC_QC" src="content://mobi.goldendict.android/resource/d8b78f0c794016d04dfe6bbf6622cf55/1129_WW_024(1).png"></PicDic_QC>\n<script src="file:///sdcard/GoldenDict/PicDic/PicDic_ES-ZH_NEraGDEC/ES-ZH_NEraGDEC_config.js"></script>\n<script src="file:///sdcard/GoldenDict/PicDic/PicDic_DictionaryController.js"></script>\n</div>\n</>
hacimiento	<link rel="stylesheet" href="file:///sdcard/GoldenDict/SPA/ES-ZH_NEraGDEC_V2026/ES-ZH_NEraGDEC_V2026.css">\n<div id="ISBN_9787100028851" class="PicDic-container">\n<PicDic_SearchWord>hacimiento</PicDic_SearchWord>\n<PicDic_TEXT>\n<PTZH_PART_MAIN><ID>z067457</ID>\n<HW_AREA><PTZH_ENTRY>hacimiento</PTZH_ENTRY> </HW_AREA>\n<PTZH_CX><PTZH_CX_DETAIL>m.</PTZH_CX_DETAIL></PTZH_CX><PTZH_DEF_UNIQ> 〈古〉 <PTZH_CX_DETAIL>s.</PTZH_CX_DETAIL> de <PTZH_REF><a href="hacer">hacer</a></PTZH_REF></PTZH_DEF_UNIQ></PTZH_PART_MAIN>\n<PTZH_PART_LOC>\n<PTZH_LOC><PTZH_LOC_PT>~ de gracias</PTZH_LOC_PT> <PTZH_LOC_ZH>感谢, 感恩</PTZH_LOC_ZH></PTZH_LOC></PTZH_PART_LOC>\n</PicDic_TEXT>\n<PicDic_QC><img class="PIC_QC" src="content://mobi.goldendict.android/resource/d8b78f0c794016d04dfe6bbf6622cf55/1129_WW_025(1).png"></PicDic_QC>\n<script src="file:///sdcard/GoldenDict/PicDic/PicDic_ES-ZH_NEraGDEC/ES-ZH_NEraGDEC_config.js"></script>\n<script src="file:///sdcard/GoldenDict/PicDic/PicDic_DictionaryController.js"></script>\n</div>\n</>

```
