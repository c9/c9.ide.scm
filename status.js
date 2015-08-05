define(function(require, exports, module) {
    main.consumes = [
        "Panel", "settings", "ui", "watcher", "menus", "tabManager", "save", 
        "fs", "panels", "preferences", "c9", "tree", "commands",
        "layout", "util", "vfs", "tabbehavior"
    ];
    main.provides = ["git.status"];
    return main;
    
    function main(options, imports, register) {
        var Panel = imports.Panel;
        var settings = imports.settings;
        var ui = imports.ui;
        var c9 = imports.c9;
        var fs = imports.fs;
        var vfs = imports.vfs;
        var tabs = imports.tabManager;
        var menus = imports.menus;
        var layout = imports.layout;
        var watcher = imports.watcher;
        var panels = imports.panels;
        var util = imports.util;
        var save = imports.save;
        var prefs = imports.preferences;
        var filetree = imports.tree;
        var commands = imports.commands;
        var tabbehavior = imports.tabbehavior;
        
        var markup = require("text!./status.xml");
        var Tree = require("ace_tree/tree");
        var ListData = require("./dataprovider");
        var basename = require("path").basename;
        var dirname = require("path").dirname;
        
        var Tooltip = require("ace_tree/tooltip");
        
        /***** Initialization *****/
        
        var plugin = new Panel("Ajax.org", main.consumes, {
            index: options.index || 350,
            caption: "Changes",
            minWidth: 130,
            autohide: false,
            where: options.where || "left"
        });
        var emit = plugin.getEmitter();
        
        var winStatus, txtGoToFile, tree, model;
        var lastSearch, lastPreviewed, cleaning, intoOutline;
        var isReloadScheduled;
        var logTree
        var logModel
        
        var dirty = true;
        var arrayCache = [];
        var loadListAtInit = options.loadListAtInit;
        var timer;
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            var command = plugin.setCommand({
                name: "changes",
                hint: "Changed Files",
                bindKey: { mac: "", win: "" },
                extra: function(editor, args, e) {
                    
                }
            });
            
            panels.on("afterAnimate", function(){
                if (panels.isActive("navigate"))
                    tree && tree.resize();
            });
            
            
            commands.addCommand({
                name: "Git:Blame",
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
                    vfs.spawn("git", {
                        args: ["blame", "-wp", "--", basename(path)],
                        stdoutEncoding: "utf8",
                        stderrEncoding: "utf8",
                        stdinEncoding: "utf8",
                        cwd: c9.workspaceDir + "/" + dirname(path)
                    }, function(e, result) {
                        var stdout = "";
                        var stderr = "";
                        if (e) return done(e);
                        var process = result.process;
                        process.stdout.on("data", function(d) {
                            stdout += d;
                        });
                        process.stderr.on("data", function(d) {
                            stderr += d;
                        });
                        process.on("exit", function() {
                            data = stdout;
                            done();
                        });
                    });
                    function done(e) {
                        if (e) err = e;
                        if (!blameAnnotation) return;
                        if (!err && data == null) return;
                        
                        blameAnnotation.setData(data);
                    }
                }
            }, plugin);
        }
        
        var drawn = false;
        function draw(options) {
            if (drawn) return;
            drawn = true;
            
            // Create UI elements
            ui.insertMarkup(options.aml, markup, plugin);
            
            // Import CSS
            ui.insertCss(require("text!./style.css"), plugin);
            
            var treeParent = plugin.getElement("status");
            
            // Create the Ace Tree
            tree = new Tree(treeParent.$int);
            model = new ListData(arrayCache);
            tree.renderer.setScrollMargin(0, 10);
            tree.renderer.setTheme({cssClass: "filetree"});
            tree.setDataProvider(model);
            model.getIconHTML = function(node) {
                var icon = node.isFolder ? "folder" : util.getFileIcon(node.label);
                if (node.status === "loading") icon = "loading";
                if (model.twoWay && !node.isFolder)
                    icon += " clickable";
                return "<span class='filetree-icon " + icon + "'></span>";
            };
            
            logTree = new Tree(plugin.getElement("log").$int);
            logModel = new ListData([]);
            logTree.renderer.setScrollMargin(0, 10);
            logTree.renderer.setTheme({cssClass: "filetree"});
            logTree.setDataProvider(logModel);
            
            tree.tooltip = new Tooltip(tree);
            logTree.tooltip = new Tooltip(logTree);
            
            layout.on("eachTheme", function(e){
                var height = parseInt(ui.getStyleRule(".filetree .tree-row", "height"), 10) || 22;
                model.rowHeightInner = height;
                model.rowHeight = height + 1;
                logModel.rowHeightInner = height;
                logModel.rowHeight = height + 1;
                if (e.changed) {
                    tree && tree.resize();
                    logTree && logTree.resize();
                }
            });
            
            logTree.on("userSelect", function(e) {
                var options = {};
                var nodes = logTree.selection.getSelectedNodes();
                
                if (!nodes[0]) 
                    return;
                options.hash = nodes[0].hash;
                if (nodes[0].parents)
                    options.base = nodes[0].parents.match(/\S*/)[0] || "4b825dc6";
                
                if (nodes[1])
                    options.base = nodes[1].hash;
                
                reload(options);
            });
            
            tree.on("afterChoose", function(e) {
                openSelection();
            });
            
            tree.on("userSelect", function(e) {
                if (tabs.focussedTab && tabs.focussedTab.editorType == "diffview") {
                    openSelection({noFocus: true});
                }
            });
            
            tree.setOption("enableDragDrop", true);
            
            
            tree.on("drop", function(e) {
                if (e.target && e.selectedNodes) {
                    var nodes = e.selectedNodes;
                    if (e.target.isStaging) {
                        addFileToStaging(nodes);
                    } else {
                        unstage(nodes);
                    }
                }   
            });
            
            tree.on("click", function(e) {
                if (e.domEvent.target.classList.contains("filetree-icon")) {
                    var node = e.getNode();
                    if (node.parent.isStaging) {
                        unstage(node);
                    } else {
                        addFileToStaging(node);
                    }
                }
            });
            
            model.setRoot();
            
            // setup resize handlers
            layout.on("resize", function() {
                tree.resize();
                logTree.resize();
            }, plugin);
            
            var btnSettings = plugin.getElement("btnSettings");
            var mnuSettings = plugin.getElement("mnuSettings");
            
            btnSettings.setAttribute("submenu", mnuSettings);
            
            var c = 0;
            ui.insertByIndex(mnuSettings, new ui.item({
                caption: "Commit",
                onclick: function(){ toggleCommitView(); }
            }), c+=100, plugin);
            ui.insertByIndex(mnuSettings, new ui.item({
                caption: "Add All",
                onclick: function(){ git("add -u"); },
                tooltip: "git add -u"
            }), c+=100, plugin);
            ui.insertByIndex(mnuSettings, new ui.item({
                caption: "Unstage All",
                onclick: function(){ git("reset --mixed"); },
                tooltip: "git add -u"
            }), c+=100, plugin);
            ui.insertByIndex(mnuSettings, new ui.divider(), c+=100, plugin);
            ui.insertByIndex(mnuSettings, new ui.item({
                caption: "Fetch",
                onclick: function(){ git("fetch"); }
            }), c+=100, plugin);
            ui.insertByIndex(mnuSettings, new ui.item({
                caption: "Pull",
                onclick: function(){ git("pull"); }
            }), c+=100, plugin);
            ui.insertByIndex(mnuSettings, new ui.divider(), c+=100, plugin);
            ui.insertByIndex(mnuSettings, new ui.item({
                caption: "Push",
                onclick: function(){ push(); }
            }), c+=100, plugin);
            
            // Context Menu
            var mnuCtxStatus = plugin.getElement("mnuCtxStatus");
            menus.decorate(mnuCtxStatus);
            plugin.addElement(mnuCtxStatus);
            plugin.getElement("log").setAttribute("contextmenu", mnuCtxStatus);

            menus.addItemToMenu(mnuCtxStatus, new ui.item({
                match: "file",
                class: "strong",
                caption: "Open Diff",
                onclick: openSelection
            }), 100, plugin);
            menus.addItemToMenu(mnuCtxStatus, new ui.item({
                match: "file",
                caption: "Open",
                onclick: openSelectedFiles
            }), 100, plugin);
            menus.addItemToMenu(mnuCtxStatus, new ui.item({
                match: "file",
                caption: "Reveal in File Tree",
                onclick: reveal
            }), 100, plugin);
            
            
            plugin.getElement("log").setAttribute("contextmenu", mnuCtxStatus);
            plugin.getElement("status").setAttribute("contextmenu", mnuCtxStatus);
            
            plugin.getElement("btnCommit").onclick = toggleCommitView;
            plugin.getElement("btnReload").onclick = function() {
                getLog({}, function() {});
            };
            
            plugin.on("show", function() {
                save.on("afterSave", markDirty);
                watcher.on("change", markDirty);
            });
            plugin.on("hide", function() {
                clearTimeout(timer);
                save.off("afterSave", markDirty);
                watcher.off("change", markDirty);
            });
            var timer = null;
            function markDirty() {
                clearTimeout(timer);
                timer = setTimeout(function() {
                    if (model.options && !model.options.hash) {
                        model.options.force = true;
                        reload(model.options);
                    }
                }, 800);
            }
            
            plugin.getElement("btnCommit").hide();
            plugin.getElement("btnSettings").hide();
        }
        
        /***** Methods *****/
        
        function reveal() {
            var node = tree.selection.getCursor();
            var path = node.path;
            if (node.path) {
                var path = node.path;
                if (path[0] != "/") path = "/" + path;
                tabbehavior.revealtab({path: path});
            }
        }
        
        function unstage(nodes) {
            // model.root.staging;
            if (!Array.isArray(nodes))
                nodes = [nodes];
            var paths = nodes.map(function(node) {
                return node.path;
            }).filter(Boolean);
            git(["reset", "--mixed", "--"].concat(paths), function(e, r) {
                
            });
        }
        
        function addFileToStaging(nodes) {
            // model.root.staging;
            if (!Array.isArray(nodes))
                nodes = [nodes];
            var paths = nodes.map(function(node) {
                return node.path;
            }).filter(Boolean);
            git(["add", "-f", "--ignore-errors", "--"].concat(paths), function(e, r) {
                
            });
        }
        
        function findOpenDiffview(cb){
            var pages = tabs.getTabs();
            for (var i = 0, tab = pages[i]; tab; tab = pages[i++]) {
                if (tab.editorType == "diffview") {
                    cb(null, tab);
                    return true;
                }
            }
        }
        
        
        function openSelection(opts) {
            if (!c9.has(c9.STORAGE))
                return;
            
            var node = tree.selection.getCursor();
            if (!node || node.isFolder)
                return;
            options = tree.model.options;
            findOpenDiffview(done) || tabs.open({
                editorType: "diffview",
                focus: true
            }, done);
            
            function done(e, tab) {
                tab = tab || tabs.focussedTab;
                if (!opts || !opts.noFocus)
                    tabs.focusTab(tab);
                
                var oldPath = node.path;
                var newPath = node.originalPath || node.path;
                
                var hash = options.hash;
                if (hash) {
                    hash = hash + ":";
                } else {
                    hash = "";
                }
                
                var base = options.base;
                if (!base)
                    base = "HEAD";
                if (base)
                    base = base + ":";
                
                tab.editor.loadDiff({
                    oldPath: base + oldPath,
                    newPath: hash + newPath
                });
            }
        }
        
        function openSelectedFiles(opts) {
            if (!c9.has(c9.STORAGE))
                return;
            
            var focus = opts && opts.focusNewTab || true;
            var sel = tree.selection.getSelectedNodes();
            var main = tree.selection.getCursor();
            
            sel.forEach(function(node) {
                if (!node || node.isFolder)
                    return;
    
                var pane = tabs.focussedTab && tabs.focussedTab.pane;
                if (tabs.getPanes(tabs.container).indexOf(pane) == -1)
                    pane = null;
    
                tabs.open({
                    path: node.path,
                    pane: pane,
                    noanim: sel.length > 1,
                    active: node === main,
                    focus: node === main && focus
                }, function(){});
            });
        }
        
        function git(args, cb) {
            if (typeof args == "string")
                args = args.split(/\s+/);
            vfs.execFile("git", {
                args: args
            }, function(e, r) {
                console.log(e, r && r.stdout);
                reload({hash: 0, force: true}, function(e, status) {
                    
                });
                cb && cb(e, r && r.stdout);
            });
        }
        
        function getStatus(options, cb) {
            var t = Date.now();
            var args = [];
            var hash = options.hash;
            var base = options.base;
            if (hash || base) {
                args.push("diff", "--name-status", "-b", "-z", 
                    "--no-textconv", "--no-ext-diff", "--no-color",
                    "--find-renames"
                );
                if (hash == "staging")
                    hash = "--cached";
                if (base == "staging")
                    base = "--cached";
                if (hash == 0 || base == 0) {
                    args.push(base || hash);
                } else {
                    args.push(base || hash + "^1", hash);
                }
            } else {
                args.push("status", "--porcelain", "-b", "-z");
                if (!ignored.isOpen)
                    args.push("--untracked-files=no");
                if (options.untracked == "all")
                    args.push("--untracked-files=all");
                if (options.ignored)
                    args.push("--ignored");
            }
            
            if (options.path)
                args.push("--", options.path);
                
            vfs.execFile("git", {
                args: args
            }, function(e, r) {
                console.log(e, r && r.stdout);
                console.log(t-Date.now(), r && r.stdout.length);
                cb(e, r && r.stdout);
            });
        }
        
        var changed = {
            label: "Modified Files",
            items: [],
            isOpen: true,
            isFolder: true
        };
        var staged = {
            label: "Files staged for commit",
            items: [],
            isOpen: true,
            isFolder: true,
            isStaging: true
        };
        var ignored = {
            label: "Ignored Files",
            items: [],
            isOpen: false,
            isFolder: true
        };
        
        function reload(options, cb) {
            if (!options) options = {hash: 0};
            if (!model.options) model.options = {};
            if (!options.force)
            if (model.options.hash == options.hash && model.options.base == options.base)
                return;
            var twoWay = !options.hash || options.hash == "staging";
            getStatus(options || {hash: 0}, function(e, status) {
                var root = [];
                status = status.split("\x00");
                console.log(status);
                if (twoWay) {
                    status.shift();
                    changed.items = changed.children = [];
                    staged.items = staged.children = [];
                    ignored.items = ignored.children = [];
                    root = {
                        items: [changed, staged, ignored],
                        $sorted: true,
                        isFolder: true
                    };
                    for (var i = 0; i < status.length; i++) {
                        var x = status[i];
                        var name = x.substr(twoWay ? 3 : 2);
                        if (!name) continue;
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
                            ignored.items.push({
                                label: name,
                                path: name,
                                type: x[0],
                                isFolder: name.slice(-1) == "/"
                            });
                        }
                        else if (x[1] != " ") {
                            changed.items.push({
                                label: name,
                                path: name,
                                type: x[0]
                            });
                        }
                    }
                } else {
                    for (var i = 0; i < status.length; i += 2) {
                        var x = status[i];
                        var name = status[i + 1];
                        if (!name) continue;
                        if (x[0] == "R") {
                            i++;
                            root.push({
                                label: status[i + 1] + "(from " + name + ")",
                                path: name,
                                originalPath: status[i + 1],
                                type: x[0]
                            });
                        } else {
                            root.push({
                                label: name,
                                path: name,
                                type: x[0]
                            });
                        }
                    }
                }
                model.setRoot(root);
                model.options = options;
                model.twoWay = twoWay;
            });
        }
        
        function getLog(options, cb) {
            var t = Date.now();
            vfs.execFile("git", {
                args: ["rev-list", "HEAD", "--count"]
            }, function(e, r) {
                console.log(e, r.stdout);
                console.log(t-Date.now(), r.stdout.length);
                
                var args = ["log", "--topo-order", "--date=raw"];
                if (options.boundary != false) args.push("--boundary");
                if (options.logOptions) args.push.apply(args, options.logOptions);
                args.push('--pretty=format:' + (options.format || "%h %p %B ").replace(/ /g, "%x00"));
                // args.push("--all");
                args.push("HEAD");
                args.push("-n", options.count || 1000);
                if (options.from)
                    args.push("--skip=" + options.from);
                vfs.execFile("git", {
                    args: args
                }, function(e, r) {
                    var x = r.stdout.trim().split("\x00\n");
                    var root = [];
                    for (var i = 0; i < x.length; i++) {
                        var line = x[i].split("\x00");
                        root.push({
                            hash: line[0],
                            parents: line[1],
                            message: line[2],
                            label: line[2].substring(0, line[2].indexOf("\n") + 1 || undefined)
                        });
                    }
                    console.log(e, x);
                    console.log(t-Date.now(), r.stdout.length);
                    root.unshift({
                        label: "working tree",
                        hash: 0
                    });
                    logModel.visibleItems = root;
                    logModel._signal("change");
                });
                
            });
        }
        
        function getFileAtHash(hash, path, cb) {
            if (!hash) {
                if (path[0] != "/")
                    path = "/" + path;
                return vfs.readfile(path, {}, cb);
            }
            if (hash == "staging")
                hash = "";
            if (path[0] == "/")
                path = path.substr(1);
            vfs.execFile("git", {
                args: ["show", hash + ":" + path],
                maxBuffer: 1000 * 1024
            }, function(e, r) {
                cb(e, r);
            });
        }
        
        function loadDiff(options, callback) {
            var req = {};
            var args = ["diff",  "-U20000", options.oldPath, options.newPath];
            vfs.execFile("git", {
                args: args
            }, function(e, r) {
                if (e) return callback(e);
                if (!r.stdout) {
                    vfs.execFile("git", {
                        args: ["show", options.oldPath],
                        maxBuffer: 1000 * 1024
                    }, function(e, r) {
                        if (e) return callback(e);
                        callback(e, {
                            request: req,
                            orig: r.stdout,
                            edit: r.stdout
                        });
                    });
                    return;
                }
                callback(null, {
                    request: req,
                    patch: r.stdout
                });
            });
            return req;
        }
        
        function addLinesToStaging(patch, cb) {
            vfs.spawn("git", {
                args: ["apply", "--cached", "--unidiff-zero", "--whitespace=nowarn", "-"], // "--recount",
                stdoutEncoding : "utf8",
                stderrEncoding : "utf8",
                stdinEncoding : "utf8"
            }, function(e, p) {
                process = p.process;
                var stderr = "";
                var stdout = "";
                process.stdout.on("data", function(e) {
                    stdout += e;
                });
                process.stderr.on("data", function(e) {
                    stderr += e;
                });
                process.on("exit", function(e) {
                    cb(e);
                });
                process.stdin.write(patch);
                process.stdin.end();
            });
        }
        
        
        /***** Commit *****/
        
        function toggleCommitView() {
            if (!options) options = {};
            var btnCommit = plugin.getElement("btnCommit");
            var logEl = plugin.getElement("log");
            var commitEl = plugin.getElement("commit");
            if (commitEl.visible && options.hide !== true) {
                commitEl.setAttribute("visible", false);
                logEl.setAttribute("visible", true);
                btnCommit.$ext.classList.remove("c9-toolbarbutton-glossyActive");
            } else {
                commitEl.setAttribute("visible", true);
                logEl.setAttribute("visible", false);
                btnCommit.$ext.classList.add("c9-toolbarbutton-glossyActive");
                if (!commitEl.codeBox) {
                    commitEl.codeBox = commitEl.appendChild(new apf.codebox({
                        
                    }));
                    commitEl.codeBox.ace.commands.addCommand({
                        bindKey: "Esc",
                        exec: toggleCommitView
                    });
                    commitEl.codeBox.ace.commands.addCommand({
                        bindKey: "Ctrl-Enter|Cmd-Enter",
                        exec: function(editor) {
                            commit({
                                message: editor.getValue(),
                                
                            });
                        }
                    });
                    // commitEl.appendChild(new apf.checkbox)
                }
                if (typeof options.message == "string")
                    commitEl.codeBox.setValue(options.message);
                commitEl.codeBox.focus();
            }
        }
        
        function commit(options) {
            if (!options.message) return;
            git(["commit", options.ammend && "--amend", "-m", options.message].filter(Boolean), function(e, r) {
                if (e) {
                    
                }
                toggleCommitView({hide: true});
                reload();
            });
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
        plugin.on("show", function(e) {
            reload({force: true});
            getLog({}, function() {
                
            });
        });
        plugin.on("hide", function(e) {
            
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * Navigation panel. Allows a user to navigate to files by searching
         * for a fuzzy string that matches the path of the file.
         * @singleton
         * @extends Panel
         **/
        /**
         * @command navigate
         */
        /**
         * Fires when the navigate panel shows
         * @event showPanelNavigate
         * @member panels
         */
        /**
         * Fires when the navigate panel hides
         * @event hidePanelNavigate
         * @member panels
         */
        plugin.freezePublicAPI({
            /**
             * @property {Object}  The tree implementation
             * @private
             */
            get tree() { return tree; },
            getFileAtHash: getFileAtHash,
            loadDiff: loadDiff
        });
        
        register(null, {
            "git.status": plugin
        });
    }
});