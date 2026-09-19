// PicDic_DictionaryController.js V10.1 External CSS
// Shared runtime bridge for GoldenDict / MDict PicDic embedding.
// Supports legacy text/QC/PicDic mode and pure PicDic (mode:"picOnly") dictionaries.
(function(global){
"use strict";

function own(obj,key){
    return Object.prototype.hasOwnProperty.call(obj,key);
}

function normalizeBase(base){
    base=base==null?"":String(base);
    if(base && base.charAt(base.length-1)!=="/") base+="/";
    return base;
}



function Controller(config){
    this.config=config||{};
    if(!this.config.wordSelector) this.config.wordSelector="PicDic_SearchWord";
    if(!this.config.textSelector) this.config.textSelector="PicDic_TEXT";
    if(!this.config.qcSelector) this.config.qcSelector="PicDic_QC";
    this.mode=String(this.config.mode||"hybrid").toLowerCase();
    this.entries=[];
    this.qcMode=false;
    this.picMode=false;
    this._controllerKey="";
}

Controller.prototype.isPicOnly=function(){
    return this.mode==="piconly" || this.mode==="pic-only" || this.mode==="pic_only";
};

Controller.prototype.getBase=function(){
    // 词典配置文件不再区分 GoldenDict / MDict。
    // 如个别环境显式提供 picDicBase，仍优先尊重；否则按宿主协议自动决定。
    if(own(this.config,"picDicBase")) return normalizeBase(this.config.picDicBase);
    if(global.location && global.location.protocol==="mdx:") return "";
    if(global.location && global.location.protocol==="content:")
        return "file:///sdcard/GoldenDict/PicDic/";
    return "";
};

function runtime(){
    var r=global._picdicEmbeddedRuntime;
    if(!r){
        r=global._picdicEmbeddedRuntime={
            host:null,
            loadPromise:null,
            loaded:false,
            activeController:null,
            activeDictId:null,
            scrollSeq:0,
            uiLoadPromise:null,
            controllers:[],
            picOnlyAutoTimer:null,
            manualSelection:false,
            autoController:null
        };
    }
    if(typeof r.scrollSeq!=="number") r.scrollSeq=0;
    if(!r.controllers) r.controllers=[];
    if(!r.host) r.host=document.getElementById("picdicEmbeddedHost")||null;
    return r;
}

function byExactId(id){
    if(!id) return [];
    try{
        var safe=String(id).replace(/\\/g,"\\\\").replace(/"/g,'\\"');
        return document.querySelectorAll('[id="'+safe+'"]');
    }catch(e){
        var all=document.querySelectorAll("[id]"),out=[];
        for(var i=0;i<all.length;i++) if(all[i].id===id) out.push(all[i]);
        return out;
    }
}

function compareDomNodes(a,b){
    if(a===b) return 0;
    if(!a) return 1;
    if(!b) return -1;
    if(a.compareDocumentPosition){
        var pos=a.compareDocumentPosition(b);
        if(pos & 4) return -1; // b follows a
        if(pos & 2) return 1;  // b precedes a
    }
    return 0;
}

function registerController(c){
    var r=runtime();
    if(r.controllers.indexOf(c)===-1) r.controllers.push(c);
}

function refreshButtonStates(){
    var r=runtime();
    r.controllers.forEach(function(c){
        var bar=c.getControllerButtonBar();
        if(!bar) return;
        var btn=bar.querySelector('[data-picdic-action="pic"]');
        if(!btn) return;
        var active=r.activeController===c && c.picMode;
        if(active){
            btn.setAttribute("data-picdic-active","1");
            btn.setAttribute("aria-pressed","true");
            btn.title=c.isPicOnly()?"隐藏当前 PicDic":"当前正在显示此词典";
        }else{
            btn.removeAttribute("data-picdic-active");
            btn.setAttribute("aria-pressed","false");
            btn.title=c.isPicOnly()?"显示此词典的 PicDic":"切换 PicDic";
        }
    });
}

function firstPicOnlyController(){
    var r=runtime();
    var list=r.controllers.filter(function(c){
        if(!c || !c.isPicOnly() || c.config.autoActivate===false) return false;
        c.collectAllEntries();
        return !!(c.entries.length && c.getOwnArticle());
    });
    list.sort(function(a,b){
        var aa=a.getOwnArticle(),bb=b.getOwnArticle();
        var cmp=compareDomNodes(aa,bb);
        if(cmp!==0) return cmp;
        var an=a.entries.length?a.entries[0].wordNode:null;
        var bn=b.entries.length?b.entries[0].wordNode:null;
        return compareDomNodes(an,bn);
    });
    return list.length?list[0]:null;
}

function schedulePicOnlyAutoActivation(){
    var r=runtime();
    if(r.manualSelection) return;
    if(r.picOnlyAutoTimer) global.clearTimeout(r.picOnlyAutoTimer);
    r.picOnlyAutoTimer=global.setTimeout(function(){
        r.picOnlyAutoTimer=null;
        if(r.manualSelection) return;
        var first=firstPicOnlyController();
        if(!first) return;
        if(r.activeController===first && first.picMode) return;
        // If a temporary auto-selected controller was activated before all dictionaries
        // had registered, reconcile to the real first dictionary in DOM order.
        first.activatePic({manual:false,auto:true,scroll:false});
    },260);
}

Controller.prototype.getEntryRoots=function(){
    var roots=[],selector=this.config.containerSelector,id=this.config.containerId,nodes,i;
    if(selector){
        try{
            nodes=document.querySelectorAll(selector);
            for(i=0;i<nodes.length;i++) roots.push(nodes[i]);
        }catch(e){}
    }
    // 兼容旧版 hybrid / picOnly 配置。
    if(!roots.length&&id){
        nodes=byExactId(id);
        for(i=0;i<nodes.length;i++) roots.push(nodes[i]);
    }
    if(!roots.length) roots.push(document);
    return roots;
};

Controller.prototype.findRelated=function(node,selector,boundary){
    if(!selector) return null;
    for(var p=node.parentNode;p;p=p.parentNode){
        var x=null;
        try{x=p.querySelector(selector);}catch(e){x=null;}
        if(x) return x;
        if(p===boundary||p===document.body) break;
    }
    return null;
};

Controller.prototype.collectAllEntries=function(){
    var self=this,roots=this.getEntryRoots(),seen=[];
    this.entries=[];
    roots.forEach(function(root){
        var words=[];
        try{words=root.querySelectorAll(self.config.wordSelector);}catch(e){words=[];}
        for(var i=0;i<words.length;i++){
            var wordNode=words[i];
            if(seen.indexOf(wordNode)!==-1) continue;
            seen.push(wordNode);
            var text=self.isPicOnly()?null:self.findRelated(wordNode,self.config.textSelector,root);
            if(!self.isPicOnly() && !text) continue;
            self.entries.push({
                word:wordNode.textContent.trim(),
                wordNode:wordNode,
                root:root,
                text:text,
                qc:self.isPicOnly()?null:self.findRelated(wordNode,self.config.qcSelector,root)
            });
        }
    });
    return this.entries.length;
};

Controller.prototype.applyEntryMode=function(){
    if(this.isPicOnly()) return;
    var portrait=global.innerWidth<=global.innerHeight;
    var pic=this.picMode,qc=this.qcMode;
    this.entries.forEach(function(e){
        if(!e.text) return;
        if(pic){
            e.text.style.display="none";
            if(e.qc) e.qc.style.display="none";
        }else if(qc){
            e.text.style.display=portrait?"none":"block";
            if(e.qc) e.qc.style.display="block";
        }else{
            e.text.style.display="block";
            if(e.qc) e.qc.style.display="none";
        }
    });
};

Controller.prototype.hideQC=function(){
    if(this.isPicOnly()) return;
    this.entries.forEach(function(e){if(e.qc)e.qc.style.display="none";});
};

Controller.prototype.restoreTextMode=function(){
    if(this.isPicOnly()) return;
    this.entries.forEach(function(e){
        if(e.text)e.text.style.display="block";
        if(e.qc)e.qc.style.display="none";
    });
};

Controller.prototype.refreshEntries=function(){
    this.collectAllEntries();
    this.applyEntryMode();
    if(this.isPicOnly()) schedulePicOnlyAutoActivation();
};

Controller.prototype.getOwnArticle=function(){
    var n=this.entries.length?this.entries[0].wordNode:null;
    return n&&n.closest?n.closest(".gdarticle"):null;
};

Controller.prototype.getOwnTitle=function(){
    var a=this.getOwnArticle();
    return a&&(a.querySelector(".gddictname")||a.querySelector(".picdic-controller-buttons"));
};

Controller.prototype.getControllerButtonBar=function(){
    var a=this.getOwnArticle();
    return a?a.querySelector('.picdic-controller-buttons[data-picdic-controller="'+this._controllerKey+'"]'):null;
};

Controller.prototype.getOwnDictTitle=Controller.prototype.getOwnTitle;

Controller.prototype.getGoldenDictArticleId=function(){
    var a=this.getOwnArticle(),m=a&&a.id&&String(a.id).match(/^gdarticle-(.+)$/);
    var id=m&&m[1];
    return id&&document.getElementById("gdarticleref-"+id)?id:null;
};

Controller.prototype.protectButtons=function(el){
    ["touchstart","touchend","mousedown","mouseup","pointerdown","pointerup"].forEach(function(type){
        el.addEventListener(type,function(e){e.stopPropagation();},false);
    });
    el.addEventListener("contextmenu",function(e){e.preventDefault();e.stopPropagation();},false);
};
Controller.prototype.protectButtonArea=Controller.prototype.protectButtons;

Controller.prototype.insertButtons=function(){
    var a=this.getOwnArticle(),title=a&&a.querySelector(".gddictname");
    if(!title) return;
    var old=this.getControllerButtonBar();
    if(old) return;

    var bar=document.createElement("span"),self=this;
    bar.className="picdic-controller-buttons";
    bar.setAttribute("data-picdic-controller",this._controllerKey);
    this.protectButtons(bar);

    function button(text,fn,action,titleText){
        var b=document.createElement("button");
        b.className="ptzh-header-btn picdic-controller-icon";
        b.textContent=text;
        b.setAttribute("data-picdic-action",action||"");
        if(titleText)b.title=titleText;
        b.addEventListener("click",function(e){
            e.stopPropagation();e.preventDefault();self.clearSelection();fn.call(self);
        },true);
        bar.appendChild(b);
    }

    if(!this.isPicOnly()){
        button("📷",this.toggleQC,"qc","切换切图");
    }
    button("📖",this.togglePic,"pic",this.isPicOnly()?"在 PicDic 中查询此词典":"切换 PicDic");
    // Keep the controller icon at the same far-left position used by the
    // original text / QC / PicDic header controls: first child of .gddictname.
    title.insertBefore(bar,title.firstChild);
    refreshButtonStates();
};

Controller.prototype.init=function(){
    if(!this.collectAllEntries()) return false;
    // Controller icon styling lives in external PicDic_search.css.
    // Load it before inserting the title-side icon so there is no unstyled flash.
    this.ensureCSS(this.getBase()+"PicDic_search.css");
    registerController(this);
    this.insertButtons();
    this.hideQC();
    if(this.isPicOnly()) schedulePicOnlyAutoActivation();
    return true;
};

Controller.prototype.toggleQC=function(){
    if(this.isPicOnly()) return;
    runtime().manualSelection=true;
    this.collectAllEntries();
    this.closePic();
    this.qcMode=!this.qcMode;
    this.applyEntryMode();
    refreshButtonStates();
};

Controller.prototype.attachSharedHost=function(){
    var r=runtime(),host=r.host,a=this.getOwnArticle();
    if(!host||!a) return null;
    if(host.parentNode!==a) a.appendChild(host);
    r.host=host;
    return host;
};

Controller.prototype.scrollToOwnDictionary=function(){
    var self=this,r=runtime(),seq=++r.scrollSeq;
    var raf=global.requestAnimationFrame||function(fn){return global.setTimeout(fn,16);};
    var id=this.getGoldenDictArticleId();

    if(id&&typeof global.gdJumpTo==="function"){
        raf(function(){
            if(seq!==r.scrollSeq||r.activeController!==self) return;
            try{ global.gdJumpTo(id); }
            catch(e){ self.scrollFallback(seq); }
        });
        return;
    }
    this.scrollFallback(seq);
};

Controller.prototype.scrollFallback=function(seq){
    var self=this,r=runtime();
    var raf=global.requestAnimationFrame||function(fn){return global.setTimeout(fn,16);};
    raf(function(){raf(function(){
        if(seq!==r.scrollSeq||r.activeController!==self) return;
        var title=self.getOwnTitle();
        if(!title) return;
        var rect=title.getBoundingClientRect();
        var y=global.pageYOffset||document.documentElement.scrollTop||document.body.scrollTop||0;
        global.scrollTo(0,Math.max(0,rect.top+y));
    });});
};
Controller.prototype.scrollToOwnDictionaryFallback=Controller.prototype.scrollFallback;

Controller.prototype.deactivatePicForSwitch=function(){
    var r=runtime();
    this.collectAllEntries();
    this.picMode=false;
    this.restoreTextMode();
    if(r.activeController===this&&r.host) r.host.style.display="none";
    refreshButtonStates();
};

Controller.prototype.activatePic=function(options){
    options=options||{};
    var self=this,r=runtime();
    this.collectAllEntries();

    if(options.manual){
        r.manualSelection=true;
        if(r.picOnlyAutoTimer){global.clearTimeout(r.picOnlyAutoTimer);r.picOnlyAutoTimer=null;}
    }

    if(r.activeController&&r.activeController!==this){
        r.activeController.deactivatePicForSwitch();
    }

    var words=this.entries.map(function(e){return e.word;}).filter(Boolean);
    if(!words.length) return Promise.resolve(false);

    r.activeController=this;
    r.activeDictId=this.config.dictId||null;
    if(options.auto) r.autoController=this;

    refreshButtonStates();

    return this.loadPicDic(words).then(function(){
        if(r.activeController!==self) return false;

        self.picMode=true;
        self.qcMode=false;
        self.applyEntryMode();

        var host=self.attachSharedHost();
        if(host) host.style.display="block";
        if(options.scroll!==false) self.scrollToOwnDictionary();
        refreshButtonStates();

        if(typeof global._picdic_activateEmbeddedSession==="function"){
            return global._picdic_activateEmbeddedSession(self.config.dictId,words);
        }

        // Compatibility fallback for older PicDic_search.js.
        words.forEach(function(word){
            if(global.addExternalRequest) global.addExternalRequest(word,self.config.dictId);
        });
        if(typeof global._picdic_embedded_refresh==="function") global._picdic_embedded_refresh();
        return true;
    }).catch(function(error){
        if(r.activeController===self){r.activeController=null;r.activeDictId=null;}
        self.picMode=false;
        self.restoreTextMode();
        refreshButtonStates();
        if(global.console&&console.error) console.error("[PicDic Controller] activate failed:",error);
        return false;
    });
};

Controller.prototype.togglePic=function(){
    var r=runtime();

    if(this.isPicOnly()){
        // Pure whole-page PicDic: the title-side 📖 button is a real show/hide toggle.
        // When the shared PicDic host is already occupying this dictionary article,
        // hide it immediately so the user can browse the following GoldenDict results.
        // The host/runtime stays cached; clicking again re-attaches and re-activates it.
        if(r.activeController===this&&this.picMode){
            r.manualSelection=true;
            if(r.picOnlyAutoTimer){
                global.clearTimeout(r.picOnlyAutoTimer);
                r.picOnlyAutoTimer=null;
            }
            this.closePic();
            return Promise.resolve(true);
        }
        return this.activatePic({manual:true,scroll:true});
    }

    this.collectAllEntries();
    if(r.activeController===this&&this.picMode){
        r.manualSelection=true;
        this.closePic();
        this.restoreTextMode();
        refreshButtonStates();
        return Promise.resolve(true);
    }
    return this.activatePic({manual:true,scroll:true});
};

Controller.prototype.closePic=function(){
    var r=runtime();
    this.picMode=false;
    if(r.activeController===this){
        if(r.host) r.host.style.display="none";
        r.activeController=null;
        r.activeDictId=null;
    }
    refreshButtonStates();
};

Controller.prototype.loadPicDic=function(words){
    var self=this,r=runtime(),base=this.getBase();
    this.ensureCSS(base+"PicDic_search.css");
    if(!r.host) r.host=this.createHost();
    this.attachSharedHost();
    if(r.loadPromise) return r.loadPromise;

    global._picdic_embedded=true;
    global._picdic_word=words[0];
    global._picdic_dictId=this.config.dictId;

    r.loadPromise=this.loadScript(base+"PicDic_language_ref.js")
        .then(function(){return self.loadScript(base+"PicDic_dictionary_list.js");})
        .then(function(){return self.loadScript(base+"PicDic_global_config.ini");})
        .then(function(){return self.loadScript(base+"PicDic_search.js");})
        .then(function(){r.loaded=true;return true;})
        .catch(function(e){r.loadPromise=null;r.loaded=false;throw e;});
    return r.loadPromise;
};

Controller.prototype.createHost=function(){
    var r=runtime();
    if(r.host) return r.host;

    var host=document.getElementById("picdicEmbeddedHost");
    if(host){r.host=host;return host;}

    host=document.createElement("div");
    host.id="picdicEmbeddedHost";
    host.setAttribute("data-picdic-shared-host","1");
    var dic=document.createElement("div"),box=document.createElement("div");
    var input=document.createElement("input"),result=document.createElement("div");
    dic.className="PIC_DIC"; box.id="searchBox"; input.id="searchInput"; result.id="result";
    input.type="text";input.placeholder="输入单词...";
    result.innerHTML="加载中...";
    box.appendChild(input); dic.appendChild(box); dic.appendChild(result); host.appendChild(dic);
    (this.getOwnArticle()||document.body).appendChild(host);
    host.style.display="none";
    r.host=host;
    return host;
};

Controller.prototype.ensureCSS=function(href){
    if(document.querySelector('link[data-picdic-css="1"]')) return;
    var l=document.createElement("link");
    l.rel="stylesheet";l.href=href;l.setAttribute("data-picdic-css","1");document.head.appendChild(l);
};

Controller.prototype.loadScript=function(src){
    return new Promise(function(resolve,reject){
        var existing=document.querySelector('script[data-picdic-runtime-src="'+String(src).replace(/"/g,'\\"')+'"]');
        if(existing){
            if(existing.getAttribute("data-loaded")==="1") return resolve();
            existing.addEventListener("load",function(){resolve();},{once:true});
            existing.addEventListener("error",function(){reject(new Error(src));},{once:true});
            return;
        }
        var s=document.createElement("script");
        s.src=src;
        s.setAttribute("data-picdic-runtime-src",src);
        s.onload=function(){s.setAttribute("data-loaded","1");resolve();};
        s.onerror=function(){reject(new Error("加载失败: "+src));};
        document.head.appendChild(s);
    });
};

Controller.prototype.loadUiModule=function(){
    var r=runtime();
    if(global._picdicCreateUI||global._picdicUI) return Promise.resolve(true);
    if(r.uiLoadPromise) return r.uiLoadPromise;

    var base=this.getBase();
    r.uiLoadPromise=this.loadScript(base+"PicDic_ui.js")
        .then(function(){
            if(!global._picdicCreateUI&&!global._picdicUI)
                throw new Error("PicDic_ui.js loaded without UI factory");
            return true;
        })
        .catch(function(e){r.uiLoadPromise=null;throw e;});

    return r.uiLoadPromise;
};

Controller.prototype.clearSelection=function(){
    if(global.getSelection) global.getSelection().removeAllRanges();
};

function cloneConfig(config){
    var copy={};
    if(config) for(var k in config) if(own(config,k)) copy[k]=config[k];
    return copy;
}

function controllerKey(c){
    return String(c.dictId||"")+"::"+String(c.containerSelector||c.containerId||"")+"::"+String(c.wordSelector||"")+"::"+String(c.mode||"hybrid");
}

var capturedConfig=global.PICDIC_CONFIG?cloneConfig(global.PICDIC_CONFIG):null;

function boot(){
    var count=0;
    var timer=setInterval(function(){
        count++;
        var config=capturedConfig||global.PICDIC_CONFIG;
        if(!config||!document.querySelector(".gdarticle")){
            if(count>100) clearInterval(timer);
            return;
        }

        if(config.containerSelector){
            try{
                if(!document.querySelector(config.containerSelector)){
                    if(count>100) clearInterval(timer);
                    return;
                }
            }catch(e){return;}
        }else if(config.containerId){
            if(!byExactId(config.containerId).length){
                if(count>100) clearInterval(timer);
                return;
            }
        }else{
            try{
                if(!document.querySelector(config.wordSelector||"PicDic_SearchWord")){
                    if(count>100) clearInterval(timer);
                    return;
                }
            }catch(e){return;}
        }

        clearInterval(timer);
        var registry=global._picdicDictionaryControllerRegistry||(global._picdicDictionaryControllerRegistry={});
        var key=controllerKey(config),existing=registry[key];
        if(existing){
            existing.config=config;
            existing.mode=String(config.mode||"hybrid").toLowerCase();
            existing.refreshEntries();
            global.picdicController=existing;
            return;
        }

        var c=new Controller(config);
        c._controllerKey=key.replace(/[^A-Za-z0-9_.:-]/g,"_");
        if(c.init()){
            registry[key]=c;
            global.picdicController=c;
        }
    },120);
}

global.PicDicDictionaryController=Controller;
global._picdic_reconcilePicOnly=function(){
    runtime().manualSelection=false;
    schedulePicOnlyAutoActivation();
};
boot();
})(window);
