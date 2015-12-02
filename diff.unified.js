define(function(require, exports, module) {
    main.consumes = [
        "editors", "Editor", "ui", "scm", "layout", "settings",
        "threewaymerge", "menus", "Menu", "MenuItem", "Divider", "ace"
    ];
    main.provides = ["diff.unified"];
    return main;

    function main(options, imports, register) {
        var settings = imports.settings;
        var editors = imports.editors;
        var Editor = imports.Editor;
        var scmProvider = imports.scm;
        var layout = imports.layout;
        var MenuItem = imports.MenuItem;
        var Divider = imports.Divider;
        var merge = imports.threewaymerge;
        var Menu = imports.Menu;
        var ace = imports.ace;
        var ui = imports.ui;
        
        var dirname = require("path").dirname;
        var basename = require("path").basename;
        var DiffView = require("./diff/unified").DiffView;
        
        /***** Initialization *****/
        
        var extensions = [];
        
        // :(
        var BGCOLOR = { 
            "flat-light": "#F1F1F1", 
            "flat-dark": "#3D3D3D",
            "light": "#D3D3D3", 
            "light-gray": "#D3D3D3",
            "dark": "#3D3D3D",
            "dark-gray": "#3D3D3D" 
        };
        
        var menuAce;
        var menuGutter;
        var scm;
        
        var handle = editors.register("diff.unified", "Compare", DiffViewer, extensions);
        var handleEmit = handle.getEmitter();
        
        function createMenu() {
            menuAce = new Menu({ 
                id: "menu",
                items: [
                    new MenuItem({ position: 10, command: "cut", caption: "Cut"}, handle),
                    new MenuItem({ position: 20, command: "copy", caption: "Copy" }, handle),
                    new MenuItem({ position: 30, command: "paste", caption: "Paste" }, handle),
                    new Divider({ position: 40 }, handle),
                    new MenuItem({ position: 50, command: "selectall", caption: "Select All" }, handle),
                    new Divider({ position: 60 }, handle)
                ]
            }, handle);
            
            menuGutter = new Menu({ 
                id: "menu-gutter",
                items: [
                ]
            }, handle);
        }
        
        scmProvider.on("scm", function(implementation){
            scm = implementation;
            handleEmit.sticky("ready");
        }, handle);
        
        function DiffViewer(){
            // TODO it is too difficult to hook into initialization flow of ace plugin
            // so we have to copy paste bunch of code here :(
            // var Baseclass = editors.findEditor("ace");
            // var plugin = new Baseclass(true, []);
            var plugin = new Editor(true, []);
            var emit = plugin.getEmitter();
            
            var currentSession;
            var diffview;
            var lastAce;
            var lblLeft, lblRight, btnNext, btnPrev, btnFold, container;
            var toolbar;
            
            plugin.on("draw", function(e) {
                var tab = e.tab;
                
                // lblLeft = new ui.label({ flex:1 });
                // lblRight = new ui.label({ flex:1, class:"right" });
                // btnNext = new ui.button({ 
                //     caption: ">", 
                //     height: 24,
                //     skin: "c9-toolbarbutton-glossy",
                //     onclick: function() {
                //         diffview.gotoNext(1);
                //     }
                // }); 
                // btnPrev = new ui.button({ 
                //     caption: "<",
                //     height: 24,
                //     skin: "c9-toolbarbutton-glossy",
                //     onclick: function() {
                //         diffview.gotoNext(-1);
                //     }
                // });
                // btnFold = new ui.button({ 
                //     caption: "Fold",
                //     height: 24,
                //     skin: "c9-toolbarbutton-glossy",
                //     onclick: function() {
                //         if (diffview.orig.session.$foldData.length)
                //             diffview.orig.session.unfold() 
                //         else
                //             diffview.foldUnchanged();
                //     }
                // });
                container = new ui.bar({ margin: "0 0 0 20", class: "ace_diff-container" });
                
                tab.appendChild(new ui.vsplitbox({ 
                    anchors: "0 0 0 0",
                    childNodes: [
                        // toolbar = new ui.hbox({
                        //     class: "difftoolbar",
                        //     height: 36,
                        //     align: "center",
                        //     edge: "0 5 0 3",
                        //     padding: 3,
                        //     childNodes: [
                        //         lblLeft,
                        //         new ui.hbox({
                        //             padding: 3,
                        //             edge: 3,
                        //             margin: "0 7 0 7",
                        //             align: "center",
                        //             class: "buttons",
                        //             childNodes: [ btnPrev, btnFold, btnNext ]
                        //         }),
                        //         lblRight
                        //     ]
                        // }),
                        toolbar = new ui.bar({ height: 36 }),
                        container
                    ]
                }));
                
                diffview = new DiffView(container.$ext, {});
                diffview.editor.setOption("fontSize", 11);
                diffview.editor.renderer.scrollBarV.$minWidth = 20;
                
                // // temporary workaround for apf focus bugs
                // // only blur is needed sinse the rest is handled by tabManager
                // // todo remove this when there is proper focus manager
                // tab.$blur = function(e) {
                //     var ace = plugin.ace; // can be null when called for destroyed tab
                //     if (!ace || !e || !e.toElement || e.toElement.tagName == "menu") 
                //         return;
                //     if (!ace.isFocused())
                //         ace.renderer.visualizeBlur();
                //     else
                //         ace.textInput.blur();
                // };
                
                // function focusApf() {
                //     var page = apf.findHost(diffview.container.parentElement.parentElement);
                //     if (apf.activeElement != page)
                //         page.focus();
                // }
                // function updateLastAce(e, ace) { lastAce = ace; }
                
                // diffview.edit.on("focus", focusApf);
                // diffview.orig.on("focus", focusApf);
                // diffview.edit.keyBinding.setDefaultHandler(null);
                // diffview.orig.keyBinding.setDefaultHandler(null);
                
                // diffview.edit.on("focus", updateLastAce);
                // diffview.orig.on("focus", updateLastAce);
                
                // lastAce = diffview.edit;
                
                // // createProgressIndicator(e.htmlNode);
                
                // tab.on("contextmenu", function(e) { 
                //     if (!menuAce) createMenu();
                    
                //     var target = e.htmlEvent.target;
                //     var gutter = plugin.diffview.gutterEl;
                    
                //     // Set Gutter Context Menu
                //     if (ui.isChildOf(gutter, target, true)) {
                //         menuGutter.show(e.x, e.y);
                //     }
                //     // Set main Ace Context Menu
                //     else {
                //         menuAce.show(e.x, e.y);
                //     }

                //     return false;
                // });
            });
            
            /***** Method *****/
            
            // function getLabelValue(path){
            //     var hash;
                
            //     if (path.indexOf(":") > -1) {
            //         hash = path.split(":");
            //         path = hash[1], hash = hash[0];
            //     }
                
            //     var dirpath = dirname(path);
            //     return (hash ? "<span class='hash'>" + hash + "</span>" : "") 
            //         + basename(dirpath) + "/" + basename(path) 
            //         + "<span class='dirname'> - " + dirname(dirpath) + "</span>";
            // }
            
            // function loadSession(session){
            //     if (session.diffSession) {
            //         diffview.setSession(session.diffSession);
            //         return;
            //     }
                
            //     diffview.setSession(session.diffSession = {
            //         orig: diffview.createSession(),
            //         edit: diffview.createSession(),
            //         chunks: []
            //     });
                
            //     var diff = session.diff || {};
            //     if (typeof diff.patch == "string") {
            //         diffview.setValueFromFullPatch(diff.patch);
            //     } else {
            //         diffview.orig.session.setValue(diff.orig || "");
            //         diffview.edit.session.setValue(diff.edit || "");
            //     }
            //     diffview.orig.setReadOnly(true);
            //     diffview.edit.setReadOnly(true);
                 
            //     var syntax = ace.getSyntaxForPath(session.newPath);
            //     if (syntax && syntax.indexOf("/") == -1) syntax = "ace/mode/" + syntax;
            //     if (syntax) {
            //         diffview.orig.session.setMode(syntax);
            //         diffview.edit.session.setMode(syntax);
            //     }
            //     diffview.orig.renderer.once("afterRender", function() {
            //         if (diffview.session == session.diffSession) {
            //             if (!diffview.chunks.length)
            //                 diffview.computeDiff();
            //             diffview.foldUnchanged();
            //             diffview.gotoNext(1);
            //         }
            //     });
            // }
            
            function loadSession(session) {
                diffview.setValueFromPatch(session.diff.patch);
            }
            
            /***** Lifecycle *****/
            
            plugin.on("load", function(){
            });
            
            plugin.on("documentLoad", function(e) {
                var doc = e.doc;
                var session = e.doc.getSession();
                
                session.isEqual = function(options){
                    return (
                        session.path == options.path &&
                        session.hash == options.hash &&
                        session.branch == options.branch &&
                        session.context == options.context &&
                        session.compareBranch == options.compareBranch
                    );
                };
                
                if (e.state.path) session.path = e.state.path;
                if (e.state.hash) session.hash = e.state.hash;
                if (e.state.branch) session.branch = e.state.branch;
                if (e.state.context) session.context = e.state.context;
                if (e.state.compareBranch)
                    session.compareBranch = e.state.compareBranch;
                
                var title;
                if (session.branch) {
                    title = session.branch
                        .replace(/refs\/(?:head|remotes\/\w+)\//, "");
                }
                else if (session.hash) {
                    title = session.hash;
                }
                else if (session.path) {
                    title = basename(session.path);
                }
                else {
                    throw new Error("Wrong arguments");
                }
                
                doc.title = "Compare " + title;
                
                // diffview.c9session = session;
                // diffview.orig.session.c9session = session;
                // diffview.edit.session.c9session = session;
                
                function setTheme(e) {
                    var tab = doc.tab;
                    if (e.theme && BGCOLOR[e.theme]) {
                        var isDark = e.theme == "dark";
                        
                        toolbar.$ext.style.backgroundColor = 
                        tab.backgroundColor = BGCOLOR[e.theme];
                        
                        if (isDark) tab.classList.add("dark");
                        else tab.classList.remove("dark");
                    }
                    // TODO
                    diffview.editor.setTheme(settings.get("user/ace/@theme"));
                }
                
                layout.on("themeChange", setTheme, doc);
                settings.on("user/ace/@theme", setTheme, doc);
                setTheme({ theme: settings.get("user/general/@skin") });
                
            });
            plugin.on("documentActivate", function(e) {
                var session = currentSession = e.doc.getSession();
                
                // lblLeft.setAttribute("caption", getLabelValue(session.oldPath));
                // lblRight.setAttribute("caption", getLabelValue(session.newPath));
                
                if (session.diff)
                    return loadSession(session);
                
                e.doc.tab.classList.add("connecting");
                
                // var newPath = (session.newPath || "")
                //     .replace(/MODIFIED:/, "")
                //     .replace(/STAGED:/, ":");
                // var oldPath = (session.oldPath || "")
                //     .replace(/PREVIOUS:/, ":");
                
                var config = { context: session.context || false };
            
                // Show a single commit
                if (session.hash) {
                    config.oldPath = session.hash;
                    config.newPath = session.hash + "^1";
                }
                
                // Show all changes in a branch
                else if (session.branch) {
                    config.newPath = session.branch;
                    config.oldPath = session.compareBranch 
                        || "refs/remotes/origin/master";
                    
                    if (session.path) {
                        config.oldPath += ":" + session.path;
                        config.newPath += ":" + session.path;
                    }
                }
                
                // Show uncommitted changes in a tracked file
                else if (session.path) {
                    config.newPath = session.path;
                }
                
                handle.on("ready", function(){
                    session.request = scm.loadDiff(config, function(err, diff) {
                        e.doc.tab.classList.remove("connecting");
                        
                        if (err) {
                            e.doc.tab.classList.add("error");
                            return;
                        }
                        
                        if (session.request == diff.request) {
                            session.diff = diff;
                            loadSession(session);
                        }
                    });
                }, plugin);
            });
            plugin.on("documentUnload", function(e) {
                // var session = e.doc.getSession();
            });
            plugin.on("getState", function(e) {
                var session = e.doc.getSession();
                e.state.path = session.path;
                e.state.hash = session.hash;
                e.state.branch = session.branch;
                e.state.compareBranch = session.compareBranch;
                e.state.context = session.context;
            });
            plugin.on("setState", function(e) {
                var session = e.doc.getSession();
                session.path = e.state.path;
                session.hash = e.state.hash;
                session.branch = e.state.branch;
                session.compareBranch = e.state.compareBranch;
                session.context = e.state.context;
            });
            plugin.on("clear", function(){
            });
            plugin.on("focus", function(){
            });
            plugin.on("enable", function(){
            });
            plugin.on("disable", function(){
            });
            plugin.on("unload", function(){
            });
            plugin.on("resize", function(e) {
                diffview && diffview.editor.resize(e);
            });
            
            /***** Register and define API *****/
            
            /**
             * Read Only Image Editor
             **/
            plugin.freezePublicAPI({
                get diffview() { return diffview },
                get ace () { return lastAce }
            });
            
            plugin.load(null, "ace.repl");
            
            return plugin;
        }
        
        register(null, {
            "diff.unified": handle
        });
    }
});