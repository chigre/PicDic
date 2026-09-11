// PicDic_search.js - 优化版 v15（Shared Runtime + Hot-Start v2 增量构建 + IndexedDB 连接复用）
(function() {

// ==================== MDict 父窗口级单例与外部请求汇总 ====================
// MDict 对词头大小写不敏感时，可能同时返回 Read/read 等多个结果 iframe。
// window._picdic_loaded 只能约束单个 iframe，无法阻止每个 iframe 各自初始化一套主界面。
// 因此在 MDict 中将主实例锁提升到可访问的父窗口：第一个实例成为 owner，
// 后续实例只把外部查询上报给 owner，并隐藏自身 iframe/容器。
var _initialExternalWord = window._picdic_word || null;
var _initialExternalDictId = window._picdic_dictId || null;
var _picdicEarlyIsMDict = window.location.protocol === 'mdx:';
// 文字词典内嵌模式：由宿主词典按钮主动加载 PicDic，不发生 APP 主词条跳转。
var _picdicEmbeddedMode = window._picdic_embedded === true;
// GoldenDict embedded 共享 runtime：search.js 只初始化一次，多个文字词典 Controller 复用。
var _picdicEmbeddedReadyResolve = null;
var _picdicEmbeddedReadyPromise = new Promise(function(resolve) {
    _picdicEmbeddedReadyResolve = resolve;
});
var _picdicEmbeddedActivationQueue = Promise.resolve();
var _picdicEmbeddedActivationSeq = 0;
var _picdicEmbeddedReadySettled = false;

function _picdicSetEmbeddedReady(ok) {
    if (_picdicEmbeddedReadySettled) return;
    _picdicEmbeddedReadySettled = true;
    if (_picdicEmbeddedReadyResolve) {
        _picdicEmbeddedReadyResolve(ok !== false);
        _picdicEmbeddedReadyResolve = null;
    }
}
var MDICT_PICDIC_ENTRY_URL = 'mdx://mdict.cn/entry/-1/picdic';

function _picdicIsPicDicEntryWord(value) {
    return String(value || '').trim().toLocaleLowerCase() === 'picdic';
}

function _picdicDetectPicDicMainEntry() {
    if (!_picdicEarlyIsMDict) return false;
    // MDict 通常会把 APP 当前主词条写入 _picdic_word。该值在页面内部查询/切换后仍保持不变，
    // 因而比 input 当前内容更适合判断宿主主词条。
    if (_picdicIsPicDicEntryWord(_initialExternalWord)) return true;
    try {
        var href = decodeURIComponent(String(window.location.href || ''));
        return /\/entry\/-?\d+\/picdic(?:[\/?#]|$)/i.test(href);
    } catch (e) {
        return false;
    }
}

var _picdicEarlyIsPicDicMainEntry = _picdicDetectPicDicMainEntry();
var MDICT_JUMP_REQUEST_KEY = 'picdic_mdict_jump_request_v1';
var MDICT_JUMP_REQUEST_SCHEMA = 1;
var MDICT_JUMP_REQUEST_TTL = 2 * 60 * 1000;
var _picdicEarlyJumpRequest = null;
var _picdicHostWindow = window;
var _picdicHostRegistry = null;

function _picdicGetSafeHostWindow() {
    if (!_picdicEarlyIsMDict || !window.parent || window.parent === window) {
        return window;
    }
    try {
        // 读取 document 以确认同源且可访问。
        void window.parent.document;
        return window.parent;
    } catch (e) {
        return window;
    }
}

function _picdicIsRegistryOwnerAlive(registry) {
    if (!registry || !registry.ownerWindow) return false;
    try {
        var ownerWindow = registry.ownerWindow;
        if (ownerWindow.closed) return false;
        var ownerDocument = ownerWindow.document;
        if (!ownerDocument || !ownerDocument.documentElement) return false;
        var frame = ownerWindow.frameElement;
        // iframe 被结果页移除后，旧 registry 视为失效。
        if (frame && frame.isConnected === false) return false;
        return true;
    } catch (e) {
        return false;
    }
}

function _picdicRequestKey(word, dictId) {
    return String(dictId || '') + '\n' + String(word || '').trim().toLocaleLowerCase();
}

function _picdicResolveDictName(wordWindow, dictId) {
    var name = dictId || '未知词典';
    try {
        var dictList = wordWindow && wordWindow.picdic_dictList;
        if (dictList && dictList[dictId]) {
            name = dictList[dictId].name || dictId || name;
        }
    } catch (e) {}
    return name;
}

function _picdicAppendRegistryRequest(registry, word, dictId, sourceWindow) {
    if (!registry || !word) return false;
    if (!registry.requests) registry.requests = [];
    var requestKey = _picdicRequestKey(word, dictId);
    var exists = registry.requests.some(function(req) {
        return req._requestKey === requestKey ||
            _picdicRequestKey(req.word, req.dictId) === requestKey;
    });
    if (exists) return false;

    registry.requests.push({
        word: word,
        dictId: dictId,
        dictName: _picdicResolveDictName(sourceWindow || window, dictId),
        time: new Date().toLocaleTimeString(),
        _requestKey: requestKey
    });

    if (typeof registry.refresh === 'function') {
        try { registry.refresh(); } catch (e) {}
    }
    return true;
}
// expose for PT-ZH_DPC_V2026.js
window._ptzh_picdic_appendRequest =
    _picdicAppendRegistryRequest;


function _picdicParseJumpRequest(raw) {
    if (!raw) return null;
    try {
        var request = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!request || request.schema !== MDICT_JUMP_REQUEST_SCHEMA ||
            !request.requestId || !request.dictId) return null;
        var now = Date.now();
        var expiresAt = Number(request.expiresAt || 0);
        if (!expiresAt || expiresAt < now) return null;
        return request;
    } catch (e) {
        return null;
    }
}

function _picdicReadEarlyJumpRequest(hostWindow) {
    if (!_picdicEarlyIsMDict) return null;
    var request = null;
    try {
        request = _picdicParseJumpRequest(
            hostWindow && hostWindow.__PICDIC_PENDING_MAIN_JUMP__
        );
    } catch (e) {}
    if (request) return request;
    try {
        request = _picdicParseJumpRequest(
            window.localStorage && window.localStorage.getItem(MDICT_JUMP_REQUEST_KEY)
        );
    } catch (e) {}
    return request;
}

function _picdicRetireRegistryOwner(registry) {
    if (!registry || !registry.ownerWindow || registry.ownerWindow === window) return;
    try {
        var oldWindow = registry.ownerWindow;
        var oldContainers = oldWindow.document.querySelectorAll('.PIC_DIC');
        for (var i = 0; i < oldContainers.length; i++) {
            oldContainers[i].style.setProperty('display', 'none', 'important');
        }
        var oldFrame = oldWindow.frameElement;
        if (oldFrame) {
            oldFrame.setAttribute('data-picdic-retired-owner', '1');
            oldFrame.style.setProperty('display', 'none', 'important');
            oldFrame.style.setProperty('height', '0', 'important');
            oldFrame.style.setProperty('min-height', '0', 'important');
            oldFrame.style.setProperty('border', '0', 'important');
        }
    } catch (e) {}
}

function _picdicSuppressDuplicateInstance() {
    function hideLocalUi() {
        var containers = document.querySelectorAll('.PIC_DIC');
        for (var i = 0; i < containers.length; i++) {
            containers[i].style.setProperty('display', 'none', 'important');
        }
    }

    // 即使 .PIC_DIC 稍后才由模板/宿主插入，也确保不会闪现第二套界面。
    try {
        var style = document.createElement('style');
        style.id = 'picdic-duplicate-instance-style';
        style.textContent =
            '.PIC_DIC{display:none!important;}' +
            'html.picdic-duplicate-instance,html.picdic-duplicate-instance body{' +
            'margin:0!important;padding:0!important;height:0!important;' +
            'min-height:0!important;overflow:hidden!important;}';
        (document.head || document.documentElement).appendChild(style);
        document.documentElement.classList.add('picdic-duplicate-instance');
    } catch (e) {}

    hideLocalUi();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', hideLocalUi, { once: true });
    }

    // 直接折叠重复结果 iframe；保留节点本身，避免影响父页 iframe/标题的索引对应。
    try {
        var frame = window.frameElement;
        if (frame) {
            frame.setAttribute('data-picdic-duplicate-instance', '1');
            frame.style.setProperty('display', 'none', 'important');
            frame.style.setProperty('height', '0', 'important');
            frame.style.setProperty('min-height', '0', 'important');
            frame.style.setProperty('border', '0', 'important');
        }
    } catch (e) {}
}

_picdicHostWindow = _picdicGetSafeHostWindow();
// 嵌入模式不消费/继承跨页跳转请求，避免历史 localStorage 请求覆盖当前 PTZH_ENTRY。
_picdicEarlyJumpRequest = _picdicEmbeddedMode ? null : _picdicReadEarlyJumpRequest(_picdicHostWindow);

if (_picdicEarlyIsMDict && _picdicHostWindow !== window) {
    try {
        var existingRegistry = _picdicHostWindow.__PICDIC_MAIN_REGISTRY__ || null;
        if (existingRegistry && !_picdicIsRegistryOwnerAlive(existingRegistry)) {
            try { delete _picdicHostWindow.__PICDIC_MAIN_REGISTRY__; } catch (e) {
                _picdicHostWindow.__PICDIC_MAIN_REGISTRY__ = null;
            }
            existingRegistry = null;
        }

        if (existingRegistry && (_picdicEarlyJumpRequest || _picdicEmbeddedMode)) {
            // 跨页进入 picdic，或文字词典主动进入 embedded PicDic：当前窗口接管可视主实例。
            // 无论 MDict 复用原 iframe，还是创建新 iframe，都重置并接管主实例。
            if (existingRegistry.ownerWindow !== window) {
                _picdicRetireRegistryOwner(existingRegistry);
            }
            existingRegistry.ownerWindow = window;
            existingRegistry.requests = [];
            existingRegistry.refresh = null;
            existingRegistry.createdAt = Date.now();
            existingRegistry.version = 3;
            existingRegistry.embedded = !!_picdicEmbeddedMode;
            existingRegistry.jumpRequestId = _picdicEarlyJumpRequest ? _picdicEarlyJumpRequest.requestId : null;
            _picdicHostWindow.__PICDIC_MAIN_REGISTRY__ = existingRegistry;
        } else if (existingRegistry && existingRegistry.ownerWindow !== window) {
            _picdicAppendRegistryRequest(
                existingRegistry,
                _initialExternalWord,
                _initialExternalDictId,
                window
            );
            _picdicSuppressDuplicateInstance();
            return;
        }

        if (!existingRegistry) {
            existingRegistry = {
                version: 3,
                ownerWindow: window,
                requests: [],
                refresh: null,
                createdAt: Date.now(),
                embedded: !!_picdicEmbeddedMode,
                jumpRequestId: _picdicEarlyJumpRequest ? _picdicEarlyJumpRequest.requestId : null
            };
            _picdicHostWindow.__PICDIC_MAIN_REGISTRY__ = existingRegistry;
        }
        _picdicHostRegistry = existingRegistry;
        // owner 在继续初始化前先登记自身请求。主词条跳转显示真正的内部查询词，
        // 不把宿主入口词 "picdic" 当成查询请求。
        _picdicAppendRegistryRequest(
            _picdicHostRegistry,
            _picdicEarlyJumpRequest ? _picdicEarlyJumpRequest.word : _initialExternalWord,
            _picdicEarlyJumpRequest ? _picdicEarlyJumpRequest.dictId : _initialExternalDictId,
            window
        );
    } catch (e) {
        // 父窗口不可访问或宿主限制时，回退到原有单窗口逻辑。
        _picdicHostRegistry = null;
    }
}


// ==================== 外部查询请求管理与容器稳定 ====================
window._picdic_requests = _picdicHostRegistry ? _picdicHostRegistry.requests : (window._picdic_requests || []);
// 初始外部词条已在父窗口级单例检测前保存。
// 如果已加载，则后续加载直接返回，不影响已有界面，但请求列表仍可更新

var _picdic_stabilizeTimer = null;

function addExternalRequest(word, dictId) {
    if (!word) return false;
    if (_picdicHostRegistry) {
        return _picdicAppendRegistryRequest(_picdicHostRegistry, word, dictId, window);
    }

    var requestKey = _picdicRequestKey(word, dictId);
    var exists = window._picdic_requests.some(function(req) {
        return req._requestKey === requestKey ||
            _picdicRequestKey(req.word, req.dictId) === requestKey;
    });
    if (exists) return false;

    window._picdic_requests.push({
        word: word,
        dictId: dictId,
        dictName: _picdicResolveDictName(window, dictId),
        time: new Date().toLocaleTimeString(),
        _requestKey: requestKey
    });

    // embedded 模式下没有 MDict registry.refresh，需要主动刷新请求列表
    // 否则请求已写入 _picdic_requests，但界面不会显示“📥 查询请求”
    if (typeof updateRequestList === 'function') {
        try { updateRequestList(); } catch (e) {}
    }

    return true;
}

// expose for PT-ZH embedded host
window.addExternalRequest = addExternalRequest;


function replaceExternalRequests(words, dictId) {
    words = Array.isArray(words) ? words : [words];

    var targetRequests = _picdicHostRegistry ?
        _picdicHostRegistry.requests :
        window._picdic_requests;

    if (!Array.isArray(targetRequests)) {
        targetRequests = [];
        if (_picdicHostRegistry) _picdicHostRegistry.requests = targetRequests;
    }

    // 必须原地清空：其他代码可能持有 requests 数组引用。
    targetRequests.splice(0, targetRequests.length);

    var seen = Object.create(null);
    for (var i = 0; i < words.length; i++) {
        var word = String(words[i] || '').trim();
        if (!word) continue;

        var requestKey = _picdicRequestKey(word, dictId);
        if (seen[requestKey]) continue;
        seen[requestKey] = true;

        targetRequests.push({
            word: word,
            dictId: dictId,
            dictName: _picdicResolveDictName(window, dictId),
            time: new Date().toLocaleTimeString(),
            _requestKey: requestKey
        });
    }

    window._picdic_requests = targetRequests;

    if (_picdicHostRegistry) {
        _picdicHostRegistry.requests = targetRequests;
        if (typeof _picdicHostRegistry.refresh === 'function') {
            try { _picdicHostRegistry.refresh(); } catch (e) {}
        }
    }

    if (typeof updateRequestList === 'function') {
        try { updateRequestList(); } catch (e) {}
    }

    return targetRequests.length;
}

// Embedded Controller 使用：切换 Controller 时“替换”当前请求组，而不是向旧词典继续追加。
window.replaceExternalRequests = replaceExternalRequests;

function updateRequestList() {
    var container = document.querySelector('.PIC_DIC');
    if (!container) return;
    var old = container.querySelector('.picdic-external-requests');
    if (old) old.remove();
    if (window._picdic_requests.length <= 1) return;

    var div = document.createElement('div');
    div.className = 'picdic-external-requests';

    var label = document.createElement('span');
    label.className = 'picdic-external-words-head';
    label.textContent = '📥 查询请求:';
    div.appendChild(label);

    window._picdic_requests.forEach(function(req) {
        var spanwords = document.createElement('span');
        spanwords.className = 'picdic-external-words';
        spanwords.textContent = '●' + req.word;
        spanwords.title = '点击查询 "' + req.word + '"';
spanwords.addEventListener('click', function(e) {
    e.stopPropagation();
    try {
        var input = document.getElementById('searchInput');
        if (input) {
            input.value = req.word;
            // 优先使用全局函数，若不存在则回退到闭包中的 performSearch
            var searchFn = window._picdic_performSearch || (typeof performSearch === 'function' ? performSearch : null);
            if (searchFn) {
                searchFn(null, { external: true });
            } else {
                showToast('搜索功能未准备好，请刷新页面');
            }
        }
    } catch (err) {
        console.error('点击外部请求出错:', err);
        showToast('操作失败: ' + err.message);
    }
});
        div.appendChild(spanwords);
    });
    var searchBox = document.getElementById('searchBox');
    if (searchBox && searchBox.parentNode === container) {
        container.insertBefore(div, searchBox.nextSibling);
    } else {
        container.insertBefore(div, container.firstChild);
    }
}

if (_picdicHostRegistry) {
    _picdicHostRegistry.refresh = function() {
        // refresh 可能在 owner UI 尚未构建时由重复 iframe 调用；此时静默等待后续 stabilize。
        if (document.querySelector('.PIC_DIC')) {
            updateRequestList();
        }
    };
}
window._ptzh_picdic_registry =
    _picdicHostRegistry;


function stabilizePicDic() {
    if (_picdic_stabilizeTimer) {
        clearTimeout(_picdic_stabilizeTimer);
        _picdic_stabilizeTimer = null;
    }
    _picdic_stabilizeTimer = setTimeout(function() {
        // 1. 清理多余的 .PIC_DIC 容器（只保留第一个）
        var containers = document.querySelectorAll('.PIC_DIC');
        if (containers.length > 1) {
            for (var i = containers.length - 1; i > 0; i--) {
                containers[i].parentNode.removeChild(containers[i]);
            }
        }
        // 2. 显示保留的容器
        var mainContainer = document.querySelector('.PIC_DIC');
        if (mainContainer) {
            mainContainer.style.display = '';
        }
        // 3. 更新请求列表（仅显示，不触发搜索）
        updateRequestList();
        // ★ 绝对不执行 performSearch()
    }, 500);
}


// ==================== 单例检测 ====================
if (window._picdic_loaded) {
    // 后续加载：只添加请求，不初始化
    if (_initialExternalWord) {
        addExternalRequest(_initialExternalWord, _initialExternalDictId);
        stabilizePicDic();
    }
    return;
}

// 第一次加载：记录初始请求
if (_initialExternalWord) {
    addExternalRequest(_initialExternalWord, _initialExternalDictId);
}
// ===================================================

    'use strict';
    // ★ 新增：全局标志，标记是否已完成首次搜索
    window._picdic_initialSearchDone = false;


// ==================== 预加载管理器 ====================
class PreloadManager {
    constructor(options = {}) {
        this.concurrency = options.concurrency || 3;
        this.maxCacheSize = options.maxCacheSize || 10;
        this.cache = new Map();
        this.queue = [];
        this.running = 0;
        this._id = 0;
        this._generation = 0;
    }

    enqueue(urls) {
        const tasks = urls.map(url => () => this._loadImage(url));
        return this._runTasks(tasks);
    }

    _runTasks(tasks) {
        const generation = this._generation;
        const jobs = tasks.map(task => new Promise(resolve => {
            this.queue.push({ task: task, resolve: resolve, generation: generation });
        }));
        this._drainQueue();
        return Promise.all(jobs);
    }

    _drainQueue() {
        while (this.running < this.concurrency && this.queue.length > 0) {
            const job = this.queue.shift();
            if (job.generation !== this._generation) {
                job.resolve({ error: new Error('Cancelled') });
                continue;
            }
            this.running++;
            Promise.resolve()
                .then(job.task)
                .then(result => job.resolve(result))
                .catch(error => job.resolve({ error: error }))
                .then(() => {
                    if (job.generation === this._generation) {
                        this.running = Math.max(0, this.running - 1);
                        this._drainQueue();
                    }
                });
        }
    }

    _loadImage(url) {
        if (this.cache.has(url)) {
            const entry = this.cache.get(url);
            entry.lastUsed = Date.now();
            if (entry.promise) return entry.promise;
            return Promise.resolve(entry.blobUrl || entry.img);
        }

        let cancel = null;
        const promise = new Promise((resolve, reject) => {
            const img = new Image();
            let isCancelled = false;
            let timeout = null;

            const fail = (error) => {
                if (timeout) clearTimeout(timeout);
                img.onload = null;
                img.onerror = null;
                this.cache.delete(url);
                reject(error);
            };

            cancel = () => {
                if (isCancelled) return;
                isCancelled = true;
                if (timeout) clearTimeout(timeout);
                img.onload = null;
                img.onerror = null;
                img.src = '';
                this.cache.delete(url);
                reject(new Error('Cancelled'));
            };

            timeout = setTimeout(() => {
                if (!isCancelled) {
                    img.src = '';
                    fail(new Error('Timeout'));
                }
            }, 10000);

            img.onload = () => {
                clearTimeout(timeout);
                if (isCancelled) return;
                this._convertToBlobUrl(url, img)
                    .then(blobUrl => {
                        if (isCancelled) {
                            if (blobUrl && blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
                            return;
                        }
                        this.cache.set(url, {
                            img: img,
                            blobUrl: blobUrl || null,
                            lastUsed: Date.now(),
                            cancel: null,
                            promise: null
                        });
                        this._evictIfNeeded();
                        resolve(blobUrl || img);
                    })
                    .catch(() => {
                        if (isCancelled) return;
                        this.cache.set(url, {
                            img: img,
                            blobUrl: null,
                            lastUsed: Date.now(),
                            cancel: null,
                            promise: null
                        });
                        this._evictIfNeeded();
                        resolve(img);
                    });
            };

            img.onerror = () => {
                clearTimeout(timeout);
                if (!isCancelled) fail(new Error('Load failed'));
            };

            img.src = url;
        });

        this.cache.set(url, {
            promise: promise,
            cancel: cancel,
            lastUsed: Date.now(),
            img: null,
            blobUrl: null
        });
        return promise;
    }

    _convertToBlobUrl(url, img) {
        if (url.startsWith('data:') || url.startsWith('blob:')) {
            return Promise.resolve(url);
        }
        if (url.startsWith('file://') || url.startsWith('content://')) {
            return Promise.resolve(null);
        }
        return fetch(url)
            .then(res => res.blob())
            .then(blob => URL.createObjectURL(blob))
            .catch(() => null);
    }

    _disposeEntry(url, entry) {
        if (!entry) return;
        if (entry.promise && entry.cancel) entry.cancel();
        if (entry.blobUrl && entry.blobUrl.startsWith('blob:')) {
            URL.revokeObjectURL(entry.blobUrl);
        }
        this.cache.delete(url);
    }

    _evictIfNeeded() {
        if (this.cache.size <= this.maxCacheSize) return;
        const sorted = Array.from(this.cache.entries())
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
        const toRemove = sorted.slice(0, this.cache.size - this.maxCacheSize);
        for (const [url, entry] of toRemove) this._disposeEntry(url, entry);
    }

    get(url) {
        const entry = this.cache.get(url);
        if (!entry) return null;
        if (entry.promise) return null;
        entry.lastUsed = Date.now();
        return entry.blobUrl || entry.img || null;
    }

    getLoaded(url) {
        const entry = this.cache.get(url);
        if (!entry) return null;
        if (entry.promise) return null;
        return entry.img || null;
    }

    getPending(url) {
        const entry = this.cache.get(url);
        if (!entry) return null;
        return entry.promise || null;
    }

    loadImmediate(url) {
        const loaded = this.getLoaded(url);
        if (loaded) return Promise.resolve(loaded);
        const pending = this.getPending(url);
        if (pending) return pending;
        return this._loadImage(url);
    }

    clear() {
        this._generation++;
        var queued = this.queue.splice(0, this.queue.length);
        for (var i = 0; i < queued.length; i++) {
            queued[i].resolve({ error: new Error('Cancelled') });
        }
        for (const [url, entry] of Array.from(this.cache.entries())) {
            this._disposeEntry(url, entry);
        }
        this.running = 0;
    }
}

// ==================== 配置存储 ====================
class ConfigStore {
    constructor() {
        this.data = {
            globalConfig: Object.assign({}, DEFAULT_GLOBAL_CONFIG),
            dictConfig: Object.assign({}, DEFAULT_DICT_CONFIG),
            allDictConfigs: {}
        };
        this._saveTimer = null;
    }

    _scheduleSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._save(), 500);
    }

    _save() {
        dbPut('data', 'picdic_config', this.data).catch(e => debugLog('ConfigStore保存失败: ' + e.message));
        try {
            window.name = JSON.stringify({
                dictId: state.ui.currentDictId,
                word: state.ui.searchInput ? state.ui.searchInput.value.trim() : '',
                autoSearch: state.misc._autoSearch
            });
        } catch(e) {}
        debugLog('💾 ConfigStore 已保存');
    }

    save() {
        this._scheduleSave();
    }

    load() {
        return dbGet('data', 'picdic_config').then(data => {
            if (data) {
                for (let key in this.data) {
                    if (key in data) {
                        if (typeof this.data[key] === 'object' && !Array.isArray(this.data[key])) {
                            Object.assign(this.data[key], data[key]);
                        } else {
                            this.data[key] = data[key];
                        }
                    }
                }
                if (data.globalConfig) {
                    this.data.globalConfig.defaultDictId = data.globalConfig.defaultDictId || null;
                    this.data.globalConfig.dictGroupOrder = data.globalConfig.dictGroupOrder || null;
                }
                debugLog('✅ ConfigStore 加载成功');
                return true;
            }
            return false;
        });
    }
}

// ==================== 配置管理器 ====================
class ConfigManager {
    constructor(configStore) {
        this.store = configStore;
        this._callbacks = [];
    }

    // ---------- 全局配置 ----------
    getGlobal(key) {
        return this.store.data.globalConfig[key];
    }
    setGlobal(key, value) {
        this.store.data.globalConfig[key] = value;
        this._onChange();
    }

    // ---------- 当前词典配置 ----------
    getDict(key) {
        return this.store.data.dictConfig[key];
    }
    setDict(key, value) {
        this.store.data.dictConfig[key] = value;
        this._onChange();
    }

    // ---------- 指定词典配置 ----------
    getDictFor(dictId, key) {
        if (!this.store.data.allDictConfigs[dictId]) return undefined;
        return this.store.data.allDictConfigs[dictId][key];
    }
    setDictFor(dictId, key, value) {
        if (!this.store.data.allDictConfigs[dictId]) {
            this.store.data.allDictConfigs[dictId] = {};
        }
        this.store.data.allDictConfigs[dictId][key] = value;
        if (dictId === state.ui.currentDictId) {
            this.store.data.dictConfig[key] = value;
        }
        this._onChange();
    }
    setDictConfig(dictId, config) {
        this.store.data.allDictConfigs[dictId] = config;
        if (dictId === state.ui.currentDictId) {
            for (var key in config) {
                this.store.data.dictConfig[key] = config[key];
            }
        }
        this._onChange();
    }

    getAllDictConfigs() {
        return this.store.data.allDictConfigs;
    }

    // 注册变更回调
    onChange(callback) {
        this._callbacks.push(callback);
    }

    _onChange() {
        this.store.save();
        this._callbacks.forEach(function(fn) { fn(); });
    }

    // 手动通知变更（用于批量修改后触发）
    notifyChange() {
        this._onChange();
    }

    save() {
        this.store.save();
    }
}

// ==================== 历史存储 ====================
class HistoryStore {
    constructor() {
        this.history = [];
        this._saveTimer = null;
    }

    add(word, dictId) {
        if (!word) return;
        const idx = this.history.findIndex(h => h.word === word && h.dictId === dictId);
        if (idx !== -1) {
            this.history.splice(idx, 1);
        }
        this.history.unshift({ word, dictId, timestamp: Date.now() });
        const maxSize = state.config.globalConfig.maxHistorySize || 50;
        if (this.history.length > maxSize) this.history.length = maxSize;
        this._scheduleSave();
    }

    remove(word, dictId) {
        const idx = this.history.findIndex(h => h.word === word && h.dictId === dictId);
        if (idx !== -1) {
            this.history.splice(idx, 1);
            this._scheduleSave();
        }
    }

    clear() {
        this.history = [];
        this._scheduleSave();
    }

    getAll() {
        return this.history.slice();
    }

    _scheduleSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._save(), 500);
    }

    _save() {
        dbPut('data', 'picdic_history', this.history).catch(e => debugLog('HistoryStore保存失败: ' + e.message));
    }

    saveNow() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        this._save();
    }

    load() {
        return dbGet('data', 'picdic_history').then(data => {
            if (data && Array.isArray(data)) {
                this.history = data;
                debugLog('✅ HistoryStore 加载成功 (' + this.history.length + '条)');
                return true;
            }
            return false;
        });
    }
}

// ==================== 常量 ====================
var BOTTOM_SAFE_MARGIN = 4;
var MAX_PRELOAD_CACHE = 10;
var RESOURCE_CONCURRENCY = 3;
var INDEX_LOAD_TIMEOUT = 20000;
var INDEX_CACHE_SCHEMA = 3; // schema3：索引归属校验 + 持久化一对多规范化搜索缓存
var MAX_LOG_LINES = 100;
var EXTERNAL_COVER = '__cover_external__';
var DEFAULT_PAGE_TYPES = {
    FIRST_CONTENT: 'firstContent',
    COVER: 'cover',
    LAST_WORD: 'lastWord'
};

// ==================== 暗色滤镜预设 ====================
var FILTER_PRESETS = [
    { value: 'grayscale(0.8) invert(0.92) brightness(1.05) contrast(1.1)', label: '默认（白色背景）' },
    { value: 'invert(0.9) brightness(1.1)', label: '透明背景（仅反转）' },
    { value: 'invert(1) brightness(1.2) contrast(1.2)', label: '高对比度' },
    { value: 'grayscale(1) invert(1) brightness(1.1)', label: '黑白' },
    { value: '__custom__', label: '自定义' }
];

var LIGHT_BG_PRESETS = [
    { value: '#ffffff', label: '纯白' },
    { value: '#faf9de', label: '米黄（护眼）' },
    { value: '#f5e6d3', label: '浅褐色（Sepia）' },
    { value: '#f5f5f5', label: '柔光浅灰' },
    { value: '#c7edcc', label: '豆沙绿' },
    { value: '#f1fafa', label: '淡蓝' },
    { value: '__custom__', label: '自定义' }
];

var DARK_BG_PRESETS = [
    { value: '#1a1a1a', label: '纯黑' },
    { value: '#2b2b2b', label: '柔光深灰（推荐）' },
    { value: '#2b1b0e', label: '仿古纸色' },
    { value: '#1e2a3a', label: '暗蓝墨水' },
    { value: '#1a1a2e', label: '暗紫' },
    { value: '#2d2d2d', label: '深灰' },
    { value: '__custom__', label: '自定义' }
];

// ==================== 默认配置 ====================
var DEFAULT_GLOBAL_CONFIG = {
    DebugPanel_display: false,
    maxHistorySize: 50,
    defaultPageValue: 'firstContent',
    preloadPages: 1,
    enableDoubleTapZoom: true,
    enableClickPageTurn: true,
    enableLongPressZoom: true,
    longPressDelay: 400,
    showZoomButtons: false,
    zoomStep: 0.1,
    swipeEnabled: true,
    swipeThreshold: 30,
    enableInputDebounce: false,
    inputDebounceDelay: 2000,
    enableExpandOnZoom: true,   // 是否启用放大时扩展高度
    autoZoomExternalFullIndex: true, // 外部查询在全索引词典中自动放大并定位高亮
    darkModeFollowApp: false,
    lastDarkMode: false,
    darkMode: false,
    darkModeFilter: 'invert(0.9) brightness(1.1)',
    darkModeBgColor: '#2b2b2b',
    lightModeBgColor: '#f5e6d3',
    defaultDictId: null,
    dictGroupOrder: null,
    hideDictTitles: true
};

var DEFAULT_DICT_CONFIG = {
    doubleTapZoomFactor: 1.85,
    showTopNav: false,
    externalCropLeft: 0,     // 横向列定位：左侧虚拟裁剪（原始图片像素）
    externalCropRight: 0,    // 横向列定位：右侧虚拟裁剪（原始图片像素）
    horizontalMarginPercent: 0, // 横向列定位安全边距：相对于当前 viewport 宽度的百分比
    zoomVerticalDragOnly: true,  // 放大后拖动时锁定横向，仅允许纵向移动（默认启用）
    highlightHeight: 1.15,   // 高亮块高度（相对于图片高度比例）
    highlightWidth: 25,      // 旧版高亮宽度配置，保留兼容
    highlightCharWidth: 2.5  // 单字符宽度比例：每个字符增加的列宽百分比
};

// ==================== 状态管理 ====================
var state = {
    _configPopup: null,
    historyPopup: null,
    _jumpSrc: null,
    configStore: null,
    historyStore: null,
    configManager: null,
    config: {
        // 以下三个字段将在 afterConfigReady 中指向 configManager.store.data
        globalConfig: Object.assign({}, DEFAULT_GLOBAL_CONFIG),
        dictConfig: Object.assign({}, DEFAULT_DICT_CONFIG),
        allDictConfigs: {},
        _configControls: null,
        _refreshConfigForm: null,
        _collectAndApplyConfig: null,
        _configPanelBuilt: false,
        _configOverlay: null,
        _configPanel: null
    },
    cache: {
        historyWriteTimer: null,
        dictionaryIndex: null,
        // 搜索派生缓存：仅在词典加载/切换时构建或从 IndexedDB 恢复，查询时不再全量扫描索引。
        _normalizedKeys: null,       // 去重并有序的规范化键
        _sortedKeys: null,           // 与 _normalizedKeys 对齐的代表原始词头（兼容旧字段名）
        _keyMap: null,               // 规范化键 -> 原始词头数组（一对多）
        _searchCacheReady: false,
        _searchCacheDictId: null,
        _searchCacheIndexPath: null,
        _searchCacheRawKeyCount: 0,
        // Embedded hot-start：只在内存中保留当前查询所需的轻量索引分片。
        _hotLite: false,
        _hotMeta: null,
        _hotBaseKey: null,
        _hotPageLoads: null,
        preloadManager: null,
        _hasPagePositions: false
    },
    ui: {
        currentDictId: null,
        pageNum: null,
        searchInput: null,
        resultDiv: null,
        debugDiv: null,
        logContainer: null,
        logLines: [],
        btnContainer: null,
        topNavElement: null,
        _cachedContainer: null,
        _cachedNavSpans: null,
        _applyConfigPending: false
    },
    interaction: {
        img: null,
        wrapper: null,
        container: null,
        scale: 1,
        translateX: 0,
        translateY: 0,
        touchStartX: 0,
        touchStartY: 0,
        touchStartTranslateX: 0,
        touchStartTranslateY: 0,
        touchIsDragging: false,
        isSwiping: false,
        longPressTimer: null,
        isLongPress: false,
        mouseIsDragging: false,
        isDragging: false,
        mouseStartX: 0,
        mouseStartY: 0,
        mouseStartTranslateX: 0,
        mouseStartTranslateY: 0,
        lastClickTime: 0,
        lastClickX: 0,
        lastClickY: 0,
        clickTimer: null,
        hotZones: { top: null, bottom: null, left: null, right: null, container: null },
        transformPending: false
    },
    navigation: {
        currentWordPages: null,
        currentPageKeyMap: null,
        currentWordIndex: 0,
        _lastShowTopNav: true,
        _lastInputHasChinese: false
    },
    misc: {
        switchingDict: false,
        _savedWord: '',
        _autoSearch: false,
        _externalConfigLoaded: false,
        _lastHotZoneState: { scale: 1, pageNum: null, currentCol: -1, totalCols: 1 },
        _searchDebounceTimer: null,
        _searching: false,
        _fallbackSearch: false,
        _externalSearchPending: false,
        _externalFocusSeq: 0,
        _pendingExternalFocus: null,
        _currentSearchWord: '',
        _currentSearchNormalized: '',
        _currentSearchKeys: [],
        _currentSearchOrd: null,       // 保留单值字段，兼容旧逻辑
        _currentSearchOrds: [],        // 当前所有等价词条的 ord（仅兼容/诊断）
        _currentSearchOrdMap: null,    // 全局 ord 集合（仅兼容/诊断，不直接用于高亮）
        _currentSearchPageOrdMap: null,// 页码 -> ord 集合；高亮必须按 page + ord 联合判断
        _indexOwnerDictId: null,       // 当前内存索引明确归属的词典
        _dictSwitchSeq: 0,        // 词典切换事务序号，用于识别过期异步回调
        _imageLoadSeq: 0,         // 图片加载事务序号，防止旧异步结果覆盖新页面
        _annotationSettleSeq: 0,   // 拖动结束后的高亮稳定重绘事务序号
        _pendingMdictJumpRequest: null // MDict 词典列表跳转到 picdic 主词条的一次性请求
    },
    timers: {
        ids: [],
        add: function(id) {
            this.ids.push(id);
            return id;
        },
        cancel: function(id) {
            if (id === null || id === undefined) return;
            clearTimeout(id);
            clearInterval(id);
            var index = this.ids.indexOf(id);
            if (index !== -1) this.ids.splice(index, 1);
        },
        clearAll: function() {
            this.ids.forEach(function(id) {
                clearTimeout(id);
                clearInterval(id);
            });
            this.ids.length = 0;
        }
    },
    layout: {
        containerWidth: 0,
        containerHeight: 0,
        wrapperRect: null,
        imgRect: null,
        lastUpdate: 0,
        resizeObserver: null,
        isExpanded: false,          // 是否处于扩展高度模式
        expandedHeight: 0,          // 上次计算的扩展高度（用于快速恢复）
        toolbarHeight: 0           // 顶部工具栏高度（缓存）
    }
};

// ==================== 运行环境检测 ====================
var _env = {
    isMDictAndroid: false,
    isGoldenDictAndroid: false,
};
if (window.location.protocol === 'mdx:') {
    _env.isMDictAndroid = true;
} else if (window.location.protocol === 'content:') {
    _env.isGoldenDictAndroid = true;
}

// ==================== URL 构造器 ====================
var UrlBuilder = {
    getImageUrl: function(resourceId, page) {
        if (_env.isGoldenDictAndroid) {
            return 'content://mobi.goldendict.android/resource/' + resourceId + '/' + page + '.png';
        } else {
            return 'mdx://mdict.cn/mdd/' + resourceId + '/' + page + '.png';
        }
    },
    getIframeUrl: function(resourceId) {
        if (_env.isMDictAndroid) {
            return 'mdx://mdict.cn/iframe/' + resourceId + '/-2/:about';
        }
        return null;
    },
    getFileUrl: function(relativePath) {
        if (_env.isGoldenDictAndroid) {
            return 'file:///storage/emulated/0/GoldenDict/PicDic/' + relativePath;
        } else if (_env.isMDictAndroid) {
            return '/' + relativePath;
        } else {
            return relativePath;
        }
    }
};

function debugLog(msg) {
    // 调试关闭时直接返回，避免 Android WebView 中大量 console 输出拖慢外部查询。
    if (!state || !state.config || !state.config.globalConfig ||
        !state.config.globalConfig.DebugPanel_display || !state.ui) {
        return;
    }
    var time = new Date().toLocaleTimeString();
    var line = '[' + time + '] ' + msg;
    if (!state.ui.logLines) state.ui.logLines = [];
    state.ui.logLines.unshift(line);
    if (state.ui.logLines.length > MAX_LOG_LINES) state.ui.logLines.length = MAX_LOG_LINES;
    if (state.ui.logContainer) {
        state.ui.logContainer.innerHTML = state.ui.logLines.join('<br>');
    }
    console.log('[PicDic DEBUG]', msg);
}


// ==================== Resource ID 持久映射 ====================
function getResourceEnvironmentKey() {
    if (_env.isMDictAndroid) return 'mdict';
    if (_env.isGoldenDictAndroid) return 'goldendict';
    return 'other';
}

function hashResourceContext(text) {
    var hash = 2166136261;
    text = String(text || '');
    for (var i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function getMDictGroupContext() {
    var names = [];
    try {
        var parentWin = window.parent;
        if (parentWin && parentWin !== window && parentWin.document) {
            var titles = parentWin.document.querySelectorAll('.__mdx_css_title');
            var seen = Object.create(null);
            for (var i = 0; i < titles.length; i++) {
                var name = (titles[i].textContent || '').trim();
                if (!name) continue;
                var dedupeKey = name.toLocaleLowerCase();
                if (seen[dedupeKey]) continue;
                seen[dedupeKey] = true;
                names.push(name);
            }
        }
    } catch (e) {}
    var raw = names.join('\u001f') || 'default';
    return {
        key: 'group_' + hashResourceContext(raw) + '_' + names.length,
        label: names.length ? names.join('｜') : '当前 MDict 分组'
    };
}

function getResourceContext() {
    var env = getResourceEnvironmentKey();
    if (env === 'mdict') {
        var group = getMDictGroupContext();
        return { env: env, key: group.key, label: group.label };
    }
    if (env === 'goldendict') {
        return { env: env, key: 'default', label: 'GoldenDict 固定资源目录' };
    }
    return { env: env, key: 'default', label: '默认环境' };
}

function normalizeResourceId(value) {
    if (value === undefined || value === null) return null;
    var text = String(value).trim();
    return text || null;
}

function ensureResourceIdRecord(dictId, create) {
    if (!state.configStore || !state.configStore.data) return null;
    var all = state.configStore.data.allDictConfigs;
    if (!all[dictId]) {
        if (!create) return null;
        all[dictId] = {};
    }
    var cfg = all[dictId];
    if (!cfg._resourceIdMap) {
        if (!create) return null;
        cfg._resourceIdMap = {};
    }
    var context = getResourceContext();
    if (!cfg._resourceIdMap[context.env]) {
        if (!create) return null;
        cfg._resourceIdMap[context.env] = {};
    }
    if (!cfg._resourceIdMap[context.env][context.key]) {
        if (!create) return null;
        cfg._resourceIdMap[context.env][context.key] = {
            auto: null,
            manual: null,
            source: '',
            updatedAt: 0,
            contextLabel: context.label
        };
    }
    return {
        record: cfg._resourceIdMap[context.env][context.key],
        context: context
    };
}

function rememberConfiguredResourceIds() {
    if (!state._configuredResourceIds) state._configuredResourceIds = {};
    var dictList = window.picdic_dictList || {};
    for (var dictId in dictList) {
        if (!Object.prototype.hasOwnProperty.call(dictList, dictId)) continue;
        if (!Object.prototype.hasOwnProperty.call(state._configuredResourceIds, dictId)) {
            state._configuredResourceIds[dictId] = normalizeResourceId(dictList[dictId].resourceId);
        }
    }
}

function getResourceIdInfo(dictId) {
    var holder = ensureResourceIdRecord(dictId, false);
    var record = holder ? holder.record : null;
    var context = holder ? holder.context : getResourceContext();
    var manual = record ? normalizeResourceId(record.manual) : null;
    var auto = record ? normalizeResourceId(record.auto) : null;
    var configured = state._configuredResourceIds ? normalizeResourceId(state._configuredResourceIds[dictId]) : null;
    var value = manual || auto || configured;
    var source = manual ? '手动' : (auto ? (record.source || '自动检测') : (configured ? '初始配置' : '未设置'));
    return {
        value: value,
        manual: manual,
        auto: auto,
        configured: configured,
        source: source,
        updatedAt: record ? record.updatedAt : 0,
        context: context
    };
}

function applyEffectiveResourceId(dictId) {
    var dictList = window.picdic_dictList;
    if (!dictList || !dictList[dictId]) return null;
    var info = getResourceIdInfo(dictId);
    if (info.value) {
        dictList[dictId].resourceId = info.value;
        if (!state._cachedResourceId) state._cachedResourceId = {};
        state._cachedResourceId[dictId] = info.value;
    }
    return info.value;
}

function restoreResourceIdsFromCache() {
    var dictList = window.picdic_dictList || {};
    for (var dictId in dictList) {
        if (Object.prototype.hasOwnProperty.call(dictList, dictId)) {
            applyEffectiveResourceId(dictId);
        }
    }
}

function cacheDetectedResourceId(dictId, value, source) {
    value = normalizeResourceId(value);
    if (!value) return false;
    var holder = ensureResourceIdRecord(dictId, true);
    if (!holder) return false;
    var record = holder.record;
    var changed = record.auto !== value || record.source !== source || record.contextLabel !== holder.context.label;
    record.auto = value;
    record.source = source || '自动检测';
    record.updatedAt = Date.now();
    record.contextLabel = holder.context.label;
    applyEffectiveResourceId(dictId);
    return changed;
}

function setManualResourceId(dictId, value) {
    var holder = ensureResourceIdRecord(dictId, true);
    if (!holder) return;
    holder.record.manual = normalizeResourceId(value);
    holder.record.updatedAt = Date.now();
    holder.record.contextLabel = holder.context.label;
    applyEffectiveResourceId(dictId);
    state.configManager.notifyChange();
    applyHideDictTitles();
}

function clearManualResourceId(dictId) {
    var holder = ensureResourceIdRecord(dictId, false);
    if (holder && holder.record.manual) {
        holder.record.manual = null;
        holder.record.updatedAt = Date.now();
        applyEffectiveResourceId(dictId);
        state.configManager.notifyChange();
        applyHideDictTitles();
    }
}

// ==================== 资源ID更新 ====================
function updateResourceIdsFromParent() {
    if (!_env.isMDictAndroid) return;
    try {
        var parentWin = window.parent;
        if (parentWin === window) {
            debugLog('⚠️ 当前不在 iframe 中，无法更新 resourceId');
            return;
        }
        var dictList = window.picdic_dictList;
        if (!dictList || typeof dictList !== 'object') {
            debugLog('⚠️ picdic_dictList 未定义或无效');
            return;
        }
        var titles = parentWin.document.querySelectorAll('.__mdx_css_title');
        var iframes = parentWin.document.getElementsByTagName('iframe');
        if (titles.length === 0 || iframes.length === 0) {
            debugLog('⚠️ 未找到词典标题或 iframe');
            return;
        }
        var updatedCount = 0;
        for (var key in dictList) {
            if (!dictList.hasOwnProperty(key)) continue;
            var dict = dictList[key];
            var targetName = key;
            var found = false;
            for (var i = 0; i < titles.length; i++) {
                var titleText = titles[i].textContent.trim();
                if (titleText === targetName) {
                    var iframe = iframes[i];
                    if (!iframe) break;
                    var src = iframe.src;
                    var match = src.match(/\/iframe\/(\d+)/);
                    if (match) {
                        var actualId = match[1];
                        if (cacheDetectedResourceId(key, actualId, 'MDict 父页面检测')) {
                            updatedCount++;
                            debugLog('🔄 更新并缓存词典 "' + key + '" 的 resourceId: ' + actualId);
                        } else {
                            applyEffectiveResourceId(key);
                            debugLog('ℹ️ 词典 "' + key + '" 的 resourceId 映射无需更新: ' + actualId);
                        }
                        found = true;
                    }
                    break;
                }
            }
            if (!found) {
                debugLog('⚠️ 未在父窗口中找到词典 "' + key + '" 的标题');
            }
        }
        if (updatedCount > 0) {
            debugLog('✅ 已更新并持久保存 ' + updatedCount + ' 个词典的 resourceId');
            state.configManager.notifyChange();
        } else {
            debugLog('ℹ️ 没有词典需要更新 resourceId');
        }
    } catch (e) {
        debugLog('❌ 更新 resourceId 失败: ' + e.message);
    }
}

function updateResourceIdsFromGoldenDict() {
    if (!_env.isGoldenDictAndroid) return;
    try {
        var dictList = window.picdic_dictList;
        if (!dictList) return;
        var nameMap = {};
        var articleSpans = document.querySelectorAll('span.gdarticle');
        for (var i = 0; i < articleSpans.length; i++) {
            var span = articleSpans[i];
            var id = span.id;
            var match = id.match(/gdarticle-([a-f0-9]+)/);
            if (match) {
                var hash = match[1];
                var nameEl = span.querySelector('div.gddictname');
                if (nameEl) {
                    var nameText = nameEl.textContent.trim();
                    if (nameText.indexOf('From ') === 0) {
                        nameText = nameText.substring(5).trim();
                    }
                    nameMap[nameText] = hash;
                }
            }
        }
        if (Object.keys(nameMap).length === 0) {
            var refSpans = document.querySelectorAll('span.gdarticleref');
            for (var i = 0; i < refSpans.length; i++) {
                var span = refSpans[i];
                var id = span.id;
                var match = id.match(/gdarticleref-([a-f0-9]+)/);
                if (match) {
                    // 无法知道名称，跳过
                }
            }
        }
        var updatedCount = 0;
        for (var key in dictList) {
            if (!dictList.hasOwnProperty(key)) continue;
            var dict = dictList[key];
            var targetName = key;
            if (nameMap[targetName]) {
                var actualHash = nameMap[targetName];
                if (cacheDetectedResourceId(key, actualHash, 'GoldenDict DOM 检测')) {
                    updatedCount++;
                    debugLog('🔄 [GoldenDict] 更新并缓存词典 "' + key + '" 的 resourceId: ' + actualHash);
                } else {
                    applyEffectiveResourceId(key);
                }
            }
        }
        if (updatedCount > 0) {
            debugLog('✅ [GoldenDict] 已更新并持久保存 ' + updatedCount + ' 个词典的 resourceId');
            state.configManager.notifyChange();
        } else {
            debugLog('ℹ️ [GoldenDict] 没有词典需要更新 resourceId');
        }
    } catch (e) {
        debugLog('❌ [GoldenDict] 更新 resourceId 失败: ' + e.message);
    }
}

function updateResourceIds() {
    if (_env.isMDictAndroid) {
        updateResourceIdsFromParent();
    } else if (_env.isGoldenDictAndroid) {
        updateResourceIdsFromGoldenDict();
    } else {
        debugLog('ℹ️ 未知环境，跳过 resourceId 更新');
    }
    applyHideDictTitles();
}

// ==================== 清理函数 ====================
var _hiddenIframe = null;
var _hiddenIframeReady = false;

function cleanHiddenIframe() {
    if (_hiddenIframe) {
        _hiddenIframe.onload = null;
        _hiddenIframe.onerror = null;
        _hiddenIframe.src = 'about:blank';
        if (_hiddenIframe.parentNode) {
            _hiddenIframe.parentNode.removeChild(_hiddenIframe);
        }
        _hiddenIframe = null;
    }
    _hiddenIframeReady = false;
}

function cleanImageContainer() {
    state.misc._imageLoadSeq++;
    if (state.layout.resizeObserver) {
        state.layout.resizeObserver.disconnect();
        state.layout.resizeObserver = null;
    }
    if (state.interaction.container && state.interaction.container._abortController) {
        state.interaction.container._abortController.abort();
        state.interaction.container._abortController = null;
    }
    if (state.interaction.container && state.interaction.container.parentNode) {
        state.interaction.container.parentNode.removeChild(state.interaction.container);
    }
    state.interaction.container = null;
    if (state.interaction.img) {
        state.interaction.img.onload = null;
        state.interaction.img.onerror = null;
        state.interaction.img.src = '';
        state.interaction.img = null;
    }
    state.interaction.wrapper = null;
    state.layout.containerWidth = 0;
    state.layout.containerHeight = 0;
    state.layout.wrapperRect = null;
    state.layout.imgRect = null;
    state.layout.lastUpdate = 0;
}

function cleanupAll() {
    state.timers.clearAll();
    state.misc._externalFocusSeq++;
    state.misc._pendingExternalFocus = null;
    if (state.cache.historyWriteTimer) {
        clearTimeout(state.cache.historyWriteTimer);
        state.cache.historyWriteTimer = null;
    }
    if (state.misc._searchDebounceTimer) {
        clearTimeout(state.misc._searchDebounceTimer);
        state.misc._searchDebounceTimer = null;
    }
    if (state.interaction.clickTimer) {
        clearTimeout(state.interaction.clickTimer);
        state.interaction.clickTimer = null;
    }
    if (state.interaction.longPressTimer) {
        clearTimeout(state.interaction.longPressTimer);
        state.interaction.longPressTimer = null;
    }
    cleanHiddenIframe();
    cleanImageContainer();
    if (state.cache.preloadManager) {
        state.cache.preloadManager.clear();
    }
    if (state.configStore) {
        clearTimeout(state.configStore._saveTimer);
    }
    if (state.historyStore) {
        clearTimeout(state.historyStore._saveTimer);
    }
    document.querySelectorAll('.picdic-toast').forEach(function(el) {
        if (el._timer) {
            clearTimeout(el._timer);
            el._timer = null;
        }
    });
    document.querySelectorAll('.page-error').forEach(function(el) {
        if (el._timer) {
            clearTimeout(el._timer);
            el._timer = null;
        }
    });
    debugLog('🧹 所有定时器和资源已清理');
}

// ==================== 其他工具函数 ====================
function normalizeHostDictTitle(text) {
    text = String(text || '').trim();
    if (text.indexOf('From ') === 0) text = text.substring(5).trim();
    return text.toLocaleLowerCase();
}

function getEffectiveResourceIdentityMap() {
    var dictList = window.picdic_dictList || {};
    var names = Object.create(null);
    var ids = Object.create(null);

    rememberConfiguredResourceIds();
    for (var dictId in dictList) {
        if (!Object.prototype.hasOwnProperty.call(dictList, dictId)) continue;
        var info = getResourceIdInfo(dictId);
        var resourceId = normalizeResourceId(info.value);
        if (!resourceId) continue;

        names[normalizeHostDictTitle(dictId)] = true;
        if (dictList[dictId].name) {
            names[normalizeHostDictTitle(dictList[dictId].name)] = true;
        }
        if (dictList[dictId].title) {
            names[normalizeHostDictTitle(dictList[dictId].title)] = true;
        }
        ids[String(resourceId)] = true;
    }
    return { names: names, ids: ids };
}

function extractMDictResourceId(iframe) {
    if (!iframe) return null;
    var src = iframe.getAttribute('src') || iframe.src || '';
    var match = String(src).match(/\/(?:iframe|mdd)\/(\d+)/);
    return match ? match[1] : null;
}

function setResourceElementHidden(element, shouldHide) {
    if (!element) return;
    var marker = 'data-picdic-resource-hidden';
    var previous = 'data-picdic-previous-display';

    if (shouldHide) {
        if (!element.hasAttribute(marker)) {
            element.setAttribute(marker, '1');
            element.setAttribute(previous, element.style.display || '');
        }
        element.style.display = 'none';
        return;
    }

    if (element.hasAttribute(marker)) {
        element.style.display = element.getAttribute(previous) || '';
        element.removeAttribute(marker);
        element.removeAttribute(previous);
    } else if (element.style.display === 'none') {
        // 兼容旧版本曾经对所有标题直接写入 display:none 的情况。
        element.style.display = '';
    }
}

function resetGoldenDictMainArticleLayout(article) {
    if (!article) return;
    article.style.padding = '';
    article.style.margin = '';
    article.style.border = '';
    var def = article.querySelector('div.gddefinition');
    if (def) {
        def.style.marginTop = '';
        def.style.paddingTop = '';
    }
    var headword = article.querySelector('div.gdheadword');
    if (headword) {
        headword.style.margin = '';
        headword.style.padding = '';
        headword.style.height = '';
        headword.style.visibility = '';
    }
}

function applyHideDictTitles() {
    var hide = !!state.config.globalConfig.hideDictTitles;
    try {
        var identity = getEffectiveResourceIdentityMap();

        // ---- MDict：仅隐藏当前分组中具有有效 resourceId 的资源词典标题 ----
        if (_env.isMDictAndroid) {
            var parentWin = window.parent;
            if (parentWin === window || !parentWin.document) return;

            var titles = parentWin.document.querySelectorAll('.__mdx_css_title');
            var blocks = parentWin.document.querySelectorAll('.__mdx_css_title_block');
            var iframes = parentWin.document.getElementsByTagName('iframe');

            for (var i = 0; i < titles.length; i++) {
                var title = titles[i];
                var titleKey = normalizeHostDictTitle(title.textContent);
                var detectedId = extractMDictResourceId(iframes[i]);
                var isResourceDict = !!identity.names[titleKey] ||
                    !!(detectedId && identity.ids[String(detectedId)]);
                var shouldHide = hide && isResourceDict;

                setResourceElementHidden(title, shouldHide);

                var block = null;
                if (typeof title.closest === 'function') {
                    block = title.closest('.__mdx_css_title_block');
                }
                if (!block) block = blocks[i] || null;
                setResourceElementHidden(block, shouldHide);
            }
            return;
        }

        // ---- GoldenDict：仅隐藏具有有效 resourceId 的资源词典 article ----
        if (_env.isGoldenDictAndroid) {
            // 移除旧版本的全局隐藏样式，避免普通词典标题继续被隐藏。
            var oldStyle = document.getElementById('picdic-hide-gd');
            if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle);

            var articles = document.querySelectorAll('span.gdarticle');
            for (var j = 0; j < articles.length; j++) {
                var article = articles[j];
                var nameEl = article.querySelector('div.gddictname');
                var titleKey = nameEl ? normalizeHostDictTitle(nameEl.textContent) : '';
                var isResourceDict = !!identity.names[titleKey];

                setResourceElementHidden(article, hide && isResourceDict);
                if (!isResourceDict) resetGoldenDictMainArticleLayout(article);
            }
        }
    } catch (e) {
        debugLog('⚠️ 按 resourceId 隐藏词典标题失败: ' + e.message);
    }
}

function ensureDictIframe(dictId) {
    return new Promise(function(resolve, reject) {
        var dictList = window.picdic_dictList;
        if (!dictList || !dictList[dictId]) {
            debugLog('⚠️ ensureDictIframe: 词典 ' + dictId + ' 不存在');
            reject(new Error('词典不存在'));
            return;
        }
        var dict = dictList[dictId];
        var resourceId = dict.resourceId;
        if (!resourceId) {
            debugLog('⚠️ ensureDictIframe: 词典 ' + dictId + ' 缺少 resourceId');
            reject(new Error('缺少 resourceId'));
            return;
        }
        var src = UrlBuilder.getIframeUrl(resourceId);
        if (!src) {
            debugLog('ℹ️ 当前环境无需 iframe，跳过');
            resolve();
            return;
        }
        if (_hiddenIframe && _hiddenIframe.src === src && _hiddenIframeReady) {
            debugLog('✅ iframe 已经就绪（缓存）');
            resolve();
            return;
        }
        var iframe = _hiddenIframe || document.createElement('iframe');
        iframe.src = src;
        iframe.style.display = 'none';
        iframe.setAttribute('data-dict', dictId);
        if (!_hiddenIframe) {
            document.body.appendChild(iframe);
            _hiddenIframe = iframe;
        }
        _hiddenIframeReady = false;
        var timeoutId = state.timers.add(setTimeout(function() {
            state.timers.cancel(timeoutId);
            debugLog('⚠️ iframe 加载超时，强制 resolve');
            _hiddenIframeReady = true;
            resolve();
        }, 8000));
        iframe.onload = function() {
            state.timers.cancel(timeoutId);
            _hiddenIframeReady = true;
            debugLog('✅ 隐藏 iframe 加载完成（onload）');
            resolve();
        };
        iframe.onerror = function() {
            state.timers.cancel(timeoutId);
            debugLog('❌ iframe 加载失败，但继续');
            _hiddenIframeReady = true;
            resolve();
        };
        try {
            if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
                _hiddenIframeReady = true;
                debugLog('✅ iframe 已经加载完成（readyState complete）');
                state.timers.cancel(timeoutId);
                resolve();
                return;
            }
        } catch(e) {}
    });
}

function sanitizeCSSValue(value) {
    if (!value) return '';
    var sanitized = value.replace(/javascript:/gi, '')
                         .replace(/expression\s*\(/gi, '')
                         .replace(/eval\s*\(/gi, '')
                         .replace(/alert\s*\(/gi, '')
                         .replace(/on\w+\s*=/gi, '');
    sanitized = sanitized.replace(/[^a-zA-Z0-9\s#.,()%+\-_]/g, '');
    return sanitized;
}

function getDictLangCode(dictId, type) {

    if (!dictId) return -1;

    var dictList = window.picdic_dictList;

    if (!dictList || typeof dictList !== 'object') {
        debugLog('⚠️ window.picdic_dictList 未定义或无效');
        return -1;
    }


    var dict = dictList[dictId];

    if (!dict) return -1;


    var keyType;


    if (type === 'target') {

        // 目标语言
        keyType = dict.contents_language || 'zho';

    } else {

        // 源语言
        keyType = dict.index_language || 'eng';

    }


    var key = String(keyType).toLowerCase().trim();


    if (typeof PicDicLang !== 'undefined') {

        // ISO 639-2 / alias 转 ISO 639-1
        if (PicDicLang.ALIAS_MAP && PicDicLang.ALIAS_MAP[key]) {
            key = PicDicLang.ALIAS_MAP[key];
        }


        var code =
            PicDicLang.ISO_TO_GD_CODE &&
            PicDicLang.ISO_TO_GD_CODE[key];


        if (code !== undefined) {
            return code;
        }

    }


    // 兼容 fallback
    var fallback = {
        'en': 28261,
        'de': 25956,
        'pt': 29808,
        'zh': 26746
    };


    return fallback[key] || -1;
}

function getSourceLangCode(dictId) {
    return getDictLangCode(dictId, 'source');
}

function getTargetLangCode(dictId) {
    return getDictLangCode(dictId, 'target');
}

function matchFilterPreset(filter) {
    for (var i = 0; i < FILTER_PRESETS.length; i++) {
        if (FILTER_PRESETS[i].value === filter) {
            return filter;
        }
    }
    return '__custom__';
}

function matchLightBgPreset(value) {
    for (var i = 0; i < LIGHT_BG_PRESETS.length; i++) {
        if (LIGHT_BG_PRESETS[i].value === value) {
            return value;
        }
    }
    return '__custom__';
}

function matchDarkBgPreset(value) {
    for (var i = 0; i < DARK_BG_PRESETS.length; i++) {
        if (DARK_BG_PRESETS[i].value === value) {
            return value;
        }
    }
    return '__custom__';
}

function showToast(msg, duration) {
    duration = duration || 2000;
    var existing = document.querySelector('.picdic-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'picdic-toast';
    toast.textContent = msg;
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '25%',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.9)',
        color: '#fff',
        padding: '10px 10px',
        borderRadius: '8px',
        fontSize: '12px',
        zIndex: '999999',
        maxWidth: '90%',
        textAlign: 'center',
        opacity: '0',
        transition: 'opacity 0.3s'
    });
    document.body.appendChild(toast);
    requestAnimationFrame(function() {
        toast.style.opacity = '1';
    });
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() {
        toast.style.opacity = '0';
        setTimeout(function() { if (toast.parentNode) toast.remove(); }, 400);
    }, duration);
}

function mergeDictConfig(dictId, newConfig) {
    if (!dictId) return;

    var isCurrentDict = (dictId === state.ui.currentDictId);
    if (!state.configStore.data.allDictConfigs[dictId]) {
        state.configStore.data.allDictConfigs[dictId] = {};
    }
    var targetConfig = state.configStore.data.allDictConfigs[dictId];

    if (!newConfig || typeof newConfig !== 'object') {
        // 只将目标词典已有配置/默认值写入目标词典；仅当它仍是当前词典时才同步到 dictConfig。
        for (var key in DEFAULT_DICT_CONFIG) {
            var value = (key in targetConfig) ? targetConfig[key] : DEFAULT_DICT_CONFIG[key];
            targetConfig[key] = value;
            if (isCurrentDict) {
                state.configStore.data.dictConfig[key] = value;
            }
        }
        return;
    }

    var merged = {};
    for (var key in DEFAULT_DICT_CONFIG) {
        if (key in targetConfig) {
            merged[key] = targetConfig[key];
        } else if (key in newConfig) {
            merged[key] = newConfig[key];
        } else {
            merged[key] = DEFAULT_DICT_CONFIG[key];
        }
    }

    for (var k in DEFAULT_DICT_CONFIG) {
        targetConfig[k] = merged[k];
        if (isCurrentDict) {
            state.configStore.data.dictConfig[k] = merged[k];
        }
    }
}

function replaceDictSettings(dictId, sourceConfig) {
    var current = state.configStore.data.dictConfig;
    if (!state.configStore.data.allDictConfigs[dictId]) {
        state.configStore.data.allDictConfigs[dictId] = {};
    }
    var stored = state.configStore.data.allDictConfigs[dictId];
    for (var key in DEFAULT_DICT_CONFIG) {
        var value = sourceConfig && key in sourceConfig ?
            sourceConfig[key] : DEFAULT_DICT_CONFIG[key];
        current[key] = value;
        stored[key] = value;
    }
    state.configManager.notifyChange();
}

// ==================== wordToPages 兼容工具 ====================
function getPagesForWord(wordToPages, word) {
    var entry = wordToPages[word];
    if (!entry) return null;
    // 如果是数组
    if (Array.isArray(entry)) {
        if (entry.length > 0 && typeof entry[0] === 'object') {
            // 新格式：对象数组，提取 pg
            return entry.map(function(item) { return item.pg; });
        } else {
            // 旧格式：字符串数组，直接返回
            return entry;
        }
    } else if (typeof entry === 'string') {
        // 旧格式：单个字符串，转为数组返回
        return [entry];
    }
    return null;
}

// ==================== 从 wordToPages 构建 pageWordPositions ====================
function buildPageWordPositions(indexData) {
    if (!indexData || !indexData.wordToPages) return {};
    var wordToPages = indexData.wordToPages;
    
    // 检查是否包含坐标信息：取第一个词条的第一个条目，看是否有 col/y/ord
    var hasCoordinate = false;
    var firstKey = firstOwnKey(wordToPages);
    if (firstKey) {
        var firstEntry = wordToPages[firstKey];
        if (Array.isArray(firstEntry) && firstEntry.length > 0 && typeof firstEntry[0] === 'object') {
            var firstItem = firstEntry[0];
            if (firstItem.col !== undefined || firstItem.y !== undefined || firstItem.ord !== undefined) {
                hasCoordinate = true;
            }
        }
    }
    // 如果没有坐标信息，直接返回空对象
    if (!hasCoordinate) {
        debugLog('ℹ️ wordToPages 中无坐标信息（col/y/ord），跳过生成 pageWordPositions');
        return {};
    }
    
    // 存在坐标信息，开始生成
    var pagePositions = {};
    for (var word in wordToPages) {
        var entry = wordToPages[word];
        // 处理旧格式：单个字符串（但旧格式不会有坐标，但以防万一）
        if (typeof entry === 'string') {
            var pg = entry;
            if (!pagePositions[pg]) pagePositions[pg] = [];
            pagePositions[pg].push({ hw: word, col: 1, y: 0, ord: -1 });
            continue;
        }
        if (!Array.isArray(entry)) continue;
        // 处理旧格式：字符串数组
        if (entry.length > 0 && typeof entry[0] === 'string') {
            entry.forEach(function(pg) {
                if (!pagePositions[pg]) pagePositions[pg] = [];
                pagePositions[pg].push({ hw: word, col: 1, y: 0, ord: -1 });
            });
            continue;
        }
        // 处理新格式：对象数组
        if (entry.length > 0 && typeof entry[0] === 'object') {
            entry.forEach(function(item) {
                var pg = item.pg;
                if (!pg) return;
                if (!pagePositions[pg]) pagePositions[pg] = [];
                pagePositions[pg].push({
                    hw: word,
                    col: item.col || 1,
                    y: item.y || 0,
                    ord: item.ord !== undefined ? item.ord : -1
                });
            });
        }
    }
    return pagePositions;
}


function normalize(word) {
    if (!word) return '';
    var s = word.toLowerCase();
    var map = {
        'á': 'a', 'à': 'a', 'ã': 'a', 'â': 'a', 'ä': 'a', 'å': 'a',
        'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'ę': 'e',
        'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
        'ó': 'o', 'ò': 'o', 'õ': 'o', 'ô': 'o', 'ö': 'o',
        'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
        'ç': 'c', 'č': 'c', 'ć': 'c',
        'š': 's', 'ś': 's', 'ş': 's',
        'ţ': 't',
        'ÿ': 'y',
        'ž': 'z', 'ź': 'z',
        'ñ': 'ñ', 'ń': 'n', 'ň': 'n',
        'æ': 'ae', 'œ': 'oe', 'ß': 'ss'
    };
    var result = '';
    for (var i = 0; i < s.length; i++) {
        result += map[s[i]] || s[i];
    }
    result = result.replace(/[^a-z0-9ñ\u4e00-\u9fff]/g, '');
    return result;
}

function getAdjacentPage(currentPage, direction) {
    if (currentPage === EXTERNAL_COVER) {
        if (direction === 1) {
            var pages = state.cache.dictionaryIndex.pages;
            return pages.length ? pages[0] : null;
        } else {
            return null;
        }
    }
    if (!state.cache.dictionaryIndex) return null;
    var pages = state.cache.dictionaryIndex.pages;
    var idx = pages.indexOf(currentPage);
    if (idx === -1) return null;
    var targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= pages.length) return null;
    return pages[targetIdx];
}

function isAppInDarkMode() {
    if (_env.isMDictAndroid) {
        try {
            if (window.MDictJSUtil && typeof window.MDictJSUtil.isNightMode === 'function') {
                var isNight = window.MDictJSUtil.isNightMode();
                return isNight === true || isNight === 'true';
            }
        } catch (e) {}
        return false;
    }
    if (_env.isGoldenDictAndroid) {
        var links = document.querySelectorAll('link[rel="stylesheet"]');
        for (var i = 0; i < links.length; i++) {
            if (links[i].href && links[i].href.indexOf('article-style-night.css') !== -1) {
                return true;
            }
        }
        return false;
    }
    try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {
        return false;
    }
}

function validateIndexOrder(dictId) {
    if (!state.cache.dictionaryIndex) {
        return { sorted: false, errors: [], message: '当前词典索引未加载' };
    }
    var wordToPages = state.cache.dictionaryIndex.wordToPages;
    if (!wordToPages) {
        return { sorted: false, errors: [], message: '索引格式错误，缺少 wordToPages' };
    }
    var keys = Object.keys(wordToPages);
    if (keys.length < 2) {
        return { sorted: true, errors: [], message: '键数量少于2，无需排序验证' };
    }
    var sorted = true;
    var errors = [];
    var limit = 10000;
    for (var i = 0; i < keys.length - 1; i++) {
        var a = keys[i];
        var b = keys[i+1];
        var normA = normalize(a);
        var normB = normalize(b);
        if (normA.localeCompare(normB) > 0) {
            sorted = false;
            errors.push({
		    key1: a,
		    pages1: getPagesForWord(wordToPages, a),
		    key2: b,
		    pages2: getPagesForWord(wordToPages, b)
		});
            if (errors.length >= limit) break;
        }
    }
    if (!sorted) {
        debugLog('⚠️ 索引排序错误！词典 ' + dictId + ' 的键存在乱序：');
        errors.forEach(function(e) {
            debugLog('   "' + e.key1 + '"（页：' + e.pages1.join(', ') + '） 应该在 "' + e.key2 + '"（页：' + e.pages2.join(', ') + '） 之前');
        });
        showIndexOrderWarning(dictId, errors);
    } else {
        debugLog('✅ 索引排序验证通过，词典 ' + dictId + ' 键有序');
        showToast('✅ 索引排序验证通过，词典 ' + dictId + ' 键有序');
        removeIndexOrderWarning();
    }
    return { sorted: sorted, errors: errors };
}

function showIndexOrderWarning(dictId, errors) {
    var container = state.interaction.container || state.ui.resultDiv;
    if (!container) return;
    var oldWarn = container.querySelector('.picdic-index-warning');
    if (oldWarn) oldWarn.remove();
    var errorCount = errors.length;
    var sampleErrors = [];
    for (var i = 0; i < Math.min(2, errorCount); i++) {
        var e = errors[i];
        sampleErrors.push('"' + e.key1 + '"（页' + e.pages1.join(', ') + '）应在 "' + e.key2 + '"（页' + e.pages2.join(', ') + '）之前');
    }
    var extra = errorCount > 2 ? '...等' + errorCount + '处错误' : '';
    var warn = document.createElement('div');
    warn.className = 'picdic-index-warning';
    warn.innerHTML = '⚠️ 词典 "' + dictId + '" 索引排序有误：' + sampleErrors.join('；') + (extra ? ' ' + extra : '') +
        ' <button class="warning-close">✕</button>';
    warn.querySelector('.warning-close').addEventListener('click', function(e) {
        e.stopPropagation();
        warn.remove();
    });
    container.insertBefore(warn, container.firstChild);
}

function removeIndexOrderWarning() {
    var warn = document.querySelector('.picdic-index-warning');
    if (warn) warn.remove();
}

// ==================== IndexedDB 封装 ====================
// v15：复用同一个 IndexedDB 连接。GoldenDict 连续词条页中的一次 PicDic 生命周期内，
// 避免每个 get/put/bulk 操作都重新 indexedDB.open()。
var _picdicDbPromise = null;

function resetOpenDBConnection() {
    _picdicDbPromise = null;
}

function openDB() {
    if (_picdicDbPromise) return _picdicDbPromise;

    _picdicDbPromise = new Promise(function(resolve, reject) {
        var req;
        try {
            req = window.indexedDB.open('PicDicDB', 2);
        } catch (error) {
            resetOpenDBConnection();
            reject(error);
            return;
        }

        req.onupgradeneeded = function(e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains('data')) {
                db.createObjectStore('data', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('indexCache')) {
                var store = db.createObjectStore('indexCache', { keyPath: 'dictId' });
                store.createIndex('version', 'version', { unique: false });
            }
        };

        req.onsuccess = function() {
            var db = req.result;
            db.onversionchange = function() {
                try { db.close(); } catch (e) {}
                resetOpenDBConnection();
            };
            // 部分 WebView 支持 close 事件；若连接被宿主关闭，下次自动重开。
            try {
                db.onclose = function() { resetOpenDBConnection(); };
            } catch (e) {}
            resolve(db);
        };

        req.onerror = function() {
            resetOpenDBConnection();
            reject(req.error);
        };

        req.onblocked = function() {
            // 不立即 reject；让浏览器继续等待旧连接释放。
            debugLog('⚠️ IndexedDB open 被旧连接暂时阻塞');
        };
    });

    return _picdicDbPromise;
}

function dbPut(storeName, key, value) {
    return openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            var tx;
            try {
                tx = db.transaction(storeName, 'readwrite');
            } catch (error) {
                resetOpenDBConnection();
                reject(error);
                return;
            }
            var store = tx.objectStore(storeName);
            try {
                store.put({ id: key, value: value });
            } catch (error) {
                reject(error);
                return;
            }

            // V7：request success 只表示请求已执行，不代表 transaction 已提交。
            // 等 tx.oncomplete 后再向上层报告写入完成，避免半提交状态被后续读取。
            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() {
                reject(tx.error || new Error('IndexedDB transaction failed'));
            };
            tx.onabort = function() {
                reject(tx.error || new Error('IndexedDB transaction aborted'));
            };
        });
    }).catch(function(e) {
        debugLog('❌ IndexedDB写入失败 (store: ' + storeName + ', key: ' + key + '): ' + e.message);
        throw e;
    });
}

function dbGet(storeName, key) {
    return new Promise(function(resolve) {
        openDB().then(function(db) {
            var tx;
            try {
                tx = db.transaction(storeName, 'readonly');
            } catch (error) {
                resetOpenDBConnection();
                resolve(null);
                return;
            }
            var store = tx.objectStore(storeName);
            var req = store.get(key);
            req.onsuccess = function() { resolve(req.result ? req.result.value : null); };
            req.onerror = function() {
                debugLog('⚠️ IndexedDB读取失败 (store: ' + storeName + ', key: ' + key + ')');
                resolve(null);
            };
        }).catch(function(e) {
            debugLog('❌ IndexedDB打开失败: ' + e.message);
            resolve(null);
        });
    });
}

function dbDelete(storeName, key) {
    openDB().then(function(db) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        store.delete(key);
    }).catch(function(e) {
        debugLog('❌ IndexedDB删除失败 (store: ' + storeName + ', key: ' + key + '): ' + e.message);
    });
}

function dbClear(storeName) {
    openDB().then(function(db) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        store.clear();
    }).catch(function(e) {
        debugLog('❌ IndexedDB清空失败 (store: ' + storeName + '): ' + e.message);
    });
}

// ==================== Embedded Hot-Start 轻量缓存 ====================
// V7.1 correctness fix: word lookup keeps schema3 shard/LRU speed;
// page positions revert to V6 strict readiness: only use when pagePositionsReady=true.
// V7 / Hot Cache schema 3
// 稳定主线保持不变：Shared Runtime + Embedded Hot-start。
// schema 3 的核心优化：
// 1) lookup key = prefix + hash shard；查询一个词只读取该 shard 的 chunks，
//    不再读取整个高频 prefix（如 con/des/est/pre）的全部 chunks。
// 2) hot meta / word lookup / page positions 增加小型内存 LRU。
// 3) page positions 已写入即可读取，不必等待整本 pagePositionsReady。
// 4) 构建仍然分批写入并及时释放，避免首次构建的内存峰值。
var HOT_CACHE_SCHEMA = 3;
var HOT_WORD_PREFIX_LEN = 3;
var HOT_WORD_SHARD_COUNT = 8;
var HOT_WORD_BUILD_BATCH = 900;
var HOT_PAGE_WRITE_BATCH = 12;
var HOT_META_PROGRESS_EVERY = 8;
var _picdicHotBuildPromises = Object.create(null);

var HOT_META_MEMORY_MAX = 8;
var HOT_WORD_MEMORY_MAX = 16;
var HOT_PAGE_MEMORY_MAX = 16;

var _picdicHotMemory = {
    meta: new Map(),
    word: new Map(),
    page: new Map()
};

function hotLruGet(map, key) {
    if (!map || !map.has(key)) return null;
    var value = map.get(key);
    map.delete(key);
    map.set(key, value);
    return value;
}

function hotLruSet(map, key, value, maxSize) {
    if (!map) return;
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > maxSize) {
        var first = map.keys().next();
        if (first.done) break;
        map.delete(first.value);
    }
}

function hotPerfNow() {
    return (window.performance && typeof window.performance.now === 'function') ?
        window.performance.now() : Date.now();
}

function hotHashWord(text) {
    text = String(text || '');
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function getHotCacheBaseKey(dictId) {
    return 'picdic_hot_v' + HOT_CACHE_SCHEMA + '::' + getIndexCacheKey(dictId);
}

function getHotMetaKey(dictId) {
    return getHotCacheBaseKey(dictId) + '::meta';
}

function getHotWordBucketName(normalizedWord) {
    normalizedWord = String(normalizedWord || '');
    if (!normalizedWord) return '_';
    return normalizedWord.substring(0, HOT_WORD_PREFIX_LEN);
}

function getHotWordShard(normalizedWord) {
    return hotHashWord(normalizedWord) % HOT_WORD_SHARD_COUNT;
}

function getHotWordShardName(normalizedWord) {
    return getHotWordBucketName(normalizedWord) + '#' + String(getHotWordShard(normalizedWord));
}

function getHotWordChunkKey(dictId, shardName, chunkIndex) {
    return getHotCacheBaseKey(dictId) + '::word::' + shardName + '::' + String(chunkIndex);
}

function getHotPageKey(dictId, page) {
    return getHotCacheBaseKey(dictId) + '::page::' + String(page);
}

function hotYield() {
    return new Promise(function(resolve) {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(function() { resolve(); }, { timeout: 60 });
        } else {
            setTimeout(resolve, 0);
        }
    });
}

function scheduleHotBuildStart() {
    return new Promise(function(resolve) {
        // 先让当前查询的 UI / 图片开始显示，再利用空闲片段构建缓存。
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(function() { resolve(); }, { timeout: 900 });
        } else {
            setTimeout(resolve, 500);
        }
    });
}

function dbBulkPutData(items) {
    if (!items || !items.length) return Promise.resolve();
    return openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            var tx;
            try {
                tx = db.transaction('data', 'readwrite');
            } catch (error) {
                resetOpenDBConnection();
                reject(error);
                return;
            }
            var store = tx.objectStore('data');
            for (var i = 0; i < items.length; i++) {
                store.put({ id: items[i].id, value: items[i].value });
            }
            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() { reject(tx.error || new Error('Hot cache 批量写入失败')); };
            tx.onabort = function() { reject(tx.error || new Error('Hot cache 批量写入中止')); };
        });
    });
}

function dbGetManyData(keys) {
    if (!keys || !keys.length) return Promise.resolve([]);
    return openDB().then(function(db) {
        return new Promise(function(resolve) {
            var results = new Array(keys.length);
            var tx;
            try {
                tx = db.transaction('data', 'readonly');
            } catch (error) {
                resetOpenDBConnection();
                resolve(results);
                return;
            }
            var store = tx.objectStore('data');
            for (let i = 0; i < keys.length; i++) {
                (function(index) {
                    var req = store.get(keys[index]);
                    req.onsuccess = function() {
                        results[index] = req.result ? req.result.value : null;
                    };
                    req.onerror = function() { results[index] = null; };
                })(i);
            }
            tx.oncomplete = function() { resolve(results); };
            tx.onerror = function() { resolve(results); };
            tx.onabort = function() { resolve(results); };
        });
    }).catch(function() { return []; });
}

function dbDeleteDataByPrefix(prefix) {
    return openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction('data', 'readwrite');
            var store = tx.objectStore('data');
            var req = store.openCursor();
            req.onsuccess = function(e) {
                var cursor = e.target.result;
                if (!cursor) return;
                var key = String(cursor.key || '');
                if (key.indexOf(prefix) === 0) cursor.delete();
                cursor.continue();
            };
            req.onerror = function() { reject(req.error); };
            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() { reject(tx.error || new Error('Hot cache 清理失败')); };
        });
    });
}

function isHotMetaIdentityValid(dictId, meta) {
    if (!meta || meta.schema !== HOT_CACHE_SCHEMA) return false;
    var dict = window.picdic_dictList && window.picdic_dictList[dictId];
    if (!dict) return false;
    return meta.dictId === dictId &&
        meta.cacheKey === getIndexCacheKey(dictId) &&
        meta.indexPath === (dict.indexPath || '') &&
        Array.isArray(meta.pages);
}

function isHotMetaValid(dictId, meta) {
    if (!isHotMetaIdentityValid(dictId, meta) || !meta.lookupReady) return false;
    if (meta.buildState !== 'lookup_ready' && meta.buildState !== 'ready') return false;
    return !!(meta.wordShardChunks && typeof meta.wordShardChunks === 'object');
}

async function loadHotMeta(dictId) {
    var memoryKey = String(dictId || '');
    var cached = hotLruGet(_picdicHotMemory.meta, memoryKey);
    if (cached && isHotMetaValid(dictId, cached)) return cached;

    try {
        var meta = await dbGet('data', getHotMetaKey(dictId));
        if (!isHotMetaValid(dictId, meta)) return null;
        hotLruSet(_picdicHotMemory.meta, memoryKey, meta, HOT_META_MEMORY_MAX);
        return meta;
    } catch (e) {
        return null;
    }
}

function mergeHotWordRecord(target, source) {
    if (!source) return target;
    if (!target) {
        target = {
            keys: [],
            wordToPages: Object.create(null),
            pages: []
        };
    }

    var keys = source.keys || [];
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (target.keys.indexOf(key) === -1) target.keys.push(key);
        if (source.wordToPages && hasOwnKey(source.wordToPages, key)) {
            target.wordToPages[key] = source.wordToPages[key];
        }
    }

    var pages = source.pages || [];
    for (var p = 0; p < pages.length; p++) {
        if (target.pages.indexOf(pages[p]) === -1) target.pages.push(pages[p]);
    }
    return target;
}

async function loadHotWordLookup(dictId, word, meta) {
    var t0 = hotPerfNow();
    meta = meta || await loadHotMeta(dictId);
    if (!meta) return null;

    var normalizedWord = normalize(word);
    if (!normalizedWord) return null;

    var memoryKey = String(dictId) + '\n' + normalizedWord;
    var memoryRecord = hotLruGet(_picdicHotMemory.word, memoryKey);
    if (memoryRecord && memoryRecord.cacheKey === meta.cacheKey) {
        debugLog('⏱️ V7 hot word LRU: ' + (hotPerfNow() - t0).toFixed(1) + 'ms');
        return {
            meta: meta,
            normalized: normalizedWord,
            record: memoryRecord.record
        };
    }

    var shardName = getHotWordShardName(normalizedWord);
    var chunkCount = Number(meta.wordShardChunks[shardName] || 0);
    if (!chunkCount) return null;

    var keys = new Array(chunkCount);
    for (var i = 0; i < chunkCount; i++) {
        keys[i] = getHotWordChunkKey(dictId, shardName, i);
    }

    // V7：只读取当前 prefix + hash shard 的 chunks。
    var chunks = await dbGetManyData(keys);
    var record = null;

    for (var c = 0; c < chunks.length; c++) {
        var chunk = chunks[c];
        if (!chunk || chunk.schema !== HOT_CACHE_SCHEMA ||
            chunk.cacheKey !== meta.cacheKey || !chunk.words) continue;
        if (hasOwnKey(chunk.words, normalizedWord)) {
            record = mergeHotWordRecord(record, chunk.words[normalizedWord]);
        }
    }

    if (!record || !record.keys.length) return null;

    hotLruSet(_picdicHotMemory.word, memoryKey, {
        cacheKey: meta.cacheKey,
        record: record
    }, HOT_WORD_MEMORY_MAX);

    debugLog('⏱️ V7 hot word IDB: ' + (hotPerfNow() - t0).toFixed(1) +
        'ms, shard=' + shardName + ', chunks=' + chunkCount);

    return {
        meta: meta,
        normalized: normalizedWord,
        record: record
    };
}

async function loadHotPagePositions(dictId, page, meta) {
    // V7.1: restore the V6 correctness rule.
    // Do not read from a partially-built page-position cache.
    if (!meta || !meta.pagePositionsReady) return null;

    var pageKey = String(page);
    var memoryKey = String(dictId) + '\n' + pageKey;
    var memoryRecord = hotLruGet(_picdicHotMemory.page, memoryKey);
    if (memoryRecord && memoryRecord.cacheKey === meta.cacheKey) {
        return memoryRecord.entries;
    }

    try {
        // V7.1: cache is trusted only after pagePositionsReady=true.
        var record = await dbGet('data', getHotPageKey(dictId, pageKey));
        if (!record || record.schema !== HOT_CACHE_SCHEMA || record.cacheKey !== meta.cacheKey) return null;
        var entries = Array.isArray(record.entries) ? record.entries : null;
        if (entries) {
            hotLruSet(_picdicHotMemory.page, memoryKey, {
                cacheKey: meta.cacheKey,
                entries: entries
            }, HOT_PAGE_MEMORY_MAX);
        }
        return entries;
    } catch (e) {
        return null;
    }
}

function createHotBuildMeta(dictId, indexData, dict, cacheKey) {
    return {
        schema: HOT_CACHE_SCHEMA,
        cacheKey: cacheKey,
        dictId: dictId,
        indexPath: dict.indexPath || '',
        indexKeyType: indexData.indexKeyType || dict.index_language || 'en',
        pages: indexData.pages ? indexData.pages.slice() : [],
        special: indexData.special || {},
        rawWordCount: 0,
        bucketCount: 0,
        wordShardChunks: {},
        shardCount: HOT_WORD_SHARD_COUNT,
        lookupReady: false,
        pagePositionsReady: false,
        buildState: 'building',
        builtWordBatches: 0,
        builtPageBatches: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        builtAt: 0
    };
}

async function buildHotLookupIncrementally(dictId, indexData, meta) {
    var wordToPages = indexData.wordToPages;
    var shardChunkCounts = Object.create(null);
    var batchShards = Object.create(null);
    var batchWordCount = 0;
    var rawWordCount = 0;
    var batchNo = 0;

    async function flushWordBatch() {
        if (!batchWordCount) return;

        var names = Object.keys(batchShards);
        var items = new Array(names.length);

        for (var n = 0; n < names.length; n++) {
            var shardName = names[n];
            var chunkIndex = shardChunkCounts[shardName] || 0;
            var chunk = batchShards[shardName];
            chunk.chunk = chunkIndex;
            items[n] = {
                id: getHotWordChunkKey(dictId, shardName, chunkIndex),
                value: chunk
            };
            shardChunkCounts[shardName] = chunkIndex + 1;
        }

        await dbBulkPutData(items);

        // 每批即写即释放，避免和完整 indexData 同时保留大量派生对象。
        items = null;
        batchShards = Object.create(null);
        batchWordCount = 0;
        batchNo++;

        if (batchNo % HOT_META_PROGRESS_EVERY === 0) {
            meta.rawWordCount = rawWordCount;
            meta.builtWordBatches = batchNo;
            meta.updatedAt = Date.now();
            await dbPut('data', getHotMetaKey(dictId), meta);
        }

        await hotYield();
    }

    for (var originalKey in wordToPages) {
        if (!hasOwnKey(wordToPages, originalKey)) continue;
        rawWordCount++;

        var normalizedWord = normalize(originalKey);
        if (normalizedWord) {
            var shardName = getHotWordShardName(normalizedWord);
            var shard = batchShards[shardName];
            if (!shard) {
                shard = batchShards[shardName] = {
                    schema: HOT_CACHE_SCHEMA,
                    cacheKey: meta.cacheKey,
                    dictId: dictId,
                    shard: shardName,
                    words: Object.create(null)
                };
            }

            var wordRecord = shard.words[normalizedWord];
            if (!wordRecord) {
                wordRecord = shard.words[normalizedWord] = {
                    keys: [],
                    wordToPages: Object.create(null),
                    pages: []
                };
            }

            wordRecord.keys.push(originalKey);
            wordRecord.wordToPages[originalKey] = wordToPages[originalKey];
            var pages = getPagesForWord(wordToPages, originalKey) || [];
            for (var p = 0; p < pages.length; p++) {
                if (wordRecord.pages.indexOf(pages[p]) === -1) wordRecord.pages.push(pages[p]);
            }
        }

        batchWordCount++;
        if (batchWordCount >= HOT_WORD_BUILD_BATCH) {
            await flushWordBatch();
        }
    }

    await flushWordBatch();

    meta.rawWordCount = rawWordCount;
    meta.wordShardChunks = {};
    var shardNames = Object.keys(shardChunkCounts);
    for (var i = 0; i < shardNames.length; i++) {
        meta.wordShardChunks[shardNames[i]] = shardChunkCounts[shardNames[i]];
    }
    meta.bucketCount = shardNames.length;
    meta.lookupReady = true;
    meta.buildState = 'lookup_ready';
    meta.builtWordBatches = batchNo;
    meta.updatedAt = Date.now();

    await dbPut('data', getHotMetaKey(dictId), meta);
    hotLruSet(_picdicHotMemory.meta, String(dictId), meta, HOT_META_MEMORY_MAX);

    debugLog('✅ V7 Hot lookup 构建完成: ' + dictId +
        ', words=' + rawWordCount + ', shards=' + shardNames.length +
        ', batches=' + batchNo + ', shardCount=' + HOT_WORD_SHARD_COUNT);
}

async function buildHotPagesIncrementally(dictId, indexData, meta) {
    var positions = indexData.pageWordPositions || null;
    if (!positions || !hasOwnEntries(positions)) {
        meta.pagePositionsReady = false;
        meta.buildState = 'ready';
        meta.builtAt = Date.now();
        meta.updatedAt = meta.builtAt;
        await dbPut('data', getHotMetaKey(dictId), meta);
        hotLruSet(_picdicHotMemory.meta, String(dictId), meta, HOT_META_MEMORY_MAX);
        return;
    }

    var pageItems = [];
    var pageCount = 0;
    var pageBatchNo = 0;

    async function flushPageBatch() {
        if (!pageItems.length) return;
        await dbBulkPutData(pageItems);
        pageItems = [];
        pageBatchNo++;
        meta.builtPageBatches = pageBatchNo;
        meta.updatedAt = Date.now();
        if (pageBatchNo % HOT_META_PROGRESS_EVERY === 0) {
            await dbPut('data', getHotMetaKey(dictId), meta);
        }
        await hotYield();
    }

    for (var page in positions) {
        if (!hasOwnKey(positions, page)) continue;
        pageCount++;
        pageItems.push({
            id: getHotPageKey(dictId, page),
            value: {
                schema: HOT_CACHE_SCHEMA,
                cacheKey: meta.cacheKey,
                dictId: dictId,
                page: String(page),
                entries: positions[page]
            }
        });

        if (pageItems.length >= HOT_PAGE_WRITE_BATCH) {
            await flushPageBatch();
        }
    }

    await flushPageBatch();

    meta.pagePositionsReady = true;
    meta.pagePositionCount = pageCount;
    meta.buildState = 'ready';
    meta.builtAt = Date.now();
    meta.updatedAt = meta.builtAt;
    await dbPut('data', getHotMetaKey(dictId), meta);
    hotLruSet(_picdicHotMemory.meta, String(dictId), meta, HOT_META_MEMORY_MAX);

    debugLog('✅ Hot page positions 增量构建完成: ' + dictId +
        ', pages=' + pageCount + ', batches=' + pageBatchNo);
}

async function buildHotCacheForDict(dictId, indexData) {
    if (!indexData || !isIndexOwnedBy(dictId, indexData) || !indexData.wordToPages) return false;

    var dict = window.picdic_dictList && window.picdic_dictList[dictId];
    if (!dict) return false;

    var cacheKey = getIndexCacheKey(dictId);
    var rawMeta = null;
    try { rawMeta = await dbGet('data', getHotMetaKey(dictId)); } catch (e) {}

    // 完整 lookup 已存在时不再重建词条 chunks；如果只是 page positions 未完成，只补 page 数据。
    if (isHotMetaValid(dictId, rawMeta)) {
        if (!indexData.pageWordPositions || rawMeta.pagePositionsReady) return true;
        debugLog('🔥 Hot lookup 已存在，仅补 page positions: ' + dictId);
        await buildHotPagesIncrementally(dictId, indexData, rawMeta);
        return true;
    }

    var meta = createHotBuildMeta(dictId, indexData, dict, cacheKey);
    // 先发布 building meta。若页面在构建中被销毁，下一页不会把部分 chunks 当作完整缓存。
    await dbPut('data', getHotMetaKey(dictId), meta);
    debugLog('🔥 Hot cache 增量构建开始: ' + dictId);

    await buildHotLookupIncrementally(dictId, indexData, meta);
    // lookup_ready 一经写入，后续新词页面已经可以走 hot-start；位置数据继续在后台补齐。
    await buildHotPagesIncrementally(dictId, indexData, meta);
    return true;
}

function scheduleHotCacheBuild(dictId, indexData) {
    if (!dictId || !indexData || indexData._picdicHotLite) return;
    var key = getHotCacheBaseKey(dictId);
    if (_picdicHotBuildPromises[key]) return;

    _picdicHotBuildPromises[key] = scheduleHotBuildStart()
    .then(function() {
        return buildHotCacheForDict(dictId, indexData);
    })
    .catch(function(error) {
        debugLog('⚠️ Hot cache 增量构建失败: ' + dictId + ' / ' +
            (error && error.message ? error.message : error));
        return false;
    })
    .then(function(result) {
        delete _picdicHotBuildPromises[key];
        return result;
    });
}

function applyHotLiteSearchCache(dictId, normalizedWord, record, indexData) {
    var keyMap = Object.create(null);
    keyMap[normalizedWord] = record.keys ? record.keys.slice() : [];
    state.cache._normalizedKeys = [normalizedWord];
    state.cache._sortedKeys = [keyMap[normalizedWord][0] || normalizedWord];
    state.cache._keyMap = keyMap;
    state.cache._searchCacheReady = true;
    state.cache._searchCacheDictId = dictId;
    state.cache._searchCacheIndexPath = indexData._picdicIndexPath;
    state.cache._searchCacheRawKeyCount = keyMap[normalizedWord].length;
}

async function prepareEmbeddedHotIndex(dictId, word) {
    if (!_picdicEmbeddedMode || !dictId || !word) return false;

    var t0 = hotPerfNow();
    var lookup = await loadHotWordLookup(dictId, word);
    if (!lookup || !lookup.record || !lookup.record.wordToPages) return false;
    var tLookup = hotPerfNow();

    var dict = window.picdic_dictList && window.picdic_dictList[dictId];
    if (!dict) return false;

    var pageWordPositions = {};
    if (lookup.meta.pagePositionsReady && lookup.record.pages) {
        // V7.1: restore V6 strict positions readiness.
        // Once the hot-position path is used, the page-position cache is complete.
        for (var i = 0; i < lookup.record.pages.length; i++) {
            var page = lookup.record.pages[i];
            var entries = await loadHotPagePositions(dictId, page, lookup.meta);
            if (entries && entries.length) pageWordPositions[String(page)] = entries;
        }
    }
    var tPages = hotPerfNow();

    var liteIndex = {
        _picdicDictId: dictId,
        _picdicIndexPath: dict.indexPath || '',
        _picdicHotLite: true,
        indexKeyType: lookup.meta.indexKeyType || dict.index_language || 'en',
        pages: lookup.meta.pages ? lookup.meta.pages.slice() : [],
        special: lookup.meta.special || {},
        wordToPages: lookup.record.wordToPages,
        pageWordPositions: pageWordPositions
    };

    setActiveDictionaryIndex(dictId, liteIndex);
    state.cache._hotLite = true;
    state.cache._hotMeta = lookup.meta;
    state.cache._hotBaseKey = getHotCacheBaseKey(dictId);
    state.cache._hotPageLoads = Object.create(null);
    applyHotLiteSearchCache(dictId, lookup.normalized, lookup.record, liteIndex);
    state.cache._hasPagePositions = hasOwnEntries(pageWordPositions);
    state.ui.currentDictId = dictId;
    resetCurrentSearchState();
    state.navigation.currentWordPages = null;
    state.navigation.currentPageKeyMap = null;
    state.navigation.currentWordIndex = 0;
    mergeDictConfig(dictId, null);
    updatePagesInfo(dictId);
    applyConfig();

    debugLog('⚡ V7 Embedded hot-start: dict=' + dictId + ', word=' + word +
        ', pages=' + (lookup.record.pages ? lookup.record.pages.length : 0));
    debugLog('⏱️ V7 hot-start timing: lookup=' + (tLookup - t0).toFixed(1) +
        'ms, pagePositions=' + (tPages - tLookup).toFixed(1) +
        'ms, total=' + (hotPerfNow() - t0).toFixed(1) + 'ms');

    return true;
}

function ensureHotPagePositionsAsync(page) {
    if (!state.cache._hotLite || !state.cache.dictionaryIndex || !state.cache.dictionaryIndex._picdicHotLite) {
        return;
    }
    var pageKey = String(page);
    if (getPageWordAnnotationEntries(pageKey)) return;
    if (!state.cache._hotMeta || !state.cache._hotMeta.pagePositionsReady) return;
    if (!state.cache._hotPageLoads) state.cache._hotPageLoads = Object.create(null);
    if (state.cache._hotPageLoads[pageKey]) return;

    var dictId = state.ui.currentDictId;
    var expectedIndex = state.cache.dictionaryIndex;
    state.cache._hotPageLoads[pageKey] = loadHotPagePositions(dictId, pageKey, state.cache._hotMeta)
        .then(function(entries) {
            delete state.cache._hotPageLoads[pageKey];
            if (!entries || !entries.length || state.cache.dictionaryIndex !== expectedIndex ||
                state.ui.currentDictId !== dictId) return;
            expectedIndex.pageWordPositions[pageKey] = entries;
            state.cache._hasPagePositions = true;
            if (String(state.ui.pageNum) === pageKey && state.interaction.wrapper) {
                drawWordAnnotations(pageKey, true);
            }
        })
        .catch(function() {
            delete state.cache._hotPageLoads[pageKey];
        });
}

async function promoteHotLiteToFullIndex(dictId) {
    if (!state.cache.dictionaryIndex || !state.cache.dictionaryIndex._picdicHotLite) return true;
    state.cache._hotLite = false;
    state.cache._hotMeta = null;
    state.cache._hotBaseKey = null;
    state.cache._hotPageLoads = null;
    await loadIndexAndConfig(dictId);
    return true;
}

// ==================== MDict 主词条跨页跳转 ====================
function createPendingMDictJumpRequest(dictId, word) {
    var now = Date.now();
    return {
        schema: MDICT_JUMP_REQUEST_SCHEMA,
        requestId: now.toString(36) + '_' + Math.random().toString(36).slice(2, 9),
        dictId: String(dictId || ''),
        word: String(word || '').trim(),
        createdAt: now,
        expiresAt: now + MDICT_JUMP_REQUEST_TTL
    };
}

function savePendingMDictJumpRequest(dictId, word) {
    var request = createPendingMDictJumpRequest(dictId, word);
    var localSaved = false;

    try {
        if (window.localStorage) {
            window.localStorage.setItem(MDICT_JUMP_REQUEST_KEY, JSON.stringify(request));
            localSaved = true;
        }
    } catch (e) {
        debugLog('⚠️ MDict 跳转请求写入 localStorage 失败: ' + e.message);
    }

    try {
        var hostWindow = _picdicGetSafeHostWindow();
        if (hostWindow) hostWindow.__PICDIC_PENDING_MAIN_JUMP__ = request;
    } catch (e) {}

    var dbSave = dbPut('data', MDICT_JUMP_REQUEST_KEY, request);
    return dbSave.then(function() {
        return request;
    }).catch(function(error) {
        debugLog('⚠️ MDict 跳转请求写入 IndexedDB 失败: ' + error.message);
        // localStorage 或父窗口同步标记成功时仍可安全跳转；两者都失败才中止。
        if (localSaved) return request;
        var hostSaved = false;
        try {
            var hostWindow = _picdicGetSafeHostWindow();
            hostSaved = !!(hostWindow && hostWindow.__PICDIC_PENDING_MAIN_JUMP__ &&
                hostWindow.__PICDIC_PENDING_MAIN_JUMP__.requestId === request.requestId);
        } catch (e) {}
        if (hostSaved) return request;
        throw error;
    });
}

async function readPendingMDictJumpRequest() {
    if (!_env.isMDictAndroid) return null;

    var request = _picdicReadEarlyJumpRequest(_picdicGetSafeHostWindow());
    if (request) return request;

    var dbRequest = await dbGet('data', MDICT_JUMP_REQUEST_KEY);
    request = _picdicParseJumpRequest(dbRequest);
    if (request) return request;

    // 清理失效残留。
    try {
        if (window.localStorage) window.localStorage.removeItem(MDICT_JUMP_REQUEST_KEY);
    } catch (e) {}
    dbDelete('data', MDICT_JUMP_REQUEST_KEY);
    return null;
}

function clearPendingMDictJumpRequest(requestId) {
    try {
        var hostWindow = _picdicGetSafeHostWindow();
        var hostRequest = hostWindow && hostWindow.__PICDIC_PENDING_MAIN_JUMP__;
        if (!requestId || !hostRequest || hostRequest.requestId === requestId) {
            try { delete hostWindow.__PICDIC_PENDING_MAIN_JUMP__; } catch (e) {
                hostWindow.__PICDIC_PENDING_MAIN_JUMP__ = null;
            }
        }
        var registry = hostWindow && hostWindow.__PICDIC_MAIN_REGISTRY__;
        if (registry && (!requestId || registry.jumpRequestId === requestId)) {
            registry.jumpRequestId = null;
        }
    } catch (e) {}

    try {
        if (window.localStorage) {
            var localRequest = _picdicParseJumpRequest(
                window.localStorage.getItem(MDICT_JUMP_REQUEST_KEY)
            );
            if (!requestId || !localRequest || localRequest.requestId === requestId) {
                window.localStorage.removeItem(MDICT_JUMP_REQUEST_KEY);
            }
        }
    } catch (e) {}

    dbGet('data', MDICT_JUMP_REQUEST_KEY).then(function(saved) {
        if (!requestId || !saved || saved.requestId === requestId) {
            dbDelete('data', MDICT_JUMP_REQUEST_KEY);
        }
    });
}

async function jumpToMDictPicDic(dictId, popup) {
    if (!_env.isMDictAndroid) return;
    if (!dictId || !window.picdic_dictList || !window.picdic_dictList[dictId]) {
        showToast('目标词典不存在');
        return;
    }

    var word = state.ui.searchInput ? state.ui.searchInput.value.trim() : '';
    try {
        await savePendingMDictJumpRequest(dictId, word);
        if (popup && typeof popup.close === 'function') popup.close();
        persistStateBeforePageTransition();
        window.location.href = MDICT_PICDIC_ENTRY_URL;
    } catch (error) {
        debugLog('❌ MDict 主词条跳转失败: ' + error.message);
        showToast('跳转失败：' + error.message);
    }
}

function isCurrentMDictPicDicMainEntry() {
    return !!(_env.isMDictAndroid && _picdicEarlyIsPicDicMainEntry);
}

async function switchDictFromList(dictId, popup) {
    if (!dictId || !window.picdic_dictList || !window.picdic_dictList[dictId]) {
        showToast('目标词典不存在');
        return;
    }

    // MDict 只有在 APP 主词条不是 picdic 时才需要跨页跳转。
    // 这样可以让 picdic 主词条同时加载资源词典；已经位于 picdic 主词条时则直接内部切换，
    // 避免重复导航、界面闪烁和一次性请求的额外读写。
    if (_env.isMDictAndroid && !_picdicEmbeddedMode && !isCurrentMDictPicDicMainEntry()) {
        await jumpToMDictPicDic(dictId, popup);
        return;
    }

    if (popup && typeof popup.close === 'function') popup.close();
    if (dictId === state.ui.currentDictId) return;

    try {
        await switchDict(dictId);
    } catch (error) {
        showToast('切换词典失败：' + (error && error.message ? error.message : '未知错误'));
    }
}

// ==================== 索引缓存 ====================
// ==================== 缓存键生成 ====================
function getIndexCacheKey(dictId) {
    var dict = window.picdic_dictList && window.picdic_dictList[dictId];
    var version = dict && dict.version ? dict.version : '1';
    // schema 变更会自动避开旧缓存，防止历史上已被错误覆盖的缓存继续命中。
    return dictId + '_' + version + '_schema' + INDEX_CACHE_SCHEMA;
}

function tagIndexOwner(dictId, indexData) {
    if (!indexData || typeof indexData !== 'object') return indexData;
    var dict = window.picdic_dictList && window.picdic_dictList[dictId];
    indexData._picdicDictId = dictId;
    indexData._picdicIndexPath = dict && dict.indexPath ? dict.indexPath : '';
    return indexData;
}

function isIndexOwnedBy(dictId, indexData) {
    if (!indexData || typeof indexData !== 'object') return false;
    var dict = window.picdic_dictList && window.picdic_dictList[dictId];
    var expectedPath = dict && dict.indexPath ? dict.indexPath : '';
    return indexData._picdicDictId === dictId &&
           indexData._picdicIndexPath === expectedPath &&
           indexData.wordToPages && Array.isArray(indexData.pages);
}

function setActiveDictionaryIndex(dictId, indexData) {
    if (!isIndexOwnedBy(dictId, indexData)) {
        throw new Error('索引归属校验失败：期望词典 ' + dictId +
            '，实际为 ' + (indexData && indexData._picdicDictId ? indexData._picdicDictId : '未知'));
    }
    state.cache.dictionaryIndex = indexData;
    state.misc._indexOwnerDictId = dictId;
    if (!indexData._picdicHotLite) {
        state.cache._hotLite = false;
        state.cache._hotMeta = null;
        state.cache._hotBaseKey = null;
        state.cache._hotPageLoads = null;
    }
}
// ==================== 写入缓存 ====================
function saveIndexToCache(dictId, cacheData) {
    var cacheKey = getIndexCacheKey(dictId);
    if (!cacheKey) {
        debugLog('⚠️ saveIndexToCache: 无效的 cacheKey，跳过写入');
        return;
    }
    if (!cacheData || !isIndexOwnedBy(dictId, cacheData.indexData)) {
        debugLog('⛔ 拒绝写入索引缓存：索引数据与目标词典不对应，目标=' + dictId +
            '，索引归属=' + (cacheData && cacheData.indexData ? cacheData.indexData._picdicDictId : '未知'));
        return;
    }
    // schema3：搜索派生缓存与索引一起持久化。缺失或失效时只在这里构建一次。
    cacheData.searchCache = ensureSearchCacheForData(dictId, cacheData.indexData, cacheData.searchCache);
    // 双重附加词典ID，用于读取时校验
    cacheData._dictId = dictId;
    cacheData._indexPath = cacheData.indexData._picdicIndexPath;
    var cacheEntry = {
        dictId: cacheKey,
        version: cacheKey,
        data: cacheData,
        timestamp: Date.now()
    };
    openDB().then(function(db) {
        var tx = db.transaction('indexCache', 'readwrite');
        var store = tx.objectStore('indexCache');
        var req = store.put(cacheEntry);
        req.onsuccess = function() {
            debugLog('✅ 索引缓存写入成功: ' + dictId);
        };
        req.onerror = function(e) {
            debugLog('❌ 索引缓存写入失败: ' + e.target.error);
        };
    }).catch(function(e) {
        debugLog('❌ 索引缓存写入失败 (DB): ' + e.message);
    });
    debugLog('💾 索引和配置已缓存: ' + dictId);
    // 后台构建轻量 hot cache，不阻塞当前词典显示。
    scheduleHotCacheBuild(dictId, cacheData.indexData);
}

// ==================== 读取缓存 ====================
function loadIndexFromCache(dictId) {
    return new Promise(function(resolve) {
        var cacheKey = getIndexCacheKey(dictId);
        debugLog('🔍 loadIndexFromCache: 尝试读取缓存，key=' + cacheKey);
        if (!cacheKey) {
            debugLog('⚠️ cacheKey 为空');
            resolve(null);
            return;
        }
        openDB().then(function(db) {
            var tx = db.transaction('indexCache', 'readonly');
            var store = tx.objectStore('indexCache');
            var req = store.get(cacheKey);
            req.onsuccess = function() {
                var cached = req.result;
                if (cached && cached.version === cacheKey) {
                    // ★ 关键校验：数据中的 _dictId 必须与当前词典一致
                    if (cached.data && cached.data._dictId === dictId &&
                        cached.data._indexPath === (window.picdic_dictList[dictId].indexPath || '') &&
                        isIndexOwnedBy(dictId, cached.data.indexData)) {
                        debugLog('✅ 从缓存加载索引和配置: ' + dictId);
                        debugLog('📥 从缓存读取到索引 pages 长度: ' + (cached.data.indexData.pages ? cached.data.indexData.pages.length : 'null'));
                        resolve(cached.data);
                    } else {
                        debugLog('⚠️ 缓存数据无效（词典归属/索引路径不匹配或缺少字段），期望: ' + dictId +
                            ', 实际: ' + (cached.data && cached.data.indexData ? cached.data.indexData._picdicDictId : 'undefined'));
                        resolve(null);
                    }
                } else {
                    debugLog('⚠️ 缓存无效或版本不匹配，期望: ' + cacheKey + ', 实际: ' + (cached ? cached.version : 'null'));
                    resolve(null);
                }
            };
            req.onerror = function() {
                debugLog('❌ 读取缓存出错: ' + req.error);
                resolve(null);
            };
        }).catch(function(err) {
            debugLog('❌ 打开数据库失败: ' + err.message);
            resolve(null);
        });
    });
}

// ==================== 清除缓存 ====================
function clearIndexCache(dictId) {
    if (state.cache.preloadManager) {
        state.cache.preloadManager.clear();
    }
    if (dictId) {
        // 清当前 schema，并兼容清理 v6.0 的 hot v1 残留。
        dbDeleteDataByPrefix(getHotCacheBaseKey(dictId)).catch(function() {});
        dbDeleteDataByPrefix('picdic_hot_v1::' + getIndexCacheKey(dictId)).catch(function() {});
        dbDeleteDataByPrefix('picdic_hot_v2::' + getIndexCacheKey(dictId)).catch(function() {});
        var cacheKey = getIndexCacheKey(dictId);
        if (cacheKey) {
            dbDelete('indexCache', cacheKey);
            debugLog('🗑️ 清除缓存: ' + dictId);
        }
    } else {
        dbClear('indexCache');
        dbDeleteDataByPrefix('picdic_hot_v').catch(function() {});
        debugLog('🗑️ 清除所有索引缓存');
    }
}

// ==================== 历史函数（改用HistoryStore） ====================
function saveHistory(word, dictId) {
    if (state.historyStore) state.historyStore.add(word, dictId);
}


function clearHistory() {
    if (state.historyStore) {
        state.historyStore.clear();
        if (state.historyPopup) {
            state.historyPopup.close();
            state.historyPopup = null;
        }
        showToast('历史已清空');
    }
}

// ==================== 外部配置加载 ====================
function loadGlobalConfigJS() {
    return new Promise(function(resolve) {
        var configPath = 'PicDic_global_config.ini';
        if (window._picdic_global_config_path) {
            configPath = window._picdic_global_config_path;
        }
        var script = document.createElement('script');
        script.id = 'picdic-global-config';
        script.src = UrlBuilder.getFileUrl(configPath);
        script.onload = function() {
            var config = window._dictConfig_global || null;
            if (config) {
                window._dictConfig_global = config;
                resolve(config);
            } else {
                resolve(null);
            }
            script.remove();
        };
        script.onerror = function() {
            debugLog('⚠️ 全局配置文件加载失败（文件可能不存在）');
            resolve(null);
            script.remove();
        };
        document.head.appendChild(script);
    });
}

function loadDictConfigJS(configPath, dictId) {
    return new Promise(function(resolve) {
        var script = document.createElement('script');
        script.id = 'picdic-config-' + dictId;
        script.src = UrlBuilder.getFileUrl(configPath);
        var attempts = 0;
        var maxAttempts = 5;
        var interval = 50;
        function tryResolve() {
            var config = window._dictConfig_individual || null;
            if (config) {
                window['_dictConfig_' + dictId] = config;
                delete window._dictConfig_individual;
                if (script.parentNode) script.remove();
                resolve(config);
                return true;
            }
            return false;
        }
        script.onload = function() {
            if (tryResolve()) return;
            var timer = setInterval(function() {
                attempts++;
                if (tryResolve()) {
                    clearInterval(timer);
                    return;
                }
                if (attempts >= maxAttempts) {
                    clearInterval(timer);
                    debugLog('⚠️ 词典配置文件加载超时，未读取到配置: ' + dictId);
                    if (script.parentNode) script.remove();
                    resolve(null);
                }
            }, interval);
        };
        script.onerror = function() {
            debugLog('⚠️ 词典配置文件加载失败（文件不存在或网络错误）: ' + dictId);
            if (script.parentNode) script.remove();
            resolve(null);
        };
        document.head.appendChild(script);
    });
}

// ==================== 资源自动发现 ====================
var _resourceQueue = [];
var _resourceActive = 0;

function discoverResource(dictId, suffix, callback) {
    var dictList = window.picdic_dictList;
    if (!dictList || !dictList[dictId]) {
        callback(null);
        return;
    }
    var dict = dictList[dictId];
    var basePath = dict.indexPath.replace('_index.js', '');
    var extensions = ['.bmp', '.jpg', '.png'];
    var cachedKey = '_cached' + suffix.charAt(0).toUpperCase() + suffix.slice(1);
    if (state.configStore.data.allDictConfigs[dictId] &&
        state.configStore.data.allDictConfigs[dictId][cachedKey]) {
        callback(state.configStore.data.allDictConfigs[dictId][cachedKey]);
        return;
    }
    var task = {
        dictId: dictId,
        suffix: suffix,
        basePath: basePath,
        extensions: extensions,
        cachedKey: cachedKey,
        callback: callback,
        attempts: [],
        tried: 0,
        found: false
    };
    if (suffix === 'icon') {
        extensions.forEach(function(ext) {
            task.attempts.push(basePath + ext);
            task.attempts.push(basePath + '_icon' + ext);
        });
    } else if (suffix === 'cover') {
        extensions.forEach(function(ext) {
            task.attempts.push(basePath + '_cover' + ext);
        });
    } else {
        extensions.forEach(function(ext) {
            task.attempts.push(basePath + ext);
            task.attempts.push(basePath + '_' + suffix + ext);
        });
    }
    _resourceQueue.push(task);
    processResourceQueue();
}

function processResourceQueue() {
    while (_resourceQueue.length > 0 && _resourceActive < RESOURCE_CONCURRENCY) {
        var task = _resourceQueue.shift();
        _resourceActive++;
        tryNextResource(task);
    }
}

function tryNextResource(task) {
    if (task.found || task.tried >= task.attempts.length) {
        if (!task.found) {
            if (!state.configStore.data.allDictConfigs[task.dictId]) {
                state.configStore.data.allDictConfigs[task.dictId] = {};
            }
            state.configStore.data.allDictConfigs[task.dictId][task.cachedKey] = null;
            state.configManager.notifyChange();
            task.callback(null);
        }
        _resourceActive--;
        processResourceQueue();
        return;
    }
    var url = UrlBuilder.getFileUrl(task.attempts[task.tried]);
    var img = new Image();
    img.onload = function() {
        task.found = true;
        if (!state.configStore.data.allDictConfigs[task.dictId]) {
            state.configStore.data.allDictConfigs[task.dictId] = {};
        }
        state.configStore.data.allDictConfigs[task.dictId][task.cachedKey] = task.attempts[task.tried];
        state.configManager.notifyChange();
        // 图标/封面属于 ConfigStore 元数据，不得用当前全局索引覆盖 task.dictId 的索引缓存。
        // ConfigStore 会独立持久化，因此这里不需要触碰 indexCache。
        debugLog('✅ 图标/封面元数据已保存: ' + task.dictId + ' / ' + task.suffix);
        task.callback(task.attempts[task.tried]);
        _resourceActive--;
        processResourceQueue();
    };
    img.onerror = function() {
        debugLog('⚠️ 资源加载失败: ' + url);
        task.tried++;
        tryNextResource(task);
    };
    img.src = url;
}

// ==================== 日志导出等 ====================
function exportDebugLog() {
    try {
        if (!state.ui.logLines || state.ui.logLines.length === 0) {
            showToast('日志为空，无可导出内容。');
            return;
        }
        var content = state.ui.logLines.join('\n');
        var header = '=== PicDic Debug Log ===\n导出时间: ' + new Date().toLocaleString() +
                         '\n词典ID: ' + (state.ui.currentDictId || '无') +
                         '\n全局配置: ' + JSON.stringify(state.config.globalConfig, null, 2) +
                         '\n当前词典配置: ' + JSON.stringify(state.config.dictConfig, null, 2) +
                         '\n============================\n\n';
        var full = header + content;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(full).then(function() {
                showToast('日志已复制到剪贴板！');
            }).catch(function() { fallbackCopy(full); });
        } else {
            fallbackCopy(full);
        }
    } catch (e) {
        showToast('导出失败: ' + e.message);
        console.error('[PicDic] 导出日志错误:', e);
    }
}

function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        showToast('日志已复制到剪贴板！');
    } catch(e) {
        showToast('复制失败，请手动复制。');
    }
    document.body.removeChild(ta);
}

function clearDebugLog() {
    if (!state.ui.logLines || state.ui.logLines.length === 0) {
        showToast('日志已为空。');
        return;
    }
    showConfirm('确认清空', '确定清空所有调试日志吗？', function() {
        state.ui.logLines = [];
        if (state.ui.logContainer) state.ui.logContainer.innerHTML = '';
        showToast('日志已清空。');
    });
}

function injectExportButton() {
    if (!state.ui.debugDiv || state.ui.debugDiv.querySelector('.export-log-btn')) return;
    var container = document.createElement('div');
    container.className = 'debug-btn-container';
    var exportBtn = document.createElement('button');
    exportBtn.className = 'export-log-btn';
    exportBtn.textContent = '📋 复制日志';
    exportBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        exportDebugLog();
    });
    container.appendChild(exportBtn);
    var clearBtn = document.createElement('button');
    clearBtn.className = 'clear-log-btn';
    clearBtn.textContent = '🗑️ 清除';
    clearBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        clearDebugLog();
    });
    container.appendChild(clearBtn);
    var logContainer = state.ui.logContainer;
    if (logContainer) {
        state.ui.debugDiv.insertBefore(container, logContainer);
    } else {
        state.ui.debugDiv.appendChild(container);
    }
}

function updateConfigPanelIfVisible() {
    if (state.config._refreshConfigForm && typeof state.config._refreshConfigForm === 'function') {
        state.config._refreshConfigForm();
    }
}

// ==================== 弹出面板工厂 ====================
function createPopup(title, panelClassName, contentCallback, actions, closeCallback) {
    var overlay = document.createElement('div');
    overlay.className = 'picdic-popup-overlay';
    overlay.addEventListener('touchmove', function(e) {
        var target = e.target;
        while (target && target !== overlay) {
            if (target.classList && target.classList.contains('picdic-popup-content')) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            target = target.parentNode;
        }
        e.preventDefault();
    }, { passive: false });
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            closePopup();
        }
    });
    var panel = document.createElement('div');
    panel.className = 'picdic-popup-panel' + (panelClassName ? ' ' + panelClassName : '');
    var titleRow = document.createElement('div');
    titleRow.className = 'picdic-popup-title-row';
    var titleEl = document.createElement('h3');
    titleEl.className = 'picdic-popup-title';
    titleEl.textContent = title;
    titleRow.appendChild(titleEl);
    var actionsContainer = document.createElement('div');
    actionsContainer.className = 'picdic-popup-title-actions';
    if (actions) {
        if (Array.isArray(actions)) {
            actions.forEach(function(btn) {
                actionsContainer.appendChild(btn);
            });
        } else if (actions.nodeType === 1) {
            actionsContainer.appendChild(actions);
        }
    }
    var closeBtn = document.createElement('button');
    closeBtn.className = 'picdic-popup-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        closePopup();
    });
    actionsContainer.appendChild(closeBtn);
    titleRow.appendChild(actionsContainer);
    panel.appendChild(titleRow);
    var contentContainer = document.createElement('div');
    contentContainer.className = 'picdic-popup-content';
    panel.appendChild(contentContainer);
    contentContainer.style.display = 'block';
    if (contentCallback) {
        contentCallback(contentContainer);
    }
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    function closePopup() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (closeCallback) closeCallback();
    }
    return {
        overlay: overlay,
        panel: panel,
        contentContainer: contentContainer,
        close: closePopup
    };
}

function showConfirm(title, message, onConfirm, onCancel) {
    var popup = createPopup(
        title || '确认',
        'picdic-confirm-dialog',
        function(content) {
            content.className += ' picdic-confirm-content';
            var msgDiv = document.createElement('div');
            msgDiv.textContent = message || '确定继续吗？';
            content.appendChild(msgDiv);
            var btnContainer = document.createElement('div');
            btnContainer.className = 'btn-container';
            var confirmBtn = document.createElement('button');
            confirmBtn.textContent = '确定';
            confirmBtn.className = 'picdic-confirm-btn';
            confirmBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                popup.close();
                if (typeof onConfirm === 'function') {
                    onConfirm();
                }
            });
            btnContainer.appendChild(confirmBtn);
            var cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.className = 'picdic-cancel-btn';
            cancelBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                popup.close();
                if (typeof onCancel === 'function') {
                    onCancel();
                }
            });
            btnContainer.appendChild(cancelBtn);
            content.appendChild(btnContainer);
        },
        null,
        function() {}
    );
    return popup;
}

// ==================== 应用配置 ====================
function applyConfig() {
    // 从 configManager 读取最新配置
    if (!state.configManager) {
        // 可能还未初始化，使用 state.config 后备
        var globalCfg = state.config.globalConfig;
        var dictCfg = state.config.dictConfig;
    } else {
        var globalCfg = state.configManager.store.data.globalConfig;
        var dictCfg = state.configManager.store.data.dictConfig;
        // 同步到 state.config（兼容旧代码）
        state.config.globalConfig = globalCfg;
        state.config.dictConfig = dictCfg;
        state.config.allDictConfigs = state.configManager.store.data.allDictConfigs;
    }

    state.ui.debugDiv.style.display = globalCfg.DebugPanel_display ? 'block' : 'none';
    if (globalCfg.DebugPanel_display) {
        injectExportButton();
        if (state.ui.logContainer && state.ui.logLines.length > 0) {
            state.ui.logContainer.innerHTML = state.ui.logLines.join('<br>');
        }
    }
    if (state.ui._applyConfigPending) return;
    state.ui._applyConfigPending = true;
    requestAnimationFrame(function() {
        state.ui._applyConfigPending = false;
        if (globalCfg.darkModeFollowApp) {
            globalCfg.darkMode = isAppInDarkMode();
        }
        var currentDarkMode = globalCfg.darkMode;
        if (state.misc.lastDarkMode !== currentDarkMode) {
            state.misc.lastDarkMode = currentDarkMode;
            debugLog('🔄 暗色模式变化，刷新显示');
            setTimeout(function() {
		    debugLog('🔥 applyConfig 暗色模式延迟任务执行');
		    if (!window._picdic_initialSearchDone && state.ui.searchInput && state.ui.searchInput.value.trim()) {
		        debugLog('🔥 暗色模式延迟调用 performSearch');
		        performSearch();
		    } else if (state.ui.pageNum) {
		        displayPage(state.ui.pageNum);
		    }
		}, 100);
        }
        document.body.classList.toggle('dark-mode', globalCfg.darkMode);
        if (!state.ui._cachedContainer) {
            state.ui._cachedContainer = document.querySelector('.PIC_DIC');
        }
        var container = state.ui._cachedContainer;
        if (container) {
            container.classList.toggle('dark-mode', globalCfg.darkMode);
        }
        if (state.interaction.img) {
            if (globalCfg.darkMode) {
                state.interaction.img.style.filter = globalCfg.darkModeFilter;
                if (state.interaction.wrapper) {
                    state.interaction.wrapper.style.backgroundColor = globalCfg.darkModeBgColor || '#1a1a1a';
                }
            } else {
                state.interaction.img.style.filter = 'none';
                if (state.interaction.wrapper) {
                    state.interaction.wrapper.style.backgroundColor = globalCfg.lightModeBgColor || '#ffffff';
                }
            }
        }
        if (dictCfg.showTopNav !== state.navigation._lastShowTopNav) {
            state.navigation._lastShowTopNav = dictCfg.showTopNav;
            updateTopNav();
        }
        if (state.interaction.hotZones.container) {
            updateHotZones();
        }
        if (state.ui.btnContainer) {
            if (state.interaction.scale > 1 && globalCfg.showZoomButtons) {
                state.ui.btnContainer.style.display = 'flex';
            } else {
                state.ui.btnContainer.style.display = 'none';
            }
        }
        // 控制底部信息栏：放大时隐藏，正常时显示
        if (state.ui.footerElement) {
	    var isDark = state.config.globalConfig.darkMode;
	    var bgColor = isDark ? 
	        state.config.globalConfig.darkModeBgColor : 
	        state.config.globalConfig.lightModeBgColor;
	    var textColor = isDark ? '#cccccc' : '#666666';
	    var borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
	    state.ui.footerElement.style.backgroundColor = bgColor;
	    state.ui.footerElement.style.color = textColor;
	    state.ui.footerElement.style.borderTopColor = borderColor;
	    // 控制显示/隐藏
	    state.ui.footerElement.style.display = (state.interaction.scale > 1.01) ? 'none' : 'block';
	}
        if (!state.ui._cachedNavSpans) {
            state.ui._cachedNavSpans = document.querySelectorAll('.page-nav span');
        }
        var navSpans = state.ui._cachedNavSpans;
        if (navSpans.length > 0 && state.ui.pageNum) {
            for (var i = 0; i < navSpans.length; i++) {
                var span = navSpans[i];
                var page = span.getAttribute('data-page');
                span.classList.toggle('current', page === state.ui.pageNum);
            }
        }
        debugLog('配置已应用 | 全局: ' + '省略...' + ' | 词典: ' + JSON.stringify(dictCfg));
        
        if (state.ui.pageNum && state.interaction.wrapper && state.cache._hasPagePositions) {
	    drawWordAnnotations(state.ui.pageNum);
	}

        updateConfigPanelIfVisible();
        if (_initialExternalWord) return;
        applyHideDictTitles();
    });
}

// ==================== 顶部导航 ====================
function updateTopNav() {
    if (!state.interaction.container) return;
    var existing = state.interaction.container.querySelector('.picdic-top-nav');
    if (state.config.dictConfig.showTopNav) {
        if (!existing && state.cache.dictionaryIndex && state.cache.dictionaryIndex.special) {
            var topNav = document.createElement('div');
            topNav.className = 'picdic-top-nav';
            var special = state.cache.dictionaryIndex.special;
            var keys = Object.keys(special);
            keys.sort(function(a, b) {
                var aIsNum = /^\d+$/.test(a);
                var bIsNum = /^\d+$/.test(b);
                if (aIsNum && !bIsNum) return 1;
                if (!aIsNum && bIsNum) return -1;
                return a.localeCompare(b);
            });
            var links = [];
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                links.push('<a href="#" data-page="'+key+'">'+special[key]+'</a>');
            }
            topNav.innerHTML = links.join('|');
            topNav.querySelectorAll('a[data-page]').forEach(function(a) {
                a.addEventListener('click', function(e) {
                    e.preventDefault();
                    displayPage(this.getAttribute('data-page'));
                });
            });
            if (state.interaction.wrapper) {
                state.interaction.container.insertBefore(topNav, state.interaction.wrapper);
            } else {
                state.interaction.container.appendChild(topNav);
            }
            state.ui.topNavElement = topNav;
        }
    } else {
        if (existing) {
            existing.remove();
            state.ui.topNavElement = null;
        }
    }
}

// ==================== 统计页数信息 ====================
function updatePagesInfo(dictId) {
    if (!state.cache.dictionaryIndex) return;
    var pages = state.cache.dictionaryIndex.pages || [];
    var bodyCount = 0;
    var numericWidth = 0;
    for (var i = 0; i < pages.length; i++) {
        var page = String(pages[i]);
        if (page.indexOf('_') === -1) bodyCount++;
        if (/^\d+$/.test(page) && page.length > numericWidth) {
            numericWidth = page.length;
        }
    }
    if (!state.configStore.data.allDictConfigs[dictId]) {
        state.configStore.data.allDictConfigs[dictId] = {};
    }
    state.configStore.data.allDictConfigs[dictId]._pagesInfo = {
        total: pages.length,
        body: bodyCount,
        numericWidth: numericWidth
    };
}

// ==================== 加载索引和配置 ====================

function loadIndexAndConfigSync(dictId, indexPath, configPath) {
    return new Promise(function(resolve, reject) {
        debugLog('📥 loadIndexAndConfigSync 开始, dictId=' + dictId + ', indexPath=' + indexPath);
        var indexLoaded = false;
        var configLoaded = false;
        var indexData = null;
        var configData = null;
        var loadError = null;
        var timeoutId = null;
        var timedOut = false;
        var triedAbsolute = false;

        function checkComplete() {
            if (timedOut) return;
            if (indexLoaded && configLoaded) {
                if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
                if (loadError) {
                    debugLog('❌ loadIndexAndConfigSync 完成，但有错误: ' + loadError.message);
                    reject(loadError);
                    return;
                }
                if (indexData) {
                    setActiveDictionaryIndex(dictId, indexData);
                    var dict = window.picdic_dictList[dictId];
                    if (dict && dict.index_language) {
                        state.cache.dictionaryIndex.indexKeyType = dict.index_language;
                    }
                    var searchCache = cacheNormalizedKeys();
                    updatePagesInfo(dictId);
                }
                mergeDictConfig(dictId, configData);
                var cacheData = {
                    indexData: indexData,
                    searchCache: searchCache,
                    dictConfig: JSON.parse(JSON.stringify(state.configStore.data.allDictConfigs[dictId] || {}))
                };
                saveIndexToCache(dictId, cacheData);
                debugLog('✅ loadIndexAndConfigSync 完成，索引 pages 长度=' + (indexData ? indexData.pages.length : 'null'));
                debugLog('📥 缓存索引 pages[0] = ' + state.cache.dictionaryIndex.pages[0]);
                resolve();
            }
        }

        timeoutId = setTimeout(function() {
            timeoutId = null;
            timedOut = true;
            debugLog('❌ 索引加载超时 (5秒): ' + dictId);
            reject(new Error('索引加载超时，请检查文件或重启'));
        }, INDEX_LOAD_TIMEOUT);

        function loadScript(path) {
            debugLog('📥 尝试加载脚本: ' + path);
            var script = document.createElement('script');
            script.id = 'picdic-index-' + dictId;
            script.src = UrlBuilder.getFileUrl(path);
            debugLog('📥 最终脚本 URL: ' + script.src);
            script.onload = function() {
                debugLog('📥 脚本加载成功: ' + script.src);
                indexData = window._dictIndex || null;
                delete window._dictIndex;
                
                if (!indexData) {
                    if (!triedAbsolute && !_env.isGoldenDictAndroid) {
                        triedAbsolute = true;
                        debugLog('🔄 相对路径加载成功但 _dictIndex 未定义，尝试绝对路径: /' + indexPath);
                        loadScript('/' + indexPath);
                        return;
                    } else {
                        loadError = new Error('索引变量未定义: 请确保 _index.js 暴露了 window._dictIndex');
                        debugLog('❌ ' + loadError.message);
                    }
                } else {
                    tagIndexOwner(dictId, indexData);
                    indexData.pageWordPositions = buildPageWordPositions(indexData);
                }
                indexLoaded = true;
                checkComplete();
                script.remove();
            };
            script.onerror = function() {
                debugLog('❌ 脚本加载失败: ' + script.src);
                if (_env.isGoldenDictAndroid && script.src.indexOf('file://') === 0) {
                    debugLog('🔄 GoldenDict 绝对路径失败，尝试原始相对路径: ' + path);
                    var newScript = document.createElement('script');
                    newScript.id = 'picdic-index-' + dictId;
                    newScript.src = path;
                    newScript.onload = script.onload;
                    newScript.onerror = function() {
                        loadError = new Error('索引文件加载失败: ' + path);
                        debugLog('❌ ' + loadError.message);
                        indexLoaded = true;
                        checkComplete();
                        newScript.remove();
                    };
                    document.head.appendChild(newScript);
                    return;
                }
                if (!triedAbsolute && !_env.isGoldenDictAndroid) {
                    triedAbsolute = true;
                    debugLog('🔄 相对路径加载失败，尝试绝对路径: /' + indexPath);
                    loadScript('/' + indexPath);
                    return;
                } else {
                    loadError = new Error('索引文件加载失败: ' + path);
                    debugLog('❌ ' + loadError.message);
                }
                indexLoaded = true;
                checkComplete();
                script.remove();
            };
            document.head.appendChild(script);
        }

        loadScript(indexPath);

        var configScript = document.createElement('script');
        configScript.id = 'picdic-config-' + dictId;
        configScript.src = UrlBuilder.getFileUrl(configPath);
        configScript.onload = function() {
            configData = window._dictConfig_individual || null;
            if (configData) {
                window['_dictConfig_' + dictId] = configData;
                delete window._dictConfig_individual;
            }
            configLoaded = true;
            checkComplete();
            configScript.remove();
        };
        configScript.onerror = function() {
            configData = null;
            configLoaded = true;
            checkComplete();
            configScript.remove();
        };
        document.head.appendChild(configScript);
    });
}

async function loadIndexAndConfig(dictId) {
    debugLog('📥 loadIndexAndConfig 被调用, dictId=' + dictId);
    try {
        var dictList = window.picdic_dictList;
        if (!dictList || typeof dictList !== 'object' || !dictList[dictId]) {
            throw new Error('词典 "' + dictId + '" 不存在或 dictList 未定义');
        }
        var dict = dictList[dictId];
        var indexPath = dict.indexPath;
        var configPath = indexPath.replace('_index.js', '_config.ini');
        debugLog('📥 loadIndexAndConfig: indexPath=' + indexPath);
        var cached = await loadIndexFromCache(dictId);
        debugLog('📥 缓存加载结果: ' + (cached ? '命中' : '未命中'));
        if (cached && cached.indexData) {
            debugLog('✅ 从缓存加载索引和配置: ' + dictId);
            debugLog('📥 缓存数据 pages 长度=' + (cached.indexData.pages ? cached.indexData.pages.length : 'null'));
            setActiveDictionaryIndex(dictId, cached.indexData);

            // schema3 优先恢复持久化的一对多搜索缓存；仅在缺失/损坏时扫描索引重建一次。
            var cachedSearchCacheWasValid = isSearchCacheOwnedBy(dictId, cached.indexData, cached.searchCache);
            var loadedSearchCacheForDict = cacheNormalizedKeys(cached.searchCache);
            var cacheNeedsRefresh = !cachedSearchCacheWasValid;

            // 确保 pageWordPositions 存在
            if (!cached.indexData.pageWordPositions) {
                cached.indexData.pageWordPositions = buildPageWordPositions(cached.indexData);
                state.cache._hasPagePositions = !!(cached.indexData.pageWordPositions &&
                    hasOwnEntries(cached.indexData.pageWordPositions));
                cacheNeedsRefresh = true;
                debugLog('🔄 缓存中缺少 pageWordPositions，已重新生成');
            }
            if (cacheNeedsRefresh) {
                var refreshedCacheData = {
                    indexData: cached.indexData,
                    searchCache: loadedSearchCacheForDict,
                    dictConfig: JSON.parse(JSON.stringify(state.configStore.data.allDictConfigs[dictId] || {}))
                };
                saveIndexToCache(dictId, refreshedCacheData);
                debugLog('🔄 索引派生缓存已更新');
            }

            updatePagesInfo(dictId);
            if (cached.dictConfig) {
                if (!state.configStore.data.allDictConfigs[dictId]) {
                    state.configStore.data.allDictConfigs[dictId] = {};
                }
                for (var k in cached.dictConfig) {
                    if (!(k in state.configStore.data.allDictConfigs[dictId])) {
                        state.configStore.data.allDictConfigs[dictId][k] = cached.dictConfig[k];
                    }
                }
            }
            if (state.configStore.data.allDictConfigs[dictId]) {
                for (var key in DEFAULT_DICT_CONFIG) {
                    if (key in state.configStore.data.allDictConfigs[dictId]) {
                        state.configStore.data.dictConfig[key] = state.configStore.data.allDictConfigs[dictId][key];
                    }
                }
            }
            debugLog('✅ 从缓存加载索引和配置完成: ' + dictId);
            debugLog('📥 当前索引 pages 长度=' + (state.cache.dictionaryIndex ? state.cache.dictionaryIndex.pages.length : 'null'));
            // 旧版本已有大对象缓存但还没有 hot cache 时，在后台补建一次。
            scheduleHotCacheBuild(dictId, cached.indexData);
            // 捕获“该词典自己的索引/搜索缓存”引用，异步回调不得读取可能已切换的全局状态。
            var loadedIndexForDict = cached.indexData;
            var persistentSearchCacheForDict = loadedSearchCacheForDict;
            loadDictConfigJS(configPath, dictId).then(function(newConfig) {
                if (newConfig) {
                    var changed = false;
                    var targetDictConfig = state.configStore.data.allDictConfigs[dictId] || {};
                    for (var key in DEFAULT_DICT_CONFIG) {
                        if (key in newConfig && targetDictConfig[key] !== newConfig[key]) {
                            changed = true;
                            break;
                        }
                    }
                    if (changed) {
                        mergeDictConfig(dictId, newConfig);
                        state.configManager.notifyChange();
                        var cacheData = {
                            indexData: loadedIndexForDict,
                            searchCache: persistentSearchCacheForDict,
                            dictConfig: JSON.parse(JSON.stringify(state.configStore.data.allDictConfigs[dictId]))
                        };
                        saveIndexToCache(dictId, cacheData);
                        debugLog('🔄 配置已更新（后台加载）: ' + dictId);
                        if (state.ui.currentDictId === dictId) {
                            applyConfig();
                        }
                    }
                }
                discoverResource(dictId, 'icon', function() {});
                discoverResource(dictId, 'cover', function() {});
            }).catch(function(err) {
                debugLog('⚠️ 后台加载词典配置文件失败（缓存仍可用）: ' + (err ? err.message : err));
            });
            if (state.ui.resultDiv) state.ui.resultDiv.innerHTML = '';
            return;
        }
        debugLog('📥 缓存未命中，执行同步加载...');
        if (state.ui.resultDiv) {
            state.ui.resultDiv.innerHTML = '⏳ 正在加载词典索引，请稍候...';
        }
        await loadIndexAndConfigSync(dictId, indexPath, configPath);
        // loadIndexAndConfigSync 已构建并应用搜索缓存，不再重复全量遍历索引。
        debugLog('📥 同步加载完成，索引 pages 长度=' + (state.cache.dictionaryIndex ? state.cache.dictionaryIndex.pages.length : 'null'));
        if (state.ui.resultDiv) state.ui.resultDiv.innerHTML = '';
    } catch (err) {
        debugLog('❌ 加载索引失败: ' + err.message);
        if (state.ui.resultDiv) {
            state.ui.resultDiv.innerHTML = '⚠️ 加载失败: ' + err.message;
        }
        throw err;
    }
}

// ==================== 一对多规范化搜索缓存 ====================
var SEARCH_CACHE_SCHEMA = 1;

function hasOwnKey(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function firstOwnKey(obj) {
    if (!obj) return null;
    for (var key in obj) {
        if (hasOwnKey(obj, key)) return key;
    }
    return null;
}

function hasOwnEntries(obj) {
    return firstOwnKey(obj) !== null;
}

function compareNormalizedKeys(a, b) {
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function isSearchCacheOwnedBy(dictId, indexData, searchCache) {
    if (!searchCache || typeof searchCache !== 'object' || !indexData) return false;
    var dict = window.picdic_dictList && window.picdic_dictList[dictId];
    var expectedPath = dict && dict.indexPath ? dict.indexPath : '';
    return searchCache.schema === SEARCH_CACHE_SCHEMA &&
           searchCache.dictId === dictId &&
           searchCache.indexPath === expectedPath &&
           Array.isArray(searchCache.normalizedKeys) &&
           Array.isArray(searchCache.representativeKeys) &&
           searchCache.keyMap && typeof searchCache.keyMap === 'object' &&
           typeof searchCache.rawKeyCount === 'number' &&
           indexData._picdicWordKeyCount === searchCache.rawKeyCount;
}

function buildSearchCacheData(dictId, indexData) {
    if (!indexData || !indexData.wordToPages) {
        throw new Error('无法构建搜索缓存：索引缺少 wordToPages');
    }
    var dict = window.picdic_dictList && window.picdic_dictList[dictId];
    var indexPath = dict && dict.indexPath ? dict.indexPath : '';
    var rawKeys = Object.keys(indexData.wordToPages); // 仅在首次构建时执行一次
    var keyMap = {};
    var normalizedKeys = [];
    var previousNorm = null;
    var alreadySorted = true;

    for (var i = 0; i < rawKeys.length; i++) {
        var originalKey = rawKeys[i];
        var normKey = normalize(originalKey);
        if (!hasOwnKey(keyMap, normKey)) {
            keyMap[normKey] = [];
            normalizedKeys.push(normKey);
            if (previousNorm !== null && compareNormalizedKeys(previousNorm, normKey) > 0) {
                alreadySorted = false;
            }
            previousNorm = normKey;
        }
        keyMap[normKey].push(originalKey);
    }

    // 正常的索引本身已有序；只有检测到乱序时才排序一次。
    if (!alreadySorted) {
        normalizedKeys.sort(compareNormalizedKeys);
    }
    var representativeKeys = new Array(normalizedKeys.length);
    for (var j = 0; j < normalizedKeys.length; j++) {
        representativeKeys[j] = keyMap[normalizedKeys[j]][0];
    }

    indexData._picdicWordKeyCount = rawKeys.length;
    return {
        schema: SEARCH_CACHE_SCHEMA,
        dictId: dictId,
        indexPath: indexPath,
        rawKeyCount: rawKeys.length,
        normalizedKeys: normalizedKeys,
        representativeKeys: representativeKeys,
        keyMap: keyMap
    };
}

function getCurrentSearchCacheData(dictId) {
    if (!state.cache._searchCacheReady || state.cache._searchCacheDictId !== dictId) return null;
    return {
        schema: SEARCH_CACHE_SCHEMA,
        dictId: state.cache._searchCacheDictId,
        indexPath: state.cache._searchCacheIndexPath,
        rawKeyCount: state.cache._searchCacheRawKeyCount,
        normalizedKeys: state.cache._normalizedKeys,
        representativeKeys: state.cache._sortedKeys,
        keyMap: state.cache._keyMap
    };
}

function applySearchCache(dictId, indexData, searchCache) {
    if (!isSearchCacheOwnedBy(dictId, indexData, searchCache)) {
        throw new Error('搜索缓存归属或结构校验失败: ' + dictId);
    }
    state.cache._normalizedKeys = searchCache.normalizedKeys;
    state.cache._sortedKeys = searchCache.representativeKeys;
    state.cache._keyMap = searchCache.keyMap;
    state.cache._searchCacheReady = true;
    state.cache._searchCacheDictId = dictId;
    state.cache._searchCacheIndexPath = searchCache.indexPath;
    state.cache._searchCacheRawKeyCount = searchCache.rawKeyCount;
    state.cache._hasPagePositions = !!(indexData.pageWordPositions &&
        hasOwnEntries(indexData.pageWordPositions));
    return searchCache;
}

function ensureSearchCacheForData(dictId, indexData, searchCache) {
    if (isSearchCacheOwnedBy(dictId, indexData, searchCache)) {
        return searchCache;
    }
    var current = getCurrentSearchCacheData(dictId);
    if (isSearchCacheOwnedBy(dictId, indexData, current)) {
        return current;
    }
    return buildSearchCacheData(dictId, indexData);
}

function cacheNormalizedKeys(searchCache) {
    if (!state.cache.dictionaryIndex || !state.ui.currentDictId) return null;
    var dictId = state.ui.currentDictId;
    var indexData = state.cache.dictionaryIndex;
    var prepared = ensureSearchCacheForData(dictId, indexData, searchCache);
    applySearchCache(dictId, indexData, prepared);
    debugLog('✅ 搜索缓存就绪: 原始键=' + prepared.rawKeyCount +
        '，规范化键=' + prepared.normalizedKeys.length);
    return prepared;
}

function clearCurrentSearchMatchMetadata() {
    state.misc._currentSearchNormalized = '';
    state.misc._currentSearchKeys = [];
    state.misc._currentSearchOrd = null;
    state.misc._currentSearchOrds = [];
    state.misc._currentSearchOrdMap = null;
    state.misc._currentSearchPageOrdMap = null;
}

function resetCurrentSearchState() {
    state.misc._currentSearchWord = '';
    clearCurrentSearchMatchMetadata();
}

function addEntryOrds(entry, ords, ordMap, pageOrdMap) {
    if (!Array.isArray(entry)) return;
    for (var i = 0; i < entry.length; i++) {
        var item = entry[i];
        if (!item || typeof item !== 'object' || item.ord === undefined || item.ord === null) continue;
        var ordKey = String(item.ord);

        // 保留全局集合仅用于兼容旧字段和调试，不再直接用于高亮。
        if (!hasOwnKey(ordMap, ordKey)) {
            ordMap[ordKey] = true;
            ords.push(item.ord);
        }

        // ord 在 FAREAST 等索引中可能按页重复，必须绑定页码后才能唯一定位。
        if (item.pg !== undefined && item.pg !== null && item.pg !== '') {
            var pageKey = String(item.pg);
            if (!hasOwnKey(pageOrdMap, pageKey)) {
                pageOrdMap[pageKey] = {};
            }
            pageOrdMap[pageKey][ordKey] = true;
        }
    }
}

function comparePageIds(a, b) {
    var na = parseInt(a, 10);
    var nb = parseInt(b, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// ==================== 获取默认页面 ====================
function getDefaultPage() {
    if (!state.cache.dictionaryIndex || !state.ui.currentDictId) return null;
    var pages = state.cache.dictionaryIndex.pages;
    var wordToPages = state.cache.dictionaryIndex.wordToPages;
    var special = state.cache.dictionaryIndex.special || {};
    var firstContentPage = null;
    var firstKey = firstOwnKey(wordToPages);
    if (firstKey !== null) {
        var firstPages = getPagesForWord(wordToPages, firstKey);
        if (firstPages && firstPages.length > 0) firstContentPage = firstPages[0];
    }
    if (!firstContentPage && pages.length > 0) firstContentPage = pages[0];

    var pageType = state.config.globalConfig.defaultPageValue || DEFAULT_PAGE_TYPES.FIRST_CONTENT;
    if (pageType === DEFAULT_PAGE_TYPES.COVER) {
        var dictConfig = state.configStore.data.allDictConfigs[state.ui.currentDictId];
        if (dictConfig && dictConfig._cachedCover) return EXTERNAL_COVER;
        if (special.cover) return 'cover';
        if (special._cover) return '_cover';
        for (var key in special) {
            if (!hasOwnKey(special, key)) continue;
            var value = special[key];
            if (value && (value.toLowerCase().indexOf('cover') !== -1 || value.indexOf('封面') !== -1)) {
                return key;
            }
        }
        return firstOwnKey(special) || firstContentPage;
    }
    if (pageType === DEFAULT_PAGE_TYPES.LAST_WORD) {
        var history = state.historyStore ? state.historyStore.getAll() : [];
        for (var i = 0; i < history.length; i++) {
            if (history[i].dictId === state.ui.currentDictId) {
                return history[i].word ? { type: 'search', word: history[i].word } : firstContentPage;
            }
        }
    }
    return firstContentPage;
}

// ==================== 视图变换与约束 ====================
function constrainTransform() {
    if (!state.interaction.img || state.interaction.scale <= 1) return;
    var wrapperRect = state.interaction.wrapper.getBoundingClientRect();
    var imgRect = state.interaction.img.getBoundingClientRect();
    var containerW = wrapperRect.width;
    var containerH = wrapperRect.height;
    var imgW = imgRect.width;
    var imgH = imgRect.height;
    var availableHeight = Math.min(containerH, window.innerHeight - wrapperRect.top);
    var effectiveHeight = Math.max(0, availableHeight - BOTTOM_SAFE_MARGIN);
    var minX, maxX, minY, maxY;
    if (imgW <= containerW) {
        minX = 0;
        maxX = containerW - imgW;
    } else {
        minX = -(imgW - containerW);
        maxX = 0;
    }
    if (imgH <= effectiveHeight) {
        minY = 0;
        maxY = effectiveHeight - imgH;
    } else {
        minY = -(imgH - effectiveHeight);
        maxY = 0;
    }
    if (state.interaction.translateX < minX) state.interaction.translateX = minX;
    if (state.interaction.translateX > maxX) state.interaction.translateX = maxX;
    if (state.interaction.translateY < minY) state.interaction.translateY = minY;
    if (state.interaction.translateY > maxY) state.interaction.translateY = maxY;
    state.interaction.img.style.transform = 'translate(' + state.interaction.translateX + 'px, ' + state.interaction.translateY + 'px) scale(' + state.interaction.scale + ')';
}

function resetView() {
    state.interaction.scale = 1;
    state.interaction.translateX = 0;
    state.interaction.translateY = 0;
    updateTransform();
    applyConfig();
}


// ==================== V7.3 统一横向列定位 ====================
// 统一 source of truth：
// 1) 左/右裁剪 -> effective horizontal range
// 2) x -> col
// 3) col -> viewport translate delta（首列左对齐、末列右对齐、中间列左边界对齐）
// 外部查询、双击/长按、列导航均复用这套逻辑。

function getEffectiveHorizontalGeometry(columns) {
    if (!state.interaction.img || !state.interaction.wrapper) return null;

    var imgRect = state.interaction.img.getBoundingClientRect();
    var wrapperRect = state.interaction.wrapper.getBoundingClientRect();
    if (!imgRect.width || !wrapperRect.width) return null;

    columns = parseInt(columns, 10);
    if (!columns || columns < 1) {
        columns = Math.round(parseFloat(state.config.dictConfig.doubleTapZoomFactor) || 1);
        if (columns < 1) columns = 1;
    }

    var cropLeftNatural = parseFloat(state.config.dictConfig.externalCropLeft) || 0;
    var cropRightNatural = parseFloat(state.config.dictConfig.externalCropRight) || 0;
    if (cropLeftNatural < 0) cropLeftNatural = 0;
    if (cropRightNatural < 0) cropRightNatural = 0;

    var imgLeft = imgRect.left - wrapperRect.left;
    var effectiveLeft = imgLeft;
    var effectiveWidth = imgRect.width;

    var naturalWidth = state.interaction.img.naturalWidth || 0;
    if (naturalWidth > 0 &&
        cropLeftNatural + cropRightNatural < naturalWidth) {

        var renderedPerNaturalPx = imgRect.width / naturalWidth;
        var cropLeftRendered = cropLeftNatural * renderedPerNaturalPx;
        var cropRightRendered = cropRightNatural * renderedPerNaturalPx;
        var croppedWidth = imgRect.width - cropLeftRendered - cropRightRendered;

        if (croppedWidth > 1) {
            effectiveLeft = imgLeft + cropLeftRendered;
            effectiveWidth = croppedWidth;
        }
    }

    return {
        imgRect: imgRect,
        wrapperRect: wrapperRect,
        imgLeft: imgLeft,
        effectiveLeft: effectiveLeft,
        effectiveWidth: effectiveWidth,
        columnWidth: effectiveWidth / columns,
        columns: columns,
        cropLeftNatural: cropLeftNatural,
        cropRightNatural: cropRightNatural
    };
}

function clampHorizontalColumn(col, columns) {
    columns = parseInt(columns, 10) || 1;
    col = parseInt(col, 10);
    if (!isFinite(col)) col = 0;
    if (col < 0) col = 0;
    if (col >= columns) col = columns - 1;
    return col;
}

function getColumnFromWrapperX(wrapperX, columns) {
    var g = getEffectiveHorizontalGeometry(columns);
    if (!g || !g.columnWidth) return 0;

    var col = Math.floor((wrapperX - g.effectiveLeft) / g.columnWidth);
    return clampHorizontalColumn(col, g.columns);
}

function getCurrentHorizontalColumn(columns) {
    var g = getEffectiveHorizontalGeometry(columns);
    if (!g || !g.columnWidth) return 0;

    // 手动拖动后仍能正确识别当前视口主要落在哪一列：
    // 使用视口中心点判断，而不是依赖旧 translateX 数学假设。
    var viewCenterX = g.wrapperRect.width / 2;
    var col = Math.floor((viewCenterX - g.effectiveLeft) / g.columnWidth);
    return clampHorizontalColumn(col, g.columns);
}

function getColumnHorizontalDelta(col, columns) {
    var g = getEffectiveHorizontalGeometry(columns);
    if (!g || !g.columnWidth) return 0;

    col = clampHorizontalColumn(col, g.columns);

    var marginPercent = parseFloat(state.config.dictConfig.horizontalMarginPercent) || 0;
    if (marginPercent < 0) marginPercent = 0;
    if (marginPercent > 25) marginPercent = 25;

    // 安全边距属于 viewport 视觉留白，因此使用当前 viewport 宽度的百分比。
    var marginPx = g.wrapperRect.width * marginPercent / 100;

    // 单列时：优先左侧有效边缘对齐左侧 margin。
    if (g.columns <= 1) {
        return marginPx - g.effectiveLeft;
    }

    // 最左列：有效内容左边缘严格对齐左侧 margin。
    if (col === 0) {
        return marginPx - g.effectiveLeft;
    }

    // 最右列：有效内容右边缘严格对齐右侧 margin。
    if (col === g.columns - 1) {
        var effectiveRight = g.effectiveLeft + g.effectiveWidth;
        var desiredRight = g.wrapperRect.width - marginPx;
        return desiredRight - effectiveRight;
    }

    // 中间列：该列左边界对齐左侧 margin。
    var targetLeft = g.effectiveLeft + col * g.columnWidth;
    return marginPx - targetLeft;
}

function applyColumnHorizontalPosition(col, columns) {
    if (!state.interaction.img || !state.interaction.wrapper) return false;

    var deltaX = getColumnHorizontalDelta(col, columns);
    if (!isFinite(deltaX)) return false;

    state.interaction.translateX += deltaX;
    updateTransform();
    return true;
}

function scheduleColumnHorizontalPosition(col, columns) {
    var seq = (state.misc._horizontalColumnSeq || 0) + 1;
    state.misc._horizontalColumnSeq = seq;

    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            if (state.misc._horizontalColumnSeq !== seq) return;
            if (!state.interaction.img || !state.interaction.wrapper ||
                state.interaction.scale <= 1.01) return;

            applyColumnHorizontalPosition(col, columns);
        });
    });
}

function toggleZoom(cx, cy) {
    if (cx === undefined || cy === undefined) {
        var rect = state.interaction.wrapper.getBoundingClientRect();
        cx = rect.width / 2;
        cy = rect.height / 2;
    }

    var zoomFactor = state.config.dictConfig.doubleTapZoomFactor;
    var newScale;

    if (state.interaction.scale > 1.01) {
        newScale = 1;
        state.misc._horizontalColumnSeq = (state.misc._horizontalColumnSeq || 0) + 1;
        state.interaction.translateX = 0;
        state.interaction.translateY = 0;
        setWrapperHeight(false);
    } else {
        newScale = zoomFactor;

        var rect = state.interaction.wrapper.getBoundingClientRect();
        var containerWidth = rect.width;
        var containerHeight = rect.height;

        var naturalW = state.interaction.img.naturalWidth;
        var naturalH = state.interaction.img.naturalHeight;
        if (naturalW === 0) naturalW = state.interaction.img.width || 1;
        if (naturalH === 0) naturalH = state.interaction.img.height || 1;

        var aspect = naturalW / naturalH;
        var baseWidth = containerWidth;
        var baseHeight = containerWidth / aspect;
        var scaledHeight = baseHeight * newScale;

        // V7.3：点击 x 不再直接作为缩放中心。
        // 先在“左右裁剪后的有效区域”判断点击属于哪一列，
        // 再由统一 col -> viewport 算法决定最终横向位置。
        var columns = Math.round(zoomFactor);
        if (columns < 1) columns = 1;
        var clickCol = getColumnFromWrapperX(cx, columns);

        // 纵向逻辑保持原版完全不变。
        var py = cy / containerHeight;
        var targetY = containerHeight / 2 - py * scaledHeight;

        // 横向先归零，待 scale/layout 落地后用真实 rect 做统一列定位。
        state.interaction.translateX = 0;
        state.interaction.translateY = targetY;

        setWrapperHeight(true);

        state.interaction.scale = newScale;
        updateTransform();
        applyConfig();

        scheduleColumnHorizontalPosition(clickCol, columns);
        return;
    }

    state.interaction.scale = newScale;
    updateTransform();
    applyConfig();
}

// 新增辅助函数
/**
 * 设置 wrapper 高度，以填充屏幕可用空间（放大时）或恢复默认（缩小时）
 * @param {boolean} expand - true 表示扩展高度，false 表示恢复默认
 */
function setWrapperHeight(expand) {
    if (!state.interaction.wrapper) return;
    // 检查配置开关（默认开启）
    if (!state.config.globalConfig.enableExpandOnZoom) {
        state.interaction.wrapper.style.height = '100%';
        state.layout.isExpanded = false;
        return;
    }

    if (expand) {
        // 计算可用高度：窗口高度 - 顶部工具栏高度 - 底部安全边距
        var toolbar = document.querySelector('.picdic-toolbar-wrapper');
        var toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
        var margin = 10;
        var availableHeight = window.innerHeight - toolbarHeight - margin;
        // 保证最小高度，避免过小
        if (availableHeight < 200) availableHeight = 200;
        state.interaction.wrapper.style.height = availableHeight + 'px';
        state.layout.isExpanded = true;
        state.layout.expandedHeight = availableHeight;
    } else {
        // 恢复原始高度
        state.interaction.wrapper.style.height = '100%';
        state.layout.isExpanded = false;
    }

    // 立即更新缓存，确保后续约束计算准确
    if (state.interaction.wrapper) {
        state.layout.wrapperRect = state.interaction.wrapper.getBoundingClientRect();
        state.layout.containerHeight = state.layout.wrapperRect.height;
    }
}


function getCurrentCol() {
    if (!state.interaction.img) return 0;

    var zoomFactor = state.config.dictConfig.doubleTapZoomFactor;
    var N = Math.round(zoomFactor);
    if (N < 1) N = 1;

    return getCurrentHorizontalColumn(N);
}

function goToCol(targetCol) {
    if (!state.interaction.img) return;

    var zoomFactor = state.config.dictConfig.doubleTapZoomFactor;
    var N = Math.round(zoomFactor);
    if (N < 1) N = 1;
    if (targetCol < 0 || targetCol >= N) return;

    var imgRect = state.interaction.img.getBoundingClientRect();
    var containerHeight = state.interaction.wrapper.getBoundingClientRect().height;
    if (!imgRect.width || !containerHeight) return;

    var currentCol = getCurrentCol();
    var imgHeight = imgRect.height;
    var newTranslateY = state.interaction.translateY;

    if (targetCol < currentCol) {
        newTranslateY = containerHeight - imgHeight - BOTTOM_SAFE_MARGIN;
    } else if (targetCol > currentCol) {
        newTranslateY = 0;
    }

    state.interaction.translateY = newTranslateY;

    // V7.3：与外部查询、双击/长按完全共用 col -> viewport。
    var deltaX = getColumnHorizontalDelta(targetCol, N);
    state.interaction.translateX += deltaX;

    updateTransform();
}

function handleTopHotZone() {
    var currentCol = getCurrentCol();
    if (currentCol === 0) {
        var prev = getAdjacentPage(state.ui.pageNum, -1);
        if (prev) displayPage(prev, true, -1);
        return;
    }
    goToCol(currentCol - 1);
}

function handleBottomHotZone() {
    var zoomFactor = state.config.dictConfig.doubleTapZoomFactor;
    var N = Math.round(zoomFactor);
    if (N < 1) N = 1;
    var currentCol = getCurrentCol();
    if (currentCol === N - 1) {
        var next = getAdjacentPage(state.ui.pageNum, 1);
        if (next) displayPage(next, true, 1);
        return;
    }
    goToCol(currentCol + 1);
}

var _hotZonesRafId = null;
function updateHotZones() {
    if (_hotZonesRafId !== null) return;
    _hotZonesRafId = requestAnimationFrame(function() {
        _hotZonesRafId = null;
        var top = state.interaction.hotZones.top;
        var bottom = state.interaction.hotZones.bottom;
        var left = state.interaction.hotZones.left;
        var right = state.interaction.hotZones.right;
        if (!top) return;

        var isZoomed = (state.interaction.scale > 1);
        var N = Math.round(state.config.dictConfig.doubleTapZoomFactor);
        var currentCol = getCurrentCol();
        var lastCol = N - 1;
        var prev = isZoomed ? getAdjacentPage(state.ui.pageNum, -1) : null;
        var next = isZoomed ? getAdjacentPage(state.ui.pageNum, 1) : null;

        var stateChanged = false;
        if (state.misc._lastHotZoneState.scale !== state.interaction.scale ||
            state.misc._lastHotZoneState.pageNum !== state.ui.pageNum ||
            state.misc._lastHotZoneState.currentCol !== currentCol ||
            state.misc._lastHotZoneState.totalCols !== N) {
            stateChanged = true;
        }
        if (!stateChanged) {
            return;
        }
        state.misc._lastHotZoneState.scale = state.interaction.scale;
        state.misc._lastHotZoneState.pageNum = state.ui.pageNum;
        state.misc._lastHotZoneState.currentCol = currentCol;
        state.misc._lastHotZoneState.totalCols = N;

        var showColumnZones = isZoomed && (N > 1);
        if (!showColumnZones) {
            top.style.display = 'none';
            bottom.style.display = 'none';
        } else {
            top.style.display = 'flex';
            bottom.style.display = 'flex';
            top.style.color = (currentCol === 0) ? 'rgba(76, 175, 80, 0.5)' : 'rgba(255,0,0,0.6)';
            bottom.style.color = (currentCol === lastCol) ? 'rgba(76, 175, 80, 0.5)' : 'rgba(255,0,0,0.6)';
            top.textContent = (currentCol === 0) ? '◀' : '▲';
            bottom.textContent = (currentCol === lastCol) ? '▶' : '▼';
        }
        if (isZoomed) {
            left.style.display = 'flex';
            right.style.display = 'flex';
            left.style.opacity = prev ? '0.65' : '0.25';
            right.style.opacity = next ? '0.65' : '0.25';
            left.classList.toggle('disabled', !prev);
            right.classList.toggle('disabled', !next);
        } else {
            left.style.display = 'none';
            right.style.display = 'none';
        }
        if (bottom && state.interaction.wrapper) {
            var wrapperRect = state.interaction.wrapper.getBoundingClientRect();
            var bottomSpace = window.innerHeight - wrapperRect.bottom;
            var offset = Math.max(0, BOTTOM_SAFE_MARGIN - bottomSpace);
            bottom.style.bottom = offset + 'px';
        }
    });
}

function createHotZones() {
    if (!state.interaction.wrapper) return;
    if (state.interaction.hotZones.container) {
        state.interaction.hotZones.container.remove();
        state.interaction.hotZones.container = null;
        state.interaction.hotZones.top = null;
        state.interaction.hotZones.bottom = null;
        state.interaction.hotZones.left = null;
        state.interaction.hotZones.right = null;
    }
    var container = document.createElement('div');
    container.className = 'picdic-hot-zone-container';
    state.interaction.wrapper.appendChild(container);
    state.interaction.hotZones.container = container;

    var top = document.createElement('div');
    top.className = 'picdic-hot-zone picdic-hot-zone-top';
    top.textContent = '▲';
    top.title = '上一栏';
    top.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        if (this.disabled) return;
        handleTopHotZone();
    });
    container.appendChild(top);
    state.interaction.hotZones.top = top;

    var bottom = document.createElement('div');
    bottom.className = 'picdic-hot-zone picdic-hot-zone-bottom';
    bottom.textContent = '▼';
    bottom.title = '下一栏';
    bottom.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        if (this.disabled) return;
        handleBottomHotZone();
    });
    container.appendChild(bottom);
    state.interaction.hotZones.bottom = bottom;

    var left = document.createElement('div');
    left.className = 'picdic-hot-zone picdic-hot-zone-left';
    left.textContent = '◀';
    left.title = '上一页（保持缩放）';
    left.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        if (this.classList.contains('disabled')) return;
        var prev = getAdjacentPage(state.ui.pageNum, -1);
        if (prev) displayPage(prev, true, -1);
    });
    container.appendChild(left);
    state.interaction.hotZones.left = left;

    var right = document.createElement('div');
    right.className = 'picdic-hot-zone picdic-hot-zone-right';
    right.textContent = '▶';
    right.title = '下一页（保持缩放）';
    right.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        if (this.classList.contains('disabled')) return;
        var next = getAdjacentPage(state.ui.pageNum, 1);
        if (next) displayPage(next, true, 1);
    });
    container.appendChild(right);
    state.interaction.hotZones.right = right;

    updateHotZones();
}

// ==================== 图片加载完成处理 ====================
function applyLoadedImage(page, direction, keepScale, callback, startTime) {
    var loadTime = (performance.now() - startTime).toFixed(0);
    debugLog('⏱️ 图片加载完成: page=' + page + ', 耗时=' + loadTime + 'ms');
    debugLog('📄 img naturalWidth=' + state.interaction.img.naturalWidth + ', naturalHeight=' + state.interaction.img.naturalHeight);
    state.ui.pageNum = page;
    if (!keepScale) {
        state.interaction.scale = 1;
        state.interaction.translateX = 0;
        state.interaction.translateY = 0;
    } else {
        var containerRect = state.interaction.wrapper.getBoundingClientRect();
        var containerWidth = containerRect.width;
        var containerHeight = containerRect.height;
        var imgNaturalWidth = state.interaction.img.naturalWidth;
        var imgNaturalHeight = state.interaction.img.naturalHeight;
        var scaleX = containerWidth / imgNaturalWidth;
        var scaleY = containerHeight / imgNaturalHeight;
        var layoutScale = Math.min(scaleX, scaleY, 1);
        var finalWidth = imgNaturalWidth * layoutScale * state.interaction.scale;
        var finalHeight = imgNaturalHeight * layoutScale * state.interaction.scale;
        var zoomFactor = state.config.dictConfig.doubleTapZoomFactor;
        var N = Math.round(zoomFactor);
        if (N < 1) N = 1;
        if (direction === -1) {
            var lastColCenter = finalWidth - finalWidth / (2 * N);
            state.interaction.translateX = containerWidth / 2 - lastColCenter;
            state.interaction.translateY = containerHeight - finalHeight - BOTTOM_SAFE_MARGIN;
        } else if (direction === 1) {
            var firstColCenter = finalWidth / (2 * N);
            state.interaction.translateX = containerWidth / 2 - firstColCenter;
            state.interaction.translateY = 0;
        }
    }
    // 在 updateTransform 之前设置高度
    if (state.interaction.scale > 1.01) {
        setWrapperHeight(true);
    } else {
        setWrapperHeight(false);
    }
    updateTransform();
    updateNavigation(page);
    preloadAdjacentPages(page);
    updatePageInfo(page);
    applyConfig();
    if (state.cache._hasPagePositions) {
        drawWordAnnotations(page);
    }
    tryApplyExternalResultAutoFocus(page);
    if (callback) callback(null);
}

// ==================== 图片加载辅助 ====================
function ensureActiveImageElement() {
    if (!state.interaction.container || !document.contains(state.interaction.container)) {
        buildImageContainer();
    }
    if (!state.interaction.img) {
        var image = createImageElement();
        state.interaction.wrapper.appendChild(image);
        state.interaction.img = image;
    }
    return state.interaction.img;
}

function getImageSource(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return typeof value.src === 'string' ? value.src : '';
}

function setActiveImageSource(source, page, direction, keepScale, callback, label, loadSeq) {
    var src = getImageSource(source);
    if (!src) {
        if (callback) callback(new Error('图片地址为空'));
        return;
    }
    var image = ensureActiveImageElement();
    var startTime = performance.now();
    var settled = false;
    var timeoutId = state.timers.add(setTimeout(function() {
        finish(new Error('图片加载超时'));
    }, 10000));

    function isCurrentRequest() {
        return loadSeq === state.misc._imageLoadSeq && image === state.interaction.img;
    }

    function finish(error) {
        if (settled) return;
        settled = true;
        state.timers.cancel(timeoutId);
        if (!isCurrentRequest()) return;
        image.onload = null;
        image.onerror = null;
        if (error) {
            debugLog('❌ 图片加载失败 (' + label + '): page=' + page + ', url=' + src);
            if (callback) callback(error);
            return;
        }
        applyLoadedImage(page, direction, keepScale, callback, startTime);
    }

    image.onload = function() { finish(null); };
    image.onerror = function() { finish(new Error('图片加载失败')); };
    image.src = src;

    // 相同 src 或内存/blob 缓存可能已经同步处于 complete 状态。
    if (image.complete && image.naturalWidth > 0) {
        setTimeout(function() { finish(null); }, 0);
    }
}

// ==================== 图片加载 ====================
function loadImage(page, direction, keepScale, callback) {
    var resourceId = getCurrentResourceId();
    if (!resourceId) {
        debugLog('❌ loadImage: resourceId 为空，无法加载图片');
        if (callback) callback(new Error('resourceId 为空'));
        return;
    }
    var url = UrlBuilder.getImageUrl(resourceId, page);
    var loadSeq = ++state.misc._imageLoadSeq;
    var pm = state.cache.preloadManager;
    var cached = pm ? pm.get(url) : null;
    var pending = pm && typeof pm.getPending === 'function' ? pm.getPending(url) : null;

    if (cached) {
        setActiveImageSource(cached, page, direction, keepScale, callback, '缓存', loadSeq);
        return;
    }

    if (pending) {
        pending.then(function(result) {
            if (loadSeq !== state.misc._imageLoadSeq) return;
            setActiveImageSource(result, page, direction, keepScale, callback, '等待预加载', loadSeq);
        }).catch(function(error) {
            if (loadSeq !== state.misc._imageLoadSeq) return;
            debugLog('❌ 预加载失败，降级到普通加载: ' + error.message);
            performNormalLoad();
        });
        return;
    }

    function performNormalLoad() {
        if (loadSeq !== state.misc._imageLoadSeq) return;
        function start() {
            if (loadSeq !== state.misc._imageLoadSeq) return;
            setActiveImageSource(url, page, direction, keepScale, callback, '普通加载', loadSeq);
        }
        if (_env.isMDictAndroid && !_hiddenIframeReady) {
            ensureDictIframe(state.ui.currentDictId).then(start).catch(function(error) {
                debugLog('⚠️ 等待 iframe 失败: ' + error.message);
                start();
            });
        } else {
            start();
        }
    }

    if (pm && typeof pm.loadImmediate === 'function') {
        pm.loadImmediate(url).then(function(result) {
            if (loadSeq !== state.misc._imageLoadSeq) return;
            setActiveImageSource(result, page, direction, keepScale, callback, '高优先级', loadSeq);
        }).catch(function(error) {
            if (loadSeq !== state.misc._imageLoadSeq) return;
            debugLog('❌ 高优先级加载失败，降级到普通加载: ' + error.message);
            performNormalLoad();
        });
    } else {
        performNormalLoad();
    }
}

// ==================== 预加载函数 ====================
function submitPreloadPages(pageList, label) {
    if (!pageList || pageList.length === 0 || !state.cache.dictionaryIndex ||
        state.config.globalConfig.preloadPages <= 0) return;
    var seen = {};
    var urls = [];
    var resourceId = getCurrentResourceId();
    for (var i = 0; i < pageList.length; i++) {
        var page = pageList[i];
        var key = String(page);
        if (hasOwnKey(seen, key)) continue;
        seen[key] = true;
        urls.push(UrlBuilder.getImageUrl(resourceId, page));
    }
    if (urls.length === 0 || !state.cache.preloadManager) return;
    state.cache.preloadManager.enqueue(urls).catch(function(error) {
        debugLog('🔄 ' + label + '部分失败: ' + (error.message || error));
    });
    debugLog('🔄 ' + label + '已提交 ' + urls.length + ' 个页面');
}

function preloadAdjacentPages(currentPage) {
    var preload = state.config.globalConfig.preloadPages;
    if (preload <= 0 || !state.cache.dictionaryIndex) return;
    var pages = state.cache.dictionaryIndex.pages;
    var pageList = [];
    if (currentPage === EXTERNAL_COVER) {
        for (var i = 0; i < preload && i < pages.length; i++) pageList.push(pages[i]);
    } else {
        var index = pages.indexOf(currentPage);
        if (index === -1) return;
        for (var offset = 1; offset <= preload; offset++) {
            if (index - offset >= 0) pageList.push(pages[index - offset]);
            if (index + offset < pages.length) pageList.push(pages[index + offset]);
        }
    }
    submitPreloadPages(pageList, '预加载');
}
function preloadSpecificPages(pageList) {
    submitPreloadPages(pageList, '预加载指定页');
}

// ==================== 导航UI ====================
function updateNavigation(currentPage) {
    var container = state.interaction.container;
    if (!container) return;
    var oldNav = container.querySelector('.page-nav');
    if (oldNav) oldNav.remove();
    state.ui._cachedNavSpans = null;
    if (state.navigation.currentWordPages && state.navigation.currentWordPages.length > 1) {
        var newNav = document.createElement('div');
        newNav.className = 'page-nav';
        var pages = state.navigation.currentWordPages;
        var pageKeyMap = state.navigation.currentPageKeyMap || {};
        var indexKeyType = (state.cache.dictionaryIndex && state.cache.dictionaryIndex.indexKeyType) || 'en';
        var showPinyin = (indexKeyType === 'pinyin' && state.navigation._lastInputHasChinese);
        pages.forEach(function(p, idx) {
            var span = document.createElement('span');
            span.setAttribute('data-page', p);
            if (p === currentPage) span.classList.add('current');
            var num = idx + 1;
            var label = num <= 20 ? String.fromCharCode(0x2460 + num - 1) : '(' + num + ')';
            var extraInfo = '';
            if (p === EXTERNAL_COVER) {
                extraInfo = ' 封面';
                label = '';
            } else {
                extraInfo = ' ' + p;
            }
            if (showPinyin) {
                var py = pageKeyMap[p] || '';
                extraInfo = py ? ' ' + py : '';
            } else {
                extraInfo = ' ' + p;
            }
            span.textContent = label + extraInfo;
            span.addEventListener('click', function(e) {
                e.stopPropagation();
                displayPage(p);
            });
            newNav.appendChild(span);
        });
        container.insertBefore(newNav, state.interaction.wrapper);
        state.ui._cachedNavSpans = newNav.querySelectorAll('span');
    }
}

function updateTransform() {
    if (!state.interaction.img) return;
    if (state.interaction.scale <= 1) {
        state.interaction.translateX = 0;
        state.interaction.translateY = 0;
        state.interaction.img.style.transform = 'translate(0, 0) scale(' + state.interaction.scale + ')';
        updateHotZones();
        // 缩放后触发重绘
        scheduleAnnotationUpdate();
        return;
    }
    state.interaction.img.style.transform = 'translate(' + state.interaction.translateX + 'px, ' + state.interaction.translateY + 'px) scale(' + state.interaction.scale + ')';
    if (!state.interaction.transformPending) {
        state.interaction.transformPending = true;
        requestAnimationFrame(function() {
            state.interaction.transformPending = false;
            constrainTransform();
            updateHotZones();
            // 缩放/平移后触发重绘
            scheduleAnnotationUpdate();
        });
    }
}

// ==================== 词条高亮层重绘调度 ====================
// 拖动过程中只隐藏覆盖层，不计算坐标；拖动结束后等待最终 transform / constrainTransform
// 真正落地并经过浏览器布局，再基于最终 getBoundingClientRect() 强制重绘。
function hideWordAnnotationsLayer() {
    if (!state.interaction.wrapper) return;
    var layer = state.interaction.wrapper.querySelector('.picdic-word-annotations');
    if (layer) layer.style.display = 'none';
}

function clearWordAnnotationsLayer() {
    if (state.interaction.wrapper) {
        var layer = state.interaction.wrapper.querySelector('.picdic-word-annotations');
        if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    }
    state._lastDrawPage = null;
    state._lastDrawTime = 0;
    state._lastAnnotationGeometryKey = null;
}

function getPageWordAnnotationEntries(page) {
    var positions = state.cache.dictionaryIndex && state.cache.dictionaryIndex.pageWordPositions;
    if (!positions || page === undefined || page === null) return null;
    var entries = positions[String(page)] || positions[page];
    return Array.isArray(entries) && entries.length > 0 ? entries : null;
}

function cancelAnnotationUpdateTimer() {
    if (state._annotationTimer) {
        clearTimeout(state._annotationTimer);
        state._annotationTimer = null;
    }
}

function scheduleAnnotationUpdate() {
    if (!state.ui.pageNum || !state.cache._hasPagePositions) return;

    // 拖动时不要让后台定时器偷偷调用 drawWordAnnotations；否则会污染“最近绘制”状态。
    if (state.interaction.isDragging || state.interaction.touchIsDragging ||
        state.interaction.mouseIsDragging) {
        cancelAnnotationUpdateTimer();
        hideWordAnnotationsLayer();
        return;
    }

    cancelAnnotationUpdateTimer();
    state._annotationTimer = setTimeout(function() {
        state._annotationTimer = null;
        if (!state.interaction.isDragging &&
            !state.interaction.touchIsDragging &&
            !state.interaction.mouseIsDragging &&
            state.ui.pageNum && state.cache._hasPagePositions) {
            drawWordAnnotations(state.ui.pageNum);
        }
    }, 100);
}

function scheduleAnnotationRedrawAfterInteraction() {
    cancelAnnotationUpdateTimer();
    if (!state.ui.pageNum || !state.cache._hasPagePositions) return;

    var seq = (state.misc._annotationSettleSeq || 0) + 1;
    state.misc._annotationSettleSeq = seq;
    var attempts = 0;

    function waitForFinalTransform() {
        requestAnimationFrame(function() {
            if (state.misc._annotationSettleSeq !== seq) return;
            if (state.interaction.isDragging || state.interaction.touchIsDragging ||
                state.interaction.mouseIsDragging) return;

            // updateTransform() 可能还有一个 RAF 中的 constrainTransform() 未完成。
            // 最多等几帧，避免在边界约束调整 translateX/Y 之前取到旧矩形。
            if (state.interaction.transformPending && attempts < 6) {
                attempts++;
                waitForFinalTransform();
                return;
            }

            // 再等一帧，确保 style.transform / wrapper 尺寸已经进入最终布局快照。
            requestAnimationFrame(function() {
                if (state.misc._annotationSettleSeq !== seq) return;
                if (state.interaction.isDragging || state.interaction.touchIsDragging ||
                    state.interaction.mouseIsDragging) return;
                if (!state.ui.pageNum || !state.cache._hasPagePositions) return;

                drawWordAnnotations(state.ui.pageNum, true);
            });
        });
    }

    waitForFinalTransform();
}

// ==================== 外部查询自动放大定位（仅全索引词典） ====================

function getPositionItemNormalizedWord(item) {
    if (!item) return '';
    if (item._picdicNormalizedHw !== undefined) return item._picdicNormalizedHw;
    var normalized = normalize(item.hw || '');
    try {
        Object.defineProperty(item, '_picdicNormalizedHw', {
            value: normalized,
            configurable: true,
            writable: true,
            enumerable: false
        });
    } catch (error) {
        // Frozen/sealed index objects remain supported; simply skip memoization.
    }
    return normalized;
}

function isFullIndexDictionary() {
    return !!(state.cache._hasPagePositions &&
        state.cache.dictionaryIndex &&
        state.cache.dictionaryIndex.pageWordPositions);
}

function findExternalFocusEntry(page) {
    if (!isFullIndexDictionary()) return null;
    var entries = state.cache.dictionaryIndex.pageWordPositions[String(page)] ||
        state.cache.dictionaryIndex.pageWordPositions[page];
    if (!entries || entries.length === 0) return null;

    var pageOrdMap = state.misc._currentSearchPageOrdMap &&
        state.misc._currentSearchPageOrdMap[String(page)];
    var searchNormalized = state.misc._currentSearchNormalized ||
        normalize(state.misc._currentSearchWord || '');
    var rawWord = state.misc._currentSearchWord || '';
    var rawLower = rawWord.toLowerCase();
    var best = null;

    for (var i = 0; i < entries.length; i++) {
        var item = entries[i];
        var word = item.hw || '';
        var ordMatch = !!(pageOrdMap && item.ord !== undefined && item.ord !== null &&
            hasOwnKey(pageOrdMap, String(item.ord)));
        var normalizedMatch = !!searchNormalized &&
            getPositionItemNormalizedWord(item) === searchNormalized;
        if (!ordMatch && !normalizedMatch) continue;

        var priority = 4;
        if (word === rawWord) priority = 0;
        else if (word.toLowerCase() === rawLower) priority = 1;
        else if (ordMatch) priority = 2;
        else if (normalizedMatch) priority = 3;

        var candidate = {
            item: item,
            priority: priority,
            col: parseInt(item.col, 10) || 1,
            y: parseFloat(item.y) || 0
        };
        if (!best || candidate.priority < best.priority ||
            (candidate.priority === best.priority && candidate.col < best.col) ||
            (candidate.priority === best.priority && candidate.col === best.col && candidate.y < best.y)) {
            best = candidate;
        }
    }
    return best ? best.item : null;
}

function requestExternalResultAutoFocus(page) {
    if (!state.config.globalConfig.autoZoomExternalFullIndex || !isFullIndexDictionary()) {
        state.misc._pendingExternalFocus = null;
        return;
    }
    var seq = ++state.misc._externalFocusSeq;
    state.misc._pendingExternalFocus = {
        seq: seq,
        dictId: state.ui.currentDictId,
        page: String(page)
    };
    setTimeout(function() {
        tryApplyExternalResultAutoFocus(page, seq);
    }, 0);
}

function tryApplyExternalResultAutoFocus(page, expectedSeq) {
    var pending = state.misc._pendingExternalFocus;
    if (!pending) return false;
    if (expectedSeq !== undefined && pending.seq !== expectedSeq) return false;
    if (!state.config.globalConfig.autoZoomExternalFullIndex || !isFullIndexDictionary()) {
        state.misc._pendingExternalFocus = null;
        return false;
    }
    if (pending.dictId !== state.ui.currentDictId ||
        String(pending.page) !== String(page) ||
        String(state.ui.pageNum) !== String(page) ||
        !state.interaction.img || !state.interaction.wrapper ||
        !state.interaction.img.complete || state.interaction.img.naturalWidth <= 0) {
        return false;
    }

    var target = findExternalFocusEntry(page);
    if (!target) {
        state.misc._pendingExternalFocus = null;
        return false;
    }

    var seq = pending.seq;
    var zoomFactor = parseFloat(state.config.dictConfig.doubleTapZoomFactor) || 1.85;
    if (zoomFactor <= 1.01) zoomFactor = 1.05;

    state.interaction.scale = zoomFactor;
    state.interaction.translateX = 0;
    state.interaction.translateY = 0;
    setWrapperHeight(true);
    updateTransform();
    applyConfig();

    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            var current = state.misc._pendingExternalFocus;
            if (!current || current.seq !== seq || current.dictId !== state.ui.currentDictId ||
                String(current.page) !== String(state.ui.pageNum)) return;

            var imgRect = state.interaction.img.getBoundingClientRect();
            var wrapperRect = state.interaction.wrapper.getBoundingClientRect();
            if (!imgRect.width || !imgRect.height || !wrapperRect.width || !wrapperRect.height) return;

            var columns = Math.round(zoomFactor);
            if (columns < 1) columns = 1;
            var col = parseInt(target.col, 10) || 1;
            if (col < 1) col = 1;
            if (col > columns) col = columns;
            var y = parseFloat(target.y) || 0;

            var imgLeft = imgRect.left - wrapperRect.left;
            var imgTop = imgRect.top - wrapperRect.top;

            // V7.3：外部查询也改用唯一的横向 source of truth。
            // target.col 为 1-based；内部统一为 0-based。
            var horizontalGeometry = getEffectiveHorizontalGeometry(columns);
            var cropLeftNatural = horizontalGeometry ? horizontalGeometry.cropLeftNatural : 0;
            var cropRightNatural = horizontalGeometry ? horizontalGeometry.cropRightNatural : 0;
            var targetColZeroBased = clampHorizontalColumn(col - 1, columns);
            var horizontalDelta = getColumnHorizontalDelta(targetColZeroBased, columns);

            // 纵向定位保持原算法，不受左右裁剪影响。
            var targetTop = imgTop + y * imgRect.width / 100;

            var desiredTop = Math.max(18, wrapperRect.height * 0.14);
            state.interaction.translateX += horizontalDelta;
            state.interaction.translateY += desiredTop - targetTop;
            updateTransform();

            state.misc._pendingExternalFocus = null;
            state._lastDrawTime = 0;
            setTimeout(function() {
                if (String(state.ui.pageNum) === String(page) && state.cache._hasPagePositions) {
                    drawWordAnnotations(page);
                }
            }, 220);
            debugLog('🎯 外部查询已自动放大定位: page=' + page +
                ', word=' + (target.hw || '') +
                ', cropLeft=' + cropLeftNatural +
                ', cropRight=' + cropRightNatural);
        });
    });
    return true;
}

function navigateToHeadword(word) {
    if (!word) return;
    var encodedWord = encodeURIComponent(word);
    var url;
    if (_env.isMDictAndroid) {
        url = 'mdx://mdict.cn/entry/-1/' + encodedWord;
    } else {
        var dictId = state.ui.currentDictId;
        var sourceLang = getSourceLangCode(dictId);
        var targetLang =  '-1'; //getTargetLangCode(dictId);
        url =
            'content://mobi.goldendict.android/article/' +
            sourceLang + '/' +
            targetLang + '/' +
            encodedWord;
    }
    try {
        window.location.href = url;
    } catch(error) {
        window.open(url, '_self');
    }
}

function drawWordAnnotations(page, force) {
    if (!state.cache._hasPagePositions) {
        clearWordAnnotationsLayer();
        return;
    }

    // 先判断交互状态，再更新任何“最近绘制”标记。
    // 旧逻辑会在拖动中先写入 _lastDrawTime 再 return，导致停止拖动后的正确重绘
    // 被 200ms 防重复逻辑误判为重复，从而留下隐藏层或错位层。
    if (state.interaction.isDragging || state.interaction.touchIsDragging ||
        state.interaction.mouseIsDragging) {
        hideWordAnnotationsLayer();
        return;
    }

    var wrapper = state.interaction.wrapper;
    var image = state.interaction.img;
    var entries = getPageWordAnnotationEntries(page);

    // 当前页没有任何带位置坐标的词条时，必须主动删除上一页遗留的高亮层。
    // 旧逻辑直接 return，导致从正文页跳到附录/封面等无 location 页面时，
    // 上一页的固定高亮层仍覆盖在新页面上。
    if (!entries || entries.length === 0) {
        clearWordAnnotationsLayer();
        return;
    }
    if (!wrapper || !image) {
        clearWordAnnotationsLayer();
        return;
    }

    // 必须先取得“当前最终几何”，再决定是否真的是重复绘制。
    var imgRect = image.getBoundingClientRect();
    var wrapperRect = wrapper.getBoundingClientRect();
    if (!imgRect.width || !imgRect.height || !wrapperRect.width || !wrapperRect.height) return;

    var imgLeft = imgRect.left - wrapperRect.left;
    var imgTop = imgRect.top - wrapperRect.top;
    var imgWidth = imgRect.width;
    var imgHeight = imgRect.height;
    var wrapperWidth = wrapperRect.width;
    var wrapperHeight = wrapperRect.height;

    var oldLayer = wrapper.querySelector('.picdic-word-annotations');
    var geometryKey = [
        String(page),
        imgLeft.toFixed(2), imgTop.toFixed(2),
        imgWidth.toFixed(2), imgHeight.toFixed(2),
        wrapperWidth.toFixed(2), wrapperHeight.toFixed(2),
        Number(state.interaction.scale || 1).toFixed(4)
    ].join('|');
    var now = Date.now();

    // 只有“页码 + 图片位置/尺寸 + wrapper尺寸 + scale”都完全相同才视作重复。
    // 即使两次绘制间隔小于 200ms，只要 constrainTransform 改过最终位置，也必须重绘。
    if (!force && oldLayer && oldLayer.style.display !== 'none' &&
        state._lastAnnotationGeometryKey === geometryKey &&
        state._lastDrawPage === page && state._lastDrawTime &&
        now - state._lastDrawTime < 200) {
        return;
    }

    state._lastDrawPage = page;
    state._lastDrawTime = now;
    state._lastAnnotationGeometryKey = geometryKey;

    if (oldLayer) oldLayer.remove();
    var columns = Math.max(1, Math.round(state.config.dictConfig.doubleTapZoomFactor || 1.85));
    var columnWidth = imgWidth / columns;
    var heightPercent = (imgHeight * (state.config.dictConfig.highlightHeight || 1.15) / 100 /
        wrapperHeight) * 100;

    var searchNormalized = state.misc._currentSearchNormalized || '';
    var pageOrdMaps = state.misc._currentSearchPageOrdMap || null;
    var currentPageOrdMap = pageOrdMaps && pageOrdMaps[String(page)] || null;
    var currentWordPages = state.navigation.currentWordPages || [];
    var isResultPage = currentWordPages.length === 0 || currentWordPages.indexOf(page) !== -1;

    var layer = document.createElement('div');
    layer.className = 'picdic-word-annotations';
    layer.style.cssText = 'position:absolute; display:block; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:10;';
    var container = document.createElement('div');
    container.style.cssText = 'position:relative; width:100%; height:100%;';
    layer.appendChild(container);

    var charWidthRatio = parseFloat(state.config.dictConfig.highlightCharWidth);
    if (!isFinite(charWidthRatio) || charWidthRatio <= 0) {
        charWidthRatio = DEFAULT_DICT_CONFIG.highlightCharWidth;
    }

    for (var i = 0; i < entries.length; i++) {
        var item = entries[i];
        var word = item.hw || '';
        var columnIndex = (parseInt(item.col, 10) || 1) - 1;
        var y = parseFloat(item.y) || 0;
        var leftPercent = ((imgLeft + columnIndex * columnWidth) / wrapperWidth) * 100;
        var topPercent = ((imgTop + y * imgWidth / 100) / wrapperHeight) * 100;
        var widthRatio = Math.min(10 + Math.min(word.length * charWidthRatio, 80), 90);
        var widthPercent = (columnWidth * widthRatio / 100 / wrapperWidth) * 100;

        var block = document.createElement('div');
        block.style.cssText = 'position:absolute; left:' + leftPercent + '%; top:' + topPercent +
            '%; width:' + widthPercent + '%; height:' + heightPercent + '%;';

        var normalizedMatch = !!searchNormalized &&
            getPositionItemNormalizedWord(item) === searchNormalized;
        var ordMatch = !!(currentPageOrdMap && item.ord !== undefined && item.ord !== null &&
            hasOwnKey(currentPageOrdMap, String(item.ord)));
        block.className = isResultPage && (normalizedMatch || ordMatch) ?
            'picdic-hw-highlight' : 'picdic-hw-normal';
        block.addEventListener('click', (function(targetWord) {
            return function(event) {
                event.stopPropagation();
                navigateToHeadword(targetWord);
            };
        })(word));
        container.appendChild(block);
    }
    wrapper.appendChild(layer);
}


function updatePageInfo(currentPage) {
    var infoEl = state.ui.pageInfoElement || document.getElementById('picdic_pageinfo');
    if (!infoEl) return;
    state.ui.pageInfoElement = infoEl;
    if (!state.cache.dictionaryIndex) {
        infoEl.textContent = '';
        return;
    }
    var dictConfig = state.configStore.data.allDictConfigs[state.ui.currentDictId];
    var pageInfo = dictConfig && dictConfig._pagesInfo;
    if (!pageInfo) {
        updatePagesInfo(state.ui.currentDictId);
        dictConfig = state.configStore.data.allDictConfigs[state.ui.currentDictId];
        pageInfo = dictConfig && dictConfig._pagesInfo;
    }
    infoEl.textContent = (currentPage || '?') + ' / ' + (pageInfo ? pageInfo.body : 0);
}

// ==================== 主入口 displayPage ====================
function displayPage(page, keepScale, direction) {
    // Hot-lite 只持有当前需要的位置页；翻到其他页时按页异步补取。
    ensureHotPagePositionsAsync(page);

    // 切换到附录、封面等没有词条 location 的页面时，立即清除上一页高亮层。
    // 不等待新图片加载完成，避免旧高亮在无定位页面上残留。
    if (!getPageWordAnnotationEntries(page)) {
        clearWordAnnotationsLayer();
    }

    if (page === EXTERNAL_COVER) {
        var cachedCover = state.configStore.data.allDictConfigs[state.ui.currentDictId] &&
                         state.configStore.data.allDictConfigs[state.ui.currentDictId]._cachedCover;
        if (!cachedCover) {
            showError('封面图不存在');
            return;
        }
        if (!state.interaction.container || !document.contains(state.interaction.container)) {
            buildImageContainer();
        }
        var fullUrl = UrlBuilder.getFileUrl(cachedCover);
        if (state.interaction.img) {
            state.interaction.img.onload = null;
            state.interaction.img.onerror = null;
            state.interaction.img.src = '';
        }
        state.interaction.img.onload = function() {
            state.ui.pageNum = EXTERNAL_COVER;
            state.interaction.scale = 1;
            state.interaction.translateX = 0;
            state.interaction.translateY = 0;
            var pages = state.cache.dictionaryIndex.pages;
            var firstBody = pages.length ? pages[0] : null;
            state.navigation.currentWordPages = [EXTERNAL_COVER];
            if (firstBody) {
                state.navigation.currentWordPages.push(firstBody);
            }
            updateNavigation(EXTERNAL_COVER);
            updatePageInfo('封面');
            updateTransform();
            applyConfig();
            debugLog('✅ 外部封面图加载完成');
            preloadAdjacentPages(EXTERNAL_COVER);
        };
        state.interaction.img.onerror = function() {
            debugLog('❌ 外部封面图加载失败');
            showError('封面图加载失败');
        };
        state.interaction.img.src = fullUrl;
        return;
    }
    debugLog('📖 displayPage 被调用，page=' + page);
    direction = direction || 0;
    keepScale = keepScale || false;
    if (!state.cache.dictionaryIndex) {
        showError('索引未加载');
        return;
    }
    if (state.cache.dictionaryIndex.pages.indexOf(page) === -1) {
        debugLog('⚠️ 页面不存在: ' + page);
        showError('页面不存在: ' + page);
        return;
    }
    if (!state.interaction.container || !document.contains(state.interaction.container)) {
        buildImageContainer();
    }
    if (page === state.ui.pageNum && state.interaction.img && state.interaction.img.src) {
        debugLog('🔄 页面相同，仅刷新导航');
        updateNavigation(page);
        updatePageInfo(page);
        return;
    }
    loadImage(page, direction, keepScale, function(err) {
        if (err) {
            showError('加载失败: ' + page);
        } else {
            var errDiv = state.interaction.container.querySelector('.page-error');
            if (errDiv) errDiv.remove();
        }
    });
}

// ==================== 图片元素创建和容器构建 ====================
function createImageElement() {
    var img = document.createElement('img');
    img.className = 'picdic-image';
    img.style.webkitTouchCallout = 'none';
    img.style.userSelect = 'none';
    img.style.webkitUserSelect = 'none';
    img.style.touchAction = 'manipulation';
    img.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }, true);
    img.addEventListener('selectstart', function(e) {
        e.preventDefault();
    }, true);
    img.addEventListener('dragstart', function(e) {
        e.preventDefault();
    }, true);
    img.addEventListener('auxclick', function(e) {
        e.preventDefault();
        e.stopPropagation();
    }, true);
    img.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        e.preventDefault();
    }, true);
    return img;
}

function buildImageContainer() {
    if (state.interaction.img) {
        state.interaction.img.onload = null;
        state.interaction.img.onerror = null;
        state.interaction.img.src = '';
        state.interaction.img = null;
    }
    if (state.interaction.wrapper) {
        state.interaction.wrapper = null;
    }
    if (state.interaction.container && state.interaction.container._abortController) {
        state.interaction.container._abortController.abort();
        state.interaction.container._abortController = null;
    }
    if (state.interaction.container) {
        if (state.interaction.container.parentNode) {
            state.interaction.container.parentNode.removeChild(state.interaction.container);
        }
        state.interaction.container = null;
    }
    state.ui.btnContainer = null;
    state.ui.topNavElement = null;
    state.ui._cachedContainer = null;
    state.ui._cachedNavSpans = null;

    state.ui.resultDiv.innerHTML = '';
    var container = document.createElement('div');
    container.className = 'picdic-image-container';
    container.style.width = '100%';
    container.style.minHeight = '200px';

    state.ui.resultDiv.appendChild(container);
    state.interaction.container = container;

    if (state.config.dictConfig.showTopNav) {
        var special = state.cache.dictionaryIndex.special;
        if (special && Object.keys(special).length > 0) {
            var topNav = document.createElement('div');
            topNav.className = 'picdic-top-nav';
            var links = [];
            for (var key in special) {
                links.push('<a href="#" data-page="'+key+'">'+special[key]+'</a>');
            }
            topNav.innerHTML = links.join('|');
            topNav.querySelectorAll('a[data-page]').forEach(function(a) {
                a.addEventListener('click', function(e) {
                    e.preventDefault();
                    displayPage(this.getAttribute('data-page'));
                });
            });
            container.appendChild(topNav);
            state.ui.topNavElement = topNav;
        }
    }

    var wrapper = document.createElement('div');
    wrapper.className = 'picdic-wrapper';
    wrapper.style.position = 'relative';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.overflow = 'hidden';
    container.appendChild(wrapper);
    state.interaction.wrapper = wrapper;

    if (window.ResizeObserver) {
        state.layout.resizeObserver = new ResizeObserver(function(entries) {
            for (var entry of entries) {
                if (entry.target === wrapper) {
                    var rect = entry.contentRect;
                    state.layout.containerWidth = rect.width;
                    state.layout.containerHeight = rect.height;
                    updateHotZones();
                }
            }
        });
        state.layout.resizeObserver.observe(wrapper);
    }

    var img = createImageElement();
    wrapper.appendChild(img);
    state.interaction.img = img;

    var btnContainer = document.createElement('div');
    btnContainer.className = 'picdic-float-buttons';
    container.appendChild(btnContainer);
    state.ui.btnContainer = btnContainer;

    var buttons = [
        { text: '✕', action: 'close', color: '#f44336' },
        { text: '+', action: 'zoomIn', color: '#4CAF50' },
        { text: '−', action: 'zoomOut', color: '#FF9800' }
    ];
    buttons.forEach(function(btnData) {
        var btn = document.createElement('button');
        btn.className = 'picdic-float-btn';
        btn.textContent = btnData.text;
        btn.style.background = btnData.color;
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            switch (btnData.action) {
                case 'zoomIn':
                    state.interaction.scale = Math.min(5, state.interaction.scale + state.config.globalConfig.zoomStep);
                    updateTransform();
                    applyConfig();
                    break;
                case 'zoomOut':
                    state.interaction.scale = Math.max(0.2, state.interaction.scale - state.config.globalConfig.zoomStep);
                    updateTransform();
                    applyConfig();
                    break;
                case 'close':
                    resetView();
                    break;
            }
        });
        btn.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true });
        btnContainer.appendChild(btn);
    });

    createHotZones();

    var abortController = new AbortController();
    container._abortController = abortController;
    container.addEventListener('click', handleContainerClick, { signal: abortController.signal });
    container.addEventListener('touchstart', handleTouchStart, { passive: true, signal: abortController.signal });
    container.addEventListener('touchmove', handleTouchMove, { passive: false, signal: abortController.signal });
    container.addEventListener('touchend', handleTouchEnd, { passive: false, signal: abortController.signal });
    document.addEventListener('mousemove', handleMouseMove, { signal: abortController.signal });
    document.addEventListener('mouseup', handleMouseUp, { signal: abortController.signal });
    img.addEventListener('mousedown', onImgMouseDown, { signal: abortController.signal });
    
    // 创建底部信息栏（仅在正常大小显示）
    var footer = document.createElement('div');
    footer.className = 'picdic-footer';
    footer.textContent = 'PicDic图片词典查阅';
    container.appendChild(footer);
    state.ui.footerElement = footer;
}

// ==================== 交互事件 ====================
function handleContainerClick(e) {
    var target = e.target;
    if (target.tagName === 'IMG') {
        var clientX = e.clientX;
        var clientY = e.clientY;
        handleImgClick(clientX, clientY);
        e.preventDefault();
    }
}

function handleImgClick(clientX, clientY) {
    if (window.event) {
        window.event.stopPropagation();
        window.event.preventDefault();
    }
    if (!state.interaction.img) return;
    var now = Date.now();
    var timeDiff = now - state.interaction.lastClickTime;
    var dist = Math.sqrt(Math.pow(clientX - state.interaction.lastClickX, 2) + Math.pow(clientY - state.interaction.lastClickY, 2));
    if (timeDiff < 300 && dist < 30) {
        if (state.interaction.clickTimer) {
            clearTimeout(state.interaction.clickTimer);
            state.interaction.clickTimer = null;
        }
        if (state.config.globalConfig.enableDoubleTapZoom) {
            var rect = state.interaction.wrapper.getBoundingClientRect();
            var cx = clientX - rect.left;
            var cy = clientY - rect.top;
            toggleZoom(cx, cy);
        }
        state.interaction.lastClickTime = 0;
        return;
    }
    state.interaction.lastClickTime = now;
    state.interaction.lastClickX = clientX;
    state.interaction.lastClickY = clientY;
    if (state.interaction.clickTimer) clearTimeout(state.interaction.clickTimer);
    state.interaction.clickTimer = setTimeout(function() {
        state.interaction.clickTimer = null;
        if (state.interaction.scale <= 1 && state.config.globalConfig.enableClickPageTurn) {
            var rect = state.interaction.wrapper.getBoundingClientRect();
            var x = clientX - rect.left;
            var width = rect.width;
            var ratio = x / width;
            if (ratio < 1/2) {
                var prev = getAdjacentPage(state.ui.pageNum, -1);
                if (prev) displayPage(prev);
            } else if (ratio > 1/2) {
                var next = getAdjacentPage(state.ui.pageNum, 1);
                if (next) displayPage(next);
            }
        }
    }, 300);
}

function handleTouchStart(e) {
    if (e.touches.length === 1) {
        var touch = e.touches[0];
        state.interaction.touchStartX = touch.clientX;
        state.interaction.touchStartY = touch.clientY;
        state.interaction.touchStartTranslateX = state.interaction.translateX;
        state.interaction.touchStartTranslateY = state.interaction.translateY;
        state.interaction.touchIsDragging = false;
        state.interaction.isLongPress = false;
        if (state.config.globalConfig.enableLongPressZoom && state.interaction.scale <= 1) {
            if (state.interaction.longPressTimer) {
                clearTimeout(state.interaction.longPressTimer);
                state.interaction.longPressTimer = null;
            }
            var delay = state.config.globalConfig.longPressDelay || 400;
            state.interaction.longPressTimer = setTimeout(function() {
                if (!state.interaction.touchIsDragging && state.interaction.scale <= 1) {
                    var rect = state.interaction.wrapper.getBoundingClientRect();
                    var cx = state.interaction.touchStartX - rect.left;
                    var cy = state.interaction.touchStartY - rect.top;
                    toggleZoom(cx, cy);
                    state.interaction.isLongPress = true;
                    if (navigator.vibrate) navigator.vibrate(30);
                }
                state.interaction.longPressTimer = null;
            }, delay);
        }
    }
}

function handleTouchMove(e) {
    if (state.interaction.longPressTimer && e.touches.length === 1) {
        var touch = e.touches[0];
        var dx = touch.clientX - state.interaction.touchStartX;
        var dy = touch.clientY - state.interaction.touchStartY;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            clearTimeout(state.interaction.longPressTimer);
            state.interaction.longPressTimer = null;
        }
    }
    if (e.touches.length === 1) {
        var touch = e.touches[0];
        var dx = touch.clientX - state.interaction.touchStartX;
        var dy = touch.clientY - state.interaction.touchStartY;
        if (state.interaction.scale > 1) {
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                state.interaction.touchIsDragging = true;
                state.interaction.isDragging = true;

                if (state.config.dictConfig.zoomVerticalDragOnly) {
                    // V7.4：按词典可选。锁定开始拖动时的横向位置，只更新纵向位置。
                    // 横向手势仍作为拖动处理并 preventDefault，避免泄漏成页面/点击行为。
                    state.interaction.translateX = state.interaction.touchStartTranslateX;
                } else {
                    // 兼容跨列内容：保持原来的自由二维拖动。
                    state.interaction.translateX = state.interaction.touchStartTranslateX + dx;
                }

                state.interaction.translateY = state.interaction.touchStartTranslateY + dy;
                updateTransform();

                // 拖动过程中隐藏高亮层；停止后由 settle 调度器基于最终 transform 重绘。
                hideWordAnnotationsLayer();
                e.preventDefault();
            }
            return;
        }
        if (state.config.globalConfig.swipeEnabled && state.interaction.scale <= 1) {
            if (Math.abs(dx) > state.config.globalConfig.swipeThreshold || Math.abs(dy) > state.config.globalConfig.swipeThreshold) {
                if (Math.abs(dx) > Math.abs(dy) * 0.6) {
                    state.interaction.isSwiping = true;
                    e.preventDefault();
                }
            }
        }
    }
}

function handleTouchEnd(e) {
    if (state.interaction.longPressTimer) {
        clearTimeout(state.interaction.longPressTimer);
        state.interaction.longPressTimer = null;
    }
    if (state.interaction.touchIsDragging) {
        state.interaction.touchIsDragging = false;
        state.interaction.isDragging = false;
        e.preventDefault();

        // 不再 touchend 当下立即取 getBoundingClientRect()。
        // 等 updateTransform/constrainTransform 和浏览器布局稳定后强制重绘一次。
        scheduleAnnotationRedrawAfterInteraction();
        return;
    }
    if (state.interaction.isLongPress) {
        state.interaction.isLongPress = false;
        e.preventDefault();
        return;
    }
    if (state.interaction.isSwiping && state.interaction.scale <= 1 && state.config.globalConfig.swipeEnabled) {
        var touch = e.changedTouches[0];
        if (touch) {
            var dx = touch.clientX - state.interaction.touchStartX;
            if (Math.abs(dx) > state.config.globalConfig.swipeThreshold) {
                var direction = dx > 0 ? -1 : 1;
                var nextPage = getAdjacentPage(state.ui.pageNum, direction);
                if (nextPage) {
                    displayPage(nextPage);
                } else {
                    showError('已到边界');
                }
                e.preventDefault();
                state.interaction.isSwiping = false;
                return;
            }
        }
        state.interaction.isSwiping = false;
    }
}

function onImgMouseDown(e) {
    if (e.button === 0 && state.interaction.scale > 1) {
        state.interaction.mouseIsDragging = true;
        state.interaction.mouseStartX = e.clientX;
        state.interaction.mouseStartY = e.clientY;
        state.interaction.mouseStartTranslateX = state.interaction.translateX;
        state.interaction.mouseStartTranslateY = state.interaction.translateY;
        e.preventDefault();
    }
}

function handleMouseMove(e) {
	if (state.interaction.mouseIsDragging) {
	    state.interaction.isDragging = true;
	    var dx = e.clientX - state.interaction.mouseStartX;
	    var dy = e.clientY - state.interaction.mouseStartY;

        if (state.config.dictConfig.zoomVerticalDragOnly) {
            // V7.4：与触屏一致，锁定横向，只允许纵向拖动。
            state.interaction.translateX = state.interaction.mouseStartTranslateX;
        } else {
            state.interaction.translateX = state.interaction.mouseStartTranslateX + dx;
        }

	    state.interaction.translateY = state.interaction.mouseStartTranslateY + dy;
	    updateTransform();

        // 拖动过程中隐藏高亮层；停止后统一按最终几何重绘。
        hideWordAnnotationsLayer();
	}
}

function handleMouseUp() {
    var wasDragging = state.interaction.mouseIsDragging || state.interaction.isDragging;
    state.interaction.mouseIsDragging = false;
    state.interaction.isDragging = false;

    if (wasDragging) {
        scheduleAnnotationRedrawAfterInteraction();
    }
}

function showError(msg) {
    var container = state.interaction.container || state.ui.resultDiv;
    if (!container) return;
    var errorDiv = container.querySelector('.page-error');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'picdic-page-error';
        container.appendChild(errorDiv);
    }
    errorDiv.textContent = msg;
    clearTimeout(errorDiv._timer);
    errorDiv._timer = setTimeout(function() {
        if (errorDiv && errorDiv.parentNode) errorDiv.remove();
    }, 3000);
}

// ==================== 词典切换 ====================
async function switchDict(dictId) {
    if (state.misc.switchingDict) {
        throw new Error('正在切换中，请稍后');
    }
    state.misc.switchingDict = true;
    cleanupAll();
    try {
        updateResourceIds();
        if (state.ui.currentDictId) {
            var oldDictId = state.ui.currentDictId;
            if (!state.configStore.data.allDictConfigs[oldDictId]) {
                state.configStore.data.allDictConfigs[oldDictId] = {};
            }
            // 仅保存词典设置字段，保留 _order、_cachedIcon、_cachedCover、_pagesInfo 等元数据。
            for (var configKey in DEFAULT_DICT_CONFIG) {
                state.configStore.data.allDictConfigs[oldDictId][configKey] =
                    state.config.dictConfig[configKey];
            }
        }
        var switchSeq = ++state.misc._dictSwitchSeq;
        state.ui.currentDictId = dictId;
        debugLog('🔄 switchDict: 已设置 state.ui.currentDictId = ' + dictId);
        await ensureDictIframe(dictId);
        debugLog('🔄 switchDict: 准备加载索引，缓存键=' + getIndexCacheKey(dictId));
        await loadIndexAndConfig(dictId);
        if (switchSeq !== state.misc._dictSwitchSeq || state.ui.currentDictId !== dictId) {
            throw new Error('词典切换事务已过期');
        }
        if (!isIndexOwnedBy(dictId, state.cache.dictionaryIndex) || state.misc._indexOwnerDictId !== dictId) {
            throw new Error('加载完成后的索引与所选词典不对应');
        }
        debugLog('🔄 switchDict: 加载索引后，pages 数量=' + (state.cache.dictionaryIndex ? state.cache.dictionaryIndex.pages.length : 'null'));

        if (!state.cache._searchCacheReady || state.cache._searchCacheDictId !== dictId) {
            throw new Error('词典索引已加载，但搜索缓存未就绪');
        }
        // 重置搜索相关状态，避免残留旧词条高亮
        resetCurrentSearchState();
        state.navigation.currentWordPages = null;
        state.navigation.currentPageKeyMap = null;
        state.navigation.currentWordIndex = 0;

        debugLog('🔄 切换后规范化键数: ' + (state.cache._normalizedKeys ? state.cache._normalizedKeys.length : 0));
        mergeDictConfig(dictId, null);
        
        if (state.interaction.container && state.interaction.container._abortController) {
            state.interaction.container._abortController.abort();
            state.interaction.container._abortController = null;
        }
        state.ui.resultDiv.innerHTML = '';
        state.interaction.container = null;
        state.interaction.img = null;
        state.interaction.wrapper = null;
        state.ui.pageNum = null;
        if (state.ui.btnContainer) state.ui.btnContainer = null;
        state.ui.topNavElement = null;
        state.ui._cachedContainer = null;
        state.ui._cachedNavSpans = null;
        applyConfig();
        state.misc._searching = false;
        var inputWord = state.ui.searchInput ? state.ui.searchInput.value.trim() : '';
        if (inputWord) {
            debugLog('🔄 switchDict: 输入框有值 "' + inputWord + '"，执行搜索');
            performSearch();
        } else {
            debugLog('🔄 switchDict: 输入框为空，尝试显示默认页');
            var defaultTarget = getDefaultPage();
            if (defaultTarget && typeof defaultTarget === 'object' && defaultTarget.type === 'search') {
                state.ui.searchInput.value = defaultTarget.word;
                performSearch();
            } else if (defaultTarget) {
                displayPage(defaultTarget);
            } else {
                if (state.cache.dictionaryIndex && state.cache.dictionaryIndex.pages.length) {
                    displayPage(state.cache.dictionaryIndex.pages[0]);
                }
            }
        }
        state.misc.switchingDict = false;
        state.configManager.notifyChange();
        debugLog('✅ 切换词典成功: ' + dictId);
    } catch (err) {
        state.misc.switchingDict = false;
        debugLog('❌ 切换词典失败: ' + err.message);
        showToast('切换词典失败: ' + err.message);
        throw err;
    }
}

// ==================== Embedded 共享会话 ====================
async function activateEmbeddedSessionNow(dictId, words, activationSeq) {
    if (!_picdicEmbeddedMode) return false;

    words = Array.isArray(words) ? words : [words];
    var normalizedWords = [];
    var seen = Object.create(null);

    for (var i = 0; i < words.length; i++) {
        var word = String(words[i] || '').trim();
        if (!word) continue;
        var key = word.toLocaleLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        normalizedWords.push(word);
    }

    if (!normalizedWords.length) return false;

    var dictList = window.picdic_dictList || {};
    if (!dictId || !dictList[dictId]) {
        throw new Error('Embedded 目标 PicDic 词典不存在: ' + dictId);
    }

    // 如果排队期间又点击了更新的 Controller，只执行最后一次激活。
    if (activationSeq !== _picdicEmbeddedActivationSeq) return false;

    var firstWord = normalizedWords[0];

    window._picdic_word = firstWord;
    window._picdic_dictId = dictId;
    replaceExternalRequests(normalizedWords, dictId);

    if (!state || !state.ui || !state.ui.searchInput || !state.ui.resultDiv) {
        throw new Error('Embedded PicDic UI 尚未就绪');
    }

    state.ui.searchInput.value = firstWord;
    state.misc._savedWord = firstWord;

    if (state.ui.currentDictId !== dictId) {
        // 不同 PicDic 词典仍沿用已稳定的 switchDict 事务。
        state.misc._externalSearchPending = true;
        await switchDict(dictId);
    } else {
        // 同一 PicDic 词典的 hot-lite 页面只持有上一次词条。
        // 新词先按需换入新的轻量 lookup；命中时完全不恢复大 indexData。
        if (state.cache.dictionaryIndex && state.cache.dictionaryIndex._picdicHotLite) {
            var hotPrepared = await prepareEmbeddedHotIndex(dictId, firstWord);
            if (!hotPrepared) {
                // 少数 hot miss（例如缓存尚未完成/索引变更）安全回退完整索引。
                await promoteHotLiteToFullIndex(dictId);
            }
            state.ui.searchInput.value = firstWord;
        }
        performSearch(null, { external: true });
    }

    updateRequestList();

    if (typeof window._picdic_embedded_refresh === 'function') {
        try { window._picdic_embedded_refresh(); } catch (e) {}
    }

    return true;
}

window._picdic_activateEmbeddedSession = function(dictId, words) {
    if (!_picdicEmbeddedMode) return Promise.resolve(false);

    var activationSeq = ++_picdicEmbeddedActivationSeq;

    // 串行切换，避免两个 Controller 在 switchDict/loadIndex 期间并发污染全局 state。
    _picdicEmbeddedActivationQueue = _picdicEmbeddedActivationQueue
        .catch(function() { return false; })
        .then(function() {
            return _picdicEmbeddedReadyPromise;
        })
        .then(function(ready) {
            if (!ready) throw new Error('Embedded PicDic 初始化失败');
            return activateEmbeddedSessionNow(dictId, words, activationSeq);
        });

    return _picdicEmbeddedActivationQueue;
};

// ==================== 搜索 ====================
function performSearch(e, options) {
    // 详细的状态检查，打印到控制台以辅助排查
    if (!state || !state.ui || !state.ui.searchInput) {
        console.warn('performSearch 未就绪，state:', state, 'state.ui:', state ? state.ui : 'undefined');
        setTimeout(function() {
            if (state && state.ui && state.ui.searchInput) {
                performSearch(e, options);
            } else {
                showToast('搜索功能尚未初始化，请稍后重试');
            }
        }, 200);
        return;
    }
    options = options || {};
    var isExternalSearch = !!options.external || !!state.misc._externalSearchPending;
    state.misc._externalSearchPending = false;
    if (!isExternalSearch) {
        // 手动查询优先，取消尚未执行的旧外部定位任务。
        state.misc._externalFocusSeq++;
        state.misc._pendingExternalFocus = null;
    }

    if (!state.cache.dictionaryIndex) {
        debugLog('⚠️ performSearch 时 state.cache.dictionaryIndex 为空');
    }

    var inputWord = state.ui.searchInput ? state.ui.searchInput.value.trim() : '（无输入框）';
    debugLog('🔍 performSearch: "' + inputWord + '"');

    // Hot-lite 手动输入了另一个词：先按词换入轻量分片。这样 Embedded 内部搜索也不会
    // 因为 partial wordToPages 而错误地把上一词当作“最近词”。
    if (inputWord && state.cache.dictionaryIndex && state.cache.dictionaryIndex._picdicHotLite &&
        !options._hotPrepared) {
        var requestedNorm = normalize(inputWord);
        var currentMap = state.cache._keyMap || {};
        if (!hasOwnKey(currentMap, requestedNorm)) {
            var retryOptions = {};
            for (var optionKey in options) {
                if (Object.prototype.hasOwnProperty.call(options, optionKey)) retryOptions[optionKey] = options[optionKey];
            }
            retryOptions._hotPrepared = true;
            prepareEmbeddedHotIndex(state.ui.currentDictId, inputWord).then(function(hit) {
                if (hit) {
                    state.ui.searchInput.value = inputWord;
                    performSearch(null, retryOptions);
                    return;
                }
                return promoteHotLiteToFullIndex(state.ui.currentDictId).then(function() {
                    state.ui.searchInput.value = inputWord;
                    performSearch(null, retryOptions);
                });
            }).catch(function(error) {
                showToast('搜索准备失败: ' + (error && error.message ? error.message : error));
            });
            return;
        }
    }
    
    // ★ 新增：标记首次搜索已完成
    if (!window._picdic_initialSearchDone) {
        window._picdic_initialSearchDone = true;
    }
    
    if (state.misc._searching) {
        debugLog('⚠️ 搜索正在进行，忽略重复调用');
        return;
    }
    state.misc._searching = true;
    try {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var inputWord = state.ui.searchInput.value.trim();
        state.misc._currentSearchWord = inputWord;
        clearCurrentSearchMatchMetadata();
        debugLog('🔍 搜索: "' + inputWord + '"');
        if (!inputWord) {
            showToast('请输入单词');
            return;
        }
        if (!state.cache.dictionaryIndex) {
            state.ui.resultDiv.innerHTML = '❌ 索引未加载';
            return;
        }
        var pages = state.cache.dictionaryIndex.pages;
        var wordToPages = state.cache.dictionaryIndex.wordToPages;
        if (!wordToPages) {
            state.ui.resultDiv.innerHTML = '❌ 索引格式错误';
            return;
        }
        var indexKeyType = (state.cache.dictionaryIndex && state.cache.dictionaryIndex.indexKeyType) || 'en';
        var hasChinese = /[\u4e00-\u9fff]/.test(inputWord);
        state.navigation._lastInputHasChinese = hasChinese;
        if (indexKeyType !== 'pinyin' && hasChinese) {
            showToast('⚠️ 当前词典为英文索引，不支持中文搜索。建议切换到拼音索引词典或输入英文单词。');
            return;
        }
        if (/^\d+$/.test(inputWord)) {
            var dictMeta = state.configStore.data.allDictConfigs[state.ui.currentDictId];
            var pagesInfo = dictMeta && dictMeta._pagesInfo;
            if (!pagesInfo || typeof pagesInfo.numericWidth !== 'number') {
                updatePagesInfo(state.ui.currentDictId);
                dictMeta = state.configStore.data.allDictConfigs[state.ui.currentDictId];
                pagesInfo = dictMeta && dictMeta._pagesInfo;
            }
            var maxLen = pagesInfo ? pagesInfo.numericWidth : 0;
            if (maxLen === 0) {
                showToast('⚠️ 没有数字页码可供跳转');
                return;
            }
            var padded = inputWord;
            while (padded.length < maxLen) padded = '0' + padded;
            if (pages.indexOf(padded) !== -1) {
                debugLog('📄 直接跳转页码: ' + padded);
                state.navigation.currentWordPages = null;
                state.navigation.currentPageKeyMap = null;
                displayPage(padded);
                saveHistory(inputWord, state.ui.currentDictId);
                return;
            } else {
                showToast('⚠️ 未找到页码：' + inputWord + '（补齐后: ' + padded + '）');
                return;
            }
        }
        if (indexKeyType === 'pinyin' && hasChinese) {
            if (typeof window.pinyinPro === 'undefined') {
                state.ui.resultDiv.innerHTML = '❌ 拼音库未加载，回退到英文索引。';
                debugLog('⚠️ 拼音库缺失，回退到英文索引');
                if (state.misc._fallbackSearch) {
                    state.ui.resultDiv.innerHTML = '⚠️ 拼音库缺失，且回退失败。';
                    return;
                }
                state.misc._fallbackSearch = true;
                state.misc._searching = false;
                performSearch(e);
                state.misc._searching = true;
                state.misc._fallbackSearch = false;
                return;
            }
            var allPages = [];
            var pageToKey = {};
            if (inputWord.length === 1) {
                var pinyinResult = window.pinyinPro.pinyin(inputWord, { toneType: 'num', multiple: true });
                var readings = [];
                if (typeof pinyinResult === 'string') {
                    readings = pinyinResult.split(/\s+/);
                } else if (Array.isArray(pinyinResult) && pinyinResult.length > 0) {
                    var first = pinyinResult[0];
                    if (Array.isArray(first)) readings = first;
                    else if (typeof first === 'string') readings = first.split(/\s+/);
                }
                readings.forEach(function(py) {
                    if (!py) return;
                    var pgs = getPagesForWord(wordToPages, py);
                    if (pgs) {
                        pgs.forEach(function(pg) {
                            if (allPages.indexOf(pg) === -1) {
                                allPages.push(pg);
                                pageToKey[pg] = py;
                            }
                        });
                    }
                });
            } else {
                var pinyinArray = window.pinyinPro.pinyin(inputWord, { toneType: 'num' });
                var firstPy = null;
                if (typeof pinyinArray === 'string') {
                    var parts = pinyinArray.split(/\s+/);
                    if (parts.length > 0) firstPy = parts[0];
                } else if (Array.isArray(pinyinArray) && pinyinArray.length > 0) {
                    var first = pinyinArray[0];
                    if (Array.isArray(first) && first.length > 0) firstPy = first[0];
                    else if (typeof first === 'string') firstPy = first;
                }
                if (firstPy) {
                    var pgs = getPagesForWord(wordToPages, firstPy);
                    if (pgs) {
                        pgs.forEach(function(pg) {
                            if (allPages.indexOf(pg) === -1) {
                                allPages.push(pg);
                                pageToKey[pg] = firstPy;
                            }
                        });
                    }
                }
            }
            if (allPages.length === 0) {
                showToast('⚠️ 未找到与 "' + inputWord + '" 对应的拼音页面。');
                debugLog('⚠️ 拼音匹配无结果');
                return;
            }
            allPages.sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10); });
            state.navigation.currentPageKeyMap = pageToKey;
            state.navigation.currentWordPages = allPages;
            state.navigation.currentWordIndex = 0;
            debugLog('📚 拼音匹配页面列表: ' + allPages.join(', '));
            if (isExternalSearch) requestExternalResultAutoFocus(allPages[0]);
            displayPage(allPages[0]);
            if (allPages.length > 1) {
                var preloadCount = state.config.globalConfig.preloadPages || 1;
                var toPreload = allPages.slice(1, Math.min(allPages.length, 1 + preloadCount));
                preloadSpecificPages(toPreload);
            }
            saveHistory(inputWord, state.ui.currentDictId);
            return;
        }

        // -------------------- 英文/通用索引搜索 --------------------
        state.navigation.currentPageKeyMap = null;
        var normTarget = normalize(inputWord);

        // O(1) 校验；只有缓存缺失/归属不符时才重建一次，不按 key 数量反复判断。
        if (!state.cache._searchCacheReady ||
            state.cache._searchCacheDictId !== state.ui.currentDictId ||
            state.cache._searchCacheIndexPath !== state.cache.dictionaryIndex._picdicIndexPath ||
            !state.cache._normalizedKeys || !state.cache._keyMap) {
            cacheNormalizedKeys();
        }
        var normKeys = state.cache._normalizedKeys;
        var keyMap = state.cache._keyMap;
        var matchKeys = [];
        var matchedNormalized = normTarget;

        // 原始词头精确命中优先放在结果首位，但仍合并同一规范化键下的全部等价词条。
        var exactKey = hasOwnKey(wordToPages, inputWord) ? inputWord : null;
        if (exactKey) matchKeys.push(exactKey);

        var equivalentKeys = hasOwnKey(keyMap, normTarget) ? keyMap[normTarget] : null;
        if (equivalentKeys) {
            for (var ek = 0; ek < equivalentKeys.length; ek++) {
                if (matchKeys.indexOf(equivalentKeys[ek]) === -1) {
                    matchKeys.push(equivalentKeys[ek]);
                }
            }
        }

        if (matchKeys.length === 0 && normKeys.length > 0) {
            // 二分查找最接近的规范化键；映射结果仍是一组原始词头，而不是单个覆盖值。
            var low = 0, high = normKeys.length - 1, pos = normKeys.length;
            while (low <= high) {
                var mid = Math.floor((low + high) / 2);
                var cmp = compareNormalizedKeys(normKeys[mid], normTarget);
                if (cmp === 0) { pos = mid; break; }
                if (cmp < 0) low = mid + 1;
                else high = mid - 1;
            }
            if (pos === normKeys.length) pos = low;
            if (pos < 0) pos = 0;
            if (pos >= normKeys.length) pos = normKeys.length - 1;
            matchedNormalized = normKeys[pos];
            var nearestKeys = keyMap[matchedNormalized] || [];
            for (var nk = 0; nk < nearestKeys.length; nk++) {
                matchKeys.push(nearestKeys[nk]);
            }
        }

        var pgs = [];
        var pageSeen = {};
        var primaryPage = null;
        var ords = [];
        var ordMap = {};
        var pageOrdMap = {};
        for (var mk = 0; mk < matchKeys.length; mk++) {
            var matchedKey = matchKeys[mk];
            var keyPages = getPagesForWord(wordToPages, matchedKey);
            if (keyPages) {
                if (primaryPage === null && exactKey && matchedKey === exactKey && keyPages.length > 0) {
                    primaryPage = keyPages[0];
                }
                for (var kp = 0; kp < keyPages.length; kp++) {
                    var pageKey = String(keyPages[kp]);
                    if (!hasOwnKey(pageSeen, pageKey)) {
                        pageSeen[pageKey] = true;
                        pgs.push(keyPages[kp]);
                    }
                }
            }
            addEntryOrds(wordToPages[matchedKey], ords, ordMap, pageOrdMap);
        }

        state.misc._currentSearchNormalized = matchedNormalized;
        state.misc._currentSearchKeys = matchKeys.slice();
        state.misc._currentSearchOrds = ords;
        state.misc._currentSearchOrdMap = ordMap;
        state.misc._currentSearchPageOrdMap = pageOrdMap;
        state.misc._currentSearchOrd = ords.length > 0 ? ords[0] : null;

        if (pgs && pgs.length > 0) {
            pgs.sort(comparePageIds);
            // 精确原始词头存在时，优先显示它的首个页面；其余等价词条页面继续保留。
            if (primaryPage !== null) {
                var primaryIndex = pgs.indexOf(primaryPage);
                if (primaryIndex > 0) {
                    pgs.splice(primaryIndex, 1);
                    pgs.unshift(primaryPage);
                }
            }
            state.navigation.currentWordPages = pgs;
            state.navigation.currentWordIndex = 0;
            debugLog('📚 匹配规范化键: "' + state.misc._currentSearchNormalized +
                '"，等价词条=' + state.misc._currentSearchKeys.length +
                '，页面=' + pgs.length);
            if (isExternalSearch) requestExternalResultAutoFocus(pgs[0]);
            displayPage(pgs[0]);
            if (pgs.length > 1) {
                var preloadCount = state.config.globalConfig.preloadPages || 1;
                var toPreload = pgs.slice(1, Math.min(pgs.length, 1 + preloadCount));
                preloadSpecificPages(toPreload);
            }
            saveHistory(inputWord, state.ui.currentDictId);
        } else {
            var suggestMsg = '⚠️ 未找到与 "' + inputWord + '" 对应的页面。';
            if (!hasChinese && indexKeyType === 'en') {
                suggestMsg += ' 请检查拼写，或尝试输入更简短的词根。';
            } else if (hasChinese && indexKeyType === 'pinyin') {
                suggestMsg += ' 当前为拼音索引，请检查输入是否正确（如 "zhongguo"）。';
            }
            showToast(suggestMsg);
            debugLog('⚠️ 未找到匹配');
            state.navigation.currentWordPages = null;
            clearCurrentSearchMatchMetadata();
        }
    } finally {
        state.misc._searching = false;
    }
}

// ==================== UI 构建 ====================
function buildUI() {
    var searchBox = document.getElementById('searchBox');
    if (!searchBox) return;
    var input = document.getElementById('searchInput');
    if (!input) return;
    searchBox.innerHTML = '';
    var wrapper = document.createElement('div');
    wrapper.className = 'picdic-toolbar-wrapper';
    var leftContainer = document.createElement('div');
    leftContainer.className = 'search-left';
    leftContainer.appendChild(input);
    var pageInfo = document.createElement('span');
    pageInfo.id = 'picdic_pageinfo';
    pageInfo.className = 'page-info';
    leftContainer.appendChild(pageInfo);
    state.ui.pageInfoElement = pageInfo;
    wrapper.appendChild(leftContainer);
    var btnGroup = document.createElement('div');
    btnGroup.className = 'toolbar-group';
    var histBtn = document.createElement('button');
    histBtn.textContent = '📜';
    histBtn.className = 'toolbar-btn';
    histBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        showHistoryPanel();
    });
    var configBtn = document.createElement('button');
    configBtn.textContent = '⚙️';
    configBtn.className = 'toolbar-btn';
    configBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        showConfigMenu();
    });
    var dictBtn = document.createElement('button');
    dictBtn.textContent = '📚';
    dictBtn.className = 'toolbar-btn';
    dictBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        showDictListMenu();
    });
    btnGroup.appendChild(histBtn);
    btnGroup.appendChild(configBtn);
    btnGroup.appendChild(dictBtn);
    wrapper.appendChild(btnGroup);
    searchBox.appendChild(wrapper);
    state.ui.searchInput = input;
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.isComposing) {
            performSearch(e);
        }
    });
    input.addEventListener('input', function() {
        if (!state.config.globalConfig.enableInputDebounce) return;
        if (state.misc._searchDebounceTimer) clearTimeout(state.misc._searchDebounceTimer);
        state.misc._searchDebounceTimer = setTimeout(function() {
            performSearch();
        }, state.config.globalConfig.inputDebounceDelay || 300);
    });
    function selectAllSearchInput() {
        var el = input;
        setTimeout(function() {
            if (document.activeElement === el && typeof el.select === 'function') {
                el.select();
            }
        }, 0);
    }
    input.addEventListener('focus', selectAllSearchInput);
    input.addEventListener('click', selectAllSearchInput);
    if (state.misc._savedWord) {
        input.value = state.misc._savedWord;
    }
    updatePageInfo(null);
}

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

			    // 根据环境构造不同的 URL
			    if (_env.isMDictAndroid) {
			        // MDict 使用 entry:// 协议，直接跳转词条
			        url = 'mdx://mdict.cn/entry/-1/' + encodedWord;
			    } else {
			        // GoldenDict 使用 content:// 协议
			        var sourceLang = getSourceLangCode(dictId);
			        var targetLang = -1;
			        url = 'content://mobi.goldendict.android/article/' + sourceLang + '/' + targetLang + '/' + encodedWord;
			    }

			    try {
			        window.location.href = url;
			    } catch (ex) {
			        // 部分环境可能不允许直接跳转，用 open 作为后备
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
                        // 词典名称自身已 stopPropagation；点击列表其余区域也走同一条件切换逻辑，
                        // 防止在非 picdic 主词条下绕过必要的 APP 主词条跳转。
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

function buildConfigPanel() {
    if (state.config._configPanelBuilt) return;
    var actions = [];
    var applyBtn = document.createElement('button');
    applyBtn.className = 'picdic-title-action-btn to_Apply';
    applyBtn.textContent = '应用';
    applyBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        collectAndApplyConfig();
        applyBtn.textContent = '✅';
        setTimeout(function() { applyBtn.textContent = '应用'; }, 1500);
    });
    actions.push(applyBtn);
    var copyBtn = document.createElement('button');
    copyBtn.className = 'picdic-title-action-btn to_Copy';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var iniContent = '[PicDic Global]\n';
        for (var key in state.config.globalConfig) {
            iniContent += key + ' = ' + state.config.globalConfig[key] + '\n';
        }
        iniContent += '\n[Dict: ' + state.ui.currentDictId + ']\n';
        for (var key in state.config.dictConfig) {
            iniContent += key + ' = ' + state.config.dictConfig[key] + '\n';
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(iniContent).then(function() {
                copyBtn.textContent = '✅';
                setTimeout(function() { copyBtn.textContent = '复制'; }, 1500);
            }).catch(function() { fallbackCopy(iniContent); });
        } else {
            fallbackCopy(iniContent);
        }
    });
    actions.push(copyBtn);
    var clearCacheBtn = document.createElement('button');
    clearCacheBtn.className = 'picdic-title-action-btn to_ClearIndexCache';
    clearCacheBtn.textContent = '清理缓存';
    clearCacheBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        showClearCachePanel();
    });
    actions.push(clearCacheBtn);
    var popup = createPopup(
        '⚙️ 设置列表',
        'picdic-config-panel',
        function(content) {
            var form = document.createElement('div');
            form.className = 'picdic-config-form';
            function createControl(labelText, control) {
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
            var controls = {};
            // 词典配置
            var dictSection = document.createElement('div');
            dictSection.className = 'config-section';
            var dictTitleRow = document.createElement('div');
            dictTitleRow.className = 'section-title-row';
            var dictTitle = document.createElement('span');
            dictTitle.textContent = '📖 当前词典设置';
            dictTitleRow.appendChild(dictTitle);
		var dictResetBtn = document.createElement('button');
		dictResetBtn.className = 'picdic-title-action-btn to_Default';
		dictResetBtn.textContent = '恢复';
		dictResetBtn.addEventListener('click', function(e) {
		    e.stopPropagation();
		    var dictId = state.ui.currentDictId;
		    if (!dictId) {
		        showToast('当前无词典');
		        return;
		    }
		    var dict = window.picdic_dictList && window.picdic_dictList[dictId];
		    if (!dict) {
		        showToast('词典信息未加载');
		        return;
		    }
		    var configPath = dict.indexPath.replace('_index.js', '_config.ini');

		    // 二次确认
		    showConfirm(
		        '确认恢复',
		        '确定要恢复当前词典的默认设置吗？此操作将覆盖您之前的所有自定义设置。',
		        function() {  // 确认回调
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
		        },
		        function() {  // 取消回调（可选）
		            debugLog('恢复操作已取消');
		        }
		    );
		});
            dictTitleRow.appendChild(dictResetBtn);
            dictSection.appendChild(dictTitleRow);
            var dictGrid = document.createElement('div');
            dictGrid.className = 'config-grid';

            // V7.6：当前词典设置固定为 3 列 × 3 排。
            // 第一排：目录导航 / 放大倍数 / 仅纵向滑动
            // 第二排：左边裁剪 / 右边裁剪 / 双侧安全边距
            // 第三排：高亮比例：高度 / 单字宽度 / 宽度最大
            dictGrid.style.display = 'grid';
            dictGrid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
            dictGrid.style.columnGap = '10px';
            dictGrid.style.rowGap = '8px';

            // ===== 第一排 =====
            controls.chkTopNav = document.createElement('input');
            controls.chkTopNav.type = 'checkbox';
            controls.chkTopNav.checked = state.config.dictConfig.showTopNav;
            dictGrid.appendChild(createControl('目录导航', controls.chkTopNav));

            controls.inpZoom = document.createElement('input');
            controls.inpZoom.type = 'number';
            controls.inpZoom.step = '0.25';
            controls.inpZoom.min = '1.05';
            controls.inpZoom.max = '4';
            controls.inpZoom.value = state.config.dictConfig.doubleTapZoomFactor;
            dictGrid.appendChild(createControl('放大倍数', controls.inpZoom));

            controls.chkZoomVerticalDragOnly = document.createElement('input');
            controls.chkZoomVerticalDragOnly.type = 'checkbox';
            controls.chkZoomVerticalDragOnly.checked =
                state.config.dictConfig.zoomVerticalDragOnly !== false;
            dictGrid.appendChild(
                createControl('仅纵向滑动', controls.chkZoomVerticalDragOnly)
            );

            // ===== 第二排 =====
            // 左/右裁剪单位：原始图片像素。
            controls.inpExternalCropLeft = document.createElement('input');
            controls.inpExternalCropLeft.type = 'number';
            controls.inpExternalCropLeft.step = '1';
            controls.inpExternalCropLeft.min = '0';
            controls.inpExternalCropLeft.value =
                Math.max(0, parseFloat(state.config.dictConfig.externalCropLeft) || 0);
            controls.inpExternalCropLeft.title = '单位：原始图片像素';
            dictGrid.appendChild(createControl('左边裁剪', controls.inpExternalCropLeft));

            controls.inpExternalCropRight = document.createElement('input');
            controls.inpExternalCropRight.type = 'number';
            controls.inpExternalCropRight.step = '1';
            controls.inpExternalCropRight.min = '0';
            controls.inpExternalCropRight.value =
                Math.max(0, parseFloat(state.config.dictConfig.externalCropRight) || 0);
            controls.inpExternalCropRight.title = '单位：原始图片像素';
            dictGrid.appendChild(createControl('右边裁剪', controls.inpExternalCropRight));

            // 双侧安全边距单位：当前 viewport 宽度百分比。
            controls.inpHorizontalMarginPercent = document.createElement('input');
            controls.inpHorizontalMarginPercent.type = 'number';
            controls.inpHorizontalMarginPercent.step = '0.1';
            controls.inpHorizontalMarginPercent.min = '0';
            controls.inpHorizontalMarginPercent.max = '25';
            controls.inpHorizontalMarginPercent.value =
                Math.max(0, parseFloat(state.config.dictConfig.horizontalMarginPercent) || 0);
            controls.inpHorizontalMarginPercent.title = '单位：当前视口宽度的百分比';
            dictGrid.appendChild(
                createControl('安全边距', controls.inpHorizontalMarginPercent)
            );

            // ===== 第三排：高亮比例 =====
            controls.inpHighlightHeight = document.createElement('input');
            controls.inpHighlightHeight.type = 'number';
            controls.inpHighlightHeight.step = '0.01';
            controls.inpHighlightHeight.min = '1.0';
            controls.inpHighlightHeight.max = '5.0';
            controls.inpHighlightHeight.value =
                state.config.dictConfig.highlightHeight || 1.15;
            dictGrid.appendChild(
                createControl('高亮高度', controls.inpHighlightHeight)
            );

            // 单字宽度：每个字符增加的列宽百分比。
            controls.inpHighlightCharWidth = document.createElement('input');
            controls.inpHighlightCharWidth.type = 'number';
            controls.inpHighlightCharWidth.step = '0.1';
            controls.inpHighlightCharWidth.min = '0.1';
            controls.inpHighlightCharWidth.max = '10';
            controls.inpHighlightCharWidth.value =
                state.config.dictConfig.highlightCharWidth ||
                DEFAULT_DICT_CONFIG.highlightCharWidth;
            dictGrid.appendChild(
                createControl('高亮字宽', controls.inpHighlightCharWidth)
            );

            controls.inpHighlightWidth = document.createElement('input');
            controls.inpHighlightWidth.type = 'number';
            controls.inpHighlightWidth.step = '1';
            controls.inpHighlightWidth.min = '1';
            controls.inpHighlightWidth.max = '99';
            controls.inpHighlightWidth.value =
                state.config.dictConfig.highlightWidth || 25;
            dictGrid.appendChild(
                createControl('最大总宽', controls.inpHighlightWidth)
            );
            
            dictSection.appendChild(dictGrid);
            form.appendChild(dictSection);
            // 全局配置
            var globalSection = document.createElement('div');
            globalSection.className = 'config-section';
            var globalTitleRow = document.createElement('div');
            globalTitleRow.className = 'section-title-row';
            var globalTitle = document.createElement('span');
            globalTitle.textContent = '🌐 全局设置';
            globalTitleRow.appendChild(globalTitle);
		var globalResetBtn = document.createElement('button');
		globalResetBtn.className = 'picdic-title-action-btn to_Default';
		globalResetBtn.textContent = '恢复';
		globalResetBtn.addEventListener('click', function(e) {
		    e.stopPropagation();

		    // 二次确认
		    showConfirm(
		        '确认恢复',
		        '确定要恢复所有全局设置为默认值吗？此操作将覆盖您之前的所有自定义设置。',
		        function() {  // 确认回调
		            loadGlobalConfigJS().then(function(configData) {
		                if (configData) {
		                    var merged = {};
		                    for (var key in DEFAULT_GLOBAL_CONFIG) {
		                        if (key in configData) {
		                            merged[key] = configData[key];
		                        } else {
		                            merged[key] = DEFAULT_GLOBAL_CONFIG[key];
		                        }
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
		        },
		        function() {  // 取消回调（可选）
		            debugLog('恢复操作已取消');
		        }
		    );
		});
            globalTitleRow.appendChild(globalResetBtn);
            globalSection.appendChild(globalTitleRow);
            var globalGrid = document.createElement('div');
            globalGrid.className = 'config-grid';
            controls.chkDebug = document.createElement('input');
            controls.chkDebug.type = 'checkbox';
            controls.chkDebug.checked = state.config.globalConfig.DebugPanel_display;
            globalGrid.appendChild(createControl('调试面板', controls.chkDebug));
            controls.inpMaxHistory = document.createElement('input');
            controls.inpMaxHistory.type = 'number';
            controls.inpMaxHistory.step = '1';
            controls.inpMaxHistory.min = '10';
            controls.inpMaxHistory.max = '500';
            controls.inpMaxHistory.value = state.config.globalConfig.maxHistorySize;
            globalGrid.appendChild(createControl('历史记录', controls.inpMaxHistory));
            controls.defaultPageSelect = document.createElement('select');
            var pageOptions = [
                { value: DEFAULT_PAGE_TYPES.FIRST_CONTENT, label: '正文首页' },
                { value: DEFAULT_PAGE_TYPES.COVER, label: '词典封面' },
                { value: DEFAULT_PAGE_TYPES.LAST_WORD, label: '末次查词' }
            ];
            pageOptions.forEach(function(opt) {
                var option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (opt.value === state.config.globalConfig.defaultPageValue) {
                    option.selected = true;
                }
                controls.defaultPageSelect.appendChild(option);
            });
            globalGrid.appendChild(createControl('首选词典', controls.defaultPageSelect));
            controls.inpPreload = document.createElement('input');
            controls.inpPreload.type = 'number';
            controls.inpPreload.step = '1';
            controls.inpPreload.min = '0';
            controls.inpPreload.max = '5';
            controls.inpPreload.value = state.config.globalConfig.preloadPages;
            globalGrid.appendChild(createControl('预加载页', controls.inpPreload));
            controls.chkDoubleTap = document.createElement('input');
            controls.chkDoubleTap.type = 'checkbox';
            controls.chkDoubleTap.checked = state.config.globalConfig.enableDoubleTapZoom;
            globalGrid.appendChild(createControl('双击放大', controls.chkDoubleTap));
            controls.chkClickPageTurn = document.createElement('input');
            controls.chkClickPageTurn.type = 'checkbox';
            controls.chkClickPageTurn.checked = state.config.globalConfig.enableClickPageTurn;
            globalGrid.appendChild(createControl('单击翻页', controls.chkClickPageTurn));
            controls.chkLongPressZoom = document.createElement('input');
            controls.chkLongPressZoom.type = 'checkbox';
            controls.chkLongPressZoom.checked = state.config.globalConfig.enableLongPressZoom;
            globalGrid.appendChild(createControl('长按放大', controls.chkLongPressZoom));
            controls.inpLongPressDelay = document.createElement('input');
            controls.inpLongPressDelay.type = 'number';
            controls.inpLongPressDelay.step = '50';
            controls.inpLongPressDelay.min = '200';
            controls.inpLongPressDelay.max = '1000';
            controls.inpLongPressDelay.value = state.config.globalConfig.longPressDelay;
            globalGrid.appendChild(createControl('长按延迟', controls.inpLongPressDelay));
            controls.chkShowZoomBtns = document.createElement('input');
            controls.chkShowZoomBtns.type = 'checkbox';
            controls.chkShowZoomBtns.checked = state.config.globalConfig.showZoomButtons;
            globalGrid.appendChild(createControl('放大启用按钮', controls.chkShowZoomBtns));
            controls.inpZoomStep = document.createElement('input');
            controls.inpZoomStep.type = 'number';
            controls.inpZoomStep.step = '0.1';
            controls.inpZoomStep.min = '0.1';
            controls.inpZoomStep.max = '2';
            controls.inpZoomStep.value = state.config.globalConfig.zoomStep;
            globalGrid.appendChild(createControl('按钮缩放倍数', controls.inpZoomStep));
            controls.chkSwipe = document.createElement('input');
            controls.chkSwipe.type = 'checkbox';
            controls.chkSwipe.checked = state.config.globalConfig.swipeEnabled;
            globalGrid.appendChild(createControl('滑动翻页', controls.chkSwipe));
            controls.inpThreshold = document.createElement('input');
            controls.inpThreshold.type = 'number';
            controls.inpThreshold.step = '5';
            controls.inpThreshold.min = '10';
            controls.inpThreshold.max = '100';
            controls.inpThreshold.value = state.config.globalConfig.swipeThreshold;
            globalGrid.appendChild(createControl('滑动阈值', controls.inpThreshold));
            controls.chkInputDebounce = document.createElement('input');
            controls.chkInputDebounce.type = 'checkbox';
            controls.chkInputDebounce.checked = state.config.globalConfig.enableInputDebounce;
            globalGrid.appendChild(createControl('输入防抖', controls.chkInputDebounce));
            controls.inpDebounceDelay = document.createElement('input');
            controls.inpDebounceDelay.type = 'number';
            controls.inpDebounceDelay.step = '50';
            controls.inpDebounceDelay.min = '100';
            controls.inpDebounceDelay.max = '1000';
            controls.inpDebounceDelay.value = state.config.globalConfig.inputDebounceDelay;
            globalGrid.appendChild(createControl('防抖延迟', controls.inpDebounceDelay));
            controls.chkExpandOnZoom = document.createElement('input');
            controls.chkExpandOnZoom.type = 'checkbox';
            controls.chkExpandOnZoom.checked = state.config.globalConfig.enableExpandOnZoom;
            globalGrid.appendChild(createControl('放大时扩展显示高度', controls.chkExpandOnZoom));
            controls.chkAutoZoomExternal = document.createElement('input');
            controls.chkAutoZoomExternal.type = 'checkbox';
            controls.chkAutoZoomExternal.checked = state.config.globalConfig.autoZoomExternalFullIndex;
            controls.chkAutoZoomExternal.title = '仅对具有词条坐标的全索引词典生效';
            globalGrid.appendChild(createControl('外部查询放大定位', controls.chkAutoZoomExternal));
            controls.chkFollow = document.createElement('input');
            controls.chkFollow.type = 'checkbox';
            controls.chkFollow.checked = state.config.globalConfig.darkModeFollowApp;
            globalGrid.appendChild(createControl('跟随程序暗色', controls.chkFollow));
            
            controls.chkDark = document.createElement('input');
            controls.chkDark.type = 'checkbox';
            controls.chkDark.checked = state.config.globalConfig.darkMode;
            if (state.config.globalConfig.darkModeFollowApp) {
                controls.chkDark.disabled = true;
                controls.chkDark.checked = isAppInDarkMode();
            }
            globalGrid.appendChild(createControl('单独暗色模式', controls.chkDark));
            
            var presetRow = document.createElement('div');
            presetRow.className = 'picdic-config-row';
            var presetLabel = document.createElement('label');
            presetLabel.className = 'picdic-config-label';
            presetLabel.textContent = '滤镜预设:';
            presetRow.appendChild(presetLabel);
            var presetWrapper = document.createElement('div');
            presetWrapper.className = 'picdic-config-control';
            controls.selectDarkFilterPreset = document.createElement('select');
            FILTER_PRESETS.forEach(function(p) {
                var opt = document.createElement('option');
                opt.value = p.value;
                opt.textContent = p.label;
                controls.selectDarkFilterPreset.appendChild(opt);
            });
            controls.selectDarkFilterPreset.value = matchFilterPreset(state.config.globalConfig.darkModeFilter);
            controls.selectDarkFilterPreset.addEventListener('change', function() {
                var val = this.value;
                if (val !== '__custom__') {
                    controls.inpDarkFilter.value = val;
                }
            });
            presetWrapper.appendChild(controls.selectDarkFilterPreset);
            presetRow.appendChild(presetWrapper);
            globalGrid.appendChild(presetRow);
            
            var filterRow = document.createElement('div');
            filterRow.className = 'picdic-config-row filter-row';
            var filterLabel = document.createElement('label');
            filterLabel.className = 'picdic-config-label';
            filterLabel.textContent = '暗色滤镜:';
            filterRow.appendChild(filterLabel);
            var filterWrapper = document.createElement('div');
            filterWrapper.className = 'picdic-config-control';
            controls.inpDarkFilter = document.createElement('input');
            controls.inpDarkFilter.type = 'text';
            controls.inpDarkFilter.value = state.config.globalConfig.darkModeFilter;
            filterWrapper.appendChild(controls.inpDarkFilter);
            filterRow.appendChild(filterWrapper);
            globalGrid.appendChild(filterRow);

            var darkBgRow = document.createElement('div');
            darkBgRow.className = 'picdic-config-row';
            var darkBgLabel = document.createElement('label');
            darkBgLabel.className = 'picdic-config-label';
            darkBgLabel.textContent = '暗色背景:';
            darkBgRow.appendChild(darkBgLabel);
            var darkBgWrapper = document.createElement('div');
            darkBgWrapper.className = 'picdic-config-control';
            controls.selectDarkBgPreset = document.createElement('select');
            DARK_BG_PRESETS.forEach(function(p) {
                var opt = document.createElement('option');
                opt.value = p.value;
                opt.textContent = p.label;
                controls.selectDarkBgPreset.appendChild(opt);
            });
            controls.selectDarkBgPreset.value = matchDarkBgPreset(state.config.globalConfig.darkModeBgColor || '#1a1a1a');
            darkBgWrapper.appendChild(controls.selectDarkBgPreset);
            var darkBgPreview = document.createElement('span');
            darkBgPreview.className = 'picdic-color-preview';
            darkBgPreview.style.backgroundColor = state.config.globalConfig.darkModeBgColor || '#1a1a1a';
            darkBgWrapper.appendChild(darkBgPreview);
            controls.inpDarkBg = document.createElement('input');
            controls.inpDarkBg.className = 'picdic-color-input';
            controls.inpDarkBg.type = 'text';
            controls.inpDarkBg.placeholder = '#1a1a1a';
            controls.inpDarkBg.value = state.config.globalConfig.darkModeBgColor || '#1a1a1a';
            darkBgWrapper.appendChild(controls.inpDarkBg);
            darkBgRow.style.gridColumn = '1 / -1';
            darkBgRow.appendChild(darkBgWrapper);
            globalGrid.appendChild(darkBgRow);
            controls.selectDarkBgPreset.addEventListener('change', function() {
                var val = this.value;
                if (val !== '__custom__') {
                    controls.inpDarkBg.value = val;
                    darkBgPreview.style.backgroundColor = val;
                }
            });
            controls.inpDarkBg.addEventListener('input', function() {
                darkBgPreview.style.backgroundColor = this.value || '#1a1a1a';
            });
            var lightBgRow = document.createElement('div');
            lightBgRow.className = 'picdic-config-row';
            var lightBgLabel = document.createElement('label');
            lightBgLabel.className = 'picdic-config-label';
            lightBgLabel.textContent = '浅色背景:';
            lightBgRow.appendChild(lightBgLabel);
            var lightBgWrapper = document.createElement('div');
            lightBgWrapper.className = 'picdic-config-control';
            controls.selectLightBgPreset = document.createElement('select');
            LIGHT_BG_PRESETS.forEach(function(p) {
                var opt = document.createElement('option');
                opt.value = p.value;
                opt.textContent = p.label;
                controls.selectLightBgPreset.appendChild(opt);
            });
            controls.selectLightBgPreset.value = matchLightBgPreset(state.config.globalConfig.lightModeBgColor || '#ffffff');
            lightBgWrapper.appendChild(controls.selectLightBgPreset);
            var lightBgPreview = document.createElement('span');
            lightBgPreview.className = 'picdic-color-preview';
            lightBgPreview.style.backgroundColor = state.config.globalConfig.lightModeBgColor || '#ffffff';
            lightBgWrapper.appendChild(lightBgPreview);
            controls.inpLightBg = document.createElement('input');
            controls.inpLightBg.className = 'picdic-color-input';
            controls.inpLightBg.type = 'text';
            controls.inpLightBg.placeholder = '#ffffff';
            controls.inpLightBg.value = state.config.globalConfig.lightModeBgColor || '#ffffff';
            lightBgWrapper.appendChild(controls.inpLightBg);
            lightBgRow.style.gridColumn = '1 / -1';
            lightBgRow.appendChild(lightBgWrapper);
            globalGrid.appendChild(lightBgRow);
            controls.selectLightBgPreset.addEventListener('change', function() {
                var val = this.value;
                if (val !== '__custom__') {
                    controls.inpLightBg.value = val;
                    lightBgPreview.style.backgroundColor = val;
                }
            });
            controls.inpLightBg.addEventListener('input', function() {
                lightBgPreview.style.backgroundColor = this.value || '#ffffff';
            });
            globalSection.appendChild(globalGrid);
            form.appendChild(globalSection);
            content.appendChild(form);
            state.config._configControls = controls;
        },
        actions,
        function() {
            state.config._configPanelBuilt = false;
            state.config._configOverlay = null;
            state._configPopup = null;
            configMenuVisible = false;
        }
    );
    state._configPopup = popup;
    state.config._configOverlay = popup.overlay;
    state.config._configPanel = popup.panel;
    state.config._configPanelBuilt = true;

    function refreshConfigForm() {
        if (!state.config._configControls) return;
        var c = state.config._configControls;
        c.chkDebug.checked = state.config.globalConfig.DebugPanel_display;
        c.inpPreload.value = state.config.globalConfig.preloadPages;
        c.chkShowZoomBtns.checked = state.config.globalConfig.showZoomButtons;
        c.inpZoomStep.value = state.config.globalConfig.zoomStep;
        c.chkSwipe.checked = state.config.globalConfig.swipeEnabled;
        c.inpThreshold.value = state.config.globalConfig.swipeThreshold;
        c.chkInputDebounce.checked = state.config.globalConfig.enableInputDebounce;
        c.inpDebounceDelay.value = state.config.globalConfig.inputDebounceDelay;
        c.chkDoubleTap.checked = state.config.globalConfig.enableDoubleTapZoom;
        c.chkExpandOnZoom.checked = state.config.globalConfig.enableExpandOnZoom;
        c.chkAutoZoomExternal.checked = state.config.globalConfig.autoZoomExternalFullIndex;
        c.chkClickPageTurn.checked = state.config.globalConfig.enableClickPageTurn;
        c.chkLongPressZoom.checked = state.config.globalConfig.enableLongPressZoom;
        c.inpLongPressDelay.value = state.config.globalConfig.longPressDelay;
        c.inpHighlightHeight.value = state.config.dictConfig.highlightHeight || 1.15;
        c.inpHighlightWidth.value = state.config.dictConfig.highlightWidth || 25;
        c.inpHighlightCharWidth.value = state.config.dictConfig.highlightCharWidth || DEFAULT_DICT_CONFIG.highlightCharWidth;
        if (c.defaultPageSelect) {
            c.defaultPageSelect.value = state.config.globalConfig.defaultPageValue || DEFAULT_PAGE_TYPES.FIRST_CONTENT;
        }
        c.chkFollow.checked = state.config.globalConfig.darkModeFollowApp;
        c.chkDark.checked = state.config.globalConfig.darkMode;
        if (state.config.globalConfig.darkModeFollowApp) {
            c.chkDark.disabled = true;
        } else {
            c.chkDark.disabled = false;
        }
        c.inpDarkFilter.value = state.config.globalConfig.darkModeFilter;
        c.selectDarkFilterPreset.value = matchFilterPreset(state.config.globalConfig.darkModeFilter);
        c.selectLightBgPreset.value = matchLightBgPreset(state.config.globalConfig.lightModeBgColor || '#ffffff');
        c.inpLightBg.value = state.config.globalConfig.lightModeBgColor || '#ffffff';
        var lightPreview = c.selectLightBgPreset.parentNode.querySelector('.picdic-color-preview');
        if (lightPreview) {
            lightPreview.style.backgroundColor = state.config.globalConfig.lightModeBgColor || '#ffffff';
        }
        c.selectDarkBgPreset.value = matchDarkBgPreset(state.config.globalConfig.darkModeBgColor || '#1a1a1a');
        c.inpDarkBg.value = state.config.globalConfig.darkModeBgColor || '#1a1a1a';
        var darkPreview = c.selectDarkBgPreset.parentNode.querySelector('.picdic-color-preview');
        if (darkPreview) {
            darkPreview.style.backgroundColor = state.config.globalConfig.darkModeBgColor || '#1a1a1a';
        }
        c.inpZoom.value = state.config.dictConfig.doubleTapZoomFactor;
        if (c.inpExternalCropLeft) {
            c.inpExternalCropLeft.value =
                Math.max(0, parseFloat(state.config.dictConfig.externalCropLeft) || 0);
        }
        if (c.inpExternalCropRight) {
            c.inpExternalCropRight.value =
                Math.max(0, parseFloat(state.config.dictConfig.externalCropRight) || 0);
        }
        if (c.inpHorizontalMarginPercent) {
            c.inpHorizontalMarginPercent.value =
                Math.max(0, parseFloat(state.config.dictConfig.horizontalMarginPercent) || 0);
        }
        if (c.chkZoomVerticalDragOnly) {
            c.chkZoomVerticalDragOnly.checked =
                state.config.dictConfig.zoomVerticalDragOnly !== false;
        }
        c.chkTopNav.checked = state.config.dictConfig.showTopNav;
        c.inpMaxHistory.value = state.config.globalConfig.maxHistorySize;
    }
    state.config._refreshConfigForm = refreshConfigForm;

    function collectAndApplyConfig() {
        var c = state.config._configControls;
        // 收集全局配置
        var newGlobal = {
            DebugPanel_display: c.chkDebug.checked,
            darkModeFollowApp: c.chkFollow.checked,
            darkMode: c.chkDark.checked,
            darkModeFilter: sanitizeCSSValue(c.inpDarkFilter.value) || DEFAULT_GLOBAL_CONFIG.darkModeFilter,
            lightModeBgColor: sanitizeCSSValue(c.inpLightBg.value) || '#ffffff',
            darkModeBgColor: sanitizeCSSValue(c.inpDarkBg.value) || '#1a1a1a',
            swipeEnabled: c.chkSwipe.checked,
            swipeThreshold: parseInt(c.inpThreshold.value, 10) || DEFAULT_GLOBAL_CONFIG.swipeThreshold,
            preloadPages: parseInt(c.inpPreload.value, 10) || DEFAULT_GLOBAL_CONFIG.preloadPages,
            zoomStep: parseFloat(c.inpZoomStep.value) || DEFAULT_GLOBAL_CONFIG.zoomStep,
            showZoomButtons: c.chkShowZoomBtns.checked,
            enableExpandOnZoom: c.chkExpandOnZoom.checked,
            autoZoomExternalFullIndex: c.chkAutoZoomExternal.checked,
            enableInputDebounce: c.chkInputDebounce.checked,
            inputDebounceDelay: parseInt(c.inpDebounceDelay.value, 10) || 300,
            enableLongPressZoom: c.chkLongPressZoom.checked,
            longPressDelay: parseInt(c.inpLongPressDelay.value, 10) || 400,
            enableDoubleTapZoom: c.chkDoubleTap.checked,
            enableClickPageTurn: c.chkClickPageTurn.checked,
            maxHistorySize: parseInt(c.inpMaxHistory.value, 10) || 50,
            defaultPageValue: c.defaultPageSelect.value || DEFAULT_PAGE_TYPES.FIRST_CONTENT
        };
        if (newGlobal.maxHistorySize < 1) newGlobal.maxHistorySize = 50;
        // 直接修改数据
        Object.assign(state.configStore.data.globalConfig, newGlobal);
        // 更新历史最大条数
        if (state.historyStore && state.historyStore.getAll().length > newGlobal.maxHistorySize) {
            state.historyStore.history.length = newGlobal.maxHistorySize;
        }
        var cropLeftValue = parseFloat(c.inpExternalCropLeft && c.inpExternalCropLeft.value);
        var cropRightValue = parseFloat(c.inpExternalCropRight && c.inpExternalCropRight.value);
        if (!isFinite(cropLeftValue) || cropLeftValue < 0) cropLeftValue = 0;
        if (!isFinite(cropRightValue) || cropRightValue < 0) cropRightValue = 0;

        var horizontalMarginPercentValue =
            parseFloat(c.inpHorizontalMarginPercent && c.inpHorizontalMarginPercent.value);
        if (!isFinite(horizontalMarginPercentValue) || horizontalMarginPercentValue < 0) {
            horizontalMarginPercentValue = 0;
        }
        if (horizontalMarginPercentValue > 25) {
            horizontalMarginPercentValue = 25;
        }

        var newDict = {
            doubleTapZoomFactor: parseFloat(c.inpZoom.value) || DEFAULT_DICT_CONFIG.doubleTapZoomFactor,
            showTopNav: c.chkTopNav.checked,
            externalCropLeft: cropLeftValue,
            externalCropRight: cropRightValue,
            horizontalMarginPercent: horizontalMarginPercentValue,
            zoomVerticalDragOnly: !!(c.chkZoomVerticalDragOnly && c.chkZoomVerticalDragOnly.checked),
            highlightHeight: parseFloat(c.inpHighlightHeight.value) || 1.15,
            highlightWidth: parseFloat(c.inpHighlightWidth.value) || 25,
            highlightCharWidth: parseFloat(c.inpHighlightCharWidth.value) || DEFAULT_DICT_CONFIG.highlightCharWidth
        };
        Object.assign(state.configStore.data.dictConfig, newDict);
        // 更新当前词典的 allDictConfigs
        if (state.ui.currentDictId) {
            if (!state.configStore.data.allDictConfigs[state.ui.currentDictId]) {
                state.configStore.data.allDictConfigs[state.ui.currentDictId] = {};
            }
            for (var k in DEFAULT_DICT_CONFIG) {
                state.configStore.data.allDictConfigs[state.ui.currentDictId][k] =
                    state.configStore.data.dictConfig[k];
            }
        }
        // 触发变更
        state.configManager.notifyChange();
        // 关闭面板
        if (state._configPopup) {
            state._configPopup.close();
        }
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

// ==================== 资源ID ====================
function getCurrentResourceId() {
    var dictId = state.ui.currentDictId;
    var resourceId = null;
    if (dictId) {
        resourceId = applyEffectiveResourceId(dictId);
        if (resourceId) {
            debugLog('📥 getCurrentResourceId: 使用当前环境映射 resourceId=' + resourceId);
            return String(resourceId);
        }
    }
    if (_env.isGoldenDictAndroid) {
        try {
            var el = document.querySelector('span.gdarticle');
            if (el && el.id) {
                var match = el.id.match(/gdarticle-([a-f0-9]+)/);
                if (match) {
                    resourceId = match[1];
                    if (!state._cachedResourceId) state._cachedResourceId = {};
                    state._cachedResourceId[dictId] = resourceId;
                    if (cacheDetectedResourceId(dictId, resourceId, 'GoldenDict 当前条目检测')) state.configManager.notifyChange();
                    debugLog('⚠️ getCurrentResourceId: 从 DOM 提取 resourceId=' + resourceId);
                    return resourceId;
                }
            }
            el = document.querySelector('span.gdarticleref');
            if (el && el.id) {
                var match = el.id.match(/gdarticleref-([a-f0-9]+)/);
                if (match) {
                    resourceId = match[1];
                    if (!state._cachedResourceId) state._cachedResourceId = {};
                    state._cachedResourceId[dictId] = resourceId;
                    if (cacheDetectedResourceId(dictId, resourceId, 'GoldenDict 当前引用检测')) state.configManager.notifyChange();
                    debugLog('⚠️ getCurrentResourceId: 从 DOM (ref) 提取 resourceId=' + resourceId);
                    return resourceId;
                }
            }
        } catch(e) {}
    }
    if (_env.isMDictAndroid && typeof window.dict_id !== 'undefined' && window.dict_id !== null) {
        resourceId = String(window.dict_id);
        if (!state._cachedResourceId) state._cachedResourceId = {};
        state._cachedResourceId[dictId] = resourceId;
        if (cacheDetectedResourceId(dictId, resourceId, 'MDict window.dict_id')) state.configManager.notifyChange();
        debugLog('📥 getCurrentResourceId: 从 window.dict_id 获取 resourceId=' + resourceId);
        return resourceId;
    }
    debugLog('⚠️ getCurrentResourceId: 所有方法失败，使用默认后备');
    return '__no_resourceId__';
}

// ==================== 初始化 ====================
function init() {
    // 临时：强制删除数据库
    //window.indexedDB.deleteDatabase('PicDicDB');
    
    var debugDiv = document.createElement('div');
    debugDiv.className = 'picdic-debug-panel';
    debugDiv.id = 'debugPanel';
    var logContainer = document.createElement('div');
    logContainer.className = 'debug-log-container';
    debugDiv.appendChild(logContainer);
    document.body.appendChild(debugDiv);
    state.ui.debugDiv = debugDiv;
    state.ui.logContainer = logContainer;

    state.ui.searchInput = document.getElementById('searchInput');
    state.ui.resultDiv = document.getElementById('result');
    if (!state.ui.searchInput || !state.ui.resultDiv) {
        debugLog('❌ 关键DOM缺失');
        return;
    }

	window.addEventListener('error', function(e) {
	    debugLog('❌ 全局错误: ' + e.message, 'error');
	    showToast('发生错误，请尝试刷新页面');
	    // 可选：将错误写入日志
	    console.error('[PicDic Uncaught]', e);
	});

	// 未捕获的 Promise 异常
	window.addEventListener('unhandledrejection', function(e) {
	    debugLog('❌ 未处理的 Promise 错误: ' + e.reason, 'error');
	    showToast('发生错误，请尝试刷新页面');
	    console.error('[PicDic Unhandled Rejection]', e.reason);
	});
       //如果屏幕旋转或窗口大小改变，availableHeight 会变化。可以监听 resize 事件，在扩展模式下重新计算高度。
	window.addEventListener('resize', function() {
	    // 关键：MDict 环境下，如果处于扩展模式，直接跳过，防止循环
	    if (_env.isMDictAndroid && state.layout.isExpanded) {
	        return;
	    }

	    // 其他情况（桌面、GoldenDict、或未扩展时），按需调整
	    if (state.layout.isExpanded && state.interaction.wrapper) {
	        var toolbar = document.querySelector('.picdic-toolbar-wrapper');
	        var toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
	        var margin = 10;
	        var availableHeight = window.innerHeight - toolbarHeight - margin;
	        if (availableHeight < 200) availableHeight = 200;
	        state.interaction.wrapper.style.height = availableHeight + 'px';
	        state.layout.expandedHeight = availableHeight;
	        // 重新约束边界
	        if (state.interaction.scale > 1.01) {
	            constrainTransform();
	        }
	    }
	});

    state.configStore = new ConfigStore();
    state.historyStore = new HistoryStore();

    state.configStore.load().then(function(configLoaded) {
        if (!configLoaded) {
            loadGlobalConfigJS().then(function(globalConfig) {
                if (globalConfig) {
                    Object.assign(state.configStore.data.globalConfig, globalConfig);
                    state.configStore.save();
                }
                state.historyStore.load().then(function() {
                    afterConfigReady();
                });
            }).catch(function() {
                state.historyStore.load().then(function() {
                    afterConfigReady();
                });
            });
        } else {
            state.historyStore.load().then(function() {
                afterConfigReady();
            });
        }
    });
}

// ===== 在所有代码末尾（init 调用之后）设置标记 =====
window._picdic_loaded = true;

// 同时暴露 performSearch 为全局函数（便于外部点击事件调用）
window._picdic_performSearch = performSearch;

// 文字词典再次显示 PicDic 整页模式时调用：不重载索引，只按当前尺寸刷新界面/高亮。
window._picdic_embedded_refresh = function() {
    if (!_picdicEmbeddedMode || !state || !state.ui || !state.ui.resultDiv) return false;
    requestAnimationFrame(function() {
        try {
            applyConfig();
            if (state.ui.pageNum) {
                updatePageInfo(state.ui.pageNum);
                state._lastDrawTime = 0;
                if (state.cache._hasPagePositions) drawWordAnnotations(state.ui.pageNum);
                updateHotZones();
            }
        } catch (e) {}
    });
    return true;
};


async function afterConfigReady() {
    if (window.location.protocol === 'mdx:') _env.isMDictAndroid = true;
    else if (window.location.protocol === 'content:') _env.isGoldenDictAndroid = true;

    // 词典列表跳转落地页的宿主词通常是 "picdic"。有效的一次性请求必须
    // 优先于这个入口词，否则内部查询会被错误覆盖成 picdic。
    var initialHostWord = String(_initialExternalWord || '').trim().toLocaleLowerCase();
    var mayBeMDictJumpLanding = !initialHostWord || initialHostWord === 'picdic';
    if (_env.isMDictAndroid && mayBeMDictJumpLanding) {
        var pendingJump = await readPendingMDictJumpRequest();
        if (pendingJump) {
            state.misc._savedWord = pendingJump.word || '';
            state.misc._autoSearch = !!state.misc._savedWord;
            state._pendingDictId = pendingJump.dictId;
            state.misc._pendingMdictJumpRequest = pendingJump;
            debugLog('📥 读取 MDict 主词条跳转请求: dict=' + pendingJump.dictId +
                ', word=' + (pendingJump.word || '（空）'));
        }
    }

// ===== 使用保存的初始外部词条 =====
if (_initialExternalWord && !state.misc._pendingMdictJumpRequest) {
    state.misc._savedWord = _initialExternalWord;
    state.misc._autoSearch = true;
    debugLog('📥 检测到外部词条: ' + _initialExternalWord);
    if (_initialExternalDictId) {
        debugLog('📥 外部词典 ID: ' + _initialExternalDictId);
        state._pendingDictId = _initialExternalDictId;
    }
}


    // 初始化 configManager
    state.configManager = new ConfigManager(state.configStore);
    // 注册变更回调（自动应用配置）
    state.configManager.onChange(function() {
        applyConfig();
    });

    // 将 state.config 指向 configManager 的数据（兼容旧代码）
    state.config.globalConfig = state.configManager.store.data.globalConfig;
    state.config.dictConfig = state.configManager.store.data.dictConfig;
    state.config.allDictConfigs = state.configManager.store.data.allDictConfigs;

    state.misc.lastDarkMode = state.config.globalConfig.darkMode;
    applyConfig();

    state.cache.preloadManager = new PreloadManager({
        concurrency: RESOURCE_CONCURRENCY,
        maxCacheSize: MAX_PRELOAD_CACHE
    });
    debugLog('✅ 预加载管理器已初始化');

    buildUI();
    rememberConfiguredResourceIds();
    restoreResourceIdsFromCache();
    updateResourceIds();

    var dictList = window.picdic_dictList;
    if (!dictList || Object.keys(dictList).length === 0) {
        state.ui.resultDiv.innerHTML = '⚠️ 没有可用的词典。';
        return;
    }
    var ids = Object.keys(dictList);
    var defaultId = state.config.globalConfig.defaultDictId;
    var targetDictId = defaultId && ids.indexOf(defaultId) !== -1 ? defaultId : ids[0];
    
    // 如果外部/MDict 跳转指定了词典 ID 且有效，优先使用。
    if (state._pendingDictId && ids.indexOf(state._pendingDictId) !== -1) {
        targetDictId = state._pendingDictId;
        debugLog('🔄 使用外部指定的词典: ' + targetDictId);
    } else if (state.misc._pendingMdictJumpRequest) {
        var invalidJump = state.misc._pendingMdictJumpRequest;
        clearPendingMDictJumpRequest(invalidJump.requestId);
        state.misc._pendingMdictJumpRequest = null;
        state.misc._savedWord = '';
        state.misc._autoSearch = false;
        showToast('跳转目标词典不存在：' + invalidJump.dictId);
    }


    state.ui.currentDictId = targetDictId;
    try {
        var embeddedHotStarted = false;
        if (_picdicEmbeddedMode && state.misc._savedWord) {
            // 关键快速路径：GoldenDict 新词条页优先只读取一个轻量词条分片和命中页位置。
            // Hot miss 才恢复旧的大对象缓存/索引。
            embeddedHotStarted = await prepareEmbeddedHotIndex(targetDictId, state.misc._savedWord);
        }
        if (!embeddedHotStarted) {
            await loadIndexAndConfig(targetDictId);
        }
        if (!isIndexOwnedBy(targetDictId, state.cache.dictionaryIndex)) {
            throw new Error('初始索引与目标词典不对应');
        }
        if (targetDictId) {
            await ensureDictIframe(targetDictId);
        }

        if (_picdicEmbeddedMode) {
            window._picdic_embedded_ready = true;
            _picdicSetEmbeddedReady(true);
            try {
                window.dispatchEvent(new CustomEvent('picdic-embedded-ready', {
                    detail: { dictId: targetDictId, word: state.misc._savedWord || _initialExternalWord || '' }
                }));
            } catch (e) {}
        }

        // MDict 词典列表跳转：先完成目标词典索引加载，再用原输入框词条查询。
        if (state.misc._pendingMdictJumpRequest) {
            var jumpRequest = state.misc._pendingMdictJumpRequest;
            var jumpWord = String(jumpRequest.word || '').trim();
            if (state.ui.searchInput) state.ui.searchInput.value = jumpWord;

            if (jumpWord) {
                debugLog('🔥 MDict 跳转完成，准备在 ' + targetDictId + ' 中查询: ' + jumpWord);
                setTimeout(function() {
                    performSearch(null, { external: true });
                    clearPendingMDictJumpRequest(jumpRequest.requestId);
                    state.misc._pendingMdictJumpRequest = null;
                }, 100);
            } else {
                clearPendingMDictJumpRequest(jumpRequest.requestId);
                state.misc._pendingMdictJumpRequest = null;
                var jumpDefaultTarget = getDefaultPage();
                if (jumpDefaultTarget && typeof jumpDefaultTarget === 'object' &&
                    jumpDefaultTarget.type === 'search') {
                    state.ui.searchInput.value = jumpDefaultTarget.word;
                    performSearch();
                } else if (jumpDefaultTarget) {
                    displayPage(jumpDefaultTarget);
                }
            }
            state.misc._autoSearch = false;
            return;
        }

        var urlParams = new URLSearchParams(window.location.search);
        var fromWord = urlParams.get('from');
        if (fromWord) {
            state.ui.searchInput.value = decodeURIComponent(fromWord);
            var srcCode = urlParams.get('src');
            if (srcCode) state._jumpSrc = parseInt(srcCode, 10);
            performSearch();
            return;
        }

if (state.misc._savedWord && state.misc._autoSearch) {
    debugLog('🔥 afterConfigReady: 准备搜索保存的词 ' + state.misc._savedWord);
    state.ui.searchInput.value = state.misc._savedWord;
    setTimeout(function() { 
        debugLog('🔥 afterConfigReady 延迟调用 performSearch');
        performSearch(null, { external: true }); 
    }, 100);
    state.misc._autoSearch = false;
    return;
}

        debugLog('✅ 初始化完成，当前词典: ' + state.ui.currentDictId);
        // 稳定界面（第一次加载，只显示容器和请求列表，不自动搜索）
        stabilizePicDic();
    } catch (err) {
        if (_picdicEmbeddedMode) {
            window._picdic_embedded_ready = false;
            _picdicSetEmbeddedReady(false);
        }
        debugLog('❌ 初始索引加载失败: ' + err.message);
        state.ui.resultDiv.innerHTML = '⚠️ 索引加载失败，请检查词典配置。';
    }
}

// ==================== 页面生命周期保存（GoldenDict 发音安全） ====================
// GoldenDict Android 的 gdPlayAudio() 会通过 window.location 跳转到音频协议。
// WebView 可能因此触发 beforeunload，但原生层随后拦截该跳转并留在当前文章页。
// 因此这里绝不能调用 cleanupAll()、删除图片 DOM、清空索引或中止图片请求；
// 否则发音后页面仍保留，而 PicDic 图像区域已经被自身销毁。
function persistStateBeforePageTransition() {
    if (state.historyStore && state.historyStore.getAll().length > 0) {
        state.historyStore.saveNow();
    }

    if (state.configStore) {
        // 取消尚未触发的 500ms 延迟保存，并立即发起一次保存。
        // 即使宿主最终不离开当前页，这也只是幂等持久化，不修改界面状态。
        if (state.configStore._saveTimer) {
            clearTimeout(state.configStore._saveTimer);
            state.configStore._saveTimer = null;
        }
        state.configStore._save();
    }
}

document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        persistStateBeforePageTransition();
    }
});

window.addEventListener('beforeunload', function() {
    // 仅保存数据，不做任何破坏性清理。
    // 真正离开页面时，WebView 会自行回收 DOM、图片和内存；
    // GoldenDict 发音伪导航被拦截时，当前图像区域则可完整保留。
    persistStateBeforePageTransition();
});

var darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
darkMedia.addEventListener('change', function() {
    if (state.config.globalConfig.darkModeFollowApp) {
        applyConfig();
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

})();






setTimeout(function(){
    if(typeof debugShowPTZHHeightClean==="function"){
        debugShowPTZHHeightClean();
    }
},2500);
