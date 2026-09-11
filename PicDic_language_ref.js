// ================================================================
// PicDic_language_ref.js - 语言代码映射（ISO 639-1 ↔ GoldenDict 数字代码）
// ================================================================

(function(global) {
    'use strict';

    // ---------- ISO 639-1 到 GoldenDict 数字代码的映射 ----------
    var ISO_TO_GD_CODE = {
        'en': 28261,   // English
        'de': 25956,   // German
        'fr': 29286,   // French
        'es': 29541,   // Spanish
        'it': 29801,   // Italian
        'pt': 29808,   // Portuguese
        'zh': 26746,   // Chinese
        'ug': 26485,   // Uyghur
        // 可扩展更多语言（需验证数字代码）
        'el': 28050,   // Greek (示例)
        'ru': 28050,   // Russian (示例)
        'ja': 26746,   // Japanese (示例)
        'ko': 26746,   // Korean (示例)
        'ar': 26746    // Arabic (示例)
    };

    // ---------- 别名（兼容旧值，如 'english' → 'en'） ----------
    var ALIAS_MAP = {
        'por':'pt',
        'zho':'zh',
        'eng':'en',
        'deu':'de',
        'fra':'fr',
        'spa':'es',
        'ita':'it',
        'english': 'en',
        'german': 'de',
        'french': 'fr',
        'spanish': 'es',
        'italian': 'it',
        'portuguese': 'pt',
        'chinese': 'zh',
        'pinyin': 'zh',    // 拼音视为中文
        'uyghur': 'ug',
        'any': 'any'       // 特殊值
    };

    // 暴露到全局
    global.PicDicLang = {
        ISO_TO_GD_CODE: ISO_TO_GD_CODE,
        ALIAS_MAP: ALIAS_MAP
    };

})(window);