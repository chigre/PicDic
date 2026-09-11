// PicDic_DictionaryController.js V8 Slim
// Shared runtime bridge for GoldenDict / MDict PicDic embedding.
(function(global){
"use strict";

function Controller(config){
    this.config=config||{};
    this.entries=[];
    this.qcMode=false;
    this.picMode=false;
}

function runtime(){
    var r=global._picdicEmbeddedRuntime;
    if(!r){
        r=global._picdicEmbeddedRuntime={
            host:null,loadPromise:null,loaded:false,
            activeController:null,activeDictId:null,scrollSeq:0
        };
    }
    if(typeof r.scrollSeq!=="number") r.scrollSeq=0;
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

function own(obj,key){
    return Object.prototype.hasOwnProperty.call(obj,key);
}

Controller.prototype.getEntryRoots=function(){
    var roots=[],id=this.config.containerId,nodes,i;
    if(id){
        nodes=byExactId(id);
        for(i=0;i<nodes.length;i++) roots.push(nodes[i]);
    }
    if(!roots.length) roots.push(document);
    return roots;
};

Controller.prototype.findRelated=function(node,selector,boundary){
    for(var p=node.parentNode;p;p=p.parentNode){
        var x=p.querySelector(selector);
        if(x) return x;
        if(p===boundary||p===document.body) break;
    }
    return null;
};

Controller.prototype.collectAllEntries=function(){
    var self=this,roots=this.getEntryRoots(),seen=[];
    this.entries=[];
    roots.forEach(function(root){
        var words=root.querySelectorAll(self.config.wordSelector);
        for(var i=0;i<words.length;i++){
            var wordNode=words[i];
            if(seen.indexOf(wordNode)!==-1) continue;
            seen.push(wordNode);
            var text=self.findRelated(wordNode,self.config.textSelector,root);
            if(!text) continue;
            self.entries.push({
                word:wordNode.textContent.trim(),wordNode:wordNode,root:root,text:text,
                qc:self.findRelated(wordNode,self.config.qcSelector,root)
            });
        }
    });
    return this.entries.length;
};

Controller.prototype.applyEntryMode=function(){
    var portrait=global.innerWidth<=global.innerHeight;
    var pic=this.picMode,qc=this.qcMode;
    this.entries.forEach(function(e){
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
    this.entries.forEach(function(e){if(e.qc)e.qc.style.display="none";});
};

Controller.prototype.restoreTextMode=function(){
    this.entries.forEach(function(e){
        e.text.style.display="block";
        if(e.qc)e.qc.style.display="none";
    });
};

Controller.prototype.refreshEntries=function(){
    this.collectAllEntries();
    this.applyEntryMode();
};

Controller.prototype.getOwnArticle=function(){
    var n=this.entries.length?this.entries[0].wordNode:null;
    return n?n.closest(".gdarticle"):null;
};

Controller.prototype.getOwnTitle=function(){
    var a=this.getOwnArticle();
    return a&&(a.querySelector(".gddictname")||a.querySelector(".picdic-controller-buttons"));
};

Controller.prototype.getControllerButtonBar=function(){
    var a=this.getOwnArticle();
    return a?a.querySelector(".picdic-controller-buttons"):null;
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
    if(!title||title.querySelector(".picdic-controller-buttons")) return;

    var bar=document.createElement("span"),self=this;
    bar.className="picdic-controller-buttons";
    this.protectButtons(bar);

    function button(text,fn){
        var b=document.createElement("button");
        b.className="ptzh-header-btn";
        b.textContent=text;
        b.addEventListener("click",function(e){
            e.stopPropagation();e.preventDefault();self.clearSelection();fn.call(self);
        },true);
        bar.appendChild(b);
    }
    button("📷",this.toggleQC);
    button("📖",this.togglePic);
    title.insertBefore(bar,title.firstChild);
};

Controller.prototype.init=function(){
    if(!this.collectAllEntries()) return false;
    this.insertButtons();
    this.hideQC();
    return true;
};

Controller.prototype.toggleQC=function(){
    this.collectAllEntries();
    this.closePic();
    this.qcMode=!this.qcMode;
    this.applyEntryMode();
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
};

Controller.prototype.togglePic=function(){
    var self=this,r=runtime();
    this.collectAllEntries();

    if(r.activeController===this&&this.picMode){
        this.closePic();
        this.restoreTextMode();
        return;
    }
    if(r.activeController&&r.activeController!==this) r.activeController.deactivatePicForSwitch();

    var words=this.entries.map(function(e){return e.word;}).filter(Boolean);
    if(!words.length) return;

    r.activeController=this;
    r.activeDictId=this.config.dictId||null;

    this.loadPicDic(words).then(function(){
        if(r.activeController!==self) return false;

        self.picMode=true;
        self.qcMode=false;
        self.applyEntryMode();

        var host=self.attachSharedHost();
        if(host) host.style.display="block";
        self.scrollToOwnDictionary();

        if(typeof global._picdic_activateEmbeddedSession==="function"){
            return global._picdic_activateEmbeddedSession(self.config.dictId,words);
        }

        words.forEach(function(word){
            if(global.addExternalRequest) global.addExternalRequest(word,self.config.dictId);
        });
        if(typeof global._picdic_embedded_refresh==="function") global._picdic_embedded_refresh();
        return true;
    }).catch(function(error){
        if(r.activeController===self){r.activeController=null;r.activeDictId=null;}
        self.picMode=false;
        self.restoreTextMode();
        if(global.console&&console.error) console.error("[PicDic Controller] activate failed:",error);
    });
};

Controller.prototype.closePic=function(){
    var r=runtime();
    this.picMode=false;
    if(r.activeController===this){
        if(r.host) r.host.style.display="none";
        r.activeController=null;
        r.activeDictId=null;
    }
};

Controller.prototype.loadPicDic=function(words){
    var self=this,r=runtime(),base=this.config.picDicBase||"file:///sdcard/GoldenDict/PicDic/";
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
    var dic=document.createElement("div"),box=document.createElement("div");
    var input=document.createElement("input"),result=document.createElement("div");
    dic.className="PIC_DIC"; box.id="searchBox"; input.id="searchInput"; result.id="result";
    result.innerHTML="加载中...";
    box.appendChild(input); dic.appendChild(box); dic.appendChild(result); host.appendChild(dic);
    (this.getOwnArticle()||document.body).appendChild(host);
    host.style.display="none";
    r.host=host;
    return host;
};

Controller.prototype.ensureCSS=function(href){
    if(document.querySelector("link[data-picdic-css]")) return;
    var l=document.createElement("link");
    l.rel="stylesheet";l.href=href;l.setAttribute("data-picdic-css","1");document.head.appendChild(l);
};

Controller.prototype.loadScript=function(src){
    return new Promise(function(resolve,reject){
        var s=document.createElement("script");
        s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);
    });
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
    return String(c.dictId||"")+"::"+String(c.containerId||"")+"::"+String(c.wordSelector||"");
}

var capturedConfig=global.PICDIC_CONFIG?cloneConfig(global.PICDIC_CONFIG):null;

function boot(){
    var timer=setInterval(function(){
        var config=capturedConfig||global.PICDIC_CONFIG;
        if(!config||!document.querySelector(".gdarticle")) return;

        if(config.containerId){
            if(!byExactId(config.containerId).length) return;
        }else if(!document.querySelector(config.wordSelector)) return;

        clearInterval(timer);
        var registry=global._picdicDictionaryControllerRegistry||(global._picdicDictionaryControllerRegistry={});
        var key=controllerKey(config),existing=registry[key];
        if(existing){
            existing.config=config;
            existing.refreshEntries();
            global.picdicController=existing;
            return;
        }

        var c=new Controller(config);
        if(c.init()){
            registry[key]=c;
            global.picdicController=c;
        }
    },200);
}

global.PicDicDictionaryController=Controller;
boot();
})(window);
