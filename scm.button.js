define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "ui", "settings", "collab.workspace", 
        "dialog.info", "dialog.confirm", "dialog.error", "fs", "dialog.alert", 
        "Menu", "MenuItem", "Divider", "layout", "Tree", "tabManager", 
        "dialog.question", "dialog.filechange", "tree", "save",
        "commands", "c9", "scm", "console", "preferences.experimental"
    ];
    main.provides = ["scm.button"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var ui = imports.ui;
        var fs = imports.fs;
        var c9 = imports.c9;
        var settings = imports.settings;
        var commands = imports.commands;
        var collabWorkspace = imports["collab.workspace"];
        var sync = imports["salesforce.sync"];
        var showInfo = imports["dialog.info"].show;
        var showError = imports["dialog.error"].show;
        var showConfirm = imports["dialog.confirm"].show;
        var showAlert = imports["dialog.alert"].show;
        var showQuestion = imports["dialog.question"].show;
        var showFileChange = imports["dialog.filechange"].show;
        var Menu = imports.Menu;
        var MenuItem = imports.MenuItem;
        var Divider = imports.Divider;
        var layout = imports.layout;
        var Tree = imports.Tree;
        var scm = imports.scm;
        var save = imports.save;
        var experimental = imports["preferences.experimental"];
        var cnsl = imports.console;
        var tabManager = imports.tabManager;
        
        // var async = require("async");
        var basename = require("path").basename;
        var dirname = require("path").dirname;
        var escapeHTML = require("ace/lib/lang").escapeHTML;
        
        /***** Initialization *****/
        
        var ENABLED = experimental.addExperiment("git", !c9.hosted, "Panels/Source Control Management")
        if (!ENABLED)
            return register(null, { "scm.button": {} });
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit = plugin.getEmitter();
        
        var btnScmClassName = "splitbutton btn-scm";
        var btnScm, title, tree;
        var arrayCache = [];
        
        function load() {
            settings.on("read", function(e) {
                settings.setDefaults("state/scm", [
                    ["auto", "true"]
                ]);
            }, plugin);
            
            // settings.on("state/scm", function(){
            //     clearInterval(syncInterval);
                
            //     if (settings.getBool("state/scm/@auto")) {
            //         syncInterval = setInterval(syncNow, 
            //             settings.getNumber("state/scm/@interval") * 1000);
            //         syncNow();
            //     }
            // }, plugin);
            
            // prefs.add({
            //     "Salesforce" : {
            //         position: 3000,
            //         "Synchronization" : {
            //             position: 200,
            //             "Automatically Synchronize When Detecting a Change" : {
            //                 type: "checkbox",
            //                 position: 100,
            //                 setting: "state/scm/@auto"
            //             },
            //             "Synchronization Interval (in seconds)" : {
            //                 type: "spinner",
            //                 position: 200,
            //                 min: 1,
            //                 max: 60 * 60,
            //                 setting: "state/scm/@interval"
            //             }
            //         }
            //     }
            // }, plugin);
            
            // commands.addCommand({
            //     name: "sync-salesforce",
            //     bindKey: { mac: "Command-Ctrl-S", win: "Ctrl-Alt-S" },
            //     exec: function(editor, args) {
            //         syncNow();
            //     }
            // }, plugin);
            
            draw();
        }
        
        var drawn;
        function draw(){
            if (drawn) return;
            drawn = true;
            
            // ui.insertCss(require("text!./style.css"), options.staticPrefix, plugin);
            
            var status;
            
            mnuCommit = new Menu({
                items: [
                    {
                        aml: title = new ui.bar({ 
                            style: "max-width:100%",
                            class: "scm-title" 
                        }),
                        plugin: plugin
                    },
                    
                    new Divider(),
                    
                    {
                        aml: status = new ui.bar({ 
                            style: "padding: 2px 0 0 9px" 
                        }),
                        plugin: plugin
                    },
                    
                    new Divider(),
                    
                    new MenuItem({
                        caption: "Sync Now",
                        onclick: function() {
                            abortSync();
                        },
                        isAvailable: function() {
                            // return sync.isSyncing
                        }
                    }),
                    new MenuItem({
                        caption: "Abort",
                        onclick: function() {
                            abortSync();
                        },
                        isAvailable: function() {
                            // return sync.isSyncing
                        }
                    }),
                    
                    new Divider(),
                    
                    new MenuItem({
                        caption: "Rebase Against Master",
                        onclick: function() {
                            
                        },
                        isAvailable: function() {
                            // return collabWorkspace.isAdmin && sync.conflicts;
                        }
                    }),
                    
                    new MenuItem({
                        caption: "Merge Master Into This Branch",
                        onclick: function() {
                            
                        },
                        isAvailable: function() {
                            // return collabWorkspace.isAdmin && sync.conflicts;
                        }
                    }),
        
                    new MenuItem({
                        caption: "Reset Local Changes...",
                        onclick: function() {
                            resetHard();
                        },
                        isAvailable: function() {
                            // return collabWorkspace.isAdmin && !sync.isSyncing;
                        }
                    }),
                    
                    new Divider(),
                    
                    new MenuItem({
                        caption: "Show Log...",
                        onclick: function() {
                            // tabManager.openFile("/package.xml", true, function(){});
                            cnsl.show();
                            tabManager.open({
                                editorType: "scmlog", 
                                focus: true,
                                pane: cnsl.getPanes()[0]
                            }, function(){});
                        }
                    }),
                    
                    new MenuItem({
                        caption: "Show Branches...",
                        onclick: function() {
                            // tabManager.openFile("/package.xml", true, function(){});
                        }
                    }),
                    
                    new Divider(),
                    
                    new MenuItem({
                        caption: "Automatically Sync After Commit",
                        type: "check",
                        checked: "state/scm/@auto"
                    }),
                ]
            }, plugin);
            
            mnuCommit.on("show", function(){
                drawTree(status.$int);
                reload({ hash: 0, force: true }, function(){
                    updateStatusMessage();
                });
                // updateStatusTree();
            });
            
            // mnuCommit.on("hide", function(){
            //     showDetails(null);
            // });
            
            btnScm = ui.insertByIndex(layout.getElement("barTools"), new ui.splitbutton({
                caption: "Commit",
                skinset: "default",
                skin: "c9-menu-btn",
                // icon: "sync.png",
                submenu: mnuCommit.aml,
                onclick: function(){
                    // syncNow();
                }
            }), 300, plugin);
            btnScm.$ext.className = btnScmClassName;
            
            // sync.on("conflicts", function(e){
            //     updateStatusTree();
                
            //     if (e.conflicts)
            //         reportConflicts(e.conflicts);
            // }, plugin);
            
            // sync.on("errors", function(e){
            //     updateStatusTree();
            // }, plugin);
            
            // sync.on("afterPush", function(e){
            //     updateStatusTree(false);
            //     updateStatusMessage();
            // }, plugin);
            
            // sync.on("afterFetch", function(e){
            //     updateStatusTree(false);
            //     updateStatusMessage();
            // }, plugin);
            
            // function setTheme(e) {
            //     var isDark = e.theme.indexOf("dark") > -1;
            //     mnuCommit.aml.setAttribute("class", isDark ? "dark" : "");
            //     if (detailsView) 
            //         detailsView.className = "c9menu synctooltip " + (isDark ? "dark" : "");
                
            //     if (isDark) {
            //         btnScmClassName += " dark";
            //         btnScm.$ext.className += " dark";
            //     }
            //     else {
            //         btnScmClassName = btnScmClassName.replace(/ dark/g, "");
            //         btnScm.$ext.className = btnScm.$ext.className.replace(/ dark/g, "");
            //     }
            // }
            
            // layout.on("themeChange", setTheme, plugin);
            // setTheme({ theme: settings.get("user/general/@skin") });
            
            // updateStatusTree();
        }
        
        function drawTree(parentHtml){
            if (tree) return;
            
            tree = new Tree({
                container: parentHtml,
                scrollMargin: [0, 0],
                theme: "filetree scmtree",
                enableDragdrop: true,
                emptyMessage: "No changes",
            
                getIconHTML: function(node) {
                    var icon = node.isFolder ? "folder" : "status-icon-" + node.type;
                    if (node.parent == conflicts)
                        icon = "status-icon-conflict";
                    if (node.status === "loading") icon = "loading";
                    if (tree.model.twoWay && !node.isFolder)
                        icon += " clickable";
                    return "<span class='status-icon " + icon + "'>"
                        + (node.type || "") + "</span>";
                },
                
                getCaptionHTML: function(node) {
                    if (node.path) {
                        var path = node.labelPath || node.path;
                        return basename(path) 
                            + "<span class='extrainfo'> - " 
                            + dirname(path) + "</span>";
                    }
                    return escapeHTML(node.label || node.name);
                },
                
                getRowIndent: function(node) {
                    return 0; //node.$depth ? node.$depth - 2 : 0;
                },
                
                isLoading: function() {}
            }, plugin);
            
            // tree.container.style.position = "absolute";
            // tree.container.style.left = "0";
            // tree.container.style.top = "0";
            // tree.container.style.right = "0";
            // tree.container.style.bottom = "0";
            // tree.container.style.height = "";
            tree.renderer.scrollBarV.$minWidth = 10;
            
            tree.commands.bindKey("Space", function(e) {
                if (tabManager.previewTab)
                    tabManager.preview({ cancel: true });
                else
                    openSelection({ preview: true });
            });
            
            tree.commands.bindKey("Enter", function(e) {
                openSelection();
            });
            
            tree.commands.bindKey("Shift-Enter", function(e) {
                openSelectedFiles();
            });
            
            layout.on("eachTheme", function(e){
                var height = parseInt(ui.getStyleRule(".filetree .tree-row", "height"), 10) || 22;
                tree.rowHeightInner = height;
                tree.rowHeight = height + 1;
                if (e.changed)
                    tree.resize();
            }, plugin);
            
            tree.on("afterChoose", function(e) {
                openSelection();
            });
            
            tree.on("userSelect", function(e) {
                if (tabManager.previewTab)
                    openSelection({ preview: true });
            });
            
            tree.on("drop", function(e) {
                if (e.target && e.selectedNodes) {
                    var nodes = e.selectedNodes;
                    if (e.target == staged) {
                        scm.addFileToStaging(nodes);
                    } 
                    else if (e.target == changed || e.target == untracked) {
                        scm.unstage(nodes);
                    }
                }   
            });
            
            tree.on("click", function(e) {
                if (e.domEvent.target.classList.contains("status-icon")) {
                    var node = e.getNode();
                    if (node.parent == staged) {
                        scm.unstage(node);
                    } else if (node.parent == changed || node.parent == ignored) {
                        scm.addFileToStaging(node);
                    } else if (node.parent == conflicts) {
                        scm.addFileToStaging(node);
                    }
                }
            });
            
            tree.setRoot(arrayCache);
            
            // tree.on("focus", function(){
            //     test.focussedPanel = plugin;
            // });
            
            // settings.on("read", function(){
            //     test.settingsMenu.append(new MenuItem({ 
            //         caption: "Collapse Passed and Skipped Groups", 
            //         checked: "user/test/@collapsegroups",
            //         type: "check",
            //         position: 300
            //     }));
            // }, plugin);
            
            // settings.on("user/test/@collapsegroups", function(value){
            //     if (plugin.visible) {
            //         skipNode.isOpen = !value;
            //         passNode.isOpen = !value;
            //         tree.refresh();
            //     }
            // }, plugin);
            
            scm.on("reload", function(options){
                reload(options || { hash: 0, force: true }, function(e, status) {
                    
                });
            }, plugin);
            
            // scm.on("resize", function(){
            //     tree && tree.resize();
            // });
            
            // scmlog.on("select", function(options){
            //     if (options) reload(options, function(){});
            // }, plugin);
            
            // Context Menu
            // menuContext = new Menu({ items: [
            //     new MenuItem({ match: "file", class: "strong", caption: "Open Diff", onclick: openSelection }, plugin),
            //     new MenuItem({ match: "file", caption: "Open", onclick: openSelectedFiles }, plugin),
            //     new MenuItem({ match: "file", caption: "Reveal in File Tree", onclick: reveal }, plugin),
            // ]});
            // opts.aml.setAttribute("contextmenu", menuContext.aml);
            
            // logTree = new Tree({
            //     container: parentHtml,
            //     scrollMargin: [0, 0],
            //     theme: "filetree synctree",
            //     isLoading: function() {},

            //     getIconHTML: function(node) {
            //         var icon;
            //         if (node.parent == conflicts)
            //             icon = "conflict";
            //         else if (node.parent == errors)
            //             icon = "error";
            //         else return "";
                    
            //         return "<span class='sync-icon " + icon + "'></span>";
            //     },

            //     getCaptionHTML: function(node) {
            //         if (node.label)
            //             return escapeHTML(node.label);
                    
            //         if (node.fileName) {
            //             var fileName = node.fileName;
            //             return escapeHTML(basename(fileName)) 
            //                 + "<span class='extrainfo'> - " 
            //                 + escapeHTML(dirname(fileName)) + "</span>";
            //         }
            //     },

            //     getRowIndent: function(node) {
            //         return 0;
            //     },

            // },plugin);

            // // TODO generalize this
            // logTree.renderer.scrollBarV.$minWidth = 10;
            
            // logTree.commands.bindKey("Space", function(e) {
            //     if (tabManager.previewTab)
            //         tabManager.preview({ cancel: true });
            //     else
            //         openSelectedFiles({ preview: true });
            // });
            
            // logTree.commands.bindKey("Enter", function(e) {
            //     openSelectedFiles();
            // });
            
            // layout.on("eachTheme", function(e) {
            //     var height = parseInt(ui.getStyleRule(".filetree .tree-row", "height"), 10) || 22;
            //     logTree.rowHeightInner = height;
            //     logTree.rowHeight = height + 1;
            //     if (e.changed)
            //         logTree.resize();
            // }, plugin);
            
            // logTree.on("afterChoose", function(e) {
            //     openSelectedFiles();
            // });
            
            // logTree.on("userSelect", function(e) {
            //     if (tabManager.previewTab)
            //         openSelectedFiles({ preview: true });
                
            //     showDetails(logTree.selectedNode);
            // });
            
            tree.minLines = 2;
            tree.maxLines = Math.floor((window.innerHeight - 100) / tree.rowHeight);
            tree.emptyMessage = "loading...";
            
            // sync.on("log", function(e){
            //     updateStatusMessage();
            // }, plugin);
        }
        
        function updateStatusMessage() {
            if (!title || !title.$int) return;
            
            var state = "Idle" /*sync.getState()*/, color = "";
            // if (state == "not synced") {
            //     if (sync.errors.message)
            //         state = sync.errors.message;
            //     color = "#EE686A";
            // }
                
            title.$int.innerHTML = "<div style='color:" + color + "'>"
                + ("Status: " + state)
                + "</div>";
        }
        
        /***** Helper Methods *****/
        
        var changed = {
            label: "unstaged",
            className: "heading",
            items: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        var staged = {
            label: "staged",
            className: "heading",
            items: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        var ignored = {
            label: "ignored",
            className: "heading",
            items: [],
            isOpen: true,
            isFolder: true,
            map: {},
            noSelect: true,
            $sorted: true
        };
        var untracked = {
            label: "untracked",
            className: "heading",
            items: [],
            isOpen: true,
            isFolder: true,
            map: {},
            noSelect: true,
            $sorted: true
        };
        var conflicts = {
            label: "conflicts",
            className: "heading",
            items: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        function reload(options, cb) {
            if (!options) options = {hash: 0};
            if (!tree.meta.options) tree.meta.options = {};
            if (!options.force)
            if (tree.meta.options.hash == options.hash && tree.meta.options.base == options.base)
                return;
            
            options.untracked = "all";
            
            // TODO: move parsing to git - this is git specific
            scm.getStatus(options, function(e, status) {
                var root = [];
                var i, name, x;
                
                status = (status || "").split("\x00");
                status.shift();
                console.log(status);
                
                if (status.length == 1 && status[0] == "")
                    return tree.setRoot(null);
                
                changed.items = changed.children = [];
                staged.items = staged.children = [];
                ignored.items = ignored.children = [];
                conflicts.items = conflicts.children = [];
                untracked.items = untracked.children = [];
                root = {
                    items: [staged, changed, untracked],
                    $sorted: true,
                    isFolder: true
                };
                for (i = 0; i < status.length; i++) {
                    x = status[i];
                    name = x.substr(3);
                    if (!name) continue;
                    
                    if (x[0] == "U" || x[1] == "U") {
                        conflicts.items.push({
                            label: name,
                            path: name,
                            type: x[0] + x[1]
                        });
                        continue;
                    }
                    if (x[0] == "R") {
                        i++;
                        staged.items.push({
                            label: name,
                            path: name,
                            originalPath: status[i],
                            type: x[0]
                        });
                    }
                    else if (x[0] != " " && x[0] != "?") {
                        staged.items.push({
                            label: name,
                            path: name,
                            type: x[0]
                        });
                    }
                    if (x[1] == "?") {
                        untracked.items.push({
                            label: name,
                            path: name,
                            type: x[1],
                            isFolder: name.slice(-1) == "/"
                        });
                    }
                    else if (x[1] == "!") {
                        ignored.items.push({
                            label: name,
                            path: name,
                            type: x[1],
                            isFolder: name.slice(-1) == "/"
                        });
                    }
                    else if (x[1] != " ") {
                        changed.items.push({
                            label: name,
                            path: name,
                            type: x[1]
                        });
                    }
                }
                if (ignored.items.length)
                    root.items.push(ignored);
                if (conflicts.items.length)
                    root.items.unshift(conflicts);
                // label.style.display = "none";
                    
                tree.setRoot(root);
                tree.meta.options = options;
            });
        }
        
        // function trimLongStatus(output) {
        //     var lines = output.split("\n");
        //     if (lines.length < 20)
        //         return output;
        //     return lines.slice(0, 19).join("\n") 
        //         + "\n[...truncated, use s9 status in your terminal to see the full output...]";
        // }
        
        // function setConflicts() {
        //     if (!logTree) return sync.conflicts ? true : false;
        //     conflicts.items.length = 0;		
        //     if (sync.conflicts) { 		
        //         sync.conflicts.forEach(function(x) {		
        //             conflicts.items.push(x);		
        //         });		
        //         return true;		
        //     }		
            		
        //     return false;
        // }
        
        // function setErrors() {
        //     if (!logTree) return sync.errors ? true : false;
            
        //     errors.items.length = 0;
            
        //     if (sync.errors) {
        //         if (sync.errors.details)
        //             sync.errors.details.forEach(function(e, i) {
        //                 errors.items.push(e);
        //             });
        //         return true;
        //     }
            
        //     return false;
        // }
        // function updateTree() {
        //     if (!logTree) return;
            
        //     logTree.model.setRoot([
        //         conflicts, 
        //         errors
        //     ].filter(function(x) {
        //         return x.items.length;
        //     }));
            
        //     var bar = logTree.container.parentNode.host;
        //     if (logTree.model.root.items.length) {
        //         bar.show();
        //         bar.previousSibling.show();
        //     }
        //     else {
        //         bar.hide();
        //         bar.previousSibling.hide();
        //     }
            
        //     // html.nextSibling.style.display = 
        //     // html.style.display = logTree.model.root.items.length
        //     //     ? "block" : "none";
        // }
        
        // var detailsView;
        // function showDetails(item) {
        //     if (!item || !item.message)
        //         return detailsView && detailsView.remove();
            
        //     var i = logTree.model.getIndexForNode(item);
        //     var domNode = logTree.renderer.$cellLayer.getDomNodeAtIndex(i);
        //     if (!domNode) return;
            
        //     var popup = mnuCommit.aml.$ext;
        //     if (!detailsView) {
        //         detailsView = document.createElement("div");
        //         detailsView.className = "c9menu synctooltip " 
        //             + (~settings.get("user/general/@skin").indexOf("dark") ? "dark" : "");
        //         detailsView.style.right;
        //         detailsView.style.zIndex = mnuCommit.aml.$ext.style.zIndex;
        //     }
            
        //     if (!detailsView.parentNode)
        //         document.body.appendChild(detailsView);
        //     detailsView.style.display = "block";
            
        //     detailsView.textContent = item.message;

        //     var rectRow = domNode.getBoundingClientRect();
        //     var rectPopup = popup.getBoundingClientRect();
        //     // detailsView.style.bottom = popup.style.bottom;
        //     detailsView.style.maxWidth = "320px";
        //     detailsView.style.top = (rectRow.top 
        //         - ((detailsView.offsetHeight - rectRow.height) / 2)) + "px";
            
        //     if (window.innerWidth - rectPopup.right < 320) {
        //         detailsView.style.right = (window.innerWidth - rectPopup.left + 10) + "px";
        //         detailsView.style.left = "";
        //     } else {
        //         detailsView.style.left = (rectPopup.right + 10) + "px";
        //         detailsView.style.right = "";
        //     }
        // }
        
        // function updateStatusTree(isSyncing){
        //     var state = [];
            
        //     if (setErrors())
        //         state.push("error");
        //     if (setConflicts())
        //         state.push("conflict");
        //     if (isSyncing === undefined ? sync.getState() === sync.STATE_SYNCING : isSyncing)
        //         state.push("syncing");
            
        //     setSyncStatus(state.join(" "));
            
        //     if (logTree) {
        //         updateTree();
        //         logTree.resize(true);
                
        //         var toWidth = logTree.renderer.$cellLayer.element.scrollWidth + 2;
        //         mnuCommit.minWidth = toWidth > 100 ? toWidth : "";
        //     }
        // }
        
        // function openSelectedFiles(opts) {
        //     // if (!c9.has(c9.STORAGE))
        //     //     return;
            
        //     var focus = opts && opts.focusNewTab || true;
        //     var sel = logTree.selectedNodes;
        //     var main = logTree.selectedNode;
            
        //     sel.forEach(function(node) {
        //         if (!node || node.isFolder)
        //             return;
    
        //         var pane = tabManager.focussedTab && tabManager.focussedTab.pane;
        //         if (tabManager.getPanes(tabManager.container).indexOf(pane) == -1)
        //             pane = null;
                
        //         if (~node.fileName.indexOf("<???>"))
        //             return;
                
        //         var options = {
        //             path: "/" + node.fileName,
        //             pane: pane,
        //             noanim: sel.length > 1,
        //             active: node === main,
        //             focus: node === main && focus
        //         };
        //         if (node.lineNumber) {
        //             var jump = {
        //                 row: node.lineNumber,
        //                 col: node.columnNumber
        //             };
        //             options.document = {
        //                 ace: {
        //                     jump: jump
        //                 }
        //             };
        //         }
                
        //         var method = opts && opts.preview ? "preview" : "open";
        //         tabManager[method](options, function(){});
        //     });
        // }
        
        // /***** Methods *****/
        
        // function init(version){
        //     sync.init(version, function(err, forceSync) {
        //         if (err) {
        //             showInitError(err);
        //             return;
        //         }
                
        //         fs.on("afterWriteFile", onFsChange, plugin);
        //         fs.on("afterUnlink", onFsChange, plugin);
        //         fs.on("afterRmfile", onFsChange, plugin);
        //         fs.on("afterRmdir", onFsChange, plugin);

        //         if (settings.getBool("state/scm/@auto"))
        //             syncInterval = setInterval(syncNow, 
        //                 settings.getNumber("state/scm/@interval") * 1000);
                
        //         save.on("afterSave", onFsChange, plugin);
        //         save.CAPTION_SAVED = "";
                
        //         function onFsChange(e) {
        //             if (!settings.getBool("state/scm/@auto"))
        //                 return;
                    
        //             var ext = extname(e.path);
        //             if (metadata.extensions[ext && ext.substr(1)] // TODO: move this check to metadata.js
        //               || metadata.folders[e.path]) {
        //                 syncNow(SYNC_TIMEOUT);
        //             }
        //         }
                
        //         // Draw the toolbar button
        //         draw();
                
        //         // Sync
        //         if (forceSync || settings.getBool("state/scm/@auto"))
        //             syncNow();
        //     });
        // }
        
        // function showInitError(err){
        //     showAlert(
        //         "Salesforce",
        //         "Your workspace could not be configured to synchronize with Salesforce.",
        //         '<pre class="sfdc-alert-output">' + trimLongStatus(escapeHTML(err.message)) + "</pre>",
        //         function() {
                    
        //         },
        //         { isHTML: true }
        //     );
        // }
        
        // var syncTimeout;
        // function syncNow(timeout, callback){
        //     if (!collabWorkspace.isAdmin || sync.isSyncing) {
        //         // Make sure button reflects that we are fetching
        //         if (sync.isSyncing === 2) updateStatusTree(true);
                
        //         // Schedule new sync
        //         plugin.once("afterSync", syncNow.bind(this, arguments));
        //         return false;
        //     }
            
        //     if (typeof timeout == "function")
        //         callback = timeout, timeout = null;
            
        //     clearTimeout(syncTimeout);
            
        //     if (timeout) {
        //         syncTimeout = setTimeout(syncNow.bind(this, callback), timeout);
        //         return true;
        //     }
            
        //     updateStatusTree(true);
            
        //     sync.sync(function(err){
        //         if (err && err.code !== sync.ERROR_NO_CHANGES) {
        //             if (err.code === sync.ERROR_INVALID_MANIFEST) {
        //                 var list = [];
        //                 err.message.replace(RE_INVALID_MANIFEST, function(m, type, name){ 
        //                     list.push({ type: type, name: name });
        //                 });
                        
        //                 if (list.length)
        //                     handleInvalidManifest(list);
        //                 else if (RE_INVALID_VERSION.test(err.message))
        //                     handleInvalidVersion();
        //             }
        //             else if (err.code === sync.ERROR_MERGE_CONFLICT) {
        //                 // Nothing special needed
        //             }
        //             else if (err.code === sync.ERROR_NETWORK) {
        //                 // It already retried 3 times. Ignore
        //             }
        //             else if (err.code === sync.ERROR_RESOLVE_FIRST) {
        //                 // Do Nothing
        //             }
        //             else if (err.salesforce) {
        //                 showSFErrorAlert(err);
        //             }
        //             else {
        //                 // TODO: perhaps display the error message in the menu status
        //                 var errors = sync.errors || {};
        //                 errors.message = err.message;
        //                 sync.setSyncState("errors", sync.errors);
        //             }    
        //         }
        //         else if (sync.errors) {
        //             sync.setSyncState("errors", null);
        //         }
                
        //         updateStatusMessage();
        //         callback && callback(err);
                
        //         emit("afterSync");
        //     }, timeout);
            
        //     return true;
        // }
        
        // function abortSync(callback){
        //     sync.abort(function(err){
        //         updateStatusTree(sync.isSyncing);
        //         callback && callback(err);
        //     });
        // }
        
        // function resetHard(callback) {
        //     sync.getOurStatus(function(err, status){
        //         if (err) console.error(err);
                
        //         showConfirm(
        //             "Reset Local Changes",
        //             "Are you sure you would like to reset your local changes?",
        //             "This will remove all local changes not uploaded to Salesforce yet:<br>"
        //             + '<pre class="sfdc-alert-output">' + trimLongStatus(escapeHTML(status || "") || "") + '</pre>',
        //             function() {
        //                 sync.resetHard(function(err){
        //                     if (err)
        //                         return showAlert("Reset Local Changes", "Error resetting local changes", err.message);
        //                     showAlert("Reset Local Changes", "Successfully reset your local changes");
                            
        //                     syncNow();
        //                 });
        //             },
        //             function() {
        //             },
        //             { isHTML: true }
        //         );
        //     });
        // }
        
        // function markConflictsResolved() {
        //     async.waterfall([
        //         function(next) {
        //             sync.getUnresolvedConflicts(next);
        //         },
        //         function(unresolved, next) {
        //             if (unresolved.length) {
        //                 return showQuestion(
        //                     "Mark Conflicts Resolved",
        //                     "The following files still appear to have unresolved conflicts. Would you like to abort and review these files first?",
        //                     '<pre class="sfdc-alert-output">' + trimLongStatus(escapeHTML(unresolved.join("\n"))) + '</pre>',
        //                     function() {
        //                         unresolved.forEach(function(file) {
        //                             tabManager.openFile("/" + file, true);
        //                         });
        //                         done();
        //                     },
        //                     function(){
        //                         next();
        //                     },
        //                     { isHTML: true }
        //                 );
        //             }
        //             next();
        //         },
        //         function(next) {
        //             sync.getConflicts(next);
        //         },
        //         function(conflicts, next) {
        //             if (!conflicts.length) {
        //                 showAlert("Mark Conflicts Resolved", 
        //                   "No conflicts found.", 
        //                   "Congrats! Your workspace currently has no merge conflicts with Salesforce.");
                        
        //                 // Let's be paranoid and mark everything as resolved anyway
        //                 return sync.resolveConflicts(function(err){
        //                     if (err) return done(err);
                            
        //                     syncNow();
        //                     done();
        //                 });
        //             }
                    
        //             return showConfirm(
        //                 "Mark Conflicts Resolved",
        //                 "This will mark conflicts in the following files as resolved.", 
        //                 '<pre class="sfdc-alert-output">' + trimLongStatus(escapeHTML(conflicts)) + '</pre>',
        //                 function confirm() {
        //                     next();
        //                 },
        //                 function(){
        //                     done();
        //                 },
        //                 { isHTML: true }
        //             );
        //         },
        //         function(next) {
        //             sync.resolveConflicts(function(err){
        //                 if (err) return next(err);
                        
        //                 conflictsToManuallyResolve = [];
        //                 showAlert("Mark Conflicts Resolved", "", "Conflicts marked resolved.");
        //                 syncNow();
        //             });
        //         }
        //     ], done);
            
        //     function done(err) {
        //         if (err) {
        //             return showAlert(
        //                 "Mark Conflicts Resolved",
        //                 "Could not resolve conflicts because of an internal error. Please try again.",
        //                 '<pre class="sfdc-alert-output">' + trimLongStatus(escapeHTML(err.message)) + '</pre>',
        //                 function() {},
        //                 { isHTML: true }
        //             );
        //         }
        //     }
        // }
        
        // function reportConflicts(conflicts) {
        //     updateStatusTree();
            
        //     if (conflictsToManuallyResolve && conflictsToManuallyResolve.length) 
        //         return;
        //     if (resolvingConflicts) 
        //         return;
            
        //     resolvingConflicts = true;
            
        //     conflicts = conflicts.map(function (conflict) { return conflict.fileName; });
        //     async.mapSeries(conflicts, showMergeConflictDialog, function(err, result) {
        //         resolvingConflicts = false; 
        //         if (err) {
        //             return showAlert(
        //                 "Error resolving conflicts", 
        //                 "An error occured while resolving sync conflicts. Please manually check the following files:", 
        //                 '<pre class="sfdc-alert-output">' + trimLongStatus(escapeHTML(conflicts.join("\n"))) + '</pre>'
        //             );
        //         }
                
        //         conflictsToManuallyResolve = result
        //             .map(function(r) { return r && r.resolveManually; })
        //             .filter(function (t) { return !!t; });
                
        //         if (conflictsToManuallyResolve.length) {
        //             showAlert(
        //                 "Manually Resolving Conflicts",
        //                 "You've chosen to manually resolve the conflict(s) below.", 
        //                 '<pre class="sfdc-alert-output">' + trimLongStatus(escapeHTML(conflictsToManuallyResolve.join("\n"))) + '</pre>'
        //                 + '<p>Please use the Sync button dropdown and pick <b>Mark Conflicts Resolved</b> once you have resolved the conflict(s).',
        //                 function() {
        //                     settings.setJson("state/scm/@conflicts", conflictsToManuallyResolve);
        //                     conflictsToManuallyResolve.forEach(function (f) {
        //                         tabManager.openFile("/" + f, true);
        //                     });
        //                 },
        //                 { isHTML: true }
        //             );
        //             return;
        //         }
                
        //         sync.resolveConflicts(function(err) {
        //             if (err) {
        //                 return showAlert(
        //                     "Mark Conflicts Resolved",
        //                     "Could not finish resolving conflicts because of an internal error. Please use <b>Salesforce > Mark Conflicts Resolved</b> after fixing the error below.",
        //                     '<pre class="sfdc-alert-output">' + trimLongStatus(escapeHTML(err.message)) + '</pre>',
        //                     function() {},
        //                     { isHTML: true }
        //                 );
        //             }
        //             showAlert("Mark Conflicts Resolved", "", "All conflicts resolved");
        //         });
        //     });
        // }
        
        // function showMergeConflictDialog(file, callback) {
        //     showFileChange(
        //         "Unresolved Sync Conflict",
        //         "The file " + file  + " was changed remotely.",
        //         "Another user has changed this file since it was last synchronized. What would you like to do?",
        //         function useOurs() {
        //             sync.resolveConflict(file, true, function(err) {
        //                 if (err) return errorResolvingSyncConflict(err, file, callback);
        //                 callback();
        //             });
        //         },
        //         function useTheirs() {
        //             sync.resolveConflict(file, false, function(err) {
        //                 if (err) return errorResolvingSyncConflict(err, file, callback);
        //                 callback();
        //             });
        //         },
        //         function resolveManually() {
        //             callback(null, {resolveManually: file});
        //         },
        //         { all: false, merge: { caption: "Merge Manually" } }
        //     );
        // }
        
        // function errorResolvingSyncConflict(err, file, callback) {
        //     showConfirm(
        //         "Error resolving conflict",
        //         "An error occured resolving sync conflicts in the file: " + file + ". The error is below. Would you like to try again?",
        //         err && err.message,
        //         function tryAgain () {
        //             return showMergeConflictDialog(file, callback);
        //         },
        //         function cancel() {
        //             return callback(new Error("Failed to resolve sync conflict"));
        //         }
        //     );
        // }
       
        // function setSyncStatus(type){
        //     if (!btnScm) return;
            
        //     if (!type) {
        //         btnScm.$ext.className = btnScmClassName;
        //     }
        //     else {
        //         btnScm.$ext.className = btnScmClassName + " " + type;
        //     }
        // }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function() {
            load();
        });
        plugin.on("unload", function() {
            clearTimeout(syncTimeout);
            syncTimeout = null;
            drawn = false;
            logTree = null;
            title = null;
            btnScm = null;
            conflicts = null;
            conflictsToManuallyResolve = null;
            btnScmClassName = "splitbutton btn-sync";
            resolvingConflicts = false;
            errors = null;
            detailsView = null;
            mnuCommit = null;
            
            clearInterval(syncInterval);
        });
        
        /***** Register and define API *****/
        
        /**
         */
        plugin.freezePublicAPI({
            get tree(){ return tree; },
            
            /**
             * 
             */
            // syncNow: syncNow
        });
        
        register(null, {
            "scm.button": plugin
        });
    }
});