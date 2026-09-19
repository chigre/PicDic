###python __build_picdic.py  【使用配置文件__build_picdic_config.txt】
###python __build_picdic.py --config PicDic_EN-EN_WorldBook_config.txt    【使用自定义的配置文件】

#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
PicDic 索引构建工具（PicOnly 整页版，V9.8 OpenCC 短语优先简体入口）
- 支持位置信息索引（word\tX%\tY%\tpage）
- 支持自定义分隔符、@ 拆分词条、自动计算列号
- wordToPages 可保存页码或详细坐标
- 生成 MDict / StarDict 转换前文本
- 默认生成新版 mode:"picOnly" 词条：词条本身不再内嵌第二套 PicDic UI，
  只提供 <PicDic_SearchWord> + 外部词典配置 JS + PicDic_DictionaryController.js
- 多个 PicOnly 图片词典同时命中时，由 Controller 共用唯一 PicDic host；
  DOM 中排在最前的词典自动显示，其他词典点击 📖 后切换到其框架内
- 中文繁体索引可自动生成简体查询别名，让 GoldenDict/MDict 在进入 PicDic 前就能命中词典
- 外部简体别名采用 OpenCC TSPhrases 短语优先 + 字级反向映射补充，避免“乾隆→干隆”一类错误入口
- 自动生成 .dsl 和更新 PicDic_dictionary_list.js
"""

import os
import sys
import hashlib
import json
import re
import html as html_lib
import urllib.request
from datetime import datetime

DEFAULT_CONFIG = {
    'DICT_ID': '',
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

    # 词条壳模式：picOnly（推荐，新版纯整页 PicDic）/ standalone（旧版直接内嵌完整 UI）
    'ENTRY_MODE': 'picOnly',
    # GoldenDict Android 的 PicDic 公共目录；MDict 直接从 MDD 使用相对资源，不需要此类路径。
    'PICDIC_BASE_GOLDENDICT': 'file:///sdcard/GoldenDict/PicDic/',
    'CONTROLLER_FILE': 'PicDic_DictionaryController.js',
    # 纯 PicDic 模式：同一结果页排在最前的 PicOnly 词典自动激活
    'AUTO_ACTIVATE_PICONLY': '1',
    # 可选：沿用旧词典的固定容器 ID，例如 ISBN_9787100028851。
    # 留空时使用 data-picdic-container 选择器（避免重复 id）。
    'CONTAINER_ID': '',
    # 外部 APP 主词典检索兼容：中文繁体索引自动增加简体查询别名。
    # auto = 中文索引自动开启；1/true = 强制开启；0/false = 关闭。
    'GENERATE_SIMPLIFIED_ALIASES': 'auto',
    # 单个繁体词头最多生成多少个简体候选（用于少数一对多反向映射）。
    'SIMPLIFIED_ALIAS_MAX_PER_WORD': '16',
    # OpenCC T→S 短语词典：优先使用本地缓存；缺失时可自动下载。
    'OPENCC_PHRASE_FIRST_ALIASES': '1',
    'OPENCC_TSPHRASES_FILE': 'opencc_data/TSPhrases.txt',
    'OPENCC_AUTO_DOWNLOAD_DATA': '1',
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
    config['AUTO_ACTIVATE_PICONLY'] = str(config.get('AUTO_ACTIVATE_PICONLY', '1')).lower() in ('true', '1', 'yes')
    config['ENTRY_MODE'] = str(config.get('ENTRY_MODE', 'picOnly')).strip() or 'picOnly'
    config['CONTAINER_ID'] = str(config.get('CONTAINER_ID', '')).strip()
    config['GENERATE_SIMPLIFIED_ALIASES'] = str(config.get('GENERATE_SIMPLIFIED_ALIASES', 'auto')).strip().lower()
    config['OPENCC_PHRASE_FIRST_ALIASES'] = str(config.get('OPENCC_PHRASE_FIRST_ALIASES', '1')).strip().lower() in ('true','1','yes','on')
    config['OPENCC_AUTO_DOWNLOAD_DATA'] = str(config.get('OPENCC_AUTO_DOWNLOAD_DATA', '1')).strip().lower() in ('true','1','yes','on')
    config['OPENCC_TSPHRASES_FILE'] = str(config.get('OPENCC_TSPHRASES_FILE', 'opencc_data/TSPhrases.txt')).strip() or 'opencc_data/TSPhrases.txt'
    try:
        config['SIMPLIFIED_ALIAS_MAX_PER_WORD'] = max(1, min(64, int(config.get('SIMPLIFIED_ALIAS_MAX_PER_WORD', '16'))))
    except ValueError:
        config['SIMPLIFIED_ALIAS_MAX_PER_WORD'] = 16
    sep = config.get('SEPARATOR', '\t')
    if sep == '\\t':
        sep = '\t'
    config['SEPARATOR'] = sep
    if not config['DICT_FILE_NAME']:
        config['DICT_FILE_NAME'] = config.get('DICT_ID') or 'PicDic_MyDict'
    if not config.get('DICT_ID'):
        config['DICT_ID'] = config['DICT_FILE_NAME']
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

# ================== GoldenDict/MDict 外部简体别名 ==================
# 这组映射与 PicDic_opencc.js 的 S→T 搜索语义保持一致，来源于
# OpenCC/opencc-data 1.4.2 的 STCharacters / TWVariants 语义。
# 构建器在这里做“反向索引”：繁体词头 -> 可触发该词头的简体入口。
# 目的不是改写 PicDic 内部索引，而只是让宿主 APP 的主搜索框先命中这本词典。
_OPENCC_BASE_DATA = '㑇\t㑳\n㑩\t儸\n㓥\t劏\n㔉\t劚\n㖊\t噚\n㖞\t喎\n㘎\t㘚\n㟆\t㠏\n㤘\t㥮\n㧐\t㩳\n㧑\t撝\n㧟\t擓\n㨫\t㩜\n㭎\t棡\n㱩\t殰\n㱮\t殨\n㲿\t瀇\n㶉\t鸂\n㶶\t燶\n㶽\t煱\n㺍\t獱\n䁖\t瞜\n䃅\t磾\n䅉\t稏\n䅟\t穇\n䇲\t筴\n䌶\t䊷\n䌷\t紬\n䌸\t縳\n䌹\t絅\n䌺\t䋙\n䌼\t綐\n䌽\t綵\n䌾\t䋻\n䍀\t繿\n䍁\t繸\n䏝\t膞\n䓕\t薳\n䓖\t藭\n䓨\t罃\n䗖\t螮\n䙓\t襬\n䜣\t訢\n䜧\t譅\n䜩\t讌\n䝙\t貙\n䞍\t䝼\n䞐\t賰\n䥽\t鏺\n䦃\t鐯\n䩄\t靦\n䯄\t騧\n䯅\t䯀\n䲝\t䱽\n䲟\t鮣\n䲠\t鰆\n䲢\t鰧\n䴓\t鳾\n䴔\t鵁\n䴕\t鴷\n䴖\t鶄\n䴗\t鶪\n䴘\t鷈\n䴙\t鷿\n䶮\t龑\n万\t萬\n与\t與\n丑\t醜\n专\t專\n业\t業\n丛\t叢\n东\t東\n丝\t絲\n丢\t丟\n两\t兩\n严\t嚴\n丧\t喪\n个\t個\n丰\t豐\n临\t臨\n为\t為\n丽\t麗\n举\t舉\n么\t麼\n义\t義\n乌\t烏\n乐\t樂\n乔\t喬\n习\t習\n乡\t鄉\n书\t書\n买\t買\n乱\t亂\n争\t爭\n于\t於\n亏\t虧\n云\t雲\n亘\t亙\n亚\t亞\n产\t產\n亩\t畝\n亲\t親\n亵\t褻\n亸\t嚲\n亿\t億\n仅\t僅\n仆\t僕\n从\t從\n仑\t侖\n仓\t倉\n仪\t儀\n们\t們\n价\t價\n众\t眾\n优\t優\n会\t會\n伛\t傴\n伞\t傘\n伟\t偉\n传\t傳\n伣\t俔\n伤\t傷\n伥\t倀\n伦\t倫\n伧\t傖\n伪\t偽\n伫\t佇\n体\t體\n佣\t傭\n佥\t僉\n侠\t俠\n侣\t侶\n侥\t僥\n侦\t偵\n侧\t側\n侨\t僑\n侩\t儈\n侪\t儕\n侬\t儂\n俣\t俁\n俦\t儔\n俨\t儼\n俩\t倆\n俪\t儷\n俫\t倈\n俭\t儉\n债\t債\n倾\t傾\n偬\t傯\n偻\t僂\n偾\t僨\n偿\t償\n傥\t儻\n傧\t儐\n储\t儲\n傩\t儺\n儿\t兒\n兑\t兌\n兖\t兗\n党\t黨\n兰\t蘭\n关\t關\n兴\t興\n兹\t茲\n养\t養\n兽\t獸\n冁\t囅\n内\t內\n冈\t岡\n册\t冊\n写\t寫\n军\t軍\n农\t農\n冯\t馮\n冲\t衝\n决\t決\n况\t況\n冻\t凍\n净\t淨\n凄\t悽\n凉\t涼\n减\t減\n凑\t湊\n凛\t凜\n几\t幾\n凤\t鳳\n凫\t鳧\n凭\t憑\n凯\t凱\n击\t擊\n凿\t鑿\n刍\t芻\n刘\t劉\n则\t則\n刚\t剛\n创\t創\n删\t刪\n别\t別\n刬\t剗\n刭\t剄\n刹\t剎\n刽\t劊\n刿\t劌\n剀\t剴\n剂\t劑\n剐\t剮\n剑\t劍\n剥\t剝\n剧\t劇\n劝\t勸\n办\t辦\n务\t務\n劢\t勱\n动\t動\n励\t勵\n劲\t勁\n劳\t勞\n势\t勢\n勋\t勳\n勚\t勩\n匀\t勻\n匦\t匭\n匮\t匱\n区\t區\n医\t醫\n华\t華\n协\t協\n单\t單\n卖\t賣\n占\t佔\n卢\t盧\n卤\t滷\n卧\t臥\n卫\t衛\n却\t卻\n厂\t廠\n厅\t廳\n历\t歷\n厉\t厲\n压\t壓\n厌\t厭\n厍\t厙\n厐\t龎\n厕\t廁\n厘\t釐\n厢\t廂\n厣\t厴\n厦\t廈\n厨\t廚\n厩\t廄\n厮\t廝\n县\t縣\n叁\t叄\n参\t參\n叆\t靉\n叇\t靆\n双\t雙\n发\t發\n变\t變\n叙\t敘\n叠\t疊\n叶\t葉\n号\t號\n叹\t嘆\n叽\t嘰\n后\t後\n吓\t嚇\n吕\t呂\n吗\t嗎\n吣\t吣\n吨\t噸\n听\t聽\n启\t啓\n吴\t吳\n呐\t吶\n呒\t嘸\n呓\t囈\n呕\t嘔\n呖\t嚦\n呗\t唄\n员\t員\n呙\t咼\n呛\t嗆\n呜\t嗚\n咏\t詠\n咙\t嚨\n咛\t嚀\n咝\t噝\n咤\t吒\n响\t響\n哑\t啞\n哒\t噠\n哓\t嘵\n哔\t嗶\n哕\t噦\n哗\t譁\n哙\t噲\n哜\t嚌\n哝\t噥\n哟\t喲\n唛\t嘜\n唝\t嗊\n唠\t嘮\n唡\t啢\n唢\t嗩\n唤\t喚\n啧\t嘖\n啬\t嗇\n啭\t囀\n啮\t齧\n啰\t囉\n啴\t嘽\n啸\t嘯\n喂\t喂\n喷\t噴\n喽\t嘍\n喾\t嚳\n嗫\t囁\n嗳\t噯\n嘘\t噓\n嘤\t嚶\n嘱\t囑\n噜\t嚕\n嚣\t囂\n团\t團\n园\t園\n囱\t囪\n围\t圍\n囵\t圇\n国\t國\n图\t圖\n圆\t圓\n圣\t聖\n圹\t壙\n场\t場\n坂\t阪\n坏\t壞\n块\t塊\n坚\t堅\n坛\t壇\n坜\t壢\n坝\t壩\n坞\t塢\n坟\t墳\n坠\t墜\n垄\t壟\n垅\t壠\n垆\t壚\n垒\t壘\n垦\t墾\n垩\t堊\n垫\t墊\n垭\t埡\n垯\t墶\n垱\t壋\n垲\t塏\n垴\t堖\n埘\t塒\n埙\t壎\n埚\t堝\n埯\t垵\n堑\t塹\n堕\t墮\n塆\t壪\n墙\t牆\n壮\t壯\n声\t聲\n壳\t殼\n壶\t壺\n壸\t壼\n处\t處\n备\t備\n复\t復\n够\t夠\n头\t頭\n夸\t誇\n夹\t夾\n夺\t奪\n奁\t奩\n奂\t奐\n奋\t奮\n奖\t獎\n奥\t奧\n妆\t妝\n妇\t婦\n妈\t媽\n妩\t嫵\n妪\t嫗\n妫\t媯\n姗\t姍\n姹\t奼\n娄\t婁\n娅\t婭\n娆\t嬈\n娇\t嬌\n娈\t孌\n娱\t娛\n娲\t媧\n娴\t嫺\n婳\t嫿\n婴\t嬰\n婵\t嬋\n婶\t嬸\n媪\t媼\n媭\t嬃\n嫒\t嬡\n嫔\t嬪\n嫱\t嬙\n嬷\t嬤\n孙\t孫\n学\t學\n孪\t孿\n宁\t寧\n宝\t寶\n实\t實\n宠\t寵\n审\t審\n宪\t憲\n宫\t宮\n宽\t寬\n宾\t賓\n寝\t寢\n对\t對\n寻\t尋\n导\t導\n寿\t壽\n将\t將\n尔\t爾\n尘\t塵\n尝\t嘗\n尧\t堯\n尴\t尷\n尸\t屍\n尽\t盡\n层\t層\n屃\t屓\n屉\t屜\n届\t屆\n属\t屬\n屡\t屢\n屦\t屨\n屿\t嶼\n岁\t歲\n岂\t豈\n岖\t嶇\n岗\t崗\n岘\t峴\n岙\t嶴\n岚\t嵐\n岛\t島\n岭\t嶺\n岽\t崬\n岿\t巋\n峃\t嶨\n峄\t嶧\n峡\t峽\n峣\t嶢\n峤\t嶠\n峥\t崢\n峦\t巒\n崂\t嶗\n崃\t崍\n崄\t嶮\n崭\t嶄\n嵘\t嶸\n嵚\t嶔\n嵝\t嶁\n巅\t巔\n巩\t鞏\n巯\t巰\n币\t幣\n帅\t帥\n师\t師\n帏\t幃\n帐\t帳\n帘\t簾\n帜\t幟\n带\t帶\n帧\t幀\n帮\t幫\n帱\t幬\n帻\t幘\n帼\t幗\n幂\t冪\n干\t幹\n并\t並\n广\t廣\n庄\t莊\n庆\t慶\n庐\t廬\n庑\t廡\n库\t庫\n应\t應\n庙\t廟\n庞\t龐\n废\t廢\n庼\t廎\n廪\t廩\n开\t開\n异\t異\n弃\t棄\n弑\t弒\n张\t張\n弥\t彌\n弪\t弳\n弯\t彎\n弹\t彈\n强\t強\n归\t歸\n当\t當\n录\t錄\n彟\t彠\n彦\t彥\n彷\t徬\n彻\t徹\n征\t徵\n径\t徑\n徕\t徠\n忆\t憶\n忏\t懺\n忧\t憂\n忾\t愾\n怀\t懷\n态\t態\n怂\t慫\n怃\t憮\n怄\t慪\n怅\t悵\n怆\t愴\n怜\t憐\n总\t總\n怼\t懟\n怿\t懌\n恋\t戀\n恒\t恆\n恳\t懇\n恶\t惡\n恸\t慟\n恹\t懨\n恺\t愷\n恻\t惻\n恼\t惱\n恽\t惲\n悦\t悅\n悫\t愨\n悬\t懸\n悭\t慳\n悮\t悞\n悯\t憫\n惊\t驚\n惧\t懼\n惨\t慘\n惩\t懲\n惫\t憊\n惬\t愜\n惭\t慚\n惮\t憚\n惯\t慣\n愠\t慍\n愤\t憤\n愦\t憒\n愿\t願\n慑\t懾\n慭\t憖\n懑\t懣\n懒\t懶\n懔\t懍\n戆\t戇\n戋\t戔\n戏\t戲\n戗\t戧\n战\t戰\n戬\t戩\n戯\t戱\n户\t戶\n扑\t撲\n执\t執\n扩\t擴\n扪\t捫\n扫\t掃\n扬\t揚\n扰\t擾\n抚\t撫\n抛\t拋\n抟\t摶\n抠\t摳\n抡\t掄\n抢\t搶\n护\t護\n报\t報\n担\t擔\n拟\t擬\n拢\t攏\n拣\t揀\n拥\t擁\n拦\t攔\n拧\t擰\n拨\t撥\n择\t擇\n挂\t掛\n挚\t摯\n挛\t攣\n挜\t掗\n挝\t撾\n挞\t撻\n挟\t挾\n挠\t撓\n挡\t擋\n挢\t撟\n挣\t掙\n挤\t擠\n挥\t揮\n挦\t撏\n挽\t挽\n捝\t挩\n捞\t撈\n损\t損\n捡\t撿\n换\t換\n捣\t搗\n据\t據\n掳\t擄\n掴\t摑\n掷\t擲\n掸\t撣\n掺\t摻\n掼\t摜\n揽\t攬\n揾\t搵\n揿\t撳\n搀\t攙\n搁\t擱\n搂\t摟\n搅\t攪\n携\t攜\n摄\t攝\n摅\t攄\n摆\t擺\n摇\t搖\n摈\t擯\n摊\t攤\n撄\t攖\n撑\t撐\n撵\t攆\n撷\t擷\n撸\t擼\n撺\t攛\n擞\t擻\n攒\t攢\n敌\t敵\n敛\t斂\n敩\t斆\n数\t數\n斋\t齋\n斓\t斕\n斗\t鬥\n斩\t斬\n断\t斷\n无\t無\n旧\t舊\n时\t時\n旷\t曠\n旸\t暘\n昙\t曇\n昵\t暱\n昼\t晝\n昽\t曨\n显\t顯\n晋\t晉\n晒\t曬\n晓\t曉\n晔\t曄\n晕\t暈\n晖\t暉\n暂\t暫\n暧\t曖\n术\t術\n朴\t樸\n机\t機\n杀\t殺\n杂\t雜\n权\t權\n杆\t杆\n杠\t槓\n条\t條\n来\t來\n杨\t楊\n杩\t榪\n杰\t傑\n极\t極\n构\t構\n枞\t樅\n枢\t樞\n枣\t棗\n枥\t櫪\n枧\t梘\n枨\t棖\n枪\t槍\n枫\t楓\n枭\t梟\n柜\t櫃\n柠\t檸\n柽\t檉\n栀\t梔\n栅\t柵\n标\t標\n栈\t棧\n栉\t櫛\n栊\t櫳\n栋\t棟\n栌\t櫨\n栎\t櫟\n栏\t欄\n树\t樹\n栖\t棲\n样\t樣\n栾\t欒\n桠\t椏\n桡\t橈\n桢\t楨\n档\t檔\n桤\t榿\n桥\t橋\n桦\t樺\n桧\t檜\n桨\t槳\n桩\t樁\n梦\t夢\n梼\t檮\n梾\t棶\n梿\t槤\n检\t檢\n棁\t梲\n棂\t櫺\n棱\t棱\n椁\t槨\n椟\t櫝\n椠\t槧\n椤\t欏\n椭\t橢\n楼\t樓\n榄\t欖\n榅\t榲\n榇\t櫬\n榈\t櫚\n榉\t櫸\n槚\t檟\n槛\t檻\n槟\t檳\n槠\t櫧\n横\t橫\n樯\t檣\n樱\t櫻\n橥\t櫫\n橱\t櫥\n橹\t櫓\n橼\t櫞\n檩\t檁\n欢\t歡\n欤\t歟\n欧\t歐\n歼\t殲\n殁\t歿\n殇\t殤\n残\t殘\n殒\t殞\n殓\t殮\n殚\t殫\n殡\t殯\n殴\t毆\n毁\t毀\n毂\t轂\n毕\t畢\n毙\t斃\n毡\t氈\n毵\t毿\n氇\t氌\n气\t氣\n氢\t氫\n氩\t氬\n氲\t氳\n汇\t匯\n汉\t漢\n汤\t湯\n汹\t洶\n沉\t沈\n沟\t溝\n没\t沒\n沣\t灃\n沤\t漚\n沥\t瀝\n沦\t淪\n沧\t滄\n沨\t渢\n沩\t溈\n沪\t滬\n泄\t洩\n泞\t濘\n泪\t淚\n泶\t澩\n泷\t瀧\n泸\t瀘\n泺\t濼\n泻\t瀉\n泼\t潑\n泽\t澤\n泾\t涇\n洁\t潔\n洒\t灑\n洼\t窪\n浃\t浹\n浅\t淺\n浆\t漿\n浇\t澆\n浈\t湞\n浉\t溮\n浊\t濁\n测\t測\n浍\t澮\n济\t濟\n浏\t瀏\n浐\t滻\n浑\t渾\n浒\t滸\n浓\t濃\n浔\t潯\n浕\t濜\n涂\t塗\n涌\t湧\n涛\t濤\n涝\t澇\n涞\t淶\n涟\t漣\n涠\t潿\n涡\t渦\n涢\t溳\n涣\t渙\n涤\t滌\n润\t潤\n涧\t澗\n涨\t漲\n涩\t澀\n淀\t澱\n渊\t淵\n渌\t淥\n渍\t漬\n渎\t瀆\n渐\t漸\n渑\t澠\n渔\t漁\n渖\t瀋\n渗\t滲\n温\t溫\n湾\t灣\n湿\t濕\n溁\t濚\n溃\t潰\n溅\t濺\n溆\t漵\n溇\t漊\n滗\t潷\n滚\t滾\n滞\t滯\n滟\t灩\n滠\t灄\n满\t滿\n滢\t瀅\n滤\t濾\n滥\t濫\n滦\t灤\n滨\t濱\n滩\t灘\n滪\t澦\n漓\t漓\n漤\t灠\n潆\t瀠\n潇\t瀟\n潋\t瀲\n潍\t濰\n潜\t潛\n潴\t瀦\n澛\t瀂\n澜\t瀾\n濑\t瀨\n濒\t瀕\n灏\t灝\n灭\t滅\n灯\t燈\n灵\t靈\n灾\t災\n灿\t燦\n炀\t煬\n炉\t爐\n炖\t燉\n炜\t煒\n炝\t熗\n点\t點\n炼\t煉\n炽\t熾\n烁\t爍\n烂\t爛\n烃\t烴\n烛\t燭\n烟\t煙\n烦\t煩\n烧\t燒\n烨\t燁\n烩\t燴\n烫\t燙\n烬\t燼\n热\t熱\n焕\t煥\n焖\t燜\n焘\t燾\n煴\t熅\n爱\t愛\n爷\t爺\n牍\t牘\n牦\t氂\n牵\t牽\n牺\t犧\n犊\t犢\n状\t狀\n犷\t獷\n犸\t獁\n犹\t猶\n狈\t狽\n狝\t獮\n狞\t獰\n独\t獨\n狭\t狹\n狮\t獅\n狯\t獪\n狰\t猙\n狱\t獄\n狲\t猻\n猃\t獫\n猎\t獵\n猕\t獼\n猡\t玀\n猪\t豬\n猫\t貓\n猬\t蝟\n献\t獻\n獭\t獺\n玑\t璣\n玙\t璵\n玚\t瑒\n玛\t瑪\n玮\t瑋\n环\t環\n现\t現\n玱\t瑲\n玺\t璽\n珐\t琺\n珑\t瓏\n珰\t璫\n珲\t琿\n琎\t璡\n琏\t璉\n琐\t瑣\n琼\t瓊\n瑶\t瑤\n瑷\t璦\n璎\t瓔\n瓒\t瓚\n瓮\t甕\n瓯\t甌\n电\t電\n画\t畫\n畅\t暢\n畴\t疇\n疖\t癤\n疗\t療\n疟\t瘧\n疠\t癘\n疡\t瘍\n疬\t癧\n疭\t瘲\n疮\t瘡\n疯\t瘋\n疱\t皰\n疴\t痾\n痈\t癰\n痉\t痙\n痒\t癢\n痖\t瘂\n痨\t癆\n痪\t瘓\n痫\t癇\n瘅\t癉\n瘆\t瘮\n瘗\t瘞\n瘘\t瘻\n瘪\t癟\n瘫\t癱\n瘾\t癮\n瘿\t癭\n癞\t癩\n癣\t癬\n癫\t癲\n皑\t皚\n皱\t皺\n皲\t皸\n盏\t盞\n盐\t鹽\n监\t監\n盖\t蓋\n盗\t盜\n盘\t盤\n眍\t瞘\n眦\t眥\n眬\t矓\n着\t著\n睁\t睜\n睐\t睞\n睑\t瞼\n睾\t睪\n瞆\t瞶\n瞒\t瞞\n瞩\t矚\n矫\t矯\n矶\t磯\n矾\t礬\n矿\t礦\n砀\t碭\n码\t碼\n砖\t磚\n砗\t硨\n砚\t硯\n砜\t碸\n砺\t礪\n砻\t礱\n砾\t礫\n础\t礎\n硁\t硜\n硕\t碩\n硖\t硤\n硗\t磽\n硙\t磑\n硚\t礄\n确\t確\n硷\t硷\n碍\t礙\n碛\t磧\n碜\t磣\n碱\t鹼\n礴\t礡\n礼\t禮\n祃\t禡\n祎\t禕\n祢\t禰\n祯\t禎\n祷\t禱\n祸\t禍\n禀\t稟\n禄\t祿\n禅\t禪\n离\t離\n秃\t禿\n秆\t稈\n种\t種\n积\t積\n称\t稱\n秽\t穢\n秾\t穠\n稆\t穭\n税\t稅\n稣\t穌\n稳\t穩\n穑\t穡\n穷\t窮\n窃\t竊\n窍\t竅\n窎\t窵\n窑\t窯\n窜\t竄\n窝\t窩\n窥\t窺\n窦\t竇\n窭\t窶\n竖\t竪\n竞\t競\n笃\t篤\n笋\t筍\n笔\t筆\n笕\t筧\n笺\t箋\n笼\t籠\n笾\t籩\n筑\t築\n筚\t篳\n筛\t篩\n筜\t簹\n筝\t箏\n筹\t籌\n筼\t篔\n签\t籤\n简\t簡\n箓\t籙\n箦\t簀\n箧\t篋\n箨\t籜\n箩\t籮\n箪\t簞\n箫\t簫\n篑\t簣\n篓\t簍\n篮\t籃\n篯\t籛\n篱\t籬\n簖\t籪\n籁\t籟\n籴\t糴\n类\t類\n籼\t秈\n粜\t糶\n粝\t糲\n粤\t粵\n粪\t糞\n粮\t糧\n糁\t糝\n糇\t餱\n紧\t緊\n絷\t縶\n纟\t糹\n纠\t糾\n纡\t紆\n红\t紅\n纣\t紂\n纤\t纖\n纥\t紇\n约\t約\n级\t級\n纨\t紈\n纩\t纊\n纪\t紀\n纫\t紉\n纬\t緯\n纭\t紜\n纮\t紘\n纯\t純\n纰\t紕\n纱\t紗\n纲\t綱\n纳\t納\n纴\t紝\n纵\t縱\n纶\t綸\n纷\t紛\n纸\t紙\n纹\t紋\n纺\t紡\n纻\t紵\n纼\t紖\n纽\t紐\n纾\t紓\n线\t線\n绀\t紺\n绁\t紲\n绂\t紱\n练\t練\n组\t組\n绅\t紳\n细\t細\n织\t織\n终\t終\n绉\t縐\n绊\t絆\n绋\t紼\n绌\t絀\n绍\t紹\n绎\t繹\n经\t經\n绐\t紿\n绑\t綁\n绒\t絨\n结\t結\n绔\t絝\n绕\t繞\n绖\t絰\n绗\t絎\n绘\t繪\n给\t給\n绚\t絢\n绛\t絳\n络\t絡\n绝\t絕\n绞\t絞\n统\t統\n绠\t綆\n绡\t綃\n绢\t絹\n绣\t繡\n绤\t綌\n绥\t綏\n绦\t縧\n继\t繼\n绨\t綈\n绩\t績\n绪\t緒\n绫\t綾\n绬\t緓\n续\t續\n绮\t綺\n绯\t緋\n绰\t綽\n绱\t鞝\n绲\t緄\n绳\t繩\n维\t維\n绵\t綿\n绶\t綬\n绷\t繃\n绸\t綢\n绹\t綯\n绺\t綹\n绻\t綣\n综\t綜\n绽\t綻\n绾\t綰\n绿\t綠\n缀\t綴\n缁\t緇\n缂\t緙\n缃\t緗\n缄\t緘\n缅\t緬\n缆\t纜\n缇\t緹\n缈\t緲\n缉\t緝\n缊\t縕\n缋\t繢\n缌\t緦\n缍\t綞\n缎\t緞\n缏\t緶\n缐\t線\n缑\t緱\n缒\t縋\n缓\t緩\n缔\t締\n缕\t縷\n编\t編\n缗\t緡\n缘\t緣\n缙\t縉\n缚\t縛\n缛\t縟\n缜\t縝\n缝\t縫\n缞\t縗\n缟\t縞\n缠\t纏\n缡\t縭\n缢\t縊\n缣\t縑\n缤\t繽\n缥\t縹\n缦\t縵\n缧\t縲\n缨\t纓\n缩\t縮\n缪\t繆\n缫\t繅\n缬\t纈\n缭\t繚\n缮\t繕\n缯\t繒\n缰\t繮\n缱\t繾\n缲\t繰\n缳\t繯\n缴\t繳\n缵\t纘\n罂\t罌\n网\t網\n罗\t羅\n罚\t罰\n罢\t罷\n罴\t羆\n羁\t羈\n羟\t羥\n羡\t羨\n翘\t翹\n翙\t翽\n翚\t翬\n耢\t耮\n耧\t耬\n耸\t聳\n耻\t恥\n聂\t聶\n聋\t聾\n职\t職\n聍\t聹\n联\t聯\n聩\t聵\n聪\t聰\n肃\t肅\n肠\t腸\n肤\t膚\n肮\t骯\n肾\t腎\n肿\t腫\n胀\t脹\n胁\t脅\n胆\t膽\n胜\t勝\n胧\t朧\n胨\t腖\n胪\t臚\n胫\t脛\n胶\t膠\n脉\t脈\n脍\t膾\n脏\t髒\n脐\t臍\n脑\t腦\n脓\t膿\n脔\t臠\n脚\t腳\n脱\t脫\n脶\t腡\n脸\t臉\n腊\t臘\n腌\t醃\n腘\t膕\n腭\t齶\n腻\t膩\n腽\t膃\n腾\t騰\n膑\t臏\n膻\t羶\n臜\t臢\n舆\t輿\n舍\t舍\n舣\t艤\n舰\t艦\n舱\t艙\n舻\t艫\n艰\t艱\n艳\t豔\n艺\t藝\n节\t節\n芈\t羋\n芗\t薌\n芜\t蕪\n芦\t蘆\n苁\t蓯\n苇\t葦\n苈\t藶\n苋\t莧\n苌\t萇\n苍\t蒼\n苎\t苧\n苏\t蘇\n苧\t薴\n苹\t蘋\n范\t範\n茎\t莖\n茏\t蘢\n茑\t蔦\n茔\t塋\n茕\t煢\n茧\t繭\n荆\t荊\n荐\t薦\n荙\t薘\n荚\t莢\n荛\t蕘\n荜\t蓽\n荞\t蕎\n荟\t薈\n荠\t薺\n荡\t蕩\n荣\t榮\n荤\t葷\n荥\t滎\n荦\t犖\n荧\t熒\n荨\t蕁\n荩\t藎\n荪\t蓀\n荫\t蔭\n荬\t蕒\n荭\t葒\n荮\t葤\n药\t藥\n莅\t蒞\n莱\t萊\n莲\t蓮\n莳\t蒔\n莴\t萵\n莶\t薟\n获\t獲\n莸\t蕕\n莹\t瑩\n莺\t鶯\n莼\t蒓\n萚\t蘀\n萝\t蘿\n萤\t螢\n营\t營\n萦\t縈\n萧\t蕭\n萨\t薩\n葱\t蔥\n蒇\t蕆\n蒉\t蕢\n蒋\t蔣\n蒌\t蔞\n蓝\t藍\n蓟\t薊\n蓠\t蘺\n蓣\t蕷\n蓥\t鎣\n蓦\t驀\n蔂\t虆\n蔷\t薔\n蔹\t蘞\n蔺\t藺\n蔼\t藹\n蕰\t薀\n蕲\t蘄\n蕴\t蘊\n薮\t藪\n藓\t蘚\n蘖\t櫱\n虏\t虜\n虑\t慮\n虚\t虛\n虫\t蟲\n虬\t虯\n虮\t蟣\n虱\t蝨\n虽\t雖\n虾\t蝦\n虿\t蠆\n蚀\t蝕\n蚁\t蟻\n蚂\t螞\n蚕\t蠶\n蚝\t蠔\n蚬\t蜆\n蛊\t蠱\n蛎\t蠣\n蛏\t蟶\n蛮\t蠻\n蛰\t蟄\n蛱\t蛺\n蛲\t蟯\n蛳\t螄\n蛴\t蠐\n蜕\t蛻\n蜗\t蝸\n蜡\t蠟\n蝇\t蠅\n蝈\t蟈\n蝉\t蟬\n蝎\t蠍\n蝼\t螻\n蝾\t蠑\n螀\t螿\n螨\t蟎\n蟏\t蠨\n衅\t釁\n衔\t銜\n补\t補\n衬\t襯\n衮\t袞\n袄\t襖\n袅\t嫋\n袆\t褘\n袜\t襪\n袭\t襲\n袯\t襏\n装\t裝\n裆\t襠\n裈\t褌\n裢\t褳\n裣\t襝\n裤\t褲\n裥\t襉\n褛\t褸\n褴\t襤\n襕\t襴\n见\t見\n观\t觀\n觃\t覎\n规\t規\n觅\t覓\n视\t視\n觇\t覘\n览\t覽\n觉\t覺\n觊\t覬\n觋\t覡\n觌\t覿\n觍\t覥\n觎\t覦\n觏\t覯\n觐\t覲\n觑\t覷\n觞\t觴\n触\t觸\n觯\t觶\n訚\t誾\n詟\t讋\n誉\t譽\n誊\t謄\n讠\t訁\n计\t計\n订\t訂\n讣\t訃\n认\t認\n讥\t譏\n讦\t訐\n讧\t訌\n讨\t討\n让\t讓\n讪\t訕\n讫\t訖\n讬\t託\n训\t訓\n议\t議\n讯\t訊\n记\t記\n讱\t訒\n讲\t講\n讳\t諱\n讴\t謳\n讵\t詎\n讶\t訝\n讷\t訥\n许\t許\n讹\t訛\n论\t論\n讻\t訩\n讼\t訟\n讽\t諷\n设\t設\n访\t訪\n诀\t訣\n证\t證\n诂\t詁\n诃\t訶\n评\t評\n诅\t詛\n识\t識\n诇\t詗\n诈\t詐\n诉\t訴\n诊\t診\n诋\t詆\n诌\t謅\n词\t詞\n诎\t詘\n诏\t詔\n诐\t詖\n译\t譯\n诒\t詒\n诓\t誆\n诔\t誄\n试\t試\n诖\t詿\n诗\t詩\n诘\t詰\n诙\t詼\n诚\t誠\n诛\t誅\n诜\t詵\n话\t話\n诞\t誕\n诟\t詬\n诠\t詮\n诡\t詭\n询\t詢\n诣\t詣\n诤\t諍\n该\t該\n详\t詳\n诧\t詫\n诨\t諢\n诩\t詡\n诪\t譸\n诫\t誡\n诬\t誣\n语\t語\n诮\t誚\n误\t誤\n诰\t誥\n诱\t誘\n诲\t誨\n诳\t誑\n说\t說\n诵\t誦\n诶\t誒\n请\t請\n诸\t諸\n诹\t諏\n诺\t諾\n读\t讀\n诼\t諑\n诽\t誹\n课\t課\n诿\t諉\n谀\t諛\n谁\t誰\n谂\t諗\n调\t調\n谄\t諂\n谅\t諒\n谆\t諄\n谇\t誶\n谈\t談\n谊\t誼\n谋\t謀\n谌\t諶\n谍\t諜\n谎\t謊\n谏\t諫\n谐\t諧\n谑\t謔\n谒\t謁\n谓\t謂\n谔\t諤\n谕\t諭\n谖\t諼\n谗\t讒\n谘\t諮\n谙\t諳\n谚\t諺\n谛\t諦\n谜\t謎\n谝\t諞\n谞\t諝\n谟\t謨\n谠\t讜\n谡\t謖\n谢\t謝\n谣\t謠\n谤\t謗\n谥\t諡\n谦\t謙\n谧\t謐\n谨\t謹\n谩\t謾\n谪\t謫\n谫\t謭\n谬\t謬\n谭\t譚\n谮\t譖\n谯\t譙\n谰\t讕\n谱\t譜\n谲\t譎\n谳\t讞\n谴\t譴\n谵\t譫\n谶\t讖\n豮\t豶\n贝\t貝\n贞\t貞\n负\t負\n贠\t貟\n贡\t貢\n财\t財\n责\t責\n贤\t賢\n败\t敗\n账\t賬\n货\t貨\n质\t質\n贩\t販\n贪\t貪\n贫\t貧\n贬\t貶\n购\t購\n贮\t貯\n贯\t貫\n贰\t貳\n贱\t賤\n贲\t賁\n贳\t貰\n贴\t貼\n贵\t貴\n贶\t貺\n贷\t貸\n贸\t貿\n费\t費\n贺\t賀\n贻\t貽\n贼\t賊\n贽\t贄\n贾\t賈\n贿\t賄\n赀\t貲\n赁\t賃\n赂\t賂\n赃\t贓\n资\t資\n赅\t賅\n赆\t贐\n赇\t賕\n赈\t賑\n赉\t賚\n赊\t賒\n赋\t賦\n赌\t賭\n赍\t賫\n赎\t贖\n赏\t賞\n赐\t賜\n赑\t贔\n赒\t賙\n赓\t賡\n赔\t賠\n赕\t賧\n赖\t賴\n赗\t賵\n赘\t贅\n赙\t賻\n赚\t賺\n赛\t賽\n赜\t賾\n赝\t贗\n赞\t贊\n赟\t贇\n赠\t贈\n赡\t贍\n赢\t贏\n赣\t贛\n赪\t赬\n赵\t趙\n赶\t趕\n趋\t趨\n趱\t趲\n趸\t躉\n跃\t躍\n跄\t蹌\n跞\t躒\n践\t踐\n跶\t躂\n跷\t蹺\n跸\t蹕\n跹\t躚\n跻\t躋\n踊\t踴\n踌\t躊\n踪\t蹤\n踬\t躓\n踯\t躑\n蹑\t躡\n蹒\t蹣\n蹰\t躕\n蹿\t躥\n躏\t躪\n躜\t躦\n躯\t軀\n车\t車\n轧\t軋\n轨\t軌\n轩\t軒\n轪\t軑\n轫\t軔\n转\t轉\n轭\t軛\n轮\t輪\n软\t軟\n轰\t轟\n轱\t軲\n轲\t軻\n轳\t轤\n轴\t軸\n轵\t軹\n轶\t軼\n轷\t軤\n轸\t軫\n轹\t轢\n轺\t軺\n轻\t輕\n轼\t軾\n载\t載\n轾\t輊\n轿\t轎\n辀\t輈\n辁\t輇\n辂\t輅\n较\t較\n辄\t輒\n辅\t輔\n辆\t輛\n辇\t輦\n辈\t輩\n辉\t輝\n辊\t輥\n辋\t輞\n辌\t輬\n辍\t輟\n辎\t輜\n辏\t輳\n辐\t輻\n辑\t輯\n辒\t轀\n输\t輸\n辔\t轡\n辕\t轅\n辖\t轄\n辗\t輾\n辘\t轆\n辙\t轍\n辚\t轔\n辞\t辭\n辩\t辯\n辫\t辮\n边\t邊\n辽\t遼\n达\t達\n迁\t遷\n过\t過\n迈\t邁\n运\t運\n还\t還\n这\t這\n进\t進\n远\t遠\n违\t違\n连\t連\n迟\t遲\n迩\t邇\n迳\t逕\n迹\t跡\n适\t適\n选\t選\n逊\t遜\n递\t遞\n逦\t邐\n逻\t邏\n遗\t遺\n遥\t遙\n邓\t鄧\n邝\t鄺\n邬\t鄔\n邮\t郵\n邹\t鄒\n邺\t鄴\n邻\t鄰\n郏\t郟\n郐\t鄶\n郑\t鄭\n郓\t鄆\n郦\t酈\n郧\t鄖\n郸\t鄲\n酂\t酇\n酝\t醖\n酦\t醱\n酱\t醬\n酽\t釅\n酾\t釃\n酿\t釀\n采\t採\n释\t釋\n鉴\t鑑\n銮\t鑾\n錾\t鏨\n钅\t釒\n钆\t釓\n钇\t釔\n针\t針\n钉\t釘\n钊\t釗\n钋\t釙\n钌\t釕\n钍\t釷\n钎\t釺\n钏\t釧\n钐\t釤\n钑\t鈒\n钒\t釩\n钓\t釣\n钔\t鍆\n钕\t釹\n钖\t鍚\n钗\t釵\n钘\t鈃\n钙\t鈣\n钚\t鈈\n钛\t鈦\n钜\t鉅\n钝\t鈍\n钞\t鈔\n钟\t鍾\n钠\t鈉\n钡\t鋇\n钢\t鋼\n钣\t鈑\n钤\t鈐\n钥\t鑰\n钦\t欽\n钧\t鈞\n钨\t鎢\n钩\t鈎\n钪\t鈧\n钫\t鈁\n钬\t鈥\n钭\t鈄\n钮\t鈕\n钯\t鈀\n钰\t鈺\n钱\t錢\n钲\t鉦\n钳\t鉗\n钴\t鈷\n钵\t鉢\n钶\t鈳\n钷\t鉕\n钸\t鈽\n钹\t鈸\n钺\t鉞\n钻\t鑽\n钼\t鉬\n钽\t鉭\n钾\t鉀\n钿\t鈿\n铀\t鈾\n铁\t鐵\n铂\t鉑\n铃\t鈴\n铄\t鑠\n铅\t鉛\n铆\t鉚\n铇\t鉋\n铈\t鈰\n铉\t鉉\n铊\t鉈\n铋\t鉍\n铌\t鈮\n铍\t鈹\n铎\t鐸\n铏\t鉶\n铐\t銬\n铑\t銠\n铒\t鉺\n铓\t鋩\n铔\t錏\n铕\t銪\n铖\t鋮\n铗\t鋏\n铘\t鋣\n铙\t鐃\n铚\t銍\n铛\t鐺\n铜\t銅\n铝\t鋁\n铞\t銱\n铟\t銦\n铠\t鎧\n铡\t鍘\n铢\t銖\n铣\t銑\n铤\t鋌\n铥\t銩\n铦\t銛\n铧\t鏵\n铨\t銓\n铩\t鎩\n铪\t鉿\n铫\t銚\n铬\t鉻\n铭\t銘\n铮\t錚\n铯\t銫\n铰\t鉸\n铱\t銥\n铲\t鏟\n铳\t銃\n铴\t鐋\n铵\t銨\n银\t銀\n铷\t銣\n铸\t鑄\n铹\t鐒\n铺\t鋪\n铻\t鋙\n铼\t錸\n铽\t鋱\n链\t鏈\n铿\t鏗\n销\t銷\n锁\t鎖\n锂\t鋰\n锃\t鋥\n锄\t鋤\n锅\t鍋\n锆\t鋯\n锇\t鋨\n锈\t鏽\n锉\t銼\n锊\t鋝\n锋\t鋒\n锌\t鋅\n锍\t鋶\n锎\t鐦\n锏\t鐧\n锐\t銳\n锑\t銻\n锒\t鋃\n锓\t鋟\n锔\t鋦\n锕\t錒\n锖\t錆\n锗\t鍺\n锘\t鍩\n错\t錯\n锚\t錨\n锛\t錛\n锜\t錡\n锝\t鍀\n锞\t錁\n锟\t錕\n锠\t錩\n锡\t錫\n锢\t錮\n锣\t鑼\n锤\t錘\n锥\t錐\n锦\t錦\n锧\t鑕\n锨\t鍁\n锩\t錈\n锪\t鍃\n锫\t錇\n锬\t錟\n锭\t錠\n键\t鍵\n锯\t鋸\n锰\t錳\n锱\t錙\n锲\t鍥\n锳\t鍈\n锴\t鍇\n锵\t鏘\n锶\t鍶\n锷\t鍔\n锸\t鍤\n锹\t鍬\n锺\t鍾\n锻\t鍛\n锼\t鎪\n锽\t鍠\n锾\t鍰\n锿\t鎄\n镀\t鍍\n镁\t鎂\n镂\t鏤\n镃\t鎡\n镄\t鐨\n镅\t鎇\n镆\t鏌\n镇\t鎮\n镈\t鎛\n镉\t鎘\n镊\t鑷\n镋\t钂\n镌\t鐫\n镍\t鎳\n镎\t鎿\n镏\t鎦\n镐\t鎬\n镑\t鎊\n镒\t鎰\n镓\t鎵\n镔\t鑌\n镕\t鎔\n镖\t鏢\n镗\t鏜\n镘\t鏝\n镙\t鏍\n镚\t鏰\n镛\t鏞\n镜\t鏡\n镝\t鏑\n镞\t鏃\n镟\t鏇\n镠\t鏐\n镡\t鐔\n镢\t钁\n镣\t鐐\n镤\t鏷\n镥\t鑥\n镦\t鐓\n镧\t鑭\n镨\t鐠\n镩\t鑹\n镪\t鏹\n镫\t鐙\n镬\t鑊\n镭\t鐳\n镮\t鐶\n镯\t鐲\n镰\t鐮\n镱\t鐿\n镲\t鑔\n镳\t鑣\n镴\t鑞\n镵\t鑱\n镶\t鑲\n长\t長\n门\t門\n闩\t閂\n闪\t閃\n闫\t閆\n闬\t閈\n闭\t閉\n问\t問\n闯\t闖\n闰\t閏\n闱\t闈\n闲\t閒\n闳\t閎\n间\t間\n闵\t閔\n闶\t閌\n闷\t悶\n闸\t閘\n闹\t鬧\n闺\t閨\n闻\t聞\n闼\t闥\n闽\t閩\n闾\t閭\n闿\t闓\n阀\t閥\n阁\t閣\n阂\t閡\n阃\t閫\n阄\t鬮\n阅\t閱\n阆\t閬\n阇\t闍\n阈\t閾\n阉\t閹\n阊\t閶\n阋\t鬩\n阌\t閿\n阍\t閽\n阎\t閻\n阏\t閼\n阐\t闡\n阑\t闌\n阒\t闃\n阓\t闠\n阔\t闊\n阕\t闋\n阖\t闔\n阗\t闐\n阘\t闒\n阙\t闕\n阚\t闞\n阛\t闤\n队\t隊\n阳\t陽\n阴\t陰\n阵\t陣\n阶\t階\n际\t際\n陆\t陸\n陇\t隴\n陈\t陳\n陉\t陘\n陕\t陝\n陧\t隉\n陨\t隕\n险\t險\n随\t隨\n隐\t隱\n隶\t隸\n隽\t雋\n难\t難\n雏\t雛\n雠\t讎\n雳\t靂\n雾\t霧\n霁\t霽\n霡\t霢\n霭\t靄\n靓\t靚\n静\t靜\n靥\t靨\n鞑\t韃\n鞒\t鞽\n鞯\t韉\n韦\t韋\n韧\t韌\n韨\t韍\n韩\t韓\n韪\t韙\n韫\t韞\n韬\t韜\n韵\t韻\n页\t頁\n顶\t頂\n顷\t頃\n顸\t頇\n项\t項\n顺\t順\n须\t須\n顼\t頊\n顽\t頑\n顾\t顧\n顿\t頓\n颀\t頎\n颁\t頒\n颂\t頌\n颃\t頏\n预\t預\n颅\t顱\n领\t領\n颇\t頗\n颈\t頸\n颉\t頡\n颊\t頰\n颋\t頲\n颌\t頜\n颍\t潁\n颎\t熲\n颏\t頦\n颐\t頤\n频\t頻\n颒\t頮\n颓\t頹\n颔\t頷\n颕\t頴\n颖\t穎\n颗\t顆\n题\t題\n颙\t顒\n颚\t顎\n颛\t顓\n颜\t顏\n额\t額\n颞\t顳\n颟\t顢\n颠\t顛\n颡\t顙\n颢\t顥\n颤\t顫\n颥\t顬\n颦\t顰\n颧\t顴\n风\t風\n飏\t颺\n飐\t颭\n飑\t颮\n飒\t颯\n飓\t颶\n飔\t颸\n飕\t颼\n飖\t颻\n飗\t飀\n飘\t飄\n飙\t飆\n飚\t飈\n飞\t飛\n飨\t饗\n餍\t饜\n饣\t飠\n饤\t飣\n饥\t飢\n饦\t飥\n饧\t餳\n饨\t飩\n饩\t餼\n饪\t飪\n饫\t飫\n饬\t飭\n饭\t飯\n饮\t飲\n饯\t餞\n饰\t飾\n饱\t飽\n饲\t飼\n饳\t飿\n饴\t飴\n饵\t餌\n饶\t饒\n饷\t餉\n饸\t餄\n饹\t餎\n饺\t餃\n饻\t餏\n饼\t餅\n饽\t餑\n饾\t餖\n饿\t餓\n馀\t餘\n馁\t餒\n馂\t餕\n馃\t餜\n馄\t餛\n馅\t餡\n馆\t館\n馇\t餷\n馈\t饋\n馉\t餶\n馊\t餿\n馋\t饞\n馌\t饁\n馍\t饃\n馎\t餺\n馏\t餾\n馐\t饈\n馑\t饉\n馒\t饅\n馓\t饊\n馔\t饌\n馕\t饢\n马\t馬\n驭\t馭\n驮\t馱\n驯\t馴\n驰\t馳\n驱\t驅\n驲\t馹\n驳\t駁\n驴\t驢\n驵\t駔\n驶\t駛\n驷\t駟\n驸\t駙\n驹\t駒\n驺\t騶\n驻\t駐\n驼\t駝\n驽\t駑\n驾\t駕\n驿\t驛\n骀\t駘\n骁\t驍\n骂\t罵\n骃\t駰\n骄\t驕\n骅\t驊\n骆\t駱\n骇\t駭\n骈\t駢\n骉\t驫\n骊\t驪\n骋\t騁\n验\t驗\n骍\t騂\n骎\t駸\n骏\t駿\n骐\t騏\n骑\t騎\n骒\t騍\n骓\t騅\n骔\t騌\n骕\t驌\n骖\t驂\n骗\t騙\n骘\t騭\n骙\t騤\n骚\t騷\n骛\t騖\n骜\t驁\n骝\t騮\n骞\t騫\n骟\t騸\n骠\t驃\n骡\t騾\n骢\t驄\n骣\t驏\n骤\t驟\n骥\t驥\n骦\t驦\n骧\t驤\n髅\t髏\n髋\t髖\n髌\t髕\n鬓\t鬢\n鬶\t鬹\n魇\t魘\n魉\t魎\n鱼\t魚\n鱽\t魛\n鱾\t魢\n鱿\t魷\n鲀\t魨\n鲁\t魯\n鲂\t魴\n鲃\t䰾\n鲄\t魺\n鲅\t鮁\n鲆\t鮃\n鲇\t鮎\n鲈\t鱸\n鲉\t鮋\n鲊\t鮓\n鲋\t鮒\n鲌\t鮊\n鲍\t鮑\n鲎\t鱟\n鲏\t鮍\n鲐\t鮐\n鲑\t鮭\n鲒\t鮚\n鲓\t鮳\n鲔\t鮪\n鲕\t鮞\n鲖\t鮦\n鲗\t鰂\n鲘\t鮜\n鲙\t鱠\n鲚\t鱭\n鲛\t鮫\n鲜\t鮮\n鲝\t鮺\n鲞\t鮝\n鲟\t鱘\n鲠\t鯁\n鲡\t鱺\n鲢\t鰱\n鲣\t鰹\n鲤\t鯉\n鲥\t鰣\n鲦\t鰷\n鲧\t鯀\n鲨\t鯊\n鲩\t鯇\n鲪\t鮶\n鲫\t鯽\n鲬\t鯒\n鲭\t鯖\n鲮\t鯪\n鲯\t鯕\n鲰\t鯫\n鲱\t鯡\n鲲\t鯤\n鲳\t鯧\n鲴\t鯝\n鲵\t鯢\n鲶\t鯰\n鲷\t鯛\n鲸\t鯨\n鲹\t鰺\n鲺\t鯴\n鲻\t鯔\n鲼\t鱝\n鲽\t鰈\n鲾\t鰏\n鲿\t鱨\n鳀\t鯷\n鳁\t鰮\n鳂\t鰃\n鳃\t鰓\n鳄\t鰐\n鳅\t鰍\n鳆\t鰒\n鳇\t鰉\n鳈\t鰁\n鳉\t鱂\n鳊\t鯿\n鳋\t鰠\n鳌\t鰲\n鳍\t鰭\n鳎\t鰨\n鳏\t鰥\n鳐\t鰩\n鳑\t鰟\n鳒\t鰜\n鳓\t鰳\n鳔\t鰾\n鳕\t鱈\n鳖\t鱉\n鳗\t鰻\n鳘\t鰵\n鳙\t鱅\n鳚\t䲁\n鳛\t鰼\n鳜\t鱖\n鳝\t鱔\n鳞\t鱗\n鳟\t鱒\n鳠\t鱯\n鳡\t鱤\n鳢\t鱧\n鳣\t鱣\n鳤\t䲘\n鸟\t鳥\n鸠\t鳩\n鸡\t雞\n鸢\t鳶\n鸣\t鳴\n鸤\t鳲\n鸥\t鷗\n鸦\t鴉\n鸧\t鶬\n鸨\t鴇\n鸩\t鴆\n鸪\t鴣\n鸫\t鶇\n鸬\t鸕\n鸭\t鴨\n鸮\t鴞\n鸯\t鴦\n鸰\t鴒\n鸱\t鴟\n鸲\t鴝\n鸳\t鴛\n鸴\t鷽\n鸵\t鴕\n鸶\t鷥\n鸷\t鷙\n鸸\t鴯\n鸹\t鴰\n鸺\t鵂\n鸻\t鴴\n鸼\t鵃\n鸽\t鴿\n鸾\t鸞\n鸿\t鴻\n鹀\t鵐\n鹁\t鵓\n鹂\t鸝\n鹃\t鵑\n鹄\t鵠\n鹅\t鵝\n鹆\t鵒\n鹇\t鷳\n鹈\t鵜\n鹉\t鵡\n鹊\t鵲\n鹋\t鶓\n鹌\t鵪\n鹍\t鵾\n鹎\t鵯\n鹏\t鵬\n鹐\t鵮\n鹑\t鶉\n鹒\t鶊\n鹓\t鵷\n鹔\t鷫\n鹕\t鶘\n鹖\t鶡\n鹗\t鶚\n鹘\t鶻\n鹙\t鶖\n鹚\t鷀\n鹛\t鶥\n鹜\t鶩\n鹝\t鷊\n鹞\t鷂\n鹟\t鶲\n鹠\t鶹\n鹡\t鶺\n鹢\t鷁\n鹣\t鶼\n鹤\t鶴\n鹥\t鷖\n鹦\t鸚\n鹧\t鷓\n鹨\t鷚\n鹩\t鷯\n鹪\t鷦\n鹫\t鷲\n鹬\t鷸\n鹭\t鷺\n鹮\t䴉\n鹯\t鸇\n鹰\t鷹\n鹱\t鸌\n鹲\t鸏\n鹳\t鸛\n鹴\t鸘\n鹾\t鹺\n麦\t麥\n麸\t麩\n麹\t麴\n黄\t黃\n黉\t黌\n黡\t黶\n黩\t黷\n黪\t黲\n黾\t黽\n鼋\t黿\n鼍\t鼉\n鼗\t鞀\n鼹\t鼴\n齐\t齊\n齑\t齏\n齿\t齒\n龀\t齔\n龁\t齕\n龂\t齗\n龃\t齟\n龄\t齡\n龅\t齙\n龆\t齠\n龇\t齜\n龈\t齦\n龉\t齬\n龊\t齪\n龋\t齲\n龌\t齷\n龙\t龍\n龚\t龔\n龛\t龕\n龟\t龜\n鿎\t䃮\n鿏\t䥑\n鿔\t鎶\n鿭\t鉨\n𣗋\t欓\n𣲗\t湋\n𣲘\t潕\n𣸣\t濆\n𤩽\t瓛\n𦈡\t繻\n𦝼\t膢\n𨐈\t輄\n𨱇\t銶\n𨱏\t鎝\n𨱑\t鐄\n𨱔\t鐏\n𩽾\t鮟\n𩾃\t鮸\n𩾌\t鱇\n𪟝\t勣\n𪣻\t塿\n𪨶\t輋\n𪩘\t巘\n𪾢\t睍\n𫄧\t綖\n𫄨\t絺\n𫄷\t繶\n𫄸\t纁\n𫇭\t蒍\n𫌀\t襀\n𫍣\t詷\n𫍯\t諴\n𫍲\t謏\n𫍽\t譞\n𫐄\t軏\n𫐐\t輗\n𫐓\t輮\n𫑡\t鄳\n𫓧\t鈇\n𫓯\t銈\n𫓶\t鋗\n𫓹\t錤\n𫔍\t鐇\n𫔎\t鐍\n𫔶\t闑\n𫖮\t顗\n𫖯\t頫\n𫖳\t頵\n𫗧\t餗\n𫗴\t饘\n𫘜\t馼\n𫘝\t駃\n𫘦\t騊\n𫘧\t騄\n𫘨\t騠\n𫘪\t騵\n𫘬\t騱\n𫚕\t鰤\n𫚖\t鮆\n𫚭\t鱲\n𫛭\t鵟\n𫞩\t璊\n𫟅\t綡\n𫟦\t䡵\n𫟷\t鉝\n𫟹\t鉷\n𫟼\t鐽\n𫠆\t頍\n𫠊\t䮄\n𫠜\t齯\n𫢸\t僤\n𫫇\t噁\n𫭟\t塸\n𫭢\t埨\n𫭼\t𡑍\n𫮃\t墠\n𫰛\t娙\n𫵷\t㠣\n𫶇\t嵽\n𫷷\t廞\n𫸩\t彄\n𬀩\t暐\n𬀪\t晛\n𬂩\t梜\n𬃊\t櫍\n𬇕\t澫\n𬇙\t浿\n𬇹\t漍\n𬉼\t熰\n𬊈\t燖\n𬊤\t燀\n𬍛\t瓅\n𬍡\t璗\n𬍤\t璕\n𬎆\t㼆\n𬒈\t礐\n𬒗\t𥗽\n𬕂\t篢\n𬘓\t紃\n𬘘\t紞\n𬘡\t絪\n𬘩\t綎\n𬘫\t綄\n𬘬\t綪\n𬘭\t綝\n𬘯\t綧\n𬙂\t縯\n𬙊\t纆\n𬙋\t纕\n𬜬\t蔄\n𬜯\t䓣\n𬞟\t蘋\n𬟁\t虉\n𬟽\t蝀\n𬣙\t訏\n𬣞\t詝\n𬣡\t諓\n𬣳\t詪\n𬤇\t諲\n𬤊\t諟\n𬤝\t譓\n𬨂\t軝\n𬨎\t輶\n𬩽\t鄩\n𬪩\t醲\n𬬩\t釴\n𬬭\t錀\n𬬮\t鋹\n𬬱\t釿\n𬬸\t鉥\n𬬹\t鉮\n𬬻\t鑪\n𬬿\t鉊\n𬭁\t鉧\n𬭊\t𨧀\n𬭎\t鋐\n𬭚\t錞\n𬭛\t𨨏\n𬭤\t鍭\n𬭩\t鎓\n𬭬\t鏏\n𬭯\t䥕\n𬭳\t𨭎\n𬭶\t𨭆\n𬭸\t鏻\n𬭼\t鐩\n𬮱\t闉\n𬮿\t隑\n𬯀\t隮\n𬯎\t隤\n𬱖\t頔\n𬱟\t頠\n𬳵\t駓\n𬳶\t駉\n𬳽\t駪\n𬳿\t駼\n𬴂\t騑\n𬴃\t騞\n𬴊\t驎\n𬶋\t鮈\n𬶍\t鮀\n𬶏\t鮠\n𬶐\t鮡\n𬶟\t鯻\n𬶠\t鰊\n𬶨\t鱀\n𬶭\t鰶\n𬶮\t鱚\n𬷕\t鵏\n𬸘\t鶠\n𬸚\t鸑\n𬸣\t鶱\n𬸦\t鷟\n𬸪\t鷭\n𬹼\t齘\n𬺈\t齮\n𬺓\t齼\n𮧵\t韡\n㐹\t㑶\n了\t了\n仇\t仇\n仿\t仿\n伙\t夥\n余\t餘\n佛\t佛\n俊\t俊\n修\t修\n借\t借\n僵\t僵\n克\t克\n具\t具\n冢\t冢\n冬\t冬\n准\t準\n凌\t凌\n凶\t兇\n出\t出\n划\t劃\n刮\t刮\n制\t制\n千\t千\n升\t升\n卜\t卜\n卷\t卷\n只\t只\n台\t臺\n吁\t籲\n吃\t喫\n合\t合\n吊\t吊\n同\t同\n向\t向\n呆\t呆\n周\t周\n咨\t諮\n咸\t鹹\n咽\t咽\n哄\t哄\n唇\t脣\n噪\t噪\n回\t回\n困\t困\n坐\t坐\n坯\t坯\n堤\t堤\n夫\t夫\n奸\t奸\n姜\t姜\n娘\t娘\n它\t它\n家\t家\n局\t局\n岩\t巖\n岳\t嶽\n巨\t巨\n布\t布\n席\t席\n幸\t幸\n庵\t庵\n弦\t弦\n彩\t彩\n御\t御\n志\t志\n念\t念\n恤\t恤\n愈\t愈\n戚\t戚\n扇\t扇\n才\t才\n扎\t扎\n托\t托\n扣\t扣\n折\t折\n抵\t抵\n拐\t拐\n拿\t拿\n挨\t挨\n捆\t捆\n捍\t捍\n搜\t搜\n斤\t斤\n斫\t斫\n旋\t旋\n昆\t昆\n暗\t暗\n曲\t曲\n札\t札\n朱\t朱\n杯\t杯\n松\t松\n板\t板\n果\t果\n栗\t栗\n核\t核\n梁\t梁\n檗\t檗\n欲\t欲\n沈\t沈\n沾\t沾\n泛\t泛\n注\t注\n浚\t浚\n游\t遊\n溪\t溪\n澄\t澄\n焰\t焰\n熏\t燻\n狸\t狸\n玩\t玩\n琅\t琅\n璇\t璇\n症\t症\n皂\t皁\n矩\t矩\n私\t私\n秋\t秋\n穗\t穗\n筱\t筱\n糊\t糊\n系\t系\n累\t累\n耇\t耇\n胄\t胄\n背\t背\n胡\t胡\n致\t致\n芸\t芸\n苔\t苔\n蒙\t蒙\n蔑\t蔑\n藤\t藤\n表\t表\n谷\t谷\n豆\t豆\n象\t象\n跖\t蹠\n辟\t闢\n郁\t鬱\n酸\t酸\n里\t裏\n雇\t僱\n雕\t雕\n面\t面'
_OPENCC_ALT_DATA = '㐹\t㑶 㐹\n万\t萬 万\n丑\t醜 丑\n个\t個 箇\n丰\t豐 丰\n了\t了 瞭\n于\t於 于\n云\t雲 云\n亘\t亙 亘\n仆\t僕 仆\n仇\t仇 讎\n仑\t侖 崙\n价\t價 价\n仿\t仿 彷\n伙\t夥 伙\n余\t餘 余\n佛\t佛 彿\n佣\t傭 佣\n俊\t俊 儁\n修\t修 脩\n借\t借 藉\n僵\t僵 殭\n克\t克 剋\n党\t黨 党\n具\t具 俱\n冢\t冢 塚\n冬\t冬 鼕\n冲\t衝 沖\n凄\t悽 淒\n准\t準 准\n凌\t凌 淩\n几\t幾 几\n凶\t兇 凶\n出\t出 齣\n划\t劃 划\n别\t別 彆\n刮\t刮 颳\n制\t制 製\n勋\t勳 勛\n千\t千 韆\n升\t升 昇\n卜\t卜 蔔\n占\t佔 占\n卤\t滷 鹵\n卷\t卷 捲\n厂\t廠 厂\n历\t歷 曆\n厘\t釐 厘\n参\t參 蔘\n发\t發 髮\n只\t只 隻 祇\n台\t臺 檯 颱 台\n叶\t葉 叶\n叹\t嘆 歎\n吁\t籲 吁\n吃\t喫 吃\n合\t合 閤\n吊\t吊 弔\n同\t同 衕\n后\t後 后\n向\t向 嚮 曏\n吣\t吣 唚\n呆\t呆 待\n周\t周 週 賙\n咨\t諮 咨\n咸\t鹹 咸\n咽\t咽 嚥\n哄\t哄 鬨\n哗\t譁 嘩\n唇\t脣 唇\n啮\t齧 嚙\n喂\t喂 餵\n噪\t噪 譟\n回\t回 迴\n团\t團 糰\n困\t困 睏\n坐\t坐 座\n坛\t壇 罈\n坝\t壩 垻\n坯\t坯 坏\n埙\t壎 塤\n堤\t堤 隄\n复\t復 複 覆\n夫\t夫 伕\n夸\t誇 夸\n夹\t夾 袷\n奸\t奸 姦\n姜\t姜 薑\n娘\t娘 孃\n娴\t嫺 嫻\n宁\t寧 甯\n它\t它 牠\n家\t家 傢\n尝\t嘗 嚐\n尸\t屍 尸\n尽\t盡 儘\n局\t局 侷\n岩\t巖 岩\n岳\t嶽 岳\n巨\t巨 鉅\n布\t布 佈\n帘\t簾 帘\n席\t席 蓆\n干\t幹 乾 干 榦\n并\t並 併 幷\n幸\t幸 倖\n广\t廣 广\n庵\t庵 菴\n弥\t彌 瀰\n弦\t弦 絃\n当\t當 噹\n录\t錄 彔\n彩\t彩 綵\n征\t徵 征\n径\t徑 逕\n御\t御 禦\n志\t志 誌\n念\t念 唸\n恤\t恤 卹\n恶\t惡 噁\n愈\t愈 癒\n愿\t願 愿\n戚\t戚 慼 鏚\n扇\t扇 搧\n才\t才 纔\n扎\t扎 紮\n托\t托 託\n扣\t扣 釦\n折\t折 摺\n抵\t抵 牴\n拐\t拐 柺\n拿\t拿 拏\n挂\t掛 挂\n挨\t挨 捱\n挽\t挽 輓\n捆\t捆 綑\n捍\t捍 扞\n据\t據 据\n搜\t搜 蒐\n摆\t擺 襬\n斗\t鬥 斗\n斤\t斤 觔\n斫\t斫 斲\n旋\t旋 鏇\n昆\t昆 崑\n暗\t暗 闇\n曲\t曲 麴\n札\t札 劄\n术\t術 朮\n朱\t朱 硃\n朴\t樸 朴\n杆\t杆 桿\n杠\t槓 杠\n杯\t杯 盃\n杰\t傑 杰\n松\t松 鬆\n板\t板 闆\n极\t極 极\n果\t果 菓\n枪\t槍 鎗\n柜\t櫃 柜\n栗\t栗 慄\n核\t核 覈\n梁\t梁 樑\n棱\t棱 稜\n檗\t檗 蘗\n欲\t欲 慾\n毁\t毀 燬 譭\n汇\t匯 彙 滙\n沈\t沈 瀋\n沾\t沾 霑\n泛\t泛 氾 汎\n注\t注 註\n浚\t浚 濬\n涂\t塗 涂\n涌\t湧 涌\n淀\t澱 淀\n游\t遊 游\n溪\t溪 谿\n滟\t灩 灧\n漓\t漓 灕\n澄\t澄 澂\n炼\t煉 鍊\n烟\t煙 菸\n焰\t焰 燄\n熏\t燻 熏 薰\n狸\t狸 貍\n玩\t玩 翫\n琅\t琅 瑯\n璇\t璇 璿\n症\t症 癥\n皂\t皁 皂\n矩\t矩 榘\n确\t確 确\n硷\t硷 礆 鹼\n私\t私 俬\n秋\t秋 鞦\n种\t種 种\n穗\t穗 繐\n筑\t築 筑\n筱\t筱 篠\n签\t籤 簽\n糊\t糊 餬\n系\t系 係 繫\n累\t累 纍\n纤\t纖 縴\n绱\t鞝 緔\n绷\t繃 綳\n耇\t耇 耈\n胄\t胄 冑\n背\t背 揹\n胜\t勝 胜\n胡\t胡 鬍 衚\n脏\t髒 臟\n腊\t臘 腊\n腌\t醃 腌\n膻\t羶 膻\n致\t致 緻\n舍\t舍 捨\n艳\t豔 艷\n芸\t芸 蕓\n苏\t蘇 甦 囌\n苔\t苔 薹\n苹\t蘋 苹\n范\t範 范\n荐\t薦 荐\n荡\t蕩 盪\n荫\t蔭 廕\n药\t藥 葯\n获\t獲 穫\n蒙\t蒙 矇 濛 懞\n蔑\t蔑 衊\n藤\t藤 籐\n虫\t蟲 虫\n蚝\t蠔 蚝\n蜡\t蠟 蜡\n蝎\t蠍 蝎\n表\t表 錶\n袅\t嫋 裊\n裥\t襉 襇\n证\t證 証\n谥\t諡 謚\n谷\t谷 穀\n豆\t豆 荳\n象\t象 像\n赝\t贗 贋\n赞\t贊 讚\n跖\t蹠 跖\n辟\t闢 辟\n迹\t跡 蹟\n适\t適 适\n郁\t鬱 郁\n酸\t酸 痠\n采\t採 采 寀\n里\t裏 里 哩\n鉴\t鑑 鑒\n针\t針 鍼\n钟\t鍾 鐘 鈡\n钥\t鑰 鈅\n钫\t鈁 鍅\n钻\t鑽 鉆\n铲\t鏟 剷\n链\t鏈 鍊\n锄\t鋤 耡\n锫\t錇 鉳\n镋\t钂 鎲\n镎\t鎿 錼\n镢\t钁 鐝\n镰\t鐮 鎌\n闲\t閒 閑\n雇\t僱 雇\n雕\t雕 鵰\n面\t面 麪\n须\t須 鬚\n饥\t飢 饑\n鹇\t鷳 鷴'
_OPENCC_TW_DATA = '僞\t偽\n啓\t啟\n喫\t吃\n嫺\t嫻\n嬀\t媯\n峯\t峰\n幺\t么\n梁\t梁\n棱\t稜\n樑\t梁 樑\n檐\t簷\n污\t汙\n泄\t洩\n潙\t溈\n潨\t潀\n爲\t為\n牀\t床\n痹\t痺\n癡\t痴\n皁\t皂\n着\t著\n睾\t睪\n祕\t秘\n竈\t灶\n糉\t粽\n繮\t韁\n纔\t才\n羣\t群\n脣\t唇\n蔘\t參\n蔿\t蒍\n衆\t眾\n裏\t裡\n覈\t核\n踊\t踴\n鉢\t缽\n鍼\t針\n鮎\t鯰\n麪\t麵\n麼\t麼 么\n齶\t顎'
_T2S_ALIAS_MAP = None
_OPENCC_TSPHRASE_CACHE = None
_OPENCC_TSPHRASE_MAXLEN = 0
_OPENCC_TSPHRASES_URL = 'https://raw.githubusercontent.com/nk2028/opencc-data/main/data/TSPhrases.txt'


def _resolve_script_relative(path):
    path = str(path or '').strip()
    if not path:
        return ''
    if os.path.isabs(path):
        return path
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), path)


def _load_opencc_tsphrases(config):
    """
    载入 OpenCC TSPhrases.txt。
    优先本地文件；若缺失且 OPENCC_AUTO_DOWNLOAD_DATA=1，则从 opencc-data 官方镜像下载并缓存。
    返回 (phrase_map, max_key_len)。phrase_map: {繁体短语: [简体候选...]}。
    """
    global _OPENCC_TSPHRASE_CACHE, _OPENCC_TSPHRASE_MAXLEN
    if _OPENCC_TSPHRASE_CACHE is not None:
        return _OPENCC_TSPHRASE_CACHE, _OPENCC_TSPHRASE_MAXLEN

    if not config.get('OPENCC_PHRASE_FIRST_ALIASES', True):
        _OPENCC_TSPHRASE_CACHE = {}
        _OPENCC_TSPHRASE_MAXLEN = 0
        return _OPENCC_TSPHRASE_CACHE, _OPENCC_TSPHRASE_MAXLEN

    path = _resolve_script_relative(config.get('OPENCC_TSPHRASES_FILE', 'opencc_data/TSPhrases.txt'))
    text = None
    if path and os.path.isfile(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                text = f.read()
            print(f'✅ 已载入 OpenCC 短语词典：{path}')
        except Exception as e:
            print(f'⚠️ 读取 OpenCC TSPhrases 失败：{e}')

    if text is None and config.get('OPENCC_AUTO_DOWNLOAD_DATA', True):
        try:
            print('🌐 本地缺少 OpenCC TSPhrases.txt，正在下载一次并缓存...')
            req = urllib.request.Request(
                _OPENCC_TSPHRASES_URL,
                headers={'User-Agent': 'PicDic-Builder/9.7'}
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                text = resp.read().decode('utf-8')
            if path:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, 'w', encoding='utf-8', newline='\n') as f:
                    f.write(text)
                print(f'✅ OpenCC TSPhrases 已缓存：{path}')
        except Exception as e:
            print(f'⚠️ 无法下载 OpenCC TSPhrases，将退回字级反向别名：{e}')
            text = None

    phrase_map = {}
    max_len = 0
    if text:
        for raw in text.splitlines():
            line = raw.strip()
            if not line or line.startswith('#') or '\t' not in line:
                continue
            key, values = line.split('\t', 1)
            key = key.strip()
            vals = [v for v in values.split() if v]
            if not key or not vals:
                continue
            phrase_map[key] = vals
            if len(key) > max_len:
                max_len = len(key)

    _OPENCC_TSPHRASE_CACHE = phrase_map
    _OPENCC_TSPHRASE_MAXLEN = max_len
    if phrase_map:
        print(f'✅ OpenCC 短语优先模式启用：{len(phrase_map)} 条短语，最长 {max_len} 字符。')
    else:
        print('ℹ️ OpenCC 短语词典不可用：本次仅使用字级反向别名。')
    return phrase_map, max_len

def _is_chinese_language_code(value):
    s = str(value or '').strip().lower().replace('_', '-')
    if not s:
        return False
    root = s.split('-', 1)[0]
    return root in ('zh', 'zho', 'chi', 'cmn', 'yue') or s in ('chinese', 'han', 'hans', 'hant')

def _parse_opencc_single(data):
    out = []
    for line in str(data or '').splitlines():
        if not line or '\t' not in line:
            continue
        k, v = line.split('\t', 1)
        if k and v:
            out.append((k, [v]))
    return out

def _parse_opencc_multi(data):
    out = []
    for line in str(data or '').splitlines():
        if not line or '\t' not in line:
            continue
        k, v = line.split('\t', 1)
        vals = [x for x in v.split() if x]
        if k and vals:
            out.append((k, vals))
    return out

def _build_t2s_alias_map():
    global _T2S_ALIAS_MAP
    if _T2S_ALIAS_MAP is not None:
        return _T2S_ALIAS_MAP

    reverse = {}
    def add(trad, simp):
        if not trad or not simp:
            return
        arr = reverse.setdefault(trad, [])
        if simp not in arr:
            arr.append(simp)

    # BASE + ALT 都是简体 key -> 繁体候选；反过来即可得到入口别名。
    for simp, vals in _parse_opencc_single(_OPENCC_BASE_DATA):
        for trad in vals:
            add(trad, simp)
    for simp, vals in _parse_opencc_multi(_OPENCC_ALT_DATA):
        for trad in vals:
            add(trad, simp)

    # Taiwan variant 需要作为同一繁体等价类传播。
    # 例如：裏 -> 裡；reverse 已知 裏 -> 里，因此裡也应可由“里”触发。
    graph = {}
    for src, vals in _parse_opencc_multi(_OPENCC_TW_DATA):
        nodes = [src] + vals
        for a in nodes:
            graph.setdefault(a, set()).update(x for x in nodes if x != a)

    visited = set()
    for node in list(graph):
        if node in visited:
            continue
        stack = [node]
        comp = []
        while stack:
            cur = stack.pop()
            if cur in visited:
                continue
            visited.add(cur)
            comp.append(cur)
            stack.extend(graph.get(cur, ()))
        simp_vals = []
        for ch in comp:
            for simp in reverse.get(ch, []):
                if simp not in simp_vals:
                    simp_vals.append(simp)
        if simp_vals:
            for ch in comp:
                for simp in simp_vals:
                    add(ch, simp)

    _T2S_ALIAS_MAP = reverse
    return reverse

def generate_simplified_aliases_char_only(word, max_candidates=16):
    """
    为一个繁体词头生成可供宿主 APP 查询的简体入口。
    一对多反向映射会保留多个候选，但设上限避免组合爆炸。
    PUA / 未知字符保持原样。
    """
    word = str(word or '')
    if not word:
        return []
    reverse = _build_t2s_alias_map()
    combos = ['']
    for ch in word:
        choices = reverse.get(ch) or [ch]
        nxt = []
        seen = set()
        for prefix in combos:
            for choice in choices:
                value = prefix + choice
                if value not in seen:
                    seen.add(value)
                    nxt.append(value)
                if len(nxt) >= max_candidates:
                    break
            if len(nxt) >= max_candidates:
                break
        combos = nxt or combos
    out = []
    seen = set()
    for value in combos:
        if value and value != word and value not in seen:
            seen.add(value)
            out.append(value)
    return out


def generate_simplified_aliases(word, max_candidates=16, phrase_map=None, phrase_max_len=0):
    """
    OpenCC 短语优先 + 字级反向映射补充。

    规则：
    1) 从左到右采用“最长短语匹配”；命中 TSPhrases 的片段只使用短语结果，
       不再对该片段逐字扩展（避免 乾隆→干隆、計畫→计画 一类错误别名）。
    2) 未被短语覆盖的字符才使用现有 T↔S 反向字符候选。
    3) TSPhrases 一行若有多个输出，按原顺序保留，整体仍受 max_candidates 限制。
    4) 若短语词典不可用，则完全回退到 V9.6 的字级逻辑。
    """
    word = str(word or '')
    if not word:
        return []
    if not phrase_map or not phrase_max_len:
        return generate_simplified_aliases_char_only(word, max_candidates)

    reverse = _build_t2s_alias_map()
    segments = []
    i = 0
    while i < len(word):
        match_key = None
        match_vals = None
        upper = min(phrase_max_len, len(word) - i)
        for length in range(upper, 1, -1):
            key = word[i:i+length]
            vals = phrase_map.get(key)
            if vals:
                match_key = key
                match_vals = vals
                break
        if match_key is not None:
            # OpenCC group 为 short_circuit：命中短语后，不再对短语内部做字符转换。
            segments.append(match_vals)
            i += len(match_key)
            continue

        ch = word[i]
        segments.append(reverse.get(ch) or [ch])
        i += 1

    combos = ['']
    for choices in segments:
        nxt = []
        seen = set()
        for prefix in combos:
            for choice in choices:
                value = prefix + choice
                if value not in seen:
                    seen.add(value)
                    nxt.append(value)
                if len(nxt) >= max_candidates:
                    break
            if len(nxt) >= max_candidates:
                break
        combos = nxt or combos

    out = []
    seen = set()
    for value in combos:
        if value and value != word and value not in seen:
            seen.add(value)
            out.append(value)
    return out

def should_generate_simplified_aliases(config):
    mode = str(config.get('GENERATE_SIMPLIFIED_ALIASES', 'auto')).strip().lower()
    if mode in ('0', 'false', 'no', 'off', 'none'):
        return False
    if mode in ('1', 'true', 'yes', 'on'):
        return True
    return _is_chinese_language_code(config.get('INDEX_LANGUAGE'))

def build_external_lookup_entries(word_list, config):
    """
    返回 {宿主词头: [PicDic真实索引词头, ...]}。

    V9.8 关键原则：宿主别名只负责“让 GoldenDict/MDict 命中”，而
    <PicDic_SearchWord> 永远保存转换前、PicDic 内部索引真实存在的词头。

    例如真实索引为“法師”，生成简体宿主入口“法师”后：
        法师 -> [法師]
    因而宿主命中后 PicDic 可以直接走 exact hot-lite，不需要再做 OpenCC、
    异体、前缀或逐级缩短。

    若多个真实词头折叠成同一个简体入口（例如 發/髮 -> 发），则同一个
    宿主词头保留多个真实 PicDic_SearchWord，Controller 会一并传给 PicDic。
    """
    originals = [str(w) for w in word_list if str(w)]
    entries = {}
    for word in originals:
        bucket = entries.setdefault(word, [])
        if word not in bucket:
            bucket.append(word)

    if not should_generate_simplified_aliases(config):
        return entries, 0

    max_per_word = int(config.get('SIMPLIFIED_ALIAS_MAX_PER_WORD', 16) or 16)
    phrase_map, phrase_max_len = _load_opencc_tsphrases(config)
    alias_headwords = set()

    for word in originals:
        for alias in generate_simplified_aliases(word, max_per_word, phrase_map, phrase_max_len):
            alias = str(alias or '').strip()
            if not alias or alias == word:
                continue
            existed = alias in entries
            bucket = entries.setdefault(alias, [])
            if word not in bucket:
                bucket.append(word)
            if not existed:
                alias_headwords.add(alias)

    return entries, len(alias_headwords)

# ================== 生成词条文件（MDict + StarDict） ==================
def normalize_base(base):
    base = '' if base is None else str(base).strip()
    if base and not base.endswith('/'):
        base += '/'
    return base


def make_picdic_container_selector(dict_file_name):
    """
    PicOnly 外部 config 不再绑定静态 HTML id。
    同一本词典的所有词条通过 data-picdic-container=DICT_FILE_NAME 被同一个 Controller 收集。
    这样 GoldenDict 同时合并多个词条时不会产生重复 id。
    """
    raw = str(dict_file_name or 'PicDic')
    css_value = raw.replace('\\', '\\\\').replace('"', '\\"')
    return '[data-picdic-container="' + css_value + '"]'

def js_json(value):
    """用于 <script> 内安全嵌入 JSON，避免极端词典名出现 </script> 截断。"""
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')


def generate_pic_only_config_js(dict_id, dict_file_name, auto_activate=True, container_id=''):
    """
    生成 GoldenDict / MDict 共用的一份外部 PICDIC_CONFIG JS。

    容器定位优先级：
    - 若 __build_picdic_config.txt 设置 CONTAINER_ID，则生成 containerId，
      可继续沿用旧版 ISBN_xxxx 方案；Controller 会用 querySelectorAll 精确收集
      同一页面中所有同名容器。
    - 若 CONTAINER_ID 留空，则生成 containerSelector，使用
      data-picdic-container=DICT_FILE_NAME（HTML 规范上更干净）。

    配置文件本身不写 picDicBase：
    - GoldenDict 由 Controller 根据 content: 环境使用 /sdcard/GoldenDict/PicDic/；
    - MDict 由 Controller 根据 mdx: 环境直接使用 MDD 内相对资源路径。
    """
    cfg = {
        'mode': 'picOnly',
        'autoActivate': bool(auto_activate),
        'dictId': dict_id,
        'wordSelector': 'PicDic_SearchWord',
    }
    container_id = str(container_id or '').strip()
    if container_id:
        cfg['containerId'] = container_id
    else:
        cfg['containerSelector'] = make_picdic_container_selector(dict_file_name)
    return (
        '// PicDic PicOnly dictionary config\n'
        '// Auto-generated by __build_picdic.py V9.8\n'
        '// One unified config is shared by GoldenDict and MDict.\n'
        '// Resource base is selected automatically by PicDic_DictionaryController.js.\n'
        'window.PICDIC_CONFIG = ' + js_json(cfg) + ';\n'
    )


def get_pic_only_config_filename(dict_file_name):
    """配置文件名固定由 DICT_FILE_NAME 派生，GoldenDict / MDict 共用。"""
    return f'{dict_file_name}_config.js'


def generate_pic_only_config_file(output_dir, dict_file_name, dict_id, config):
    """只生成一份 GoldenDict / MDict 共用的外部配置 JS。"""
    auto_activate = bool(config.get('AUTO_ACTIVATE_PICONLY', True))
    container_id = str(config.get('CONTAINER_ID', '') or '').strip()
    name = get_pic_only_config_filename(dict_file_name)
    path = os.path.join(output_dir, name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(generate_pic_only_config_js(dict_id, dict_file_name, auto_activate, container_id))

    print(f'✅ PicOnly 共用配置已生成：{path}')
    return name


def build_pic_only_html(words, dict_id, config_src, controller_src, dict_folder, container_id=''):
    if isinstance(words, (str, bytes)):
        words = [words]
    words = [str(w) for w in (words or []) if str(w)]
    search_word_html = ''.join(
        '<PicDic_SearchWord style="display:none!important">' +
        html_lib.escape(word, quote=False) +
        '</PicDic_SearchWord>'
        for word in words
    )
    safe_dict_attr = html_lib.escape(str(dict_id), quote=True)
    safe_folder_attr = html_lib.escape(str(dict_folder), quote=True)
    safe_config_src = html_lib.escape(str(config_src), quote=True)
    safe_controller_src = html_lib.escape(str(controller_src), quote=True)
    container_id = str(container_id or '').strip()

    # V9.5：允许显式沿用旧版 ISBN_xxxx containerId。
    # 即使 GoldenDict 合并同一本词典的多个 entry 而出现相同 id，
    # 新版 Controller 的 byExactId() 也会通过 querySelectorAll 收集全部节点。
    id_attr = ''
    if container_id:
        id_attr = ' id="' + html_lib.escape(container_id, quote=True) + '"'

    return (
        f'<div{id_attr} class="PicDic-container PicDic-pic-only" '
        f'data-picdic-container="{safe_folder_attr}" '
        f'data-picdic-dict-id="{safe_dict_attr}" data-picdic-mode="picOnly">'
        f'{search_word_html}'
        f'</div>'
        f'<script src="{safe_config_src}"></script>'
        f'<script src="{safe_controller_src}"></script>'
    )


def build_standalone_html(word, dict_id, base):
    """兼容旧版：每个词条直接内嵌 PicDic UI。一般不再推荐。"""
    base = normalize_base(base)
    safe_word = js_json(str(word))
    safe_dict = js_json(str(dict_id))
    safe_base = html_lib.escape(base, quote=True)
    return (
        f'<script>window._picdic_word={safe_word};window._picdic_dictId={safe_dict};</script>'
        f'<link rel="stylesheet" type="text/css" href="{safe_base}PicDic_search.css"/>'
        f'<div class="PIC_DIC"><div id="searchBox"><input type="text" id="searchInput" '
        f'placeholder="输入单词..."/></div><div id="result">加载中...</div></div>'
        f'<script src="{safe_base}PicDic_language_ref.js"></script>'
        f'<script src="{safe_base}PicDic_dictionary_list.js"></script>'
        f'<script src="{safe_base}PicDic_global_config.ini"></script>'
        f'<script src="{safe_base}PicDic_search.js"></script>'
    )


def generate_wordlist_files(word_list, output_dir, dict_file_name, dict_id, config):
    if not word_list:
        return

    entry_mode = str(config.get('ENTRY_MODE', 'picOnly')).strip().lower()
    controller_file = str(config.get('CONTROLLER_FILE', 'PicDic_DictionaryController.js')).strip()
    gd_base = normalize_base(config.get('PICDIC_BASE_GOLDENDICT', 'file:///sdcard/GoldenDict/PicDic/'))
    config_file = get_pic_only_config_filename(dict_file_name)

    # 关键：宿主 APP 查询用的词头 != PicDic 内部索引。
    # 对中文繁体词典，这里额外生成简体“入口词头”；内部 _index.js 完全不改。
    lookup_entries, alias_count = build_external_lookup_entries(word_list, config)
    original_count = len(set(str(w) for w in word_list if str(w)))

    def build_html(query_words, target):
        if entry_mode in ('piconly', 'pic-only', 'pic_only'):
            if target == 'mdict':
                # MDict 从自己的 MDD 资源中解析，不写手机文件系统绝对路径。
                config_src = config_file
                controller_src = controller_file
            else:
                config_src = gd_base + str(dict_file_name).strip('/') + '/' + config_file
                controller_src = gd_base + controller_file
            return build_pic_only_html(
                query_words, dict_id, config_src, controller_src, dict_file_name,
                config.get('CONTAINER_ID', '')
            )
        if entry_mode == 'standalone':
            if target == 'mdict':
                return build_standalone_html(query_words[0], dict_id, '')
            return build_standalone_html(query_words[0], dict_id, gd_base)
        raise ValueError(f'不支持的 ENTRY_MODE: {entry_mode}（仅支持 picOnly / standalone）')

    # MDict 转换前文本：JS/CSS/图片等资源均从 MDD 内按相对路径读取。
    mdx_path = os.path.join(output_dir, f'{dict_file_name}_for_Mdict.txt')
    with open(mdx_path, 'w', encoding='utf-8') as f:
        for headword in sorted(lookup_entries):
            query_words = lookup_entries[headword]
            f.write(headword + '\n')
            f.write(build_html(query_words, 'mdict') + '\n')
            f.write('</>\n')
    print(
        f"✅ MDict 词条文件已生成：{mdx_path}，共 {len(lookup_entries)} 个宿主词头"
        f"（原词头 {original_count} + 简体入口 {alias_count}；{entry_mode}，MDD 相对资源）。"
    )

    # GoldenDict / StarDict 转换前文本
    stardict_path = os.path.join(output_dir, f'{dict_file_name}_for_Stardict.txt')
    with open(stardict_path, 'w', encoding='utf-8') as f:
        for headword in sorted(lookup_entries):
            query_words = lookup_entries[headword]
            html = build_html(query_words, 'goldendict')
            f.write(headword + '\t' + html + '\n')
    print(
        f"✅ StarDict/GoldenDict 词条文件已生成：{stardict_path}，共 {len(lookup_entries)} 个宿主词头"
        f"（原词头 {original_count} + 简体入口 {alias_count}；{entry_mode}）。"
    )

    if alias_count:
        print('   ↳ 简体入口采用 OpenCC 短语优先 + 字级补充；PicDic_SearchWord 保留转换前真实词头，宿主查询可直接 exact hot-lite。')

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
    DICT_NAME = config['DICT_NAME']
    DICT_FILE_NAME = config['DICT_FILE_NAME']
    DICT_ID = config.get('DICT_ID') or DICT_FILE_NAME
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

    script_dir = os.path.dirname(os.path.abspath(__file__))
    if not INDEX_DIR:
        INDEX_DIR = script_dir
    elif not os.path.isabs(INDEX_DIR):
        INDEX_DIR = os.path.join(script_dir, INDEX_DIR)
    index_file_path = os.path.join(INDEX_DIR, INDEX_FILE)
    if not os.path.isfile(index_file_path):
        print(f"错误：索引文件 '{index_file_path}' 不存在！")
        sys.exit(1)

    output_dir = os.path.join(script_dir, DICT_FILE_NAME)
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
        DICT_ID,
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
    dict_list_path = os.path.join(script_dir, DICT_LIST_JS)
    final_key = update_dictionary_list_js(entry_filename, dict_list_path)
    if not final_key:
        print("错误：未能获得最终键，使用 DICT_FILE_NAME 作为后备。")
        final_key = "'" + DICT_ID + "'"

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

    # PicOnly 模式先生成独立的词典配置 JS；HTML 只负责按路径加载，不再内嵌 PICDIC_CONFIG。
    if str(config.get('ENTRY_MODE', 'picOnly')).lower() in ('piconly', 'pic-only', 'pic_only'):
        generate_pic_only_config_file(output_dir, DICT_FILE_NAME, DICT_ID, config)

    # 生成两种词条文件。PicOnly 整页词典即使没有坐标也可生成；
    # 有坐标时 PicDic 还能进一步完成词条定位/高亮。
    if GENERATE_MDX:
        word_list = list(word_to_pages.keys())
        if word_list:
            generate_wordlist_files(word_list, output_dir, DICT_FILE_NAME, DICT_ID, config)
        else:
            print("警告：word_to_pages 为空，无法生成词条文件。")

    print("\n" + "=" * 60)
    print(f"最终词典键（picdic_dictList 中的键）：{final_key}")
    print("条目内容：")
    print(entry_text)
    print("=" * 60)

    print(f"\n✅ 所有生成文件已放入 '{output_dir}' 文件夹。")
    print(f"\n✅ 主目录中的 {DICT_LIST_JS} 已自动更新，请复制到手机 GoldenDict/PicDic/ 或者 mdict/doc/PicDic/ 目录下。")
    print(f"\n✅ 请将包含以下文件的 {output_dir} 文件夹复制到手机 GoldenDict/PicDic/ 或 mdict/doc/PicDic/ 目录下：")
    print(f"  - {js_filename}")
    print(f"  - {dsl_filename}")
    if str(config.get('ENTRY_MODE', 'picOnly')).lower() in ('piconly','pic-only','pic_only'):
        _cfg = get_pic_only_config_filename(DICT_FILE_NAME)
        print(f"  - {_cfg}（GoldenDict / MDict 共用词典入口配置）")
    print(f"  - {DICT_FILE_NAME}.dsl.files.zip（手动准备）")
    print(f"  - {DICT_FILE_NAME}.bmp（手动准备）")
    if COLUMN_NUM > 1:
        print(f"  列数配置: {COLUMN_NUM}（已在 _index.js 中记录，并已计算列号）")
    if GENERATE_MDX:
        print(f"\n✅ 词条文件已生成：")
        print(f"   - {DICT_FILE_NAME}_for_Mdict.txt")
        print(f"   - {DICT_FILE_NAME}_for_Stardict.txt")
        print(f"   (已包含所有词条；ENTRY_MODE={config.get('ENTRY_MODE', 'picOnly')})")
        if str(config.get('ENTRY_MODE', 'picOnly')).lower() in ('piconly','pic-only','pic_only'):
            print("   纯整页版入口壳只加载外部词典配置 JS + PicDic_DictionaryController.js；实际 PicDic UI 由 Controller 共享创建。")

if __name__ == "__main__":
    main()