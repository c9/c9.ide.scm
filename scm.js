define(function(require, exports, module) {
    main.consumes = [
        "Panel", "Menu", "MenuItem", "Divider", "settings", "ui", "c9", 
        "watcher", "panels", "util", "save", "preferences", "commands", "Tree",
        "tabManager", "layout"
    ];
    main.provides = ["scm"];
    return main;
    
    /*
        # LOW HANGING FRUIT 
            - conflicts
                - save
            - tree
                - add watcher to .git/HEAD
            - update overview panel style 
            - git commit 
                - do dry-run 
                    - add status message for ammend 
                    - display branch to commit to 
            - fix errors with added/removed files
        
        # TODO
            - toolbar
                - commit - split button
                    - add all
                    - unstage all
                - pull (or fetch - split button
                    - form
                        - includes pull vs fetch checkbox
                - push button - split button
                    - form
            - pull
                - pull --rebase
            - conflicts
                - add commands? detect, next, prev, use 1/ 2 
                - automatically add to staging on save
                - dialog for one deleted and one saved file 
                - undo
            - Compare view
                - save the right file (use ace session clone)
                - git add the left file 
                - restore compare view after reload/ when moving tab
                - undo doesn't work 
            - branches
                - Harutyun: Resize properly when expanding/collapsing
                - Harutyun: scrollMargin for left, right and bottom doesn't work (same for log, detail)
                - When updating, only do a partial update (maintain selection, expanded state - see test/data/data.js)
                - Move to icon (branches) button on the right
                - make a datagrid?
            - log
                - Setting indent to 0 doesn't work
            - detail
                - Show header of hash + commit message
            - commmit
                - don't hide detail
        
        # RUBEN
            - conflicts
                - dark theme (Ruben)
            - Compare view
                - proper integtation with cloud9 api  (Ruben)
                
            - add push dialog (Ruben) 
                dropdown for remotes/branches
                checkbox for --force
                output
            - add fetch dialog (Ruben)
                dropdown for remotes
                checkbox for --prune
                output
            - Choose Git Path - use file dialog
            - Add setting to collapse tree to only see roots
        
        # LATER
            - split status.js into git and general parts
            - support multiple git roots
            - tree
                - solve edge line cases
    */
    
    function main(options, imports, register) {
        var Panel = imports.Panel;
        var Tree = imports.Tree;
        var Menu = imports.Menu;
        var MenuItem = imports.MenuItem;
        var Divider = imports.Divider;
        var settings = imports.settings;
        var ui = imports.ui;
        var c9 = imports.c9;
        var tabs = imports.tabManager;
        var watcher = imports.watcher;
        var panels = imports.panels;
        var util = imports.util;
        var save = imports.save;
        var layout = imports.layout;
        var prefs = imports.preferences;
        var commands = imports.commands;
        
        // var Tooltip = require("ace_tree/tooltip");
        
        /***** Initialization *****/
        
        if (c9.hosted && c9.location.indexOf("git=1") == -1 || c9.location.indexOf("git=0") != -1) {
            return register(null, {
                "scm": {}
            });
        }
        
        var plugin = new Panel("Ajax.org", main.consumes, {
            index: options.index || 350,
            caption: "Changes",
            minWidth: 130,
            autohide: false,
            where: options.where || "left"
        });
        var emit = plugin.getEmitter();
        
        var tree, commitBox, toolbar, ammendCb, doneBtn;
        var mnuBranches, branchesTree, btnBranches;
        
        var scms = {};
        var scm;
        
        var mnuCommit, btnCommit, mnuExecute, btnExecute, mnuSettings;
        var btnSettings, container;
        
        var workspaceDir = c9.workspaceDir; // + "/plugins/c9.ide.scm/mock/git";
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            plugin.setCommand({
                name: "changes",
                hint: "Changed Files",
                bindKey: { mac: "", win: "" },
                extra: function(editor, args, e) {
                    
                }
            });
            
            commands.addCommand({
                name: "blame",
                group: "scm",
                exec: function() {
                    var tab = tabs.focussedTab || tabs.getPanes()[0].activeTab;
                    if (!tab || !tab.path || tab.editorType != "ace")
                        return;
                    var blameAnnotation, err, data;
                    var ace = tab.editor.ace;
                    var session = ace.session;
                    require(["./blame"], function(blameModule) {
                        if (ace.session != session)
                            return;
                        blameAnnotation = blameModule.annotate(ace);
                        done();
                    });
                    
                    var path = tab.path;
                    scm.getBlame(path, function(err, blameInfo){
                        if (err) return console.error(err);
                        data = blameInfo;
                        done();
                    });
                    
                    function done() {
                        if (!blameAnnotation) return;
                        if (data === null) return;
                        
                        blameAnnotation.setData(data);
                    }
                },
                isAvailable: function(){
                    var tab = tabs.focussedTab || tabs.getPanes()[0].activeTab;
                    if (!tab || !tab.path || tab.editorType != "ace")
                        return false;
                    return true;
                }
            }, plugin);
            
            commands.addCommand({
                name: "addall",
                group: "scm",
                exec: function(){ addAll(); }
            }, plugin);
            
            commands.addCommand({
                name: "unstageall",
                group: "scm",
                exec: function(){ unstageAll(); }
            }, plugin);
            
            commands.addCommand({
                name: "fetch",
                group: "scm",
                exec: function(){ fetch(); }
            }, plugin);
            
            commands.addCommand({
                name: "push",
                group: "scm",
                exec: function(){ push(); }
            }, plugin);
            
            commands.addCommand({
                name: "pull",
                group: "scm",
                exec: function(){ pull(); }
            }, plugin);
            
            commands.addCommand({
                name: "commit",
                group: "scm",
                exec: function(editor, args){ 
                    if (args.message) commit(args.message, args.amend);
                    else {
                        panels.activate("changes");
                        btnCommit.showMenu();
                    }
                }
            }, plugin);
        }
        
        var drawn = false;
        function draw(opts) {
            if (drawn) return;
            drawn = true;
            
            // Import CSS
            ui.insertCss(require("text!./style.css"), plugin);
            
            // Splitbox
            var vbox = opts.aml.appendChild(new ui.vbox({ 
                anchors: "0 0 0 0" 
            }));
            
            // Toolbar
            toolbar = vbox.appendChild(new ui.bar({
                id: "toolbar",
                skin: "toolbar-top",
                class: "fakehbox aligncenter debugger_buttons basic",
                style: "white-space:nowrap !important; height:32px;"
            }));
            plugin.addElement(toolbar);
            
            mnuCommit = new ui.menu({
                width: 300,
                style: "padding:10px;",
                childNodes: [
                    commitBox = new apf.codebox({}),
                    new ui.hbox({
                        childNodes: [
                            ammendCb = new ui.checkbox({ 
                                label: "amend",
                                skin: "checkbox_black",
                                margin: "5 0 0 0"
                            }),
                            new ui.hbox({ flex: 1 }),
                            doneBtn = new ui.button({
                                caption: "Commit",
                                skin: "btn-default-css3",
                                class: "btn-green",
                                margin: "5 0 0 0",
                                onclick: function() {
                                    mnuCommit.hide();
                                    commitBox.ace.execCommand("commit");
                                }
                            })
                        ]
                    })
                ]
            });
            mnuCommit.on("prop.visible", function(e){
                if (e.value) {
                    // if (typeof options.message == "string")
                    //     commitBox.setValue(options.message);
                    
                    commitBox.focus();
                }
            })
            
            commitBox.on("DOMNodeInsertedIntoDocument", function(){
                commitBox.ace.setOption("minLines", 2);
                commitBox.ace.commands.addCommand({
                    bindKey: "Esc",
                    exec: function() {
                        btnCommit.hideMenu();
                    }
                });
                commitBox.ace.commands.addCommand({
                    bindKey: "Ctrl-Enter|Cmd-Enter",
                    name: "commit",
                    exec: function(editor) {
                        commands.exec("commit", null, {
                            message: commitBox.ace.getValue(),
                            ammend: ammendCb.checked
                        });
                    }
                });
            });

            btnCommit = ui.insertByIndex(toolbar, new ui.button({
                caption: "Commit",
                skinset: "default",
                skin: "c9-menu-btn",
                submenu: mnuCommit
            }), 100, plugin);
            
            mnuBranches = new ui.menu({ width: 300, height: 100, style: "padding:0" });
            mnuBranches.on("prop.visible", function(e){
                if (e.value) {
                    if (!branchesTree) {
                        branchesTree = new Tree({
                            container: mnuBranches.$int,
                            scrollMargin: [10, 0],
                            theme: "filetree",
                            isLoading: function() {},
    
                            getEmptyMessage: function(){
                                if (!this.keyword)
                                    return this.isLoading()
                                        ? "Loading file list. One moment please..."
                                        : "No files found.";
                                else
                                    return "No files found that match '" + this.keyword + "'";
                            }
                        }, plugin);
                        branchesTree.on("afterRender", function(){
                            var maxHeight = window.innerHeight / 2;
                            mnuBranches.setHeight(Math.min(maxHeight, 
                                branchesTree.renderer.layerConfig.maxHeight + 27));
                            branchesTree.resize();
                        });
                        layout.on("eachTheme", function(e){
                            var height = parseInt(ui.getStyleRule(".filetree .tree-row", "height"), 10) || 22;
                            branchesTree.rowHeightInner = height;
                            branchesTree.rowHeight = height + 1;
                            if (e.changed)
                                branchesTree.resize();
                        }, plugin);
                        branchesTree.container.style.margin = "0 10px 0 0";
                    }
                    scm.listAllRefs(function(err, data) {
                        if (err) return console.error(err);
                        
                        var root = {};
                        data.forEach(function(x) {
                            x.fullName = x.name;
                            var parts = x.name.split("/");
                            x.name = parts.pop();
                            var node = root;
                            parts.forEach(function(p, i) {
                                var map = node.map || (node.map = {});
                                node = map[p] || (map[p] = { label: p, isOpen: false });
                            });
                            var map = node.map || (node.map = {});
                            map[x.name] = x;
                        });
                        
                        // branchesTree.model.rowHeightInner = tree.model.rowHeightInner;
                        // branchesTree.model.rowHeight = tree.model.rowHeight;
                        branchesTree.setRoot(root.map.refs);
                        branchesTree.resize();
                    });
                }
            });
            
            btnBranches = ui.insertByIndex(toolbar, new ui.button({
                caption: "Branches",
                skinset: "default",
                skin: "c9-menu-btn",
                submenu: mnuBranches
            }), 200, plugin);
            
            mnuExecute = new Menu({ items: [
                new MenuItem({ caption: "Refresh", onclick: refresh }, plugin),
                new Divider(),
                new MenuItem({ caption: "Add All", command: "addall", tooltip: "git add -u" }, plugin),
                new MenuItem({ caption: "Unstage All", command: "unstageall", tooltip: "git add -u" }, plugin),
                new Divider(),
                new MenuItem({ caption: "Fetch", command: "fetch" }, plugin),
                new MenuItem({ caption: "Pull", command: "pull" }, plugin),
                new Divider(),
                new MenuItem({ caption: "Push", command: "push" }, plugin),
            ]}, plugin);
            
            // btnExecute = ui.insertByIndex(toolbar, new ui.button({
            //     caption: "Execute",
            //     skinset: "default",
            //     skin: "c9-menu-btn",
            //     command: "cleartestresults",
            //     submenu: mnuExecute.aml
            // }), 300, plugin);
            
            mnuSettings = mnuExecute; /*new Menu({ items: [
                
            ]}, plugin);*/
            
            btnSettings = opts.aml.appendChild(new ui.button({
                skin: "header-btn",
                class: "panel-settings",
                style: "top:46px",
                submenu: mnuSettings.aml
            }));
            
            // Container
            container = vbox.appendChild(new ui.bar({
                style: "flex:1;-webkit-flex:1;display:flex;flex-direction: column;"
            }));
            
            // Mark Dirty
            plugin.on("show", function() {
                save.on("afterSave", markDirty);
                watcher.on("change", markDirty);
            });
            plugin.on("hide", function() {
                clearTimeout(timer);
                save.off("afterSave", markDirty);
                watcher.off("change", markDirty);
            });
            
            watcher.watch(util.normalizePath(workspaceDir) + "/.git");
            
            var timer = null;
            function markDirty(e) {
                clearTimeout(timer);
                timer = setTimeout(function() {
                    if (tree && tree.meta.options && !tree.meta.options.hash) {
                        tree.meta.options.force = true;
                        emit("reload", tree.meta.options);
                    }
                }, 800);
            }
            
            emit.sticky("drawPanels", { html: container.$int, aml: container });
        }
        
        /***** Methods *****/
        
        function registerSCM(name, scmPlugin){
            scms[name] = scmPlugin;
            if (!scm) scm = scmPlugin;
            
            emit("register", { plugin: scmPlugin });
        }
        
        function unregisterSCM(name, scmPlugin){
            delete scms[name];
            
            emit("unregister", { plugin: scmPlugin });
        }
        
        function refresh(){
            getLog();
            emit("reload");
        }
        
        function getLog(){
            scm.getLog({}, function(err, root) {
                if (err) return console.error(err);
                
                emit("log", root);
            });
        }
        
        function commit(message, amend, callback){
            scm.commit({ 
                message: message || commitBox.ace.getValue(),
                amend: amend || false
            }, function(err){
                if (err) return console.error(err);
                
                emit("reload");
                getLog();
                
                callback && callback();
            });
        }
        
        function unstage(nodes) {
            // model.root.staging;
            if (!Array.isArray(nodes))
                nodes = [nodes];
            var paths = nodes.map(function(node) {
                return node.path;
            }).filter(Boolean);
            
            scm.unstage(paths, function(err){
                if (err) return console.error(err);
                emit("reload");
            });
        }
        
        function addFileToStaging(nodes) {
            // model.root.staging;
            if (!Array.isArray(nodes))
                nodes = [nodes];
            var paths = nodes.map(function(node) {
                return node.path;
            }).filter(Boolean);
            
            scm.addFileToStaging(paths, function(err){
                if (err) return console.error(err);
                emit("reload");
            });
        }
        
        function addAll(){
            scm.addAll(function(err){
                if (err) return console.error(err);
                emit("reload");
            });
        }
        function unstageAll(){
            scm.unstageAll(function(err){
                if (err) return console.error(err);
                emit("reload");
            });
        }
        function fetch(){
            scm.fetch(function(err){
                if (err) return console.error(err);
                emit("reload");
            });
        }
        function pull(){
            scm.pull(function(err){
                if (err) return console.error(err);
                emit("reload");
            });
        }
        function push(){
            scm.push(function(err){
                if (err) return console.error(err);
                emit("reload");
            });
        }
        function loadDiff(options, callback){
            return scm.loadDiff(options, function(err, result){
                // if (err) return console.error(err);
                // emit("reload");
                callback(err, result)
            });
        }
        function getStatus(options, callback){
            scm.getStatus(options, callback);
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("draw", function(e) {
            draw(e);
        });
        plugin.on("enable", function(){
            
        });
        plugin.on("disable", function(){
            
        });
        plugin.on("show", function onShow(e) {
            if (!scm) return plugin.once("register", onShow);
            
            emit("reload", { force: true });
            getLog();
        });
        plugin.on("hide", function(e) {
            
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn = false;
        });
        
        /***** Register and define API *****/
        
        plugin.freezePublicAPI({
            /**
             * 
             */
            register: registerSCM,
            
            /**
             * 
             */
            unregister: unregisterSCM,
            
            /**
             * 
             */
            addFileToStaging: addFileToStaging,
            
            /**
             * 
             */
            loadDiff: loadDiff,
            
            /**
             * 
             */
            unstage: unstage,
            
            /**
             * 
             */
            getStatus: getStatus
            
            // TODO all other functions
        });
        
        register(null, {
            "scm": plugin
        });
    }
});