###python __build_picdic.py  【使用配置文件__build_picdic_config.txt】
###python __build_picdic.py --config PicDic_EN-EN_WorldBook_config.txt    【使用自定义的配置文件】

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
PicDic 索引构建工具（最终版：不生成 pageWordPositions）
- 支持位置信息索引（word\tX%\tY%\tpage）
- 支持自定义分隔符
- 支持 @ 拆分词条
- 根据 COLUMN_NUM 自动计算列号
- wordToPages 结构由 WITH_COORDINATES 控制：
    - 0: [{"pg": "0001"}]
    - 1: [{"pg": "0001", "col": 1, "y": 135.81, "ord": 0}]
- has_position 仅根据正文第一行判断
- 生成两种词条文件：MDict（无前缀）和 StarDict（带 file:// 前缀）
- 自动生成 .dsl 和更新词典列表
"""

import os
import sys
import hashlib
import json
import re
from datetime import datetime

DEFAULT_CONFIG = {
    'DICT_ID': 'PicDic_MyDict',
    'DICT_NAME': 'My Dictionary',
    'DICT_FILE_NAME': '',
    'INDEX_LANGUAGE': 'eng',
    'CONTENTS_LANGUAGE': 'eng',
    'INDEX_FILE': '_index.txt',
    'BODY_START_MARKER': '正文开始',
    'BODY_END_MARKER': '正文结束',
    'COLUMN_NUM': 2,
    'GENERATE_MDX': 'false',
    'SEPARATOR': '\t',
    'WITH_COORDINATES': '0',
}

CONFIG_FILE = '__build_picdic_config.txt'
DICT_LIST_JS = 'PicDic_dictionary_list.js'

# ================== 配置解析 ==================
def parse_config_file(filepath):
    config = {}
    if not os.path.isfile(filepath):
        print(f"警告：配置文件 '{filepath}' 不存在，使用默认配置。")
        return DEFAULT_CONFIG.copy()
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            key, value = line.split('=', 1)
            config[key.strip()] = value.strip()
    if 'INDEX_KEY_TYPE' in config and 'INDEX_LANGUAGE' not in config:
        config['INDEX_LANGUAGE'] = config['INDEX_KEY_TYPE']
    for k, v in DEFAULT_CONFIG.items():
        if k not in config:
            config[k] = v
    try:
        config['COLUMN_NUM'] = int(config['COLUMN_NUM'])
    except ValueError:
        config['COLUMN_NUM'] = 1
    try:
        config['WITH_COORDINATES'] = int(config.get('WITH_COORDINATES', '0'))
    except ValueError:
        config['WITH_COORDINATES'] = 0
    config['GENERATE_MDX'] = config.get('GENERATE_MDX', 'true').lower() in ('true', '1', 'yes')
    sep = config.get('SEPARATOR', '\t')
    if sep == '\\t':
        sep = '\t'
    config['SEPARATOR'] = sep
    if not config['DICT_FILE_NAME']:
        config['DICT_FILE_NAME'] = config['DICT_ID']
    return config

# ================== 列号计算 ==================
def get_column(x, col_num):
    if col_num <= 1:
        return 1
    elif col_num == 2:
        return 1 if x < 10 else 2
    elif col_num == 3:
        if x < 10:
            return 1
        elif x <= 66:
            return 2
        else:
            return 3
    else:
        segment = 100 / col_num
        return int(x // segment) + 1

# ================== 解析索引文件 ==================
def parse_index_file(filepath, body_start_marker, body_end_marker, separator, col_num):
    pages = []
    word_to_pages = {}
    special = {}
    in_body = False
    has_position = False
    page_counter = {}
    first_body_line_checked = False
    first_body_page = None
    last_body_page = None

    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            if line == body_start_marker:
                in_body = True
                continue
            if line == body_end_marker:
                in_body = False
                continue

            parts = line.split(separator)

            if in_body:
                # 正文部分
                if not first_body_line_checked:
                    if len(parts) == 4:
                        try:
                            float(parts[1])
                            float(parts[2])
                            has_position = True
                        except ValueError:
                            has_position = False
                    else:
                        has_position = False
                    first_body_line_checked = True

                if has_position:
                    try:
                        x = float(parts[1])
                        y = float(parts[2])
                        raw_word = parts[0].strip()
                        page = parts[3].strip()
                    except (ValueError, IndexError):
                        continue

                    # 记录首尾正文页码
                    if first_body_page is None:
                        first_body_page = page
                    last_body_page = page

                    col = get_column(x, col_num)
                    words = [w.strip() for w in raw_word.split('@') if w.strip()]
                    if words:
                        if page not in page_counter:
                            page_counter[page] = 0
                        ord_idx = page_counter[page]
                        page_counter[page] += 1

                        if page not in pages:
                            pages.append(page)

                        for word in words:
                            if word not in word_to_pages:
                                word_to_pages[word] = []
                            word_to_pages[word].append({
                                'pg': page,
                                'col': col,
                                'y': y,
                                'ord': ord_idx
                            })
                else:
                    # 无坐标旧格式（正文部分）
                    if len(parts) >= 2:
                        page = parts[0].strip()
                        entry = parts[1].strip() if len(parts) > 1 else ''
                    else:
                        page = line
                        entry = ''
                    if page:
                        if first_body_page is None:
                            first_body_page = page
                        last_body_page = page
                        if page not in pages:
                            pages.append(page)
                        if entry:
                            word_to_pages.setdefault(entry, []).append(page)

            else:
                # 非正文：特殊页（page\tentry）
                if len(parts) >= 2:
                    page = parts[0].strip()
                    entry = parts[1].strip() if len(parts) > 1 else ''
                else:
                    page = line
                    entry = ''
                if page:
                    if page not in pages:
                        pages.append(page)
                    if entry:
                        special[page] = entry

    # 补充正文连续页码
    if first_body_page is not None and last_body_page is not None:
        try:
            start = int(first_body_page)
            end = int(last_body_page)
            if start <= end:
                # 生成连续页码，补零（例如 0001）
                # 根据 first_body_page 确定宽度
                width = len(first_body_page)
                for num in range(start, end + 1):
                    pg = str(num).zfill(width)
                    if pg not in pages:
                        pages.append(pg)
        except ValueError:
            pass  # 若非数字页码则跳过

    pages = sorted(set(pages))
    return pages, word_to_pages, special, has_position
    
# ================== 生成 JS ==================
def generate_js(dict_name, pages, word_to_pages, special,
                version, column_num, has_position, with_coordinates):
    pages_str = json.dumps(pages, ensure_ascii=False, separators=(',', ':'))
    special_str = json.dumps(special, ensure_ascii=False, indent=4)

    if has_position and with_coordinates:
        word_to_pages_str = json.dumps(word_to_pages, ensure_ascii=False, separators=(',', ':'))
    else:
        simplified = {}
        for word, entries in word_to_pages.items():
            if entries and isinstance(entries[0], str):
                simplified[word] = entries
            else:
                simplified[word] = [{'pg': item['pg']} for item in entries]
        word_to_pages_str = json.dumps(simplified, ensure_ascii=False, separators=(',', ':'))

    return f"""// {dict_name}
// 页面索引（wordToPages 存储页面信息）
window._dictIndex = {{
    version: '{version}',
    columnNum: {column_num},
    pages: {pages_str},
    wordToPages: {word_to_pages_str},
    special: {special_str}
}};
"""

# ================== 生成词条文件（MDict + StarDict） ==================
def generate_wordlist_files(word_list, output_dir, dict_file_name, dict_id):
    if not word_list:
        return

    def build_html(word, prefix=''):
        safe_word = json.dumps(word)
        safe_dict = json.dumps(dict_id)
        return f'''<script>window._picdic_word = {safe_word}; window._picdic_dictId = {safe_dict};</script><link rel="stylesheet" type="text/css" href="{prefix}PicDic_search.css"/><div class="PIC_DIC"><div id="searchBox"><input type="text" id="searchInput" placeholder="输入单词..."/></div><div id="result">加载中...</div></div><script src="{prefix}PicDic_language_ref.js"></script><script src="{prefix}PicDic_dictionary_list.js"></script><script src="{prefix}PicDic_global_config.ini"></script><script src="{prefix}PicDic_search.js"></script>'''

    # MDict 格式（无前缀）
    mdx_path = os.path.join(output_dir, f'{dict_file_name}_for_Mdict.txt')
    with open(mdx_path, 'w', encoding='utf-8') as f:
        for word in sorted(word_list):
            f.write(word + '\n')
            f.write(build_html(word, prefix='') + '\n')
            f.write('</>\n')
    print(f"✅ MDict 词条文件已生成：{mdx_path}，共 {len(word_list)} 个词条。")

    # StarDict 格式（带 file:// 前缀）
    stardict_path = os.path.join(output_dir, f'{dict_file_name}_for_Stardict.txt')
    with open(stardict_path, 'w', encoding='utf-8') as f:
        for word in sorted(word_list):
            html = build_html(word, prefix='file:///storage/emulated/0/GoldenDict/PicDic/')
            f.write(word + '\t' + html + '\n')
    print(f"✅ StarDict 词条文件已生成：{stardict_path}，共 {len(word_list)} 个词条。")

# ================== 生成 DSL ==================
def generate_dsl(dict_file_name, dict_name, index_language='eng', contents_language='eng'):
    return f"""#NAME\t"{dict_file_name}"
#INDEX_LANGUAGE\t"{index_language}"
#CONTENTS_LANGUAGE\t"{contents_language}"
picdic
\t{dict_name} 图片
"""

# ================== 词典列表条目 ==================
def generate_dict_list_entry(dict_id, dict_name, index_language, contents_language, index_path, resource_id):
    return f"""        '{dict_id}': {{
            name: '{dict_name}',
            index_language: '{index_language}',
            contents_language: '{contents_language}',
            indexPath: '{index_path}',
            version: '1',
            resourceId: '{resource_id}'
        }},"""

# ================== 更新词典列表 JS ==================
def update_dictionary_list_js(entry_file_path, list_js_path):
    with open(entry_file_path, 'r', encoding='utf-8') as f:
        new_entry_raw = f.read().strip()
    if not new_entry_raw:
        print("警告：条目文件为空，跳过更新")
        return

    key_match = re.search(r"'([^']+)'\s*:", new_entry_raw)
    if not key_match:
        print("错误：无法提取条目键名")
        return
    new_key = key_match.group(1)

    name_match = re.search(r"name:\s*'([^']+)'", new_entry_raw)
    lang_match = re.search(r"index_language:\s*'([^']+)'", new_entry_raw)
    cont_lang_match = re.search(r"contents_language:\s*'([^']+)'", new_entry_raw)
    index_match = re.search(r"indexPath:\s*'([^']+)'", new_entry_raw)
    res_match = re.search(r"resourceId:\s*'([^']+)'", new_entry_raw)
    version_match = re.search(r"version:\s*'([^']+)'", new_entry_raw)

    if not all([name_match, lang_match, cont_lang_match, index_match, res_match]):
        print("错误：无法从条目文件中提取所有必要字段")
        return
    new_name = name_match.group(1)
    new_lang = lang_match.group(1)
    new_cont_lang = cont_lang_match.group(1)
    new_index = index_match.group(1)
    new_res = res_match.group(1)
    new_version = version_match.group(1) if version_match else '1'

    if not os.path.isfile(list_js_path):
        print(f"错误：词典列表文件 '{list_js_path}' 不存在，跳过更新")
        return

    with open(list_js_path, 'r', encoding='utf-8') as f:
        content = f.read()

    var_match = re.search(r'var\s+picdic_dictList\s*=\s*', content)
    if not var_match:
        print("错误：未找到 'var picdic_dictList =' 定义")
        return
    start_pos = var_match.end()

    brace_start = content.find('{', start_pos)
    if brace_start == -1:
        print("错误：未找到对象起始花括号")
        return

    brace_count = 0
    end_pos = -1
    for i in range(brace_start, len(content)):
        ch = content[i]
        if ch == '{':
            brace_count += 1
        elif ch == '}':
            brace_count -= 1
            if brace_count == 0:
                end_pos = i + 1
                break
    if end_pos == -1:
        print("错误：未找到对象结束花括号")
        return

    temp = content[end_pos:]
    temp = temp.lstrip()
    if temp.startswith(';'):
        end_pos += temp.find(';') + 1

    obj_body = content[brace_start:end_pos]
    pattern = r"('[^']+')\s*:\s*(\{[^}]*\}),?"
    entries = {}
    res_to_key = {}
    for m in re.finditer(pattern, obj_body, re.DOTALL):
        key = m.group(1)
        body = m.group(2)
        entries[key] = body
        res_match_in = re.search(r"resourceId:\s*'([^']+)'", body)
        if res_match_in:
            res_to_key[res_match_in.group(1)] = key

    if new_res in res_to_key:
        existing_key = res_to_key[new_res]
        print(f"检测到 resourceId '{new_res}' 已存在于条目 {existing_key} 中，将更新该条目。")
        if existing_key != "'" + new_key + "'":
            print(f"注意：将条目从 {existing_key} 迁移到 '{new_key}'")
            del entries[existing_key]
        old_version_match = re.search(r"version:\s*'([^']+)'", entries.get(existing_key, ''))
        old_version = old_version_match.group(1) if old_version_match else '1'
        new_body = f"""{{
            name: '{new_name}',
            index_language: '{new_lang}',
            contents_language: '{new_cont_lang}',
            indexPath: '{new_index}',
            version: '{old_version}',
            resourceId: '{new_res}'
        }}"""
        entries["'" + new_key + "'"] = new_body
        updated_key = "'" + new_key + "'"
    else:
        print(f"新增条目 '{new_key}' (resourceId: {new_res})")
        new_body = f"""{{
            name: '{new_name}',
            index_language: '{new_lang}',
            contents_language: '{new_cont_lang}',
            indexPath: '{new_index}',
            version: '{new_version}',
            resourceId: '{new_res}'
        }}"""
        entries["'" + new_key + "'"] = new_body
        updated_key = "'" + new_key + "'"

    sorted_keys = sorted(entries.keys(), key=lambda k: k.strip("'"))
    new_obj_body = "{\n"
    for i, k in enumerate(sorted_keys):
        comma = "," if i < len(sorted_keys) - 1 else ""
        new_obj_body += f"    {k}: {entries[k]}{comma}\n"
    new_obj_body += "    };"

    new_full_definition = f"var picdic_dictList = {new_obj_body}"
    new_content = content[:var_match.start()] + new_full_definition + content[end_pos:]

    with open(list_js_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f"✅ 已更新 {list_js_path}，条目顺序按键名字母排序。")
    return updated_key

# ================== 主函数 ==================
def main():
    import argparse
    parser = argparse.ArgumentParser(description='PicDic 索引构建工具')
    parser.add_argument('-c', '--config', default=CONFIG_FILE,
                        help='指定配置文件路径（默认: __PicDic_dictionary_config.txt）')
    args = parser.parse_args()

    config = parse_config_file(args.config)
    DICT_ID = config['DICT_ID']
    DICT_NAME = config['DICT_NAME']
    DICT_FILE_NAME = config['DICT_FILE_NAME']
    INDEX_LANGUAGE = config['INDEX_LANGUAGE']
    CONTENTS_LANGUAGE = config['CONTENTS_LANGUAGE']
    INDEX_FILE = config['INDEX_FILE']
    INDEX_DIR = config.get('INDEX_DIR', '.')
    BODY_START_MARKER = config['BODY_START_MARKER']
    BODY_END_MARKER = config['BODY_END_MARKER']
    COLUMN_NUM = config['COLUMN_NUM']
    GENERATE_MDX = config['GENERATE_MDX']
    SEPARATOR = config['SEPARATOR']
    WITH_COORDINATES = config['WITH_COORDINATES']

    index_file_path = os.path.join(INDEX_DIR, INDEX_FILE)
    if not os.path.isfile(index_file_path):
        print(f"错误：索引文件 '{index_file_path}' 不存在！")
        sys.exit(1)

    output_dir = DICT_FILE_NAME
    os.makedirs(output_dir, exist_ok=True)
    print(f"输出文件夹：{output_dir}")

    print(f"正在解析索引文件：{index_file_path}（分隔符：{repr(SEPARATOR)}，列数：{COLUMN_NUM}）")
    pages, word_to_pages, special, has_position = parse_index_file(
        index_file_path, BODY_START_MARKER, BODY_END_MARKER, SEPARATOR, COLUMN_NUM
    )
    print(f"解析完成：{len(pages)} 个页码，{len(word_to_pages)} 个词条，{len(special)} 个特殊页")
    if has_position:
        print("检测到位置信息，源文件包含坐标。")
    else:
        print("未检测到位置信息，源文件无坐标。")
    print(f"WITH_COORDINATES 配置：{'开启' if WITH_COORDINATES else '关闭'}")

    # 生成 DSL
    dsl_filename = f"{DICT_FILE_NAME}.dsl"
    dsl_path = os.path.join(output_dir, dsl_filename)
    with open(dsl_path, 'w', encoding='utf-8-sig') as f:
        f.write(generate_dsl(DICT_FILE_NAME, DICT_NAME, INDEX_LANGUAGE, CONTENTS_LANGUAGE))
    print(f"已生成：{dsl_path}")

    # 计算 MD5
    md5_string = f"PicDic/{DICT_FILE_NAME}/{dsl_filename}"
    md5_hash = hashlib.md5(md5_string.encode('utf-8')).hexdigest()
    print(f"资源 ID (MD5): {md5_hash}")

    # 生成条目文件
    index_path = f"{DICT_FILE_NAME}/{DICT_FILE_NAME}_index.js"
    entry_text = generate_dict_list_entry(
        DICT_FILE_NAME,
        DICT_NAME,
        INDEX_LANGUAGE,
        CONTENTS_LANGUAGE,
        index_path,
        md5_hash
    )
    entry_filename = os.path.join(output_dir, f"{DICT_FILE_NAME}_用于更新PicDic_dictionary_list_js.txt")
    with open(entry_filename, 'w', encoding='utf-8') as f:
        f.write(entry_text)
    print(f"已生成：{entry_filename}")

    # 更新词典列表
    final_key = update_dictionary_list_js(entry_filename, DICT_LIST_JS)
    if not final_key:
        print("错误：未能获得最终键，使用 DICT_FILE_NAME 作为后备。")
        final_key = "'" + DICT_FILE_NAME + "'"

    # 删除临时文件
    if os.path.exists(entry_filename):
        os.remove(entry_filename)
        print(f"已删除临时文件：{entry_filename}")

    # 生成 _index.js
    js_filename = f"{DICT_FILE_NAME}_index.js"
    js_path = os.path.join(output_dir, js_filename)
    version_str = "1"
    with open(js_path, 'w', encoding='utf-8') as f:
        js_content = generate_js(
            DICT_NAME,
            pages,
            word_to_pages,
            special,
            version_str,
            COLUMN_NUM,
            has_position,
            WITH_COORDINATES
        )
        f.write(js_content)
    print(f"已生成（版本 {version_str}）：{js_path}")

    # 生成两种词条文件（仅当 WITH_COORDINATES = 1 时）
    if GENERATE_MDX and WITH_COORDINATES == 1:
        word_list = list(word_to_pages.keys())
        if word_list:
            generate_wordlist_files(word_list, output_dir, DICT_FILE_NAME, DICT_FILE_NAME)
        else:
            print("警告：word_to_pages 为空，无法生成词条文件。")
    else:
        if GENERATE_MDX and WITH_COORDINATES == 0:
            print("ℹ️ WITH_COORDINATES=0，跳过生成 _for_Mdict.txt 和 _for_Stardict.txt")

    print("\n" + "=" * 60)
    print(f"最终词典键（picdic_dictList 中的键）：{final_key}")
    print("条目内容：")
    print(entry_text)
    print("=" * 60)

    print(f"\n✅ 所有生成文件已放入 '{output_dir}' 文件夹。")
    print(f"\n✅ 主目录中的 {DICT_LIST_JS} 已自动更新，请复制到手机 GoldenDict/PicDic/ 或者 mdict/doc/PicDic/ 目录下。")
    print("\n✅ 请将包含以下文件的 {output_dir} 文件夹复制到手机 GoldenDict/PicDic/ 或者 mdict/doc/PicDic/ 目录下：")
    print(f"  - {js_filename}")
    print(f"  - {dsl_filename}")
    print(f"  - {DICT_FILE_NAME}.dsl.files.zip（手动准备）")
    print(f"  - {DICT_FILE_NAME}.bmp（手动准备）")
    if COLUMN_NUM > 1:
        print(f"  列数配置: {COLUMN_NUM}（已在 _index.js 中记录，并已计算列号）")
    if GENERATE_MDX:
        print(f"\n✅ 词条文件已生成：")
        print(f"   - {DICT_FILE_NAME}_for_Mdict.txt")
        print(f"   - {DICT_FILE_NAME}_for_Stardict.txt")
        print("   (已包含所有词条)")

if __name__ == "__main__":
    main()