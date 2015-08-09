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
        var escapeHTML = require("ace/lib/lang").escapeHTML;
        var GitGraph = require("./log/log");

        
        var Tooltip = require("ace_tree/tooltip");
        
        /***** Initialization *****/
        
        if (c9.hosted && c9.location.indexOf("git=1") == -1 || c9.location.indexOf("git=0") != -1) {
            return register(null, {
                "git.status": {}
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
        
        var winStatus, txtGoToFile, tree, model;
        var lastSearch, lastPreviewed, cleaning, intoOutline;
        var isReloadScheduled;
        var logTree, logModel, branchesTree;
        
        var dirty = true;
        var arrayCache = [];
        var loadListAtInit = options.loadListAtInit;
        var timer;
        var workspaceDir = c9.workspaceDir + "/plugins/c9.ide.scm/mock/git";
        
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
                if (panels.isActive("changes")) {
                    tree && tree.resize();
                    logTree && logTree.resize();
                }
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
                var icon = node.isFolder ? "folder" : "status-icon-" + node.type;
                if (node.parent == conflicts)
                    icon = "status-icon-conflict";
                if (node.status === "loading") icon = "loading";
                if (model.twoWay && !node.isFolder)
                    icon += " clickable";
                return "<span class='status-icon " + icon + "'>"
                    + (node.type || "") + "</span>";
            };
            model.getCaptionHTML = function(node) {
                if (node.path) {
                    var path = node.labelPath || node.path;
                    return basename(path) 
                        + "<span class='extrainfo'> - " 
                        + dirname(path) + "</span>";
                }
                return escapeHTML(node.label || node.name);
            };
            model.getRowIndent = function(node) {
                return node.$depth ? node.$depth - 2 : 0;
            };
            
            logTree = new Tree(plugin.getElement("log").$int);
            logModel = new ListData([]);
            logTree.renderer.setScrollMargin(0, 10);
            logTree.renderer.setTheme({cssClass: "filetree"});
            logTree.setDataProvider(logModel);
            new GitGraph().attachToTree(logTree);
            
            // tree.tooltip = new Tooltip(tree);
            // logTree.tooltip = new Tooltip(logTree);
            
            layout.on("eachTheme", function(e){
                var height = parseInt(ui.getStyleRule(".filetree .tree-row", "height"), 10) || 22;
                model.rowHeightInner = height;
                model.rowHeight = height + 1;
                logModel.rowHeightInner = height;
                logModel.rowHeight = height + 1;
                if (branchesTree) {
                    branchesTree.model.rowHeightInner = height;
                    branchesTree.model.rowHeight = height + 1;
                }
                if (e.changed) {
                    tree && tree.resize();
                    logTree && logTree.resize();
                    branchesTree && branchesTree.resize();
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
                    if (e.target == staged) {
                        addFileToStaging(nodes);
                    } else if (e.target == changed) {
                        unstage(nodes);
                    }
                }   
            });
            
            tree.on("click", function(e) {
                if (e.domEvent.target.classList.contains("status-icon")) {
                    var node = e.getNode();
                    if (node.parent == staged) {
                        unstage(node);
                    } else if (node.parent == changed || node.parent == ignored) {
                        addFileToStaging(node);
                    } else if (node.parent == conflicts) {
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
                onclick: function(){ switchMainPanel({panel: "commit"}); }
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
            var mnuCtxLog = plugin.getElement("mnuCtxLog");
            

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
            
            plugin.getElement("log").setAttribute("contextmenu", mnuCtxLog);
            plugin.getElement("status").setAttribute("contextmenu", mnuCtxStatus);
            
            plugin.getElement("btnLog").onclick = switchMainPanel;
            plugin.getElement("btnCommit").onclick = switchMainPanel;
            plugin.getElement("btnBranches").onclick = switchMainPanel;
            
            plugin.getElement("btnLog").panel = "log";
            plugin.getElement("btnCommit").panel = "commit";
            plugin.getElement("btnBranches").panel = "branches";
            
            switchMainPanel({panel: "log"});
            
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
            
            watcher.watch(util.normalizePath(workspaceDir) + "/.git");
            
            var timer = null;
            function markDirty(e) {
                clearTimeout(timer);
                timer = setTimeout(function() {
                    if (model.options && !model.options.hash) {
                        model.options.force = true;
                        reload(model.options);
                    }
                }, 800);
            }
        }
        
        /***** Methods *****/
        
        function reveal() {
            var node = tree.selection.getCursor();
            var path = node.path;
            if (path) {
                if (path[0] != "/") path = "/" + path;
                path = workspaceDir + path;
                path = util.normalizePath(path);
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
            
            if (node.parent == conflicts)
                return openConflictView(node);
            
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
                    hash = node.parent == staged ? ":" : "";
                }
                
                var base = options.base;
                if (!base)
                    base = node.parent == staged ? "HEAD" : ":";
                if (base && base != ":")
                    base = base + ":";
                
                tab.editor.loadDiff({
                    oldPath: base + oldPath,
                    newPath: hash + newPath
                });
            }
        }
        
        function openConflictView(node) {
            var addConflictMarker = require("./diff/conflictmarker");
            var path = workspaceDir + "/" + node.path;
            tabs.open({path: path, focus: true}, function(e, tab) {
                addConflictMarker(tab.editor.ace);
            });
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
                    path: workspaceDir + "/" + node.path,
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
                args: args,
                cwd: workspaceDir
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
                // if (!ignored.isOpen)
                    args.push("--untracked-files=no");
                if (options.untracked == "all")
                    args.push("--untracked-files=all");
                if (options.ignored)
                    args.push("--ignored");
            }
            
            args.push("--");
            
            if (options.path)
                args.push(options.path);
                
            vfs.execFile("git", {
                args: args,
                cwd: workspaceDir
            }, function(e, r) {
                if (e)  {
                    if (/fatal: bad revision/.test(e.message)) {
                        var EMPTY = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
                        if (options.base != EMPTY) {
                            options.base = EMPTY;
                            return getStatus(options, cb);
                        }
                    }
                    console.error(e);
                }
                console.log(e, r && r.stdout);
                console.log(t-Date.now(), r && r.stdout.length);
                cb(e, r && r.stdout);
            });
        }
        
        var changed = {
            label: "modified files",
            className: "heading",
            items: [],
            isOpen: true,
            isFolder: true
        };
        var staged = {
            label: "files staged for commit",
            className: "heading",
            items: [],
            isOpen: true,
            isFolder: true
        };
        var ignored = {
            label: "ignored files",
            className: "heading",
            items: [],
            isOpen: false,
            isFolder: true,
            map: {}
        };
        var untracked = {
            label: "untracked files",
            className: "heading",
            items: [],
            isOpen: false,
            isFolder: true,
            map: {}
        };
        var conflicts = {
            label: "conflicts",
            className: "heading",
            items: [],
            isOpen: true,
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
                    conflicts.items = conflicts.children = [];
                    untracked.items = untracked.children = [];
                    root = {
                        items: [changed, staged, untracked, ignored],
                        $sorted: true,
                        isFolder: true
                    };
                    for (var i = 0; i < status.length; i++) {
                        var x = status[i];
                        var name = x.substr(twoWay ? 3 : 2);
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
                        if (x[1] == "!") {
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
                    if (conflicts.items.length)
                        root.items.unshift(conflicts);
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
                args: ["rev-list", "HEAD", "--count"],
                cwd: workspaceDir
            }, function(e, r) {
                console.log(e, r.stdout);
                console.log(t-Date.now(), r.stdout.length);
                
                var args = ["log", "--topo-order", "--date=raw"];
                if (options.boundary != false) args.push("--boundary");
                if (options.logOptions) args.push.apply(args, options.logOptions);
                args.push('--pretty=format:' + (options.format || "%h %p %d %B ").replace(/ /g, "%x00"));
                args.push("--all");
                args.push("HEAD");
                args.push("-n", options.count || 1000);
                if (options.from)
                    args.push("--skip=" + options.from);
                    
                args.push("--");
                if (options.path)
                    args.push(options.path);
                vfs.execFile("git", {
                    args: args,
                    cwd: workspaceDir
                }, function(e, r) {
                    var x = r.stdout.trim().split("\x00\n");
                    var root = [];
                    for (var i = 0; i < x.length; i++) {
                        var line = x[i].split("\x00");
                        root.push({
                            hash: line[0],
                            parents: line[1],
                            branches: line[2],
                            message: line[3],
                            label: line[3].substring(0, line[3].indexOf("\n") + 1 || undefined)
                        });
                    }
                    console.log(e, x);
                    console.log(t-Date.now(), r.stdout.length);
                    root.unshift({
                        label: "// WIP",
                        hash: 0
                    });
                    logModel.loadData(root);
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
                maxBuffer: 1000 * 1024,
                cwd: workspaceDir
            }, function(e, r) {
                cb(e, r);
            });
        }
        
        function loadDiff(options, callback) {
            var req = {};
            var args = ["diff",  "-U20000", options.oldPath, options.newPath];
            vfs.execFile("git", {
                args: args,
                cwd: workspaceDir
            }, function(e, r) {
                if (e) return callback(e);
                if (!r.stdout) {
                    vfs.execFile("git", {
                        args: ["show", options.oldPath],
                        maxBuffer: 1000 * 1024,
                        cwd: workspaceDir
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
                stdinEncoding : "utf8",
                cwd: workspaceDir
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
        
        function switchMainPanel(options) {
            var btnLog = plugin.getElement("btnLog");
            var btnCommit = plugin.getElement("btnCommit");
            var btnBranches = plugin.getElement("btnBranches");
            
            var logEl = plugin.getElement("log");
            var commitEl = plugin.getElement("commit");
            var branchesEl = plugin.getElement("branches");
            
            if (!options) options = {};
            if (options.currentTarget && options.currentTarget.panel) {
                options = { panel: options.currentTarget.panel };
                if (options.panel == "commit" && commitEl.visible)
                    options.panel = null;
                if (options.panel == "branches" && branchesEl.visible)
                    options.panel = null;
            }
            
            if (options.panel == "commit") {
                commitEl.setAttribute("visible", true);
                btnCommit.$ext.classList.add("c9-toolbarbutton-glossyActive");
                if (!commitEl.codeBox) {
                    commitEl.codeBox = commitEl.appendChild(new apf.codebox({}));
                    commitEl.codeBox.ace.setOption("minLines", 2);
                    commitEl.appendChild(new ui.hbox({
                        childNodes: [
                            new ui.label({ caption: "amend" }),
                            commitEl.ammendCb = new ui.checkbox({}),
                            new ui.hbox({ flex: 1 }),
                            commitEl.doneBtn = new ui.button({
                                caption: "Done",
                                skin: "c9-toolbarbutton-glossy",
                                onclick: function() {
                                    commitEl.codeBox.ace.execCommand("commit");
                                }
                            })
                        ]
                    }));
                    
                    commitEl.codeBox.ace.commands.addCommand({
                        bindKey: "Esc",
                        exec: function() {
                            switchMainPanel({panel: "log"});
                        }
                    });
                    commitEl.codeBox.ace.commands.addCommand({
                        bindKey: "Ctrl-Enter|Cmd-Enter",
                        name: "commit",
                        exec: function(editor) {
                            commit({
                                message: commitEl.codeBox.ace.getValue(),
                                ammend: commitEl.ammendCb.checked
                            });
                        }
                    });
                }
                if (typeof options.message == "string")
                    commitEl.codeBox.setValue(options.message);
                
                
                
                commitEl.codeBox.focus();
            } else {
                commitEl.setAttribute("visible", false);
                btnCommit.$ext.classList.remove("c9-toolbarbutton-glossyActive");
            }
            
            if (options.panel == "branches") {
                if (!branchesTree) {
                    branchesTree = new Tree(branchesEl.$ext);
                    branchesTree.renderer.setTheme({cssClass: "filetree"});
                    var model = new ListData();
                    branchesTree.setDataProvider(model);
                }
                listAllRefs(function(e, data) {
                    var root = {};
                    data.forEach(function(x) {
                        x.fullName = x.name;
                        var parts = x.name.split("/");
                        x.name = parts.pop();
                        var node = root;
                        parts.forEach(function(p, i) {
                            var map = node.map || (node.map = {});
                            node = map[p] || (map[p] = {label: p, isOpen: true});
                        });
                        var map = node.map || (node.map = {});
                        map[x.name] = x;
                    });
                    
                    branchesTree.model.rowHeightInner = tree.model.rowHeightInner;
                    branchesTree.model.rowHeight = tree.model.rowHeight;
                    branchesTree.model.setRoot(root.map.refs);
                });
                branchesEl.setAttribute("visible", true);
                btnBranches.$ext.classList.add("c9-toolbarbutton-glossyActive");
            } else {
                branchesEl.setAttribute("visible", false);
                btnBranches.$ext.classList.remove("c9-toolbarbutton-glossyActive");
            }
            
            
            if (options.panel == "log" || !options.panel) {
                logEl.setAttribute("visible", true);
                btnLog.$ext.classList.add("c9-toolbarbutton-glossyActive");
                if (logTree) logTree.resize();
            } else {
                logEl.setAttribute("visible", false);
                btnLog.$ext.classList.remove("c9-toolbarbutton-glossyActive");
            }
        }
        
        function updateCommitStatus() {
            var args = ["commit", "--dry-run", "--porcelain", "--branch", "-z"];
            if (commitEl.ammendCb.checked)
                args.push("--amend")
            git(args, function() {
                
            });
        }
        
        function commit(options) {
            if (!options.message) return;
            git(["commit", options.ammend && "--amend", "-m", options.message].filter(Boolean), function(e, r) {
                if (e) {
                    
                }
                switchMainPanel({panel: "log"});
                reload();
                getLog({}, function() {});
            });
        }
        
        function listAllRefs(cb) {
            var args = ["for-each-ref", "--count=3000", "--sort=*objecttype", "--sort=-committerdate"];
            args.push(
                '--format=%(objectname:short) %(refname) %(upstream:trackshort) %(objecttype) %(subject) %(authorname) %(authoremail) %(committerdate:raw)'.replace(/ /g, "%00")
            );
            git(args, function(e, stdout) {
                var data = stdout.trim().split("\n").map(function(x) {
                    var parts = x.split("\x00");
                    return {
                        hash: parts[0],
                        name: parts[1],
                        upstream: parts[2],
                        type: parts[3],
                        subject: parts[4],
                        authorname: parts[5],
                        authoremail: parts[6],
                        committerdate: parts[7],
                    };
                });
                cb && cb(null, data);
            });
        }
        
        
        /***** GIT Repository *****/
        var EventEmitter = require("ace/lib/event_emitter");
        var oop = require("ace/lib/oop");
        var Path = require("path");
        function GitRepository(path) {
            this.path = path;
            this.absPath = Path.join(c9.workspaceDir, this.path);
            
        }
        (function() {
            oop.implement(this, EventEmitter);
            
            this.open = function() {
                
            };
            
            this.toGitPath = function(c9path) {
                
            };
            
            this.toC9Path = function(gitPath) {
                
            };
            
            // this.
            
        }).call(GitRepository.prototype);
        
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
        
        plugin.freezePublicAPI({
            /**
             * @property {Object}  The tree implementation
             * @private
             */
            get tree() { return tree; },
            get logTree() { return logTree; },
            getFileAtHash: getFileAtHash,
            loadDiff: loadDiff,
            get changed() { return changed },
            get ignored() { return ignored },
            get staged() { return staged },
        });
        
        register(null, {
            "git.status": plugin
        });
    }
});