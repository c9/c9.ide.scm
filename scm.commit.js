define(function(require, exports, module) {
    main.consumes = [
        "Panel", "ui", "settings", "collab.workspace", "dialog.confirm",
        "dialog.info", "dialog.confirm", "dialog.error", "fs", "dialog.alert", 
        "Menu", "MenuItem", "Divider", "layout", "Tree", "tabManager", 
        "dialog.question", "dialog.filechange", "tree", "save",
        "commands", "c9", "scm", "console", "preferences.experimental",
        "watcher", "dialog.question"
    ];
    main.provides = ["scm.commit"];
    return main;
    
    /*
        TODO:
        - Test amend
        - Test nothing to do
        - Add setting to not depend on the status listener
        - Cmd-Enter to commit
        
        Add:
        - Pull / Push
        - Undo Last Commit
        - Unstage All
        - Clean All
        - On Hover:
            - Unstage (-)
            - Stage (+)
            - Clean (undo)
        
        BUG:
        - Why does tree not update after commit (have to wait a while)
    */

    function main(options, imports, register) {
        var Panel = imports.Panel;
        var ui = imports.ui;
        var fs = imports.fs;
        var c9 = imports.c9;
        var settings = imports.settings;
        var commands = imports.commands;
        var collabWorkspace = imports["collab.workspace"];
        var showInfo = imports["dialog.info"].show;
        var showError = imports["dialog.error"].show;
        var confirm = imports["dialog.confirm"].show;
        var alert = imports["dialog.alert"].show;
        var question = imports["dialog.question"];
        var showFileChange = imports["dialog.filechange"].show;
        var Menu = imports.Menu;
        var MenuItem = imports.MenuItem;
        var Divider = imports.Divider;
        var layout = imports.layout;
        var Tree = imports.Tree;
        var scmProvider = imports.scm;
        var save = imports.save;
        var watcher = imports.watcher;
        var experimental = imports["preferences.experimental"];
        var cnsl = imports.console;
        var tabManager = imports.tabManager;
        
        var async = require("async");
        var basename = require("path").basename;
        var dirname = require("path").dirname;
        var escapeHTML = require("ace/lib/lang").escapeHTML;
        
        /***** Initialization *****/
        
        var ENABLED = experimental.addExperiment("git", !c9.hosted, "Panels/Source Control Management")
        if (!ENABLED)
            return register(null, { "scm.commit": {} });
        
        var plugin = new Panel("Ajax.org", main.consumes, {
            index: options.index || 400,
            caption: "Commit",
            minWidth: 150,
            where: options.where || "left"
        });
        var emit = plugin.getEmitter();
        
        var CAPTION = {
            "commit": "Commit",
            "sync": "Sync",
            "conflict": "Resolve Conflicts",
            "rebase": "????"
        }
        
        var btnScmClassName = "splitbutton btn-scm-sync";
        var btnMode = "sync";
        var btnScm, title, tree, status, scm;
        var arrayCache = [];
        
        var body, commitBox, ammendCb, commitBtn, onclick;
        var container, lastCommitMessage;
        
        function load() {
            ui.insertCss(require("text!./style.css"), options.staticPrefix, plugin);
            
            plugin.setCommand({
                name: "showcommit",
                group: "scm",
                bindKey: { mac: "Cmd-Shift-C", win: "Ctrl-Shift-C" }
                // exec: function(editor, args){ 
                //     if (args.message) commit(args.message, args.amend);
                //     else plugin.show();
                // }
            }, plugin);
            
            settings.on("read", function(e) {
                settings.setDefaults("state/scm", [
                    ["auto", false]
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
            
            scmProvider.on("scm", function(implementation){
                scm = implementation;
                
                if (scm) {
                    scm.on("status", function(e){
                        updateStatus(e.status);
                    }, plugin);
                    
                    scm.on("log.dirty", function(){
                        if (!plugin.active) return;
                        updateLastCommit();
                    }, plugin);
                    
                    scm.on("status.dirty", reload);
                }
                
                if (plugin.active) {
                    if (reload())
                        updateLastCommit();
                }
            });
            
            watcher.on("change.all", function(e){
                if (plugin.active && !isChanged(e.path))
                    reload();
            });
            
            watcher.on("directory.all", function(e){
                if (plugin.active && !isChanged(e.path))
                    reload();
            });
            
            plugin.on("show", function(){
                if (reload())
                    updateLastCommit();
                    
                commitBox.focus();
            });
        }
        
        function draw(opts) {
            // Splitbox
            var vbox = opts.aml.appendChild(new ui.vbox({ 
                anchors: "0 0 0 0" 
            }));
            
            // Toolbar
            var toolbar = vbox.appendChild(new ui.hbox({
                id: "toolbar",
                class: "toolbar-top",
                align: "center",
                edge: "0 2 0 0",
                // padding: 3
                // class: "fakehbox aligncenter debugger_buttons basic",
                // style: "white-space:nowrap !important;"
                style: "border-top:0"
            }));
            plugin.addElement(toolbar);
            
            ui.insertByIndex(toolbar, new ui.filler(), 150, plugin);
            
            ammendCb = ui.insertByIndex(toolbar, new ui.checkbox({ 
                label: "amend",
                skin: "checkbox_black",
                margin: "-2px 0 0 0",
                onafterchange: function(){
                    commitBox.ace.setValue(ammendCb.checked
                        ? lastCommitMessage || ""
                        : "");
                }
            }), 200, plugin);
            
            vbox.appendChild(new ui.bar({
                class: "form-bar", 
                childNodes: [
                    commitBox = new apf.codebox({
                        "initial-message": "Message (Press " 
                            + (apf.isMac ? "Cmd-Enter" : "Ctrl-Enter") + " to commit)"
                    })
                ]
            }));
            
            container = vbox.appendChild(new ui.bar({
                style: "padding: 10px 0 10px 0;overflow:auto;flex:1"
            }));
            
            commitBox.ace.setOption("minLines", 1);
            commitBox.ace.setOption("wrap", true);
            commitBox.ace.commands.addCommand({
                bindKey: "Ctrl-Enter|Cmd-Enter",
                name: "commit",
                exec: function(editor) {
                    if (!commitBox.getValue())
                        return; // TODO
                    
                    ammendCb.disable();
                    commitBox.disable();
                    commit(commitBox.getValue(), ammendCb.checked, function(err){
                        ammendCb.enable();
                        commitBox.enable();
                        
                        if (err) 
                            return console.error(err);
                        
                        ammendCb.uncheck();
                        commitBox.setValue("");
                    });
                }
            });
            
            /**** Main UI ****/
            
            mnuCommit = new Menu({
                items: [
                    new MenuItem({
                        caption: "Refresh",
                        onclick: function() {
                            reload();
                        }
                    }),
                    
                    new Divider(),
                    
                    new MenuItem({
                        caption: "Push",
                        onclick: function() {
                            push();
                        }
                    }),
                    new MenuItem({
                        caption: "Pull",
                        onclick: function() {
                            pull();
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
                            mergeMaster();
                        },
                        isAvailable: function() {
                            // return collabWorkspace.isAdmin && sync.conflicts;
                        }
                    }),
        
                    new MenuItem({
                        caption: "Reset Local Changes...",
                        onclick: function() {
                            resetHard();
                        }
                    }),
                    
                    new MenuItem({
                        caption: "Mark Conflicts As Resolved",
                        onclick: function() {
                            markResolved();
                        },
                        isAvailable: function() {
                            // return collabWorkspace.isAdmin && sync.conflicts;
                        }
                    }),
                    
                    new Divider(),
                    
                    new MenuItem({
                        caption: "Show Log...",
                        onclick: function() {
                            openLog();
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
            
            btnScm = ui.insertByIndex(toolbar, new ui.splitbutton({
                icon: "syncing.gif",
                class: "btn-scm-sync",
                skinset: "default",
                skin: "c9-menu-btn",
                submenu: mnuCommit.aml,
                onclick: function(){
                    // if (btnMode == "commit")
                    //     dialogCommit.show();
                    // else 
                    if (btnMode == "sync")
                        sync();
                    else if (btnMode == "conflict") {
                        markResolved();
                    }
                    else if (btnMode == "rebase") {
                        
                    }
                }
            }), 100, plugin);
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
            
            tree = new Tree({
                container: container.$int,
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
                            + dirname(path) + "</span>"
                            + (node.parent == staged
                                ? "<span class='min'>-</span>"
                                : (node.parent == conflicts
                                    ? "<span class='plus'>+</span>"
                                    : "<span class='revert'>-</span>"
                                        + "<span class='plus'>+</span>"));
                    }
                    return escapeHTML(node.label || node.name);
                },
                
                getClassName: function(node) {
                    return (node.className || "") 
                        + (node.status == "loading" ? " loading" : "")
                        + (node.type && ~node.type.indexOf("D") ? " deleted" : "");
                },
                
                getRowIndent: function(node) {
                    return 0; //node.$depth ? node.$depth - 2 : 0;
                },
                
                isLoading: function() {}
            }, plugin);
            
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
            
            // TODO: Immediate feedback
            tree.on("drop", function(e) {
                if (e.target && e.selectedNodes) {
                    var nodes = e.selectedNodes;
                    if (e.target == staged)
                        addToStaging(nodes);
                    else if (e.target == changed || e.target == untracked)
                        removeFromStaging(nodes);
                }   
            });
            
            tree.on("click", function(e) {
                var classList = e.domEvent.target.classList;
                var node;
                
                if (classList.contains("plus")) {
                    node = e.getNode();
                    
                    if (node.parent === conflicts && node.type.indexOf("D") === -1) {
                        fs.readFile(node.path, function(err, data){
                            if (err || data.indexOf("<<<<<<<") === -1) 
                                return addToStaging([node]);
                            
                            confirm("Conflict Not Resolves",
                                "The merge conflict is not yet resolved",
                                "The file '" + node.path + "' still has an "
                                  + "unresolved merge conflict. Click OK to mark "
                                  + "the conflict as resolved.",
                                function(){
                                    addToStaging([node]);
                                });
                        });
                        return;
                    }
                    
                    addToStaging([node]);
                }
                else if (classList.contains("min")) {
                    node = e.getNode();
                    removeFromStaging([node]);
                }
                else if (classList.contains("revert")) {
                    node = e.getNode();
                    revertFile(node.path);
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
            
            // scm.on("reload", function(options){
            //     reload(options || { hash: 0, force: true }, function(e, status) {
                    
            //     });
            // }, plugin);
            
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
            tree.emptyMessage = "Loading...";
            
            // sync.on("log", function(e){
            //     updateStatusMessage();
            // }, plugin);
        }
        
        /***** Helper Methods *****/
        
        var changed = {
            label: "unstaged",
            className: "heading",
            children: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        var staged = {
            label: "staged",
            className: "heading",
            children: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        var ignored = {
            label: "ignored",
            className: "heading",
            children: [],
            isOpen: true,
            isFolder: true,
            map: {},
            noSelect: true,
            $sorted: true
        };
        var untracked = {
            label: "untracked",
            className: "heading",
            children: [],
            isOpen: true,
            isFolder: true,
            map: {},
            noSelect: true,
            $sorted: true
        };
        var conflicts = {
            label: "conflicts",
            className: "heading",
            children: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        
        var queue;
        function updateStatus(status){
            if (!tree) {
                if (!queue)
                    plugin.once("draw", function(){ updateStatus(queue); });
                queue = status;
                return;
            }
            
            if (!status) {
                tree.setRoot(null);
                tree.emptyMessage = "No changes";
                updateButton("sync");
                return;
            }
            
            changed.children = status.changed || [];
            staged.children = status.staged || [];
            ignored.children = status.ignored || [];
            conflicts.children = status.conflicts || [];
            untracked.children = status.untracked || [];
            
            var root = {
                children: [staged, changed, untracked],
                $sorted: true,
                isFolder: true
            };
            if (ignored.children.length) root.children.push(ignored);
            if (conflicts.children.length) root.children.unshift(conflicts);
            
            tree.setRoot(root);
            tree.meta.options = options;
            
            // if (dialogCommit.button) 
            //     dialogCommit.button.setCaption(staged.children.length
            //         ? "Commit"
            //         : "Add All and Commit");
            
            updateButton(conflicts.children.length 
                ? "conflict" 
                : ((status.changed || 0).length || (status.staged || 0).length
                    ? "sync"
                    : "sync"));
        }
        
        function updateButton(type){
            // btnScm.setAttribute("caption", CAPTION[type]);
            btnMode = type;
            removeLoading();
        }
        
        // TODO update UI somehow 
        // - maybe big 3 dots from earlier version of salesforce sync button
        // + a small dropdown below the button stating what the new hash is
        var isSyncing;
        function sync(){
            if (isSyncing) return;
            
            if (settings.getBool("state/scm/@auto")
              || settings.getBool("user/scm/@dontask"))
                return _sync();
            
            question.show("Synchronize Changes With Origin",
                "Are you sure you want to sync?",
                "Syncing will fetch and merge all remote changes of this branch "
                  + "to your working copy and push all your changes to the remote "
                  + "origin. Essentially this will execute a pull and then a push.",
                function(){ // Yes
                    if (question.dontAsk)
                       settings.set("user/scm/@dontask", true);
                    
                    _sync();
                }, function(){ // No
                    // Do Nothing
                }, {
                    showDontAsk: true
                });
            
            function _sync(){
                isSyncing = true;
                setLoading();
                
                function done(err){
                    isSyncing = false;
                    removeLoading();
                    
                    if (err.code == scm.errors.NOPUSHDESTINATION
                      || err.code == scm.errors.NOREMOTEREPO) {
                        alert("Unable To Sync",
                            "No origin specified.",
                            "Please add a remote (origin) via the branches "
                              + "panel in order to enable synchronization.");
                    }
                    
                    if (err) return; // TODO
                }
                
                scm.pull(function(err){
                    if (err) return done(err);
                    
                    scm.push(function(err){
                        done(err);
                    });
                });
            }
        }
        
        function push(){
            if (isSyncing) return;
            
            isSyncing = true;
            setLoading();
            
            scm.push(function(err){
                removeLoading();
                isSyncing = false;
                
                if (err && err.code == scm.errors.NOPUSHDESTINATION) {
                    alert("Unable To Push",
                        "No origin specified.",
                        "Please add a remote (origin) via the branches "
                          + "panel in order to enable push.");
                }
            });
        }
        function pull(){
            if (isSyncing) return;
            
            isSyncing = true;
            setLoading();
            
            scm.pull(function(err){
                removeLoading();
                isSyncing = false;
                
                if (err && err.code == scm.errors.NOREMOTEREPO) {
                    alert("Unable To Push",
                        "No origin specified.",
                        "Please add a remote (origin) via the branches "
                          + "panel in order to enable push.");
                }
            });
        }
        function mergeMaster(){
            if (isSyncing) return;
            
            isSyncing = true;
            setLoading();
            
            scm.pull({ branch: "origin master" }, function(err){
                removeLoading();
                isSyncing = false;
                
                if (err && err.code == scm.errors.NOREMOTEREPO) {
                    alert("Unable To Push",
                        "No origin specified.",
                        "Please add a remote (origin) via the branches "
                          + "panel in order to enable push.");
                }
            });
        }
        function resetHard(){
            setLoading();
            scm.resetHard(function(err){
                removeLoading();
                if (err) return; // TODO
            });
        }
        function markResolved(){
            if (isSyncing || !conflicts.children.length) return;
            
            confirm("Resolve Conflicts",
                "Would you like to resolve all conflicts?",
                "Click OK to resolve all conflicts",
                function(){
                    isSyncing = true;
                    setLoading();
                    
                    async.each(conflicts.children, function(n, next){
                        scm.addFileToStaging(n.path, next);
                    }, function(err){
                        removeLoading();
                        if (err) return; // TODO
                    });
                });
        }
        
        function commit(message, amend, callback, force){
            if (conflicts.children.length) {
                alert("Unresolved Conflicts",
                    "There are unresolved conflicts.",
                    "Please resolve the conflicts before committing.");
                return callback(new Error("Unresolved Conflicts"));
            }
                    
            if (!staged.children.length && !changed.children.length) {
                alert("Nothing to do",
                    "There is nothing to commit",
                    "Please make some changes to commit and try again.");
                return callback(new Error("Nothing to do"));
            }
            
            if (!staged.children.length && !force) {
                scm.addFileToStaging(function(err){
                    if (err) return console.error(err);
                    
                    commit(message, amend, callback, true); 
                });
                return;
            }
            
            scm.commit({ 
                message: message,
                amend: amend
            }, function(err){
                if (err) return console.error(err);
                
                if (settings.getBool("state/scm/@auto"))
                    sync();
                
                callback && callback();
            });
        }
        
        function openLog(callback){
            var tabs = tabManager.getTabs();
            var tab;
            if (tabs.some(function(t){ return (tab = t).editorType == "scmlog"; }))
                return tabManager.focusTab(tab);
            
            cnsl.show();
            tabManager.open({
                editorType: "scmlog", 
                focus: true,
                pane: cnsl.getPanes()[0]
            }, function(err, tab){
                callback(err, tab);
            });
        }
        
        function addToStaging(nodes){
            scm.addFileToStaging(nodes.map(function(n){
                return n.path;
            }).filter(Boolean));
        }
        
        function removeFromStaging(nodes){
            scm.unstage(nodes.map(function(n){
                return n.path;
            }).filter(Boolean));
        }
        
        function revertFile(path) {
            confirm("Revert File",
                "Are you sure you want to revert all changes in '" + path + "'",
                "Click OK to revert all changes or click Cancel to cancel this action.",
                function(){
                    scm.revert(path, function(err){
                        if (err) {
                            return alert("Could Not Revert Changes",
                                "Received Error While Reverting Changes",
                                err.message || err);
                        }
                    });
                }, 
                function(){});
        }
        
        function reload(e){
            if (!scm) {
                updateStatus(null);
                tree.emptyMessage = "No repository detected";
                return false;
            }
            
            tree.emptyMessage = "Loading...";
            setLoading();
            
            scm.getStatus({ 
                hash: 0, 
                force: true,
                untracked: "all"
            }, function(err){
                removeLoading();
                
                if (err && err.code == scm.errors.NOTAREPO)
                    updateStatus(null);
            });
            
            return true;
        }
        
        function isChanged(path){
            if (changed.children.some(function(n){
                if (n.path == path) return;
            })) return true;
            if (untracked.children.some(function(n){
                if (n.path == path) return;
            })) return true;
            if (conflicts.children.some(function(n){
                if (n.path == path) return;
            })) return true;
            if (ignored.children.some(function(n){
                if (n.path == path) return;
            })) return true;
            
            return false;
        }
        
        function updateLastCommit(){
            scm.getLastLogMessage(function(err, message){
                lastCommitMessage = err ? "" : message;
            });
        }
        
        function setLoading(){
            setSyncStatus("syncing" + (conflicts.children.length ? " conflict" : ""));
        }
        
        function removeLoading(){
            setSyncStatus((conflicts.children.length ? "conflict" : ""));
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
        //     conflicts.children.length = 0;		
        //     if (sync.conflicts) { 		
        //         sync.conflicts.forEach(function(x) {		
        //             conflicts.children.push(x);		
        //         });		
        //         return true;		
        //     }		
            		
        //     return false;
        // }
        
        // function setErrors() {
        //     if (!logTree) return sync.errors ? true : false;
            
        //     errors.children.length = 0;
            
        //     if (sync.errors) {
        //         if (sync.errors.details)
        //             sync.errors.details.forEach(function(e, i) {
        //                 errors.children.push(e);
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
        //         return x.children.length;
        //     }));
            
        //     var bar = logTree.container.parentNode.host;
        //     if (logTree.model.root.children.length) {
        //         bar.show();
        //         bar.previousSibling.show();
        //     }
        //     else {
        //         bar.hide();
        //         bar.previousSibling.hide();
        //     }
            
        //     // html.nextSibling.style.display = 
        //     // html.style.display = logTree.model.root.children.length
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
       
        function setSyncStatus(type){
            if (!btnScm) return;
            
            if (!type) {
                btnScm.$ext.className = btnScmClassName;
            }
            else {
                btnScm.$ext.className = btnScmClassName + " " + type;
            }
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function() {
            load();
        });
        plugin.on("draw", function(options) {
            draw(options);
        });
        plugin.on("resize", function(options) {
            tree && tree.resize();
        });
        plugin.on("show", function(options) {
            tree && setTimeout(tree.resize);
        });
        plugin.on("unload", function() {
            clearTimeout(syncTimeout);
            isSyncing = null;
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
            "scm.commit": plugin
        });
    }
});