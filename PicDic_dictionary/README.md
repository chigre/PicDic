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
hacienda	<link rel="stylesheet" href="file:///sdcard/GoldenDict/SPA/ES-Z
```
