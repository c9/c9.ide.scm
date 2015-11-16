define(function(require, exports, module) {
    main.consumes = [
        "Panel", "Menu", "MenuItem", "Divider", "settings", "ui", "c9", 
        "watcher", "panels", "util", "save", "preferences", "commands", "Tree",
        "tabManager", "layout", "preferences.experimental", "scm", "util"
    ];
    main.provides = ["scm.branches"];
    return main;
    
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
        var util = imports.util;
        var panels = imports.panels;
        var util = imports.util;
        var save = imports.save;
        var layout = imports.layout;
        var scm = imports.scm;
        var prefs = imports.preferences;
        var commands = imports.commands;
        var experimental = imports["preferences.experimental"];
        
        var timeago = require("timeago");
        var escapeHTML = require("ace/lib/lang").escapeHTML;
        
        /***** Initialization *****/
        
        var ENABLED = experimental.addExperiment("git", !c9.hosted, "Panels/Source Control Management")
        if (!ENABLED)
            return register(null, { "scm.branches": {} });
        
        var plugin = new Panel("Ajax.org", main.consumes, {
            index: options.index || 350,
            caption: "Branches",
            minWidth: 130,
            autohide: true,
            where: options.where || "left"
        });
        var emit = plugin.getEmitter();
        
        var RECENT_THRESHOLD = 14 * 24 * 60 * 60 * 1000; // 2 weeks ago
        var ITEM_THRESHOLD_LOCAL = 5;
        var ITEM_THRESHOLD_REMOTE = 10;
        
        var ICON_BRANCH = require("text!./icons/git-branch.svg");
        var ICON_PULLREQUEST = require("text!./icons/git-pull-request.svg");
        var ICON_TAG = require("text!./icons/git-tag.svg");
        
        var branchesTree;
        var mnuSettings, btnSettings
        var workspaceDir = c9.workspaceDir; // + "/plugins/c9.ide.scm/mock/git";
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            plugin.setCommand({
                name: "branches",
                hint: "Version Branches",
                bindKey: { mac: "", win: "" },
                extra: function(editor, args, e) {
                    
                }
            });
            
            settings.on("read", function(){
                settings.setDefaults("project/scm", [["primary", ["origin/master"]]]);
                settings.setDefaults("user/scm", [["showauthor", [false]]]);
            });
            
            settings.on("user/scm/@showauthor", function(){
                plugin.on("draw", function(){
                    var showAuthor = settings.getBool("user/scm/@showauthor");
                    
                    branchesTree.container.className = 
                        branchesTree.container.className.replace(/ showAuthorName/, "");
                        
                    if (showAuthor) 
                        branchesTree.container.className += " showAuthorName";
                });
            });
        }
        
        var drawn = false;
        function draw(opts) {
            if (drawn) return;
            drawn = true;
            
            var codebox = new ui.codebox({
                realtime: "true",
                skin: "codebox",
                clearbutton: "true",
                focusselect: "true",
                singleline: "true",
                left: 10,
                top: 10,
                right: 10
                // class: "navigate-search"
            });
            var container = new ui.bar({ anchors: "47 0 0 0" });
            
            opts.aml.appendChild(codebox);
            opts.aml.appendChild(container);
            
            var mnuContext = new Menu({ items: [
                // new MenuItem({ caption: "Add All", command: "addall", tooltip: "git add -u" }, plugin),
                // new MenuItem({ caption: "Unstage All", command: "unstageall", tooltip: "git add -u" }, plugin)
                new MenuItem({ caption: "Checkout" }),
                new Divider(),
                new MenuItem({ caption: "Show Changes Compared With Master" }),
                new Divider(),
                new MenuItem({ caption: "Delete Branch" }),
                new MenuItem({ caption: "Merge Into Current Branch" })
            ]}, plugin);
            container.setAttribute("contextmenu", mnuContext.aml);

            branchesTree = new Tree({
                container: container.$int,
                scrollMargin: [0, 10],
                theme: "filetree branches"
                    + (settings.getBool("user/scm/@showauthor") ? " showAuthorName" : ""),
                isLoading: function() {},
                
                getIconHTML: function(node) {
                    if (node.isFolder || !node.path || !node.authorname) return "";
                    
                    var icon;
                    if (node.path.indexOf("refs/tags/") === 0)
                        icon = ICON_TAG;
                    else if (node.parent.parent == pullRequests)
                        icon = ICON_PULLREQUEST;
                    else
                        icon = ICON_BRANCH; // todo diff between local, remote, stash
                    
                    return icon;
                },
                
                getCaptionHTML: function(node) {
                    if (node.date) {
                        return escapeHTML(node.label || node.name)
                            + "<span class='author'><img src='" 
                            + util.getGravatarUrl(node.authoremail.replace(/[<>]/g, ""), 32, "") 
                            + "' width='16' height='16' />" 
                            + node.authorname + "</span>"
                            + "<span class='extrainfo'> - " 
                            + timeago(node.date) + "</span>";
                    }
                    return escapeHTML(node.label || node.name);
                },
                
                getTooltipText: function(node){
                    return node.authorname
                        ? node.authorname + " - " + node.subject
                        : "";
                },
                
                getRowIndent: function(node) {
                    return node.$depth ? node.$depth - 1 : 0;
                },

                getEmptyMessage: function(){
                    return "Loading...";
                },
                
                sort: function(children) {
                    if (!children.length)
                        return;
                    
                    var compare = branchesTree.model.alphanumCompare;
                    return children.sort(function(a, b) {
                        if (a.isFolder) return 0;
                        
                        if (a.authorname && !b.authorname)
                            return 1;
                        if (b.authorname && !a.authorname)
                            return -1;
                
                        return compare(b.date + "", a.date + "");
                    });
                }
            }, plugin);
            
            // var idMixin = function () {
            //     this.expandedList = Object.create(null);
            //     this.selectedList = Object.create(null);
            //     this.setOpen = function(node, val) {
            //         if (val)
            //             this.expandedList[node.path] = val;
            //         else
            //             delete this.expandedList[node.path];
            //     };
            //     this.isOpen = function(node) {
            //         return this.expandedList[node.path];
            //     };
            //     this.isSelected = function(node) {
            //         return this.selectedList[node.path];
            //     };
            //     this.setSelected = function(node, val) {
            //         if (val)
            //             this.selectedList[node.path] = !!val;
            //         else
            //             delete this.selectedList[node.path];
            //     };
            // };
            // idMixin.call(branchesTree.model);
            // branchesTree.model.expandedList["refs/remotes/"] = true;
            
            branchesTree.renderer.scrollBarV.$minWidth = 10;
            // branchesTree.container.style.margin = "0 0px 0 0";
            
            // branchesTree.minLines = 3;
            // branchesTree.maxLines = Math.floor((window.innerHeight - 100) / branchesTree.rowHeight);
            branchesTree.emptyMessage = "loading..."
            
            branchesTree.on("afterChoose", function(e){
                var node = branchesTree.selectedNode;
                if (!node) return;
                
                if (node.showall) {
                    var p = node.parent;
                    p.items = p.children = p.cache;
                    node.showall = false;
                    node.label = "Show Less..."
                    branchesTree.refresh();
                }
                else if (node.showall === false) {
                    var p = node.parent;
                    p.items = p.children = p.cache.slice(0, p.limit);
                    p.items.push(node);
                    node.showall = true;
                    node.label = "Show All (" + p.cache.length + ")...";
                    branchesTree.refresh();
                }
            });
            
            scm.listAllRefs(function(err, data) {
                if (err) {
                    branchesTree.emptyMessage = "Error while loading\n" + escapeHTML(err.message);
                    return console.error(err);
                }
                
                loadBranches(data);
            });
            
            mnuSettings = new Menu({ items: [
                new MenuItem({ caption: "Refresh", onclick: refresh }, plugin),
                new Divider(),
                new MenuItem({ caption: "Remove All Local Merged Branches", onclick: refresh }, plugin),
                new MenuItem({ caption: "Remove All Remote Merged Branches", onclick: refresh }, plugin), // https://gist.github.com/schacon/942899
                new Divider(),
                new MenuItem({ caption: "Show Author Name", type: "check", checked: "user/scm/@showauthor" }, plugin)
            ]}, plugin);
            
            btnSettings = opts.aml.appendChild(new ui.button({
                skin: "header-btn",
                class: "panel-settings changes",
                submenu: mnuSettings.aml
            }));
            
            // Mark Dirty
            // plugin.on("show", function() {
            //     save.on("afterSave", markDirty);
            //     watcher.on("change", markDirty);
            // });
            // plugin.on("hide", function() {
            //     clearTimeout(timer);
            //     save.off("afterSave", markDirty);
            //     watcher.off("change", markDirty);
            // });
            
            // watcher.watch(util.normalizePath(workspaceDir) + "/.git");
            
            // var timer = null;
            // function markDirty(e) {
            //     clearTimeout(timer);
            //     timer = setTimeout(function() {
            //         if (tree && tree.meta.options && !tree.meta.options.hash) {
            //             tree.meta.options.force = true;
            //             emit("reload", tree.meta.options);
            //         }
            //     }, 800);
            // }
        }
        
        /***** Methods *****/
        
        var recentLocal = {
            label: "recent local branches",
            className: "heading",
            items: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        var primaryRemote = {
            label: "primary remote branches",
            className: "heading",
            items: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        var pullRequests = {
            label: "pull requests",
            className: "heading",
            isPR: true,
            items: [
                {
                    label: "Open",
                    items: [],
                    isOpen: true,
                    isFolder: true
                },
                {
                    label: "Closed",
                    items: [],
                    isOpen: false,
                    isFolder: true
                }
            ],
            isOpen: true,
            isFolder: true,
            map: {},
            noSelect: true,
            $sorted: true
        };
        var recentActive = {
            label: "recently active",
            className: "heading",
            items: [],
            isOpen: true,
            isFolder: true,
            map: {},
            noSelect: true,
            $sorted: true
        };
        var all = {
            label: "all",
            className: "heading",
            items: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        
        function loadBranches(data){
            var root = { 
                path: "",
                items: [recentLocal, primaryRemote, pullRequests, recentActive, all]
            };
            root.items.forEach(function(n){
                if (n.isPR) {
                    n.items[0].items.length = 0;
                    n.items[1].items.length = 0;
                }
                else n.items.length = 0;
            });
            
            var primary = settings.getJson("project/scm/@primary");
            function isPrimary(path){
                return ~primary.indexOf(path.replace(/^refs\/remotes\//, ""));
            }
            function copyNode(x){
                var y = util.extend({ className: "root-branch" }, x);
                y.name = x.path.replace(/^refs\/(?:(?:remotes|tags|heads)\/)?/, "");
                return y;
            }
            
            // Store all branches in all
            data.forEach(function(x) {
                x.date = parseInt(x.committerdate) * 1000;
                x.path = x.name;
                
                var parts = x.path.replace(/^refs\//, "").split("/");
                x.name = parts.pop(); // disregard the name
                
                if (parts[0] == "remotes") {
                    if (isPrimary(x.path))
                        primaryRemote.items.push(copyNode(x));
                }
                
                var node = all;
                parts.forEach(function(p) {
                    var map = node.map || (node.map = {});
                    node = map[p] || (map[p] = {
                        label: p,
                        path: (node.path || "") + p + "/"
                    });
                });
                var map = node.map || (node.map = {});
                map[x.name] = x;
            });
            
            // Sort by date
            data.sort(function(a, b){
                if (a.date == b.date) return 0;
                if (a.date < b.date) return 1;
                if (a.date > b.date) return -1;
            });
            
            var local = [], remote = [], threshold = Date.now() - RECENT_THRESHOLD;
            for (var i = 0, l = data.length; i < l; i++) {
                var x = data[i];
                if (x.date < threshold) continue;
                if (x.path.indexOf("refs/remotes") === 0 && !isPrimary(x.path))
                    remote.push(copyNode(x));
                else if (x.path.indexOf("refs/heads") === 0)
                    local.push(copyNode(x));
            }
            
            recentLocal.limit = ITEM_THRESHOLD_LOCAL;
            recentLocal.cache = local;
            recentLocal.items = local.slice(0, ITEM_THRESHOLD_LOCAL);
            if (local.length > ITEM_THRESHOLD_LOCAL) {
                var n = { showall: true, label: "Show All (" + local.length + ")..." };
                recentLocal.items.push(n);
                local.push(n);
            }
            
            recentActive.limit = ITEM_THRESHOLD_REMOTE;
            recentActive.cache = remote;
            recentActive.children = 
            recentActive.items = remote.slice(0, ITEM_THRESHOLD_REMOTE);
            if (remote.length > ITEM_THRESHOLD_REMOTE) {
                var n = { showall: true, label: "Show All (" + remote.length + ")..." };
                recentActive.items.push(n);
                remote.push(n);
            }
            
            // Remove empty blocks
            root.items = root.items.filter(function(n){
                if (n == all) return true;
                if (n.isPR) return n.items[0].length + n.items[1].length;
                return n.items.length;
            });
            
            branchesTree.setRoot(root.items);
            branchesTree.resize();
        }
        
        function refresh(){
            
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
            
        });
        plugin.on("hide", function(e) {
            
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn = false;
        });
        
        /***** Register and define API *****/
        
        plugin.freezePublicAPI({
            get tree(){ return branchesTree; }
        });
        
        register(null, {
            "scm.branches": plugin
        });
    }
});