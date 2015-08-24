define(function(require, exports, module) {
    main.consumes = [
        "editors", "Editor", "ui", "scm", "layout", "settings",
        "threewaymerge", "menus", "Menu", "MenuItem", "Divider", "ace"
    ];
    main.provides = ["diffview"];
    return main;

    function main(options, imports, register) {
        var settings = imports.settings;
        var editors = imports.editors;
        var Editor = imports.Editor;
        var status = imports.scm;
        var layout = imports.layout;
        var MenuItem = imports.MenuItem;
        var Divider = imports.Divider;
        var merge = imports.threewaymerge;
        var Menu = imports.Menu;
        var ace = imports.ace;
        var ui = imports.ui;
        
        var DiffView = require("./diff/twoway").DiffView;
        
        /***** Initialization *****/
        
        var extensions = [];
        
        // :(
        var BGCOLOR = { 
            "flat-light": "#F1F1F1", 
            "light": "#D3D3D3", 
            "light-gray": "#D3D3D3",
            "dark": "#3D3D3D",
            "dark-gray": "#3D3D3D" 
        };
        
        var menuAce;
        var menuGutter;
        
        var handle = editors.register("diffview", "Compare", DiffViewer, extensions);
        
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
            var labelLeft, labelRight;
            
            plugin.on("draw", function(e) {
                ui.insertMarkup(e.tab, require("text!./editor.xml"), plugin);
                diffview = new DiffView(plugin.getElement("main").$ext, {});
                
                labelLeft = plugin.getElement("labelLeft");
                labelRight = plugin.getElement("labelRight");
                
                plugin.getElement("next").onclick = function() {
                    diffview.gotoNext(1);
                };
                plugin.getElement("prev").onclick = function() {
                    diffview.gotoNext(-1);
                };
                plugin.getElement("fold").onclick = function() {
                    diffview.foldUnchanged();
                };
                
                // temporary workaround for apf focus bugs
                // only blur is needed sinse the rest is handled by tabManager
                // todo remove this when there is proper focus manager
                e.tab.$blur = function(e) {
                    var ace = plugin.ace; // can be null when called for destroyed tab
                    if (!ace || !e || !e.toElement || e.toElement.tagName == "menu") 
                        return;
                    if (!ace.isFocused())
                        ace.renderer.visualizeBlur();
                    else
                        ace.textInput.blur();
                };
                function focusApf() {
                    var page = apf.findHost(diffview.container.parentElement.parentElement);
                    if (apf.activeElement != page)
                        page.focus();
                }
                diffview.edit.on("focus", focusApf);
                diffview.orig.on("focus", focusApf);
                diffview.edit.keyBinding.setDefaultHandler(null);
                diffview.orig.keyBinding.setDefaultHandler(null);
                
                diffview.edit.on("focus", updateLastAce);
                diffview.orig.on("focus", updateLastAce);
                function updateLastAce(e, ace) { lastAce = ace; }
                
                
                lastAce = diffview.edit;
                
                // createProgressIndicator(e.htmlNode);
                
                var tab = e.tab;
                
                tab.on("contextmenu", function(e) { 
                    if (!menuAce) createMenu();
                    
                    var target = e.htmlEvent.target;
                    var gutter = plugin.diffview.gutterEl;
                    
                    // Set Gutter Context Menu
                    if (ui.isChildOf(gutter, target, true)) {
                        menuGutter.show(e.x, e.y);
                    }
                    // Set main Ace Context Menu
                    else {
                        menuAce.show(e.x, e.y);
                    }

                    return false;
                });
                
                
            });
            
            /***** Method *****/
            function loadDiff(opts) {
                var session = diffview.c9session;
                
                labelLeft.setAttribute("caption", opts.oldPath);
                labelRight.setAttribute("caption", opts.newPath);
                
                var newFilename = (opts.newPath + "").split("/").pop();
                this.activeDocument.title = "Compare " + newFilename;
                
                session.request = status.loadDiff(opts, function(e, diff) {
                    if (e) return console.log(e);
                    if (session.request == diff.request) {
                        if (typeof diff.patch == "string") {
                            diffview.setValueFromFullPatch(diff.patch);
                        } else {
                            diffview.orig.session.setValue(diff.orig);
                            diffview.edit.session.setValue(diff.edit);
                        }
                        diffview.orig.setReadOnly(true);
                        diffview.edit.setReadOnly(true);
                         
                        var syntax = ace.getSyntaxForPath(opts.newPath);
                        if (syntax && syntax.indexOf("/") == -1) syntax = "ace/mode/" + syntax;
                        if (syntax) {
                            diffview.orig.session.setMode(syntax);
                            diffview.edit.session.setMode(syntax);
                        }
                        diffview.orig.renderer.once("afterRender", function() {
                            diffview.computeDiff();
                            diffview.gotoNext(1);
                        });
                    }
                });
            }
            
            /***** Lifecycle *****/
            
            plugin.on("load", function(){
            });
            
            plugin.on("documentLoad", function(e) {
                var doc = e.doc;
                var session = e.doc.getSession();
                
                doc.title = "Compare Files...";
                
                diffview.c9session = session;
                diffview.orig.session.c9session = session;
                diffview.edit.session.c9session = session;
                
                if (doc.meta.path) {
                    loadDiff(doc.meta);
                }
                
                function setTheme(e) {
                    var tab = doc.tab;
                    if (e.theme && BGCOLOR[e.theme]) {
                        var isDark = e.theme == "dark";
                        
                        tab.backgroundColor = BGCOLOR[e.theme];
                        
                        if (isDark) tab.classList.add("dark");
                        else tab.classList.remove("dark");
                    }
                    diffview.setTheme(settings.get("user/ace/@theme"));
                }
                
                layout.on("themeChange", setTheme, doc);
                settings.on("user/ace/@theme", setTheme, doc);
                setTheme({ theme: settings.get("user/general/@skin") });
                
            });
            plugin.on("documentActivate", function(e) {
                currentSession = e.doc.getSession();
            });
            plugin.on("documentUnload", function(e) {
                var session = e.doc.getSession();
            });
            plugin.on("getState", function(e) {
            });
            plugin.on("setState", function(e) {
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
                diffview && diffview.resize(e);
            });
            
            /***** Register and define API *****/
            
            /**
             * Read Only Image Editor
             **/
            plugin.freezePublicAPI({
                get diffview() { return diffview },
                get ace () { return lastAce },
                loadDiff: loadDiff
            });
            
            plugin.load(null, "ace.repl");
            
            return plugin;
        }
        
        register(null, {
            "diffview": handle
        });
    }
});