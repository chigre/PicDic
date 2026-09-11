// PicDic_ui.js - V8 Phase 2.2 Lazy UI Factory
(function(global) {
'use strict';

global._picdicCreateUI = function(bridge) {
if (!bridge || !bridge.state || !bridge.core) {
    throw new Error('PicDic UI bridge unavailable');
}

var state = bridge.state;
var _env = bridge.env;
var UrlBuilder = bridge.UrlBuilder;
var DEFAULT_PAGE_TYPES = bridge.DEFAULT_PAGE_TYPES;
var DEFAULT_GLOBAL_CONFIG = bridge.DEFAULT_GLOBAL_CONFIG;
var DEFAULT_DICT_CONFIG = bridge.DEFAULT_DICT_CONFIG;
var FILTER_PRESETS = bridge.FILTER_PRESETS;
var LIGHT_BG_PRESETS = bridge.LIGHT_BG_PRESETS;
var DARK_BG_PRESETS = bridge.DARK_BG_PRESETS;

var core = bridge.core;
var clearHistory = core.clearHistory;
var clearIndexCache = core.clearIndexCache;
var clearManualResourceId = core.clearManualResourceId;
var createPopup = core.createPopup;
var dbClear = core.dbClear;
var debugLog = core.debugLog;
var discoverResource = core.discoverResource;
var displayPage = core.displayPage;
var fallbackCopy = core.fallbackCopy;
var getDefaultPage = core.getDefaultPage;
var getResourceContext = core.getResourceContext;
var getResourceIdInfo = core.getResourceIdInfo;
var getSourceLangCode = core.getSourceLangCode;
var isAppInDarkMode = core.isAppInDarkMode;
var isCurrentMDictPicDicMainEntry = core.isCurrentMDictPicDicMainEntry;
var loadDictConfigJS = core.loadDictConfigJS;
var loadGlobalConfigJS = core.loadGlobalConfigJS;
var loadIndexAndConfig = core.loadIndexAndConfig;
var matchDarkBgPreset = core.matchDarkBgPreset;
var matchFilterPreset = core.matchFilterPreset;
var matchLightBgPreset = core.matchLightBgPreset;
var normalizeResourceId = core.normalizeResourceId;
var performSearch = core.performSearch;
var replaceDictSettings = core.replaceDictSettings;
var sanitizeCSSValue = core.sanitizeCSSValue;
var setManualResourceId = core.setManualResourceId;
var showConfirm = core.showConfirm;
var showToast = core.showToast;
var switchDict = core.switchDict;
var switchDictFromList = core.switchDictFromList;
var updateResourceIds = core.updateResourceIds;
var validateIndexOrder = core.validateIndexOrder;

// ==================== 历史面板 ====================
function showHistoryPanel() {
    var existing = document.getElementById('historyPanel');
    if (existing) { existing.remove(); return; }
    var history = state.historyStore ? state.historyStore.getAll() : [];
    if (!history || history.length === 0) {
        showToast('暂无历史记录');
        return;
    }
    var exportBtn = document.createElement('button');
    exportBtn.className = 'picdic-title-action-btn to_Copy';
    exportBtn.textContent = '📋 导出';
    exportBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!state.historyStore || state.historyStore.getAll().length === 0) {
            showToast('历史为空');
            return;
        }
        var map = {};
        state.historyStore.getAll().forEach(function(item) {
            var word = item.word;
            if (!map[word] || item.timestamp > map[word].timestamp) {
                map[word] = item;
            }
        });
        var sorted = Object.values(map).sort(function(a, b) {
            return b.timestamp - a.timestamp;
        });
        var lines = sorted.map(function(item) { return item.word; });
        var text = lines.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                showToast('已复制 ' + lines.length + ' 个单词到剪贴板');
            }).catch(function() { fallbackCopy(text); });
        } else {
            fallbackCopy(text);
        }
    });
    var clearBtn = document.createElement('button');
    clearBtn.className = 'picdic-title-action-btn to_ClearHistory';
    clearBtn.textContent = '🗑️ 清空';
    clearBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        clearHistory();
    });
    var popup = createPopup(
        '📜 查询历史（' + history.length + '条）',
        'picdic-history-panel',
        function(content) {
            var list = document.createElement('ul');
            list.className = 'picdic-popup-list';
            function deleteHistoryItem(item, liElement) {
                if (!state.historyStore) return;
                state.historyStore.remove(item.word, item.dictId);
                if (liElement && liElement.parentNode) {
                    liElement.parentNode.removeChild(liElement);
                }
                var titleEl = popup.panel.querySelector('.picdic-popup-title');
                if (titleEl) {
                    var count = state.historyStore.getAll().length;
                    titleEl.textContent = '📜 查询历史（' + count + '条）';
                }
                if (state.historyStore.getAll().length === 0) {
                    popup.close();
                    showToast('历史已清空');
                }
            }
            history.forEach(function(item) {
                var li = document.createElement('li');
                li.className = 'picdic-history-item';
                li.setAttribute('data-dictid', item.dictId || '');
                li.setAttribute('data-word', item.word);

                var jumpIcon = document.createElement('span');
                jumpIcon.className = 'picdic-lookup-in-GD-img';
                jumpIcon.textContent = '📖';
                jumpIcon.title = '在 GoldenDict 中查询此词';
			jumpIcon.addEventListener('click', function(e) {
			    e.stopPropagation();
			    var word = item.word;
			    if (!word) return;
			    var dictId = item.dictId;
			    var encodedWord = encodeURIComponent(word);
			    var url;

			    if (_env.isMDictAndroid) {
			        url = 'mdx://mdict.cn/entry/-1/' + encodedWord;
			    } else {
			        var sourceLang = getSourceLangCode(dictId);
			        var targetLang = -1;
			        url = 'content://mobi.goldendict.android/article/' + sourceLang + '/' + targetLang + '/' + encodedWord;
			    }

			    try {
			        window.location.href = url;
			    } catch (ex) {
			        window.open(url, '_self');
			    }
			});
                li.appendChild(jumpIcon);

                var wordSpan = document.createElement('span');
                wordSpan.className = 'picdic-history-word';
                wordSpan.textContent = item.word;
                li.appendChild(wordSpan);
                var rightContainer = document.createElement('div');
                rightContainer.className = 'picdic-history-right';
                var leftCol = document.createElement('div');
                leftCol.style.display = 'flex';
                leftCol.style.flexDirection = 'column';
                leftCol.style.alignItems = 'flex-end';
                leftCol.style.gap = '2px';
                var dictSpan = document.createElement('span');
                dictSpan.className = 'picdic-history-dict';
                var dictName = item.dictId || '未知词典';
                if (window.picdic_dictList && window.picdic_dictList[item.dictId]) {
                    dictName = window.picdic_dictList[item.dictId].name || dictName;
                }
                dictSpan.textContent = dictName;
                leftCol.appendChild(dictSpan);
                var timeSpan = document.createElement('span');
                timeSpan.className = 'picdic-history-time';
                var date = new Date(item.timestamp);
                var dateStr = date.toLocaleString(undefined, {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
                timeSpan.textContent = dateStr;
                leftCol.appendChild(timeSpan);
                rightContainer.appendChild(leftCol);
                var deleteBtn = document.createElement('span');
                deleteBtn.className = 'picdic-history-delete-btn';
                deleteBtn.textContent = '✕';
                deleteBtn.title = '删除此记录';
                deleteBtn.style.marginLeft = '4px';
                deleteBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    showConfirm('确认删除', '确定删除 "' + item.word + '" 的历史记录吗？', function() {
                        deleteHistoryItem(item, li);
                    });
                });
                rightContainer.appendChild(deleteBtn);
                li.appendChild(rightContainer);
                li.addEventListener('click', async function(e) {
                    if (e.target === jumpIcon || jumpIcon.contains(e.target) ||
                        e.target === deleteBtn || deleteBtn.contains(e.target)) {
                        return;
                    }
                    var targetDictId = this.getAttribute('data-dictid');
                    var targetWord = this.getAttribute('data-word');
                    if (!targetDictId || !targetWord) return;
                    try {
                        if (targetDictId && targetDictId !== state.ui.currentDictId) {
                            await switchDict(targetDictId);
                        }
                        if (state.ui.searchInput) {
                            state.ui.searchInput.value = targetWord;
                            performSearch();
                            popup.close();
                        }
                    } catch (err) {
                        showToast('切换词典失败：' + (err.message || '未知错误'));
                    }
                });
                list.appendChild(li);
            });
            content.appendChild(list);
            content.addEventListener('touchmove', function(e) {
                if (this.scrollHeight > this.clientHeight) {
                    e.stopPropagation();
                } else {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }, { passive: false });
        },
        [exportBtn, clearBtn]
    );
    state.historyPopup = popup;
}

// ==================== 词典列表 ====================
function showDictListMenu() {
    var dictList = window.picdic_dictList;
    if (!dictList || typeof dictList !== 'object' || Object.keys(dictList).length === 0) {
        showToast('无可用的词典列表');
        return;
    }
    var refreshCacheBtn = document.createElement('button');
    refreshCacheBtn.className = 'picdic-title-action-btn to_ClearIndexCache';
    refreshCacheBtn.textContent = '🔄刷新缓存';
    refreshCacheBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        showConfirm('确认刷新缓存', '清除所有索引缓存并重新加载当前词典？', async function() {
            clearIndexCache();
            if (state.ui.currentDictId) {
                try {
                    await loadIndexAndConfig(state.ui.currentDictId);
                    showToast('缓存已刷新，当前词典索引已重新加载。');
                    if (state.ui.pageNum) {
                        displayPage(state.ui.pageNum);
                    } else {
                        var pages = state.cache.dictionaryIndex.pages;
                        var first = pages[0];
                        displayPage(first);
                    }
                } catch (err) {
                    showToast('缓存刷新失败: ' + err.message);
                }
            }
            refreshCacheBtn.textContent = '✅';
            setTimeout(function() { refreshCacheBtn.textContent = '🔄 刷新缓存'; }, 2000);
        });
    });
    var resourceMapBtn = document.createElement('button');
    resourceMapBtn.className = 'picdic-title-action-btn to_Copy';
    resourceMapBtn.textContent = '🧭 ID映射';
    resourceMapBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        showResourceIdMapPanel();
    });
    var validateBtn = document.createElement('button');
    validateBtn.className = 'picdic-title-action-btn to_Default';
    validateBtn.textContent = '🔍 验证排序';
    validateBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!state.ui.currentDictId) {
            showToast('当前无词典');
            return;
        }
        var result = validateIndexOrder(state.ui.currentDictId);
        if (result.sorted) {
            showToast('✅ 索引排序正常！');
        } else {
            showToast('⚠️ 发现 ' + result.errors.length + ' 处排序错误，详情请查看页面顶部的黄色警告条或调试面板。');
        }
    });
    var popup = createPopup(
        '📚 词典',
        'picdic-dict-panel',
        function(content) {
            var dictList = window.picdic_dictList;
            if (!dictList || Object.keys(dictList).length === 0) {
                var msg = document.createElement('p');
                msg.textContent = '无词典可用';
                content.appendChild(msg);
                return;
            }
            var groups = {};
            Object.keys(dictList).forEach(function(id) {
                var dict = dictList[id];
                var pair = (dict.index_language || 'eng') + '-' + (dict.contents_language || 'eng');
                if (!groups[pair]) groups[pair] = [];
                groups[pair].push({ id: id, dict: dict });
            });
            var groupNames = Object.keys(groups);
            var savedOrder = state.config.globalConfig.dictGroupOrder;
            if (savedOrder && Array.isArray(savedOrder)) {
                var orderedGroups = [];
                var remaining = groupNames.slice();
                savedOrder.forEach(function(name) {
                    if (groups[name]) {
                        orderedGroups.push(name);
                        var idx = remaining.indexOf(name);
                        if (idx !== -1) remaining.splice(idx, 1);
                    }
                });
                orderedGroups = orderedGroups.concat(remaining);
                groupNames = orderedGroups;
            } else {
                groupNames.sort();
            }
            Object.keys(groups).forEach(function(pair) {
                var items = groups[pair];
                items.sort(function(a, b) {
                    return a.dict.name.localeCompare(b.dict.name);
                });
                items.forEach(function(item, idx) {
                    if (!state.configStore.data.allDictConfigs[item.id]) {
                        state.configStore.data.allDictConfigs[item.id] = {};
                    }
                    if (typeof state.configStore.data.allDictConfigs[item.id]._order === 'undefined') {
                        state.configStore.data.allDictConfigs[item.id]._order = idx;
                    }
                });
                items.sort(function(a, b) {
                    return state.configStore.data.allDictConfigs[a.id]._order -
                           state.configStore.data.allDictConfigs[b.id]._order;
                });
            });
            var list = document.createElement('ul');
            list.className = 'picdic-popup-list';
            var currentId = state.ui.currentDictId;
            var defaultId = state.config.globalConfig.defaultDictId;
            function moveDict(dictId, direction) {
                var foundGroup = null;
                var foundIndex = -1;
                for (var pair in groups) {
                    var items = groups[pair];
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].id === dictId) {
                            foundGroup = pair;
                            foundIndex = i;
                            break;
                        }
                    }
                    if (foundGroup) break;
                }
                if (foundGroup === null || foundIndex === -1) return;
                var items = groups[foundGroup];
                var newIndex = foundIndex + direction;
                if (newIndex < 0 || newIndex >= items.length) return;
                var temp = items[foundIndex];
                items[foundIndex] = items[newIndex];
                items[newIndex] = temp;
                items.forEach(function(item, idx) {
                    if (!state.configStore.data.allDictConfigs[item.id]) {
                        state.configStore.data.allDictConfigs[item.id] = {};
                    }
                    state.configStore.data.allDictConfigs[item.id]._order = idx;
                });
                state.configManager.notifyChange();
                popup.close();
                showDictListMenu();
            }
            groupNames.forEach(function(pair, groupIndex) {
                var items = groups[pair];
                var groupContainer = document.createElement('li');
                groupContainer.className = 'picdic-dict-group-container';
                var titleRow = document.createElement('div');
                titleRow.className = 'picdic-dict-group-title';
                var titleText = document.createElement('span');
                titleText.textContent = pair;
                titleRow.appendChild(titleText);
                var btnGroup = document.createElement('div');
                btnGroup.className = 'picdic-group-order-btns';
                if (groupIndex > 0) {
                    var upGroupBtn = document.createElement('button');
                    upGroupBtn.className = 'picdic-group-order-btn';
                    upGroupBtn.textContent = '▲';
                    upGroupBtn.title = '分组上移';
                    upGroupBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var temp = groupNames[groupIndex];
                        groupNames[groupIndex] = groupNames[groupIndex - 1];
                        groupNames[groupIndex - 1] = temp;
                        state.config.globalConfig.dictGroupOrder = groupNames;
                        state.configManager.notifyChange();
                        popup.close();
                        showDictListMenu();
                    });
                    btnGroup.appendChild(upGroupBtn);
                }
                if (groupIndex < groupNames.length - 1) {
                    var downGroupBtn = document.createElement('button');
                    downGroupBtn.className = 'picdic-group-order-btn';
                    downGroupBtn.textContent = '▼';
                    downGroupBtn.title = '分组下移';
                    downGroupBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var temp = groupNames[groupIndex];
                        groupNames[groupIndex] = groupNames[groupIndex + 1];
                        groupNames[groupIndex + 1] = temp;
                        state.config.globalConfig.dictGroupOrder = groupNames;
                        state.configManager.notifyChange();
                        popup.close();
                        showDictListMenu();
                    });
                    btnGroup.appendChild(downGroupBtn);
                }
                titleRow.appendChild(btnGroup);
                groupContainer.appendChild(titleRow);
                var subList = document.createElement('ul');
                subList.className = 'picdic-dict-sublist';
                items.forEach(function(item, index) {
                    var dictId = item.id;
                    var dict = item.dict;
                    var li = document.createElement('li');
                    li.className = 'picdic-dict-item';
                    if (dictId === currentId) li.classList.add('current');
                    var defaultStar = document.createElement('span');
                    defaultStar.className = 'picdic-dict-default-star';
                    if (defaultId === dictId) {
                        defaultStar.classList.add('is-default');
                    }
                    defaultStar.textContent = (defaultId === dictId) ? '★' : '☆';
                    defaultStar.title = (defaultId === dictId) ? '当前默认词典' : '设为默认';
                    defaultStar.addEventListener('click', function(e) {
                        e.stopPropagation();
                        state.config.globalConfig.defaultDictId = dictId;
                        state.configManager.notifyChange();
                        popup.close();
                        showDictListMenu();
                    });
                    li.appendChild(defaultStar);
                    var iconSpan = document.createElement('span');
                    iconSpan.className = 'picdic-dict-icon';
                    var cachedIcon = state.configStore.data.allDictConfigs[dictId] &&
                                     state.configStore.data.allDictConfigs[dictId]._cachedIcon;
                    if (cachedIcon) {
                        var img = document.createElement('img');
                        img.className = 'picdic-dict-icon-img';
                        img.src = UrlBuilder.getFileUrl(cachedIcon);
                        img.alt = '';
                        img.onerror = function() {
                            this.parentNode.textContent = '📚';
                        };
                        iconSpan.appendChild(img);
                    } else {
                        iconSpan.textContent = '📚';
                        (function(span, dId) {
                            discoverResource(dId, 'icon', function(iconPath) {
                                if (iconPath) {
                                    span.innerHTML = '';
                                    var newImg = document.createElement('img');
                                    newImg.className = 'picdic-dict-icon-img';
                                    newImg.src = UrlBuilder.getFileUrl(iconPath);
                                    newImg.alt = '';
                                    newImg.onerror = function() {
                                        this.parentNode.textContent = '📚';
                                    };
                                    span.appendChild(newImg);
                                }
                            });
                        })(iconSpan, dictId);
                    }
                    iconSpan.style.cursor = 'pointer';
                    iconSpan.addEventListener('click', function(e) {
                        e.stopPropagation();
                        showDictDetailPanel(dictId);
                    });
                    li.appendChild(iconSpan);
                    var nameSpan = document.createElement('span');
                    nameSpan.className = 'picdic-dict-name';
                    nameSpan.textContent = dict.name;
                    if (_env.isMDictAndroid) {
                        var needsPicDicMainEntryJump = !isCurrentMDictPicDicMainEntry();
                        nameSpan.setAttribute('role', 'link');
                        nameSpan.setAttribute('tabindex', '0');
                        nameSpan.style.cursor = 'pointer';
                        if (needsPicDicMainEntryJump) {
                            nameSpan.classList.add('picdic-dict-name-jump');
                            nameSpan.title = '先跳转到 MDict 的 picdic 主词条，再打开此词典并查询当前输入词';
                            nameSpan.style.textDecoration = 'underline';
                            nameSpan.style.textUnderlineOffset = '2px';
                        } else {
                            nameSpan.title = '当前已在 picdic 主词条中，直接切换到此词典并查询当前输入词';
                        }
                        nameSpan.addEventListener('click', function(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            switchDictFromList(dictId, popup);
                        });
                        nameSpan.addEventListener('keydown', function(e) {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                switchDictFromList(dictId, popup);
                            }
                        });
                    }
                    li.appendChild(nameSpan);
                    var orderBtns = document.createElement('span');
                    orderBtns.className = 'picdic-dict-order-btns';
                    var upBtn = document.createElement('button');
                    upBtn.className = 'picdic-dict-order-btn';
                    upBtn.textContent = '▲';
                    upBtn.title = (index > 0) ? '上移' : '已在顶部';
                    upBtn.disabled = (index === 0);
                    upBtn.addEventListener('click', function(e) {
                        if (index === 0) return;
                        e.stopPropagation();
                        moveDict(dictId, -1);
                    });
                    orderBtns.appendChild(upBtn);
                    var downBtn = document.createElement('button');
                    downBtn.className = 'picdic-dict-order-btn';
                    downBtn.textContent = '▼';
                    downBtn.title = (index < items.length - 1) ? '下移' : '已在底部';
                    downBtn.disabled = (index === items.length - 1);
                    downBtn.addEventListener('click', function(e) {
                        if (index === items.length - 1) return;
                        e.stopPropagation();
                        moveDict(dictId, 1);
                    });
                    orderBtns.appendChild(downBtn);
                    li.appendChild(orderBtns);
                    li.addEventListener('click', function(e) {
                        if (e.target.tagName === 'BUTTON' ||
                            (e.target.tagName === 'SPAN' && (e.target.textContent === '★' || e.target.textContent === '☆'))) {
                            return;
                        }
                        switchDictFromList(dictId, popup);
                    });
                    subList.appendChild(li);
                });
                groupContainer.appendChild(subList);
                list.appendChild(groupContainer);
            });
            content.appendChild(list);
        },
        [refreshCacheBtn, resourceMapBtn, validateBtn]
    );
}

function showResourceIdMapPanel() {
    var dictList = window.picdic_dictList || {};
    var detectBtn = document.createElement('button');
    detectBtn.className = 'picdic-title-action-btn to_Apply';
    detectBtn.textContent = '重新检测';
    detectBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        updateResourceIds();
        if (state._resourceIdPopup) state._resourceIdPopup.close();
        showResourceIdMapPanel();
        showToast('Resource ID 已重新检测');
    });
    var popup = createPopup(
        '🧭 Resource ID 映射',
        'picdic-resource-id-panel',
        function(content) {
            var context = getResourceContext();
            var tip = document.createElement('div');
            tip.className = 'picdic-resource-id-content';
            tip.textContent = '当前环境：' + context.label + '。手动值优先于自动检测；MDict 映射按当前分组分别保存。';
            content.appendChild(tip);

            Object.keys(dictList).forEach(function(dictId) {
                var info = getResourceIdInfo(dictId);
                var row = document.createElement('div');
                row.className = 'picdic-resource-id-row';

                var name = document.createElement('div');
                name.style.cssText = 'word-break:break-all;';
                name.textContent = (dictList[dictId].name || dictId) + '\n' + dictId;
                name.title = dictId;
                row.appendChild(name);

                var input = document.createElement('input');
                input.type = 'text';
                input.value = info.manual || info.value || '';
                input.placeholder = info.auto || info.configured || '自动检测';
                input.style.cssText = 'min-width:0;width:100%;box-sizing:border-box;';
                input.title = '来源：' + info.source + (info.auto ? '；自动值：' + info.auto : '');
                row.appendChild(input);

                var save = document.createElement('button');
                save.textContent = '保存';
                save.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var value = normalizeResourceId(input.value);
                    if (!value) {
                        showToast('请输入有效的 Resource ID');
                        return;
                    }
                    setManualResourceId(dictId, value);
                    input.value = value;
                    showToast('已保存：' + dictId + ' → ' + value);
                });
                row.appendChild(save);

                var clear = document.createElement('button');
                clear.textContent = '自动';
                clear.title = '清除手动值，恢复自动检测或初始配置';
                clear.addEventListener('click', function(e) {
                    e.stopPropagation();
                    clearManualResourceId(dictId);
                    var refreshed = getResourceIdInfo(dictId);
                    input.value = '';
                    input.placeholder = refreshed.auto || refreshed.configured || '自动检测';
                    showToast('已恢复自动映射：' + dictId);
                });
                row.appendChild(clear);

                var meta = document.createElement('div');
                meta.style.cssText = 'grid-column:1/-1;font-size:10px;opacity:.7;word-break:break-all;';
                meta.textContent = '有效值：' + (info.value || '无') + '；来源：' + info.source + (info.auto ? '；自动检测值：' + info.auto : '');
                row.appendChild(meta);
                content.appendChild(row);
            });
        },
        [detectBtn]
    );
    state._resourceIdPopup = popup;
}

// ==================== 词典详情面板 ====================
function showDictDetailPanel(dictId) {
    var dict = window.picdic_dictList[dictId];
    if (!dict) return;
    var popup = createPopup('📖 词典详情', '', function(content) {
        var iconContainer = document.createElement('div');
        iconContainer.style.textAlign = 'center';
        iconContainer.style.marginBottom = '8px';
        var cachedIcon = state.configStore.data.allDictConfigs[dictId] &&
                         state.configStore.data.allDictConfigs[dictId]._cachedIcon;
        if (cachedIcon) {
            var img = document.createElement('img');
            img.src = UrlBuilder.getFileUrl(cachedIcon);
            img.style.maxWidth = '60%';
            img.style.height = 'auto';
            img.style.maxHeight = '100px';
            img.alt = '';
            img.onerror = function() {
                this.parentNode.innerHTML = '📚';
            };
            iconContainer.appendChild(img);
        } else {
            iconContainer.innerHTML = '<span style="font-size:48px;">📚</span>';
        }
        content.appendChild(iconContainer);
        var fields = [
            { label: '名称', value: dict.name },
            { label: '索引语言', value: dict.index_language },
            { label: '内容语言', value: dict.contents_language },
            { label: '版本', value: dict.version },
            { label: '索引路径', value: dict.indexPath },
            { label: '当前 Resource ID', value: getResourceIdInfo(dictId).value || '未设置' },
            { label: 'Resource ID 来源', value: getResourceIdInfo(dictId).source },
            { label: '映射环境', value: getResourceIdInfo(dictId).context.label }
        ];
        fields.forEach(function(f) {
            if (f.value) {
                var row = document.createElement('div');
                row.style.padding = '4px 0';
                row.style.wordBreak = 'break-all';
                row.innerHTML = '<strong>' + f.label + '：</strong>' + f.value;
                content.appendChild(row);
            }
        });
    });
}

// ==================== 配置菜单 ====================
var configMenuVisible = false;

// V8 Phase 1：设置字段只在 schema 中声明一次，构建 / 刷新 / 保存共用。
var DICT_CONFIG_FIELDS = [
    { id:'chkTopNav', key:'showTopNav', label:'目录导航', type:'checkbox' },
    { id:'inpZoom', key:'doubleTapZoomFactor', label:'放大倍数', type:'number', step:'0.25', min:'1.05', max:'4', parse:'float' },
    { id:'chkZoomVerticalDragOnly', key:'zoomVerticalDragOnly', label:'仅纵向滑动', type:'checkbox' },
    { id:'inpExternalCropLeft', key:'externalCropLeft', label:'左边裁剪', type:'number', step:'1', min:'0', parse:'float', allowZero:true, clampMin:0, title:'单位：原始图片像素' },
    { id:'inpExternalCropRight', key:'externalCropRight', label:'右边裁剪', type:'number', step:'1', min:'0', parse:'float', allowZero:true, clampMin:0, title:'单位：原始图片像素' },
    { id:'inpHorizontalMarginPercent', key:'horizontalMarginPercent', label:'安全边距', type:'number', step:'0.1', min:'0', max:'25', parse:'float', allowZero:true, clampMin:0, clampMax:25, title:'单位：当前视口宽度的百分比' },
    { id:'inpHighlightHeight', key:'highlightHeight', label:'高亮高度', type:'number', step:'0.01', min:'1.0', max:'5.0', parse:'float', fallback:1.15 },
    { id:'inpHighlightCharWidth', key:'highlightCharWidth', label:'高亮字宽', type:'number', step:'0.1', min:'0.1', max:'10', parse:'float' },
    { id:'inpHighlightWidth', key:'highlightWidth', label:'高亮最宽', type:'number', step:'1', min:'1', max:'99', parse:'float', fallback:25 }
];

var GLOBAL_CONFIG_FIELDS = [
    { id:'chkDebug', key:'DebugPanel_display', label:'调试面板', type:'checkbox' },
    { id:'inpMaxHistory', key:'maxHistorySize', label:'历史记录', type:'number', step:'1', min:'10', max:'500', parse:'int', fallback:50 },
    { id:'defaultPageSelect', key:'defaultPageValue', label:'首选词典', type:'select', fallback:DEFAULT_PAGE_TYPES.FIRST_CONTENT, options:[
        { value:DEFAULT_PAGE_TYPES.FIRST_CONTENT, label:'正文首页' },
        { value:DEFAULT_PAGE_TYPES.COVER, label:'词典封面' },
        { value:DEFAULT_PAGE_TYPES.LAST_WORD, label:'末次查词' }
    ]},
    { id:'inpPreload', key:'preloadPages', label:'预加载页', type:'number', step:'1', min:'0', max:'5', parse:'int' },
    { id:'chkDoubleTap', key:'enableDoubleTapZoom', label:'双击放大', type:'checkbox' },
    { id:'chkClickPageTurn', key:'enableClickPageTurn', label:'单击翻页', type:'checkbox' },
    { id:'chkLongPressZoom', key:'enableLongPressZoom', label:'长按放大', type:'checkbox' },
    { id:'inpLongPressDelay', key:'longPressDelay', label:'长按延迟', type:'number', step:'50', min:'200', max:'1000', parse:'int', fallback:400 },
    { id:'chkShowZoomBtns', key:'showZoomButtons', label:'放大启用按钮', type:'checkbox' },
    { id:'inpZoomStep', key:'zoomStep', label:'按钮缩放倍数', type:'number', step:'0.1', min:'0.1', max:'2', parse:'float' },
    { id:'chkSwipe', key:'swipeEnabled', label:'滑动翻页', type:'checkbox' },
    { id:'inpThreshold', key:'swipeThreshold', label:'滑动阈值', type:'number', step:'5', min:'10', max:'100', parse:'int' },
    { id:'chkInputDebounce', key:'enableInputDebounce', label:'输入防抖', type:'checkbox' },
    { id:'inpDebounceDelay', key:'inputDebounceDelay', label:'防抖延迟', type:'number', step:'50', min:'100', max:'1000', parse:'int', fallback:300 },
    { id:'chkExpandOnZoom', key:'enableExpandOnZoom', label:'放大时扩展显示高度', type:'checkbox' },
    { id:'chkAutoZoomExternal', key:'autoZoomExternalFullIndex', label:'外部查询放大定位', type:'checkbox', title:'仅对具有词条坐标的全索引词典生效' },
    { id:'chkFollow', key:'darkModeFollowApp', label:'跟随程序暗色', type:'checkbox' },
    { id:'chkDark', key:'darkMode', label:'单独暗色模式', type:'checkbox' },
    { id:'inpDarkFilter', key:'darkModeFilter', label:'暗色滤镜', type:'text', sanitize:true },
    { id:'inpDarkBg', key:'darkModeBgColor', label:'暗色背景', type:'text', sanitize:true, fallback:'#1a1a1a' },
    { id:'inpLightBg', key:'lightModeBgColor', label:'浅色背景', type:'text', sanitize:true, fallback:'#ffffff' }
];

function configFieldDefault(spec, defaults) {
    if (Object.prototype.hasOwnProperty.call(spec, 'fallback')) return spec.fallback;
    return defaults ? defaults[spec.key] : undefined;
}

function configFieldValue(source, spec, defaults) {
    var value = source ? source[spec.key] : undefined;
    return value === undefined || value === null ? configFieldDefault(spec, defaults) : value;
}

function createConfigControlRow(labelText, control) {
    var row = document.createElement('div');
    row.className = 'picdic-config-row';
    var label = document.createElement('label');
    label.className = 'picdic-config-label';
    label.textContent = labelText + ':';
    row.appendChild(label);
    var wrapper = document.createElement('div');
    wrapper.className = 'picdic-config-control';
    wrapper.appendChild(control);
    row.appendChild(wrapper);
    return row;
}

function createConfigControl(spec, source, defaults) {
    var control = document.createElement(spec.type === 'select' ? 'select' : 'input');
    if (spec.type !== 'select') control.type = spec.type;
    if (spec.step !== undefined) control.step = spec.step;
    if (spec.min !== undefined) control.min = spec.min;
    if (spec.max !== undefined) control.max = spec.max;
    if (spec.title) control.title = spec.title;

    var value = configFieldValue(source, spec, defaults);
    if (spec.type === 'checkbox') {
        control.checked = !!value;
    } else if (spec.type === 'select') {
        (spec.options || []).forEach(function(opt) {
            var option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            control.appendChild(option);
        });
        control.value = value;
    } else {
        control.value = value === undefined || value === null ? '' : value;
    }
    return control;
}

function appendConfigFields(grid, schema, source, defaults, controls, skip) {
    schema.forEach(function(spec) {
        if (skip && skip[spec.id]) return;
        var control = createConfigControl(spec, source, defaults);
        controls[spec.id] = control;
        grid.appendChild(createConfigControlRow(spec.label, control));
    });
}

function refreshConfigFields(schema, source, defaults, controls) {
    schema.forEach(function(spec) {
        var control = controls[spec.id];
        if (!control) return;
        var value = configFieldValue(source, spec, defaults);
        if (spec.type === 'checkbox') control.checked = !!value;
        else control.value = value === undefined || value === null ? '' : value;
    });
}

function collectConfigFields(schema, controls, defaults) {
    var result = {};
    schema.forEach(function(spec) {
        var control = controls[spec.id];
        if (!control) return;
        var value;
        if (spec.type === 'checkbox') {
            value = !!control.checked;
        } else if (spec.type === 'select') {
            value = control.value || configFieldDefault(spec, defaults);
        } else if (spec.type === 'text') {
            value = spec.sanitize ? sanitizeCSSValue(control.value) : control.value;
            if (!value) value = configFieldDefault(spec, defaults);
        } else {
            value = spec.parse === 'int' ? parseInt(control.value, 10) : parseFloat(control.value);
            var invalid = !isFinite(value) || (!spec.allowZero && value === 0);
            if (invalid) value = configFieldDefault(spec, defaults);
            if (spec.clampMin !== undefined && value < spec.clampMin) value = spec.clampMin;
            if (spec.clampMax !== undefined && value > spec.clampMax) value = spec.clampMax;
        }
        result[spec.key] = value;
    });
    return result;
}

function createConfigActionButton(text, className, handler) {
    var btn = document.createElement('button');
    btn.className = 'picdic-title-action-btn ' + className;
    btn.textContent = text;
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        handler(btn);
    });
    return btn;
}

function createConfigSection(titleText, resetHandler) {
    var section = document.createElement('div');
    section.className = 'config-section';
    var titleRow = document.createElement('div');
    titleRow.className = 'section-title-row';
    var title = document.createElement('span');
    title.textContent = titleText;
    titleRow.appendChild(title);
    if (resetHandler) {
        titleRow.appendChild(createConfigActionButton('恢复', 'to_Default', resetHandler));
    }
    section.appendChild(titleRow);
    return section;
}

function createPresetSelect(presets, value) {
    var select = document.createElement('select');
    presets.forEach(function(p) {
        var opt = document.createElement('option');
        opt.value = p.value;
        opt.textContent = p.label;
        select.appendChild(opt);
    });
    select.value = value;
    return select;
}

function appendPresetRow(
    grid,
    labelText,
    select,
    onChange,
    fullRow
) {
    var row = createConfigControlRow(labelText, select);

    if (fullRow) {
        row.style.gridColumn = '1 / -1';
    }

    grid.appendChild(row);

    if (onChange)
        select.addEventListener('change', onChange);
}

function appendColorEditor(grid, labelText, selectId, inputId, presets, matchFn, color, placeholder, controls) {
    var row = document.createElement('div');
    row.className = 'picdic-config-row';
    row.style.gridColumn = '1 / -1';
    var label = document.createElement('label');
    label.className = 'picdic-config-label';
    label.textContent = labelText + ':';
    row.appendChild(label);
    var wrapper = document.createElement('div');
    wrapper.className = 'picdic-config-control';
    var select = createPresetSelect(presets, matchFn(color));
    var preview = document.createElement('span');
    preview.className = 'picdic-color-preview';
    preview.style.backgroundColor = color;
    var input = document.createElement('input');
    input.className = 'picdic-color-input';
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = color;
    wrapper.appendChild(select);
    wrapper.appendChild(preview);
    wrapper.appendChild(input);
    row.appendChild(wrapper);
    grid.appendChild(row);
    controls[selectId] = select;
    controls[inputId] = input;
    select.addEventListener('change', function() {
        if (this.value !== '__custom__') {
            input.value = this.value;
            preview.style.backgroundColor = this.value;
        }
    });
    input.addEventListener('input', function() {
        preview.style.backgroundColor = this.value || color;
    });
}

function buildConfigPanel() {
    if (state.config._configPanelBuilt) return;

    var applyBtn = createConfigActionButton('应用', 'to_Apply', function(btn) {
        collectAndApplyConfig();
        btn.textContent = '✅';
        setTimeout(function() { btn.textContent = '应用'; }, 1500);
    });
    var copyBtn = createConfigActionButton('复制', 'to_Copy', function(btn) {
        var iniContent = '[PicDic Global]\\n';
        var key;
        for (key in state.config.globalConfig) iniContent += key + ' = ' + state.config.globalConfig[key] + '\\n';
        iniContent += '\\n[Dict: ' + state.ui.currentDictId + ']\\n';
        for (key in state.config.dictConfig) iniContent += key + ' = ' + state.config.dictConfig[key] + '\\n';
        function copied() {
            btn.textContent = '✅';
            setTimeout(function() { btn.textContent = '复制'; }, 1500);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(iniContent).then(copied).catch(function() { fallbackCopy(iniContent); });
        } else {
            fallbackCopy(iniContent);
        }
    });
    var clearCacheBtn = createConfigActionButton('清理缓存', 'to_ClearIndexCache', showClearCachePanel);

    var popup = createPopup('⚙️ 设置列表', 'picdic-config-panel', function(content) {
        var form = document.createElement('div');
        form.className = 'picdic-config-form';
        var controls = {};

        var dictSection = createConfigSection('📖 当前词典设置', function() {
            var dictId = state.ui.currentDictId;
            var dict = dictId && window.picdic_dictList && window.picdic_dictList[dictId];
            if (!dictId) return showToast('当前无词典');
            if (!dict) return showToast('词典信息未加载');
            var configPath = dict.indexPath.replace('_index.js', '_config.ini');
            showConfirm('确认恢复', '确定要恢复当前词典的默认设置吗？此操作将覆盖您之前的所有自定义设置。', function() {
                loadDictConfigJS(configPath, dictId).then(function(configData) {
                    if (configData) {
                        replaceDictSettings(dictId, configData);
                        showToast('已从外部配置恢复当前词典设置');
                    } else {
                        showConfirm('未找到外部配置', '未找到外部配置文件，将使用内置默认值。确认？', function() {
                            replaceDictSettings(dictId, null);
                            showToast('已恢复内置默认设置');
                        });
                    }
                }).catch(function() {
                    showConfirm('加载失败', '加载外部配置失败，将使用内置默认值。确认？', function() {
                        replaceDictSettings(dictId, null);
                        showToast('已恢复内置默认设置');
                    });
                });
            }, function() { debugLog('恢复操作已取消'); });
        });
        var dictGrid = document.createElement('div');
        dictGrid.className = 'config-grid';
        dictGrid.style.display = 'grid';
        dictGrid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
        dictGrid.style.columnGap = '10px';
        dictGrid.style.rowGap = '8px';
        appendConfigFields(dictGrid, DICT_CONFIG_FIELDS, state.config.dictConfig, DEFAULT_DICT_CONFIG, controls);
        dictSection.appendChild(dictGrid);
        form.appendChild(dictSection);

        var globalSection = createConfigSection('🌐 全局设置', function() {
            showConfirm('确认恢复', '确定要恢复所有全局设置为默认值吗？此操作将覆盖您之前的所有自定义设置。', function() {
                loadGlobalConfigJS().then(function(configData) {
                    if (configData) {
                        var merged = {};
                        for (var key in DEFAULT_GLOBAL_CONFIG) {
                            merged[key] = key in configData ? configData[key] : DEFAULT_GLOBAL_CONFIG[key];
                        }
                        Object.assign(state.configStore.data.globalConfig, merged);
                        state.configManager.notifyChange();
                        showToast('已从外部配置恢复全局设置');
                    } else {
                        showConfirm('未找到外部配置', '未找到全局外部配置文件，将使用内置默认值。确认？', function() {
                            state.configStore.data.globalConfig = Object.assign({}, DEFAULT_GLOBAL_CONFIG);
                            state.configManager.notifyChange();
                            showToast('已恢复内置默认全局设置');
                        });
                    }
                }).catch(function() {
                    showConfirm('加载失败', '加载外部全局配置失败，将使用内置默认值。确认？', function() {
                        state.configStore.data.globalConfig = Object.assign({}, DEFAULT_GLOBAL_CONFIG);
                        state.configManager.notifyChange();
                        showToast('已恢复内置默认全局设置');
                    });
                });
            }, function() { debugLog('恢复操作已取消'); });
        });
        var globalGrid = document.createElement('div');
        globalGrid.className = 'config-grid';
        var complex = { inpDarkFilter:1, inpDarkBg:1, inpLightBg:1 };
        appendConfigFields(globalGrid, GLOBAL_CONFIG_FIELDS, state.config.globalConfig, DEFAULT_GLOBAL_CONFIG, controls, complex);

        controls.selectDarkFilterPreset = createPresetSelect(FILTER_PRESETS, matchFilterPreset(state.config.globalConfig.darkModeFilter));
	appendPresetRow(
	    globalGrid,
	    '滤镜预设',
	    controls.selectDarkFilterPreset,
	    function() {
	        if (this.value !== '__custom__')
	            controls.inpDarkFilter.value = this.value;
	    },
	    true
	);
        controls.inpDarkFilter = createConfigControl(GLOBAL_CONFIG_FIELDS.filter(function(x) { return x.id === 'inpDarkFilter'; })[0], state.config.globalConfig, DEFAULT_GLOBAL_CONFIG);
        var filterRow = createConfigControlRow('暗色滤镜', controls.inpDarkFilter);
        filterRow.className += ' filter-row';
        globalGrid.appendChild(filterRow);

        appendColorEditor(globalGrid, '暗色背景', 'selectDarkBgPreset', 'inpDarkBg', DARK_BG_PRESETS, matchDarkBgPreset,
            state.config.globalConfig.darkModeBgColor || '#1a1a1a', '#1a1a1a', controls);
        appendColorEditor(globalGrid, '浅色背景', 'selectLightBgPreset', 'inpLightBg', LIGHT_BG_PRESETS, matchLightBgPreset,
            state.config.globalConfig.lightModeBgColor || '#ffffff', '#ffffff', controls);

        if (state.config.globalConfig.darkModeFollowApp) {
            controls.chkDark.disabled = true;
            controls.chkDark.checked = isAppInDarkMode();
        }

        globalSection.appendChild(globalGrid);
        form.appendChild(globalSection);
        content.appendChild(form);
        state.config._configControls = controls;
    }, [applyBtn, copyBtn, clearCacheBtn], function() {
        state.config._configPanelBuilt = false;
        state.config._configOverlay = null;
        state._configPopup = null;
        configMenuVisible = false;
    });

    state._configPopup = popup;
    state.config._configOverlay = popup.overlay;
    state.config._configPanel = popup.panel;
    state.config._configPanelBuilt = true;

    function refreshConfigForm() {
        var c = state.config._configControls;
        if (!c) return;
        refreshConfigFields(DICT_CONFIG_FIELDS, state.config.dictConfig, DEFAULT_DICT_CONFIG, c);
        refreshConfigFields(GLOBAL_CONFIG_FIELDS, state.config.globalConfig, DEFAULT_GLOBAL_CONFIG, c);
        c.chkDark.disabled = !!state.config.globalConfig.darkModeFollowApp;
        c.selectDarkFilterPreset.value = matchFilterPreset(state.config.globalConfig.darkModeFilter);
        c.selectDarkBgPreset.value = matchDarkBgPreset(state.config.globalConfig.darkModeBgColor || '#1a1a1a');
        c.selectLightBgPreset.value = matchLightBgPreset(state.config.globalConfig.lightModeBgColor || '#ffffff');
        var darkPreview = c.selectDarkBgPreset.parentNode.querySelector('.picdic-color-preview');
        var lightPreview = c.selectLightBgPreset.parentNode.querySelector('.picdic-color-preview');
        if (darkPreview) darkPreview.style.backgroundColor = state.config.globalConfig.darkModeBgColor || '#1a1a1a';
        if (lightPreview) lightPreview.style.backgroundColor = state.config.globalConfig.lightModeBgColor || '#ffffff';
    }
    state.config._refreshConfigForm = refreshConfigForm;

    function collectAndApplyConfig() {
        var c = state.config._configControls;
        if (!c) return;
        var newGlobal = collectConfigFields(GLOBAL_CONFIG_FIELDS, c, DEFAULT_GLOBAL_CONFIG);
        if (newGlobal.maxHistorySize < 1) newGlobal.maxHistorySize = 50;
        Object.assign(state.configStore.data.globalConfig, newGlobal);
        if (state.historyStore && state.historyStore.getAll().length > newGlobal.maxHistorySize) {
            state.historyStore.history.length = newGlobal.maxHistorySize;
        }

        var newDict = collectConfigFields(DICT_CONFIG_FIELDS, c, DEFAULT_DICT_CONFIG);
        Object.assign(state.configStore.data.dictConfig, newDict);
        if (state.ui.currentDictId) {
            if (!state.configStore.data.allDictConfigs[state.ui.currentDictId]) {
                state.configStore.data.allDictConfigs[state.ui.currentDictId] = {};
            }
            for (var k in DEFAULT_DICT_CONFIG) {
                state.configStore.data.allDictConfigs[state.ui.currentDictId][k] = state.configStore.data.dictConfig[k];
            }
        }
        state.configManager.notifyChange();
        if (state._configPopup) state._configPopup.close();
    }
    state.config._collectAndApplyConfig = collectAndApplyConfig;
}

function showClearCachePanel() {
    var existing = document.getElementById('clear-cache-subpanel');
    if (existing) existing.remove();
    var actions = [];
    var confirmBtn = document.createElement('button');
    confirmBtn.textContent = '确认清理';
    confirmBtn.className = 'picdic-title-action-btn to_Confirm';
    confirmBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var types = [];
        if (window._clearCacheCheckboxes) {
            var checkboxes = window._clearCacheCheckboxes;
            if (checkboxes.clear_index.checked) types.push('index');
            if (checkboxes.clear_config.checked) types.push('config');
            if (checkboxes.clear_all.checked) types.push('all');
        }
        if (types.length === 0) {
            showToast('请至少选择一个清理选项。');
            return;
        }
        doClearCache(types);
        if (window._clearCachePopup) {
            window._clearCachePopup.close();
        }
        closeConfigMenu();
    });
    actions.push(confirmBtn);
    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.className = 'picdic-title-action-btn to_Cancel';
    cancelBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (window._clearCachePopup) {
            window._clearCachePopup.close();
        }
    });
    actions.push(cancelBtn);
    var popup = createPopup(
        '🧹 清理缓存',
        '',
        function(content) {
            var desc = document.createElement('p');
            desc.textContent = '请选择要清理的内容：';
            desc.style.margin = '8px 0';
            content.appendChild(desc);
            var options = [
                { id: 'clear_index', label: '仅索引缓存（保留配置和历史）', checked: false },
                { id: 'clear_config', label: '仅配置/历史（保留索引）', checked: false },
                { id: 'clear_all', label: '全部清理（重置所有数据）', checked: false }
            ];
            var checkboxes = {};
            options.forEach(function(opt) {
                var label = document.createElement('label');
                label.style.display = 'block';
                label.style.padding = '4px 0';
                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.id = opt.id;
                cb.checked = opt.checked || false;
                checkboxes[opt.id] = cb;
                label.appendChild(cb);
                label.appendChild(document.createTextNode(' ' + opt.label));
                content.appendChild(label);
            });
            window._clearCacheCheckboxes = checkboxes;
        },
        actions,
        function() {
            window._clearCachePopup = null;
            window._clearCacheCheckboxes = null;
        }
    );
    window._clearCachePopup = popup;
}

function doClearCache(types) {
    var cleared = [];
    if (types.indexOf('all') !== -1) {
        dbClear('data');
        dbClear('indexCache');
        window.name = '';
        state.configStore.data.globalConfig = Object.assign({}, DEFAULT_GLOBAL_CONFIG);
        state.configStore.data.dictConfig = Object.assign({}, DEFAULT_DICT_CONFIG);
        state.configStore.data.allDictConfigs = {};
        if (state.historyStore) state.historyStore.history = [];
        state.ui.currentDictId = null;
        state.misc._savedWord = '';
        state.misc._autoSearch = false;
        state.cache._normalizedKeys = null;
        state.cache._sortedKeys = null;
        state.cache._keyMap = null;
        state.cache._searchCacheReady = false;
        state.cache._searchCacheDictId = null;
        state.cache._searchCacheIndexPath = null;
        state.cache._searchCacheRawKeyCount = 0;
        if (state.configStore) state.configStore.save();
        if (state.historyStore) state.historyStore.saveNow();
        showToast('已清理全部数据，页面即将刷新。');
        location.reload();
        return;
    }
    if (types.indexOf('index') !== -1) {
        dbClear('indexCache');
        cleared.push('索引缓存');
        state.cache._normalizedKeys = null;
        state.cache._sortedKeys = null;
        state.cache._keyMap = null;
        state.cache._searchCacheReady = false;
        state.cache._searchCacheDictId = null;
        state.cache._searchCacheIndexPath = null;
        state.cache._searchCacheRawKeyCount = 0;
    }
    if (types.indexOf('config') !== -1) {
        dbClear('data');
        window.name = '';
        state.configStore.data.globalConfig = Object.assign({}, DEFAULT_GLOBAL_CONFIG);
        state.configStore.data.dictConfig = Object.assign({}, DEFAULT_DICT_CONFIG);
        state.configStore.data.allDictConfigs = {};
        if (state.historyStore) state.historyStore.history = [];
        state.configStore.save();
        state.historyStore.saveNow();
        cleared.push('配置/历史');
    }
    if (cleared.length === 0) {
        showToast('未选择任何清理项。');
        return;
    }
    showToast('已清理：' + cleared.join('、') + '。\n页面即将刷新以生效。');
    if (types.length === 1 && types[0] === 'index') {
        if (state.ui.currentDictId) {
            (async function() {
                try {
                    await loadIndexAndConfig(state.ui.currentDictId);
                    if (state.ui.pageNum) {
                        displayPage(state.ui.pageNum);
                    } else {
                        var defaultTarget = getDefaultPage();
                        if (defaultTarget) displayPage(defaultTarget);
                    }
                } catch (err) {}
            })();
        }
    } else {
        location.reload();
    }
}

function showConfigMenu() {
    if (configMenuVisible) return;
    configMenuVisible = true;
    if (!state.config._configPanelBuilt) {
        buildConfigPanel();
    }
    if (state.config._refreshConfigForm) {
        state.config._refreshConfigForm();
    }
    if (state.config._configOverlay && !state.config._configOverlay.parentNode) {
        document.body.appendChild(state.config._configOverlay);
    }
}

function closeConfigMenu() {
    if (state._configPopup) {
        state._configPopup.close();
    }
    configMenuVisible = false;
}

// 对外导出的刷新入口必须位于 factory 作用域。
// 真正的表单刷新函数由 buildConfigPanel() 创建并保存在 state.config 中。
function refreshConfigForm() {
    if (state.config && typeof state.config._refreshConfigForm === 'function') {
        return state.config._refreshConfigForm();
    }
}

// ==================== 资源ID ====================

return {
    showHistoryPanel: showHistoryPanel,
    showDictListMenu: showDictListMenu,
    showConfigMenu: showConfigMenu,
    closeConfigMenu: closeConfigMenu,
    refreshConfigForm: refreshConfigForm
};
};

})(window);
