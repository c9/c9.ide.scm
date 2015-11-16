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
        
        /*
            TODO:
            - Add support for remotes:
                - Auto open remotes section
                - Show url in remotes section
                    git remote -v
                    origin  git@github.com:c9/newclient.git (fetch)
                    origin  git@github.com:c9/newclient.git (push)
                - Add button to add remote next to 'remotes'
                - Remove a remote using context menu
            - Variable rows:
                https://github.com/c9/newclient/blob/master/node_modules/ace_tree/lib/ace_tree/data_provider.js#L393
        */
        
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
        
        var branchesTree, lastData;
        var displayMode = "branches";
        var mnuSettings, btnSettings;
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
            
            var mnuFilter = Menu({ items: [
                new MenuItem({ type: "radio", caption: "Branches", value: "branches" }),
                new MenuItem({ type: "radio", caption: "Committer", value: "committer" })
            ]}, plugin);
            mnuFilter.on("itemclick", function(e){
                button.setCaption(e.item.caption);
                displayMode = e.item.value;
                
                if (displayMode == "branches")
                    showBranches();
                else
                    showCommitters();
            });
            
            var codebox = new ui.codebox({
                realtime: "true",
                skin: "codebox",
                "initial-message": "Filter Branches",
                clearbutton: "true",
                focusselect: "true",
                singleline: "true",
                left: 10,
                top: 10,
                right: 10
                // class: "navigate-search"
            });
            var container = new ui.bar({ anchors: "47 0 0 0" });
            var button = new ui.button({
                caption: "Branches",
                right: 10,
                top: 10,
                submenu: mnuFilter.aml
            });
            
            opts.aml.appendChild(codebox);
            opts.aml.appendChild(button);
            opts.aml.appendChild(container);
            
            var mnuContext = new Menu({ items: [
                new MenuItem({ caption: "Checkout" }),
                // new MenuItem({ caption: "Create Pull Request" }),
                new Divider(),
                new MenuItem({ caption: "Show In Version Log" }),
                new MenuItem({ caption: "Compare With Master" }),
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
                    if (node.isFolder || !node.path || !node.subject) return "";
                    
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
                    var name;
                    if (branchesTree.filterKeyword && node.path && !node.parent.parent 
                      || node.path && displayMode == "committer")
                        name = node.path.replace(/^refs\//, "");
                    else
                        name = node.label || node.name;
                    
                    if (node.type == "user")
                        return "<img src='" 
                            + util.getGravatarUrl(node.email.replace(/[<>]/g, ""), 32, "") 
                            + "' width='16' height='16' />" 
                            + escapeHTML(node.label) 
                            + " (" + node.items.length + ")";
                    
                    if (node.authorname) {
                        return escapeHTML(name)
                            + "<span class='author'><img src='" 
                            + util.getGravatarUrl(node.authoremail.replace(/[<>]/g, ""), 32, "") 
                            + "' width='16' height='16' />" 
                            + escapeHTML(node.authorname) + "</span>"
                            + "<span class='extrainfo'> - " 
                            + (node.date ? timeago(node.date) : "") + "</span>";
                    }
                    return escapeHTML(name);
                },
                
                getTooltipText: function(node){
                    return node.authorname
                        ? "[" + node.hash + "] " + node.authorname + " - " + node.subject
                        : "";
                },
                
                getRowIndent: function(node) {
                    return branchesTree.filterKeyword || displayMode == "committer"
                        ? node.$depth
                        : node.$depth ? node.$depth - 1 : 0;
                },
                
                getEmptyMessage: function(){
                    return branchesTree.filterKeyword
                        ? "No branches found for '" + branchesTree.filterKeyword + "'"
                        : "Loading...";
                },
                
                sort: function(children) {
                    if (!children.length)
                        return;
                    
                    var compare = branchesTree.model.alphanumCompare;
                    
                    if (children[0].type == "user")
                        return children.sort(function(a, b){
                            if (a.label == "[None]") return 1;
                            if (b.label == "[None]") return -1;
                            return compare(a.label + "", b.label + "");
                        });
                    
                    return children.sort(function(a, b) {
                        if (a.isFolder) return 0;
                        
                        if (a.authorname && !b.authorname)
                            return -1;
                        if (b.authorname && !a.authorname)
                            return 1;
                
                        return compare(b.date + "", a.date + "");
                    });
                }
            }, plugin);
            
            branchesTree.renderer.scrollBarV.$minWidth = 10;
            
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
            
            function forwardToTree() {
                branchesTree.execCommand(this.name);
            }
            codebox.ace.on("input", function(){
                 branchesTree.filterKeyword = codebox.ace.getValue();
            });
            codebox.ace.commands.addCommands([
                "centerselection",
                "goToStart",
                "goToEnd",
                "pageup",
                "gotopageup",
                "pagedown",
                "gotopageDown",
                "scrollup",
                "scrolldown",
                "goUp",
                "goDown",
                "selectUp",
                "selectDown",
                "selectMoreUp",
                "selectMoreDown"
            ].map(function(name) {
                var command = branchesTree.commands.byName[name];
                return {
                    name: command.name,
                    bindKey: command.editorKey || command.bindKey,
                    exec: forwardToTree
                };
            }));
            
            refresh();
            
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
        var branchesRoot = { 
            path: "",
            items: [recentLocal, primaryRemote, pullRequests, recentActive, all]
        };
        var committersRoot = { 
            path: "",
            items: []
        }
        
        function loadBranches(data){
            var root = branchesRoot;
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
                    var items = node.items || (node.items = []);
                    var map = node.map || (node.map = {});
                    if (map[p]) node = map[p];
                    else {
                        node = map[p] = {
                            label: p,
                            path: (node.path || "") + p + "/"
                        };
                        items.push(node);
                    }
                });
                var items = node.items || (node.items = []);
                var map = node.map || (node.map = {});
                map[x.name] = x;
                items.push(x);
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
            
            // TODO add current branch to top of recent local and make bold
            
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
            
            // Reset committers root
            committersRoot.items.length = 0;
            
            // branchesTree.filterRoot = data;
            // branchesTree.setRoot(root.items);
            // branchesTree.resize();
        }
        
        function showBranches(){
            branchesTree.filterProperty = "path";
            branchesTree.filterRoot = lastData;
            branchesTree.setRoot(branchesRoot.items);
        }
        function showCommitters(){
            if (!committersRoot.items.length) {
                var data = lastData;
                var users = {}, emails = {};
                data.forEach(function(x) {
                    var user = x.authorname || "[None]";
                    if (!emails[user]) emails[user] = x.authoremail;
                    (users[user] || (users[user] = [])).push(x);
                });
                for (var user in users) {
                    committersRoot.items.push({
                        label: user,
                        authorname: user,
                        email: emails[user],
                        type: "user",
                        items: users[user],
                        clone: function(){ 
                            var x = function(){};
                            x.prototype = this;
                            var y = new x();
                            y.keepChildren = true;
                            y.isOpen = true;
                            return y;
                        }
                    });
                }
            }
            
            branchesTree.filterProperty = "authorname";
            branchesTree.filterRoot = committersRoot;
            branchesTree.setRoot(committersRoot.items);
        }
        
        function refresh(){
            scm.listAllRefs(function(err, data) {
                if (err) {
                    branchesTree.emptyMessage = "Error while loading\n" + escapeHTML(err.message);
                    branchesTree.setRoot(null);
                    return console.error(err);
                }
                
                lastData = data;
                loadBranches(data);
                
                if (displayMode == "branches")
                    showBranches();
                else
                    showCommitters();
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