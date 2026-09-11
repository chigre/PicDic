本仓库包含 Android 版 GoldenDict 所需的 PicDic StarDict 词典文件资源。

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
