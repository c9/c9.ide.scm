define(function(require, exports, module) {
    main.consumes = [
        "Panel", "Menu", "MenuItem", "Divider", "settings", "ui", "c9", 
        "watcher", "panels", "util", "save", "preferences", "commands", "Tree",
        "tabManager", "layout", "preferences.experimental", "scm", "util",
        "dialog.alert"
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
        var alert = imports["dialog.alert"].show;
        
        var async = require("async");
        var timeago = require("timeago");
        var escapeHTML = require("ace/lib/lang").escapeHTML;
        
        /*
            TODO:
            - Add support for remotes:
                * Auto open remotes section
                * Show url in remotes section
                    git remote -v
                    origin  git@github.com:c9/newclient.git (fetch)
                    origin  git@github.com:c9/newclient.git (push)
                * Add button to add remote next to 'remotes'
                * Remove a remote using context menu
            - Variable rows:
                - https://github.com/c9/newclient/blob/master/node_modules/ace_tree/lib/ace_tree/data_provider.js#L393
                - getHeight();
                - node.height
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
        var REMOTES = {};
        var CURBRANCH;
        
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
                new MenuItem({ caption: "Checkout Branch", onclick: function(){
                    var node = branchesTree.selectedNode;
                    scm.checkout(node.path, function(err){
                        if (err) {
                            return alert("Could Not Checkout Branch",
                                "Received Error While Checking out Branch",
                                err.message || err);
                        }
                        
                        CURBRANCH = node.path;
                        
                        branchesTree.refresh();
                    });
                }}),
                new MenuItem({ caption: "Delete Branch", onclick: function(){
                    var node = branchesTree.selectedNode;
                    scm.removeBranch(node.path, function(err){
                        if (err) {
                            return alert("Could Not Remove Branch",
                                "Received Error While Removing Branch",
                                err.message || err);
                        }
                        
                        delete node.parent.map[node.label];
                        node.parent.items.remove(node);
                        branchesTree.refresh();
                    });
                }}),
                new MenuItem({ caption: "Rename Branch", onclick: function(){
                    branchesTree.startRename(branchesTree.selectedNode);
                }, isAvailable: function(){
                    var node = branchesTree.selectedNode;
                    return node.path.match(/^refs\/(?:heads|remotes)/);
                }}),
                new Divider(),
                // new MenuItem({ caption: "Create Pull Request" }),
                new MenuItem({ caption: "Create New Branch From Here", onclick: function(){
                    var node = branchesTree.selectedNode;
                    scm.addBranch("refs/heads/newbranche", node.path, function(err){
                        if (err) {
                            return alert("Could Not Add Branch",
                                "Received Error While Adding Branch",
                                err.message || err);
                        }
                        
                        // Todo add branch with info of node
                        // Todo select New Branch
                        // Todo start renaming New Branch
                        // Todo Remove refresh
                        
                        refresh();
                    });
                }}),
                new Divider(),
                new MenuItem({ caption: "Show In Version Log" }),
                new MenuItem({ caption: "Compare With Master" }),
                new Divider(),
                new MenuItem({ caption: "Remove Remote", onclick: function(){
                    var node = branchesTree.selectedNode;
                    
                    scm.removeRemote(node.label, function(err){
                        if (err) {
                            return alert("Could Not Remove Remote",
                                "Received Error While Removing Remote",
                                err.message || err);
                        }
                        
                        delete REMOTES[name];
                        
                        delete node.parent.map[node.label];
                        node.parent.children.remove(node);
                        branchesTree.refresh();
                        
                        refresh();
                    });
                }, isAvailable: function(){
                    var node = branchesTree.selectedNode;
                    return node && node.parent.isRemote ? true : false;
                }}),
                new Divider(),
                new MenuItem({ caption: "Merge Into Current Branch" })
            ]}, plugin);
            container.setAttribute("contextmenu", mnuContext.aml);

            branchesTree = new Tree({
                container: container.$int,
                scrollMargin: [0, 10],
                theme: "filetree branches"
                    + (settings.getBool("user/scm/@showauthor") ? " showAuthorName" : ""),
                enableRename: true,
                    
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
                            + " (" + node.children.length + ")";
                    
                    if (node.isRemote) {
                        return "remotes <span class='remote-button'>Add Remote</span>";
                    }
                    
                    if (node.parent.isRemote) {
                        return escapeHTML(name) + " [" 
                            + (REMOTES[name] || "") + "]";
                    }
                    
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
                
                getClassName: function(node) {
                    return (node.className || "") 
                        + (node.path == CURBRANCH ? " current" : "")
                        + (node.status == "loading" ? " loading" : "");
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
                    p.children = p.children = p.cache;
                    node.showall = false;
                    node.label = "Show Less...";
                    branchesTree.refresh();
                }
                else if (node.showall === false) {
                    var p = node.parent;
                    p.children = p.children = p.cache.slice(0, p.limit);
                    p.children.push(node);
                    node.showall = true;
                    node.label = "Show All (" + p.cache.length + ")...";
                    branchesTree.refresh();
                }
            });
            
            branchesTree.on("beforeRename", function(e) {
                if (!e.node.path.match(/^refs\/(?:heads|remotes)/))
                    return e.preventDefault();
            });
            branchesTree.on("afterRename", function(e) {
                // TODO Test if branch exists. If it does, warn user and do nothing
                // TODO Check for illegal characters
                
                var base = e.node.path.match(/^refs\/(?:remotes\/[^\/]+|heads)/)[0];
                var newPath = base + "/" + e.value;
                
                scm.renameBranch(e.node.path, newPath, function(err){
                    if (err) return;
                    
                    e.node.label = e.value;
                    e.node.path = newPath;
                    branchesTree.refresh();
                });
            });
            
            var remoteName, remoteURI;
            var remoteMenu = new ui.menu({
                width: 400,
                height: 86,
                style: "padding:0",
                childNodes: [
                    new ui.hsplitbox({
                        height: 20,
                        edge: 10,
                        padding: 10,
                        childNodes: [
                            remoteName = new ui.textbox({ width: "100", "initial-message": "Name" }),
                            remoteURI = new ui.textbox({ "initial-message": "URL"})
                        ]
                    }),
                    new ui.button({
                        caption: "Add Remote",
                        skin: "btn-default-css3",
                        class: "btn-green",
                        right: 10,
                        bottom: 10,
                        onclick: function(){
                            if (!remoteName.getValue() || !remoteURI.getValue() || REMOTES[name])
                                return;
                            
                            remoteMenu.disable();
                            
                            var name = remoteName.getValue();
                            var url = remoteURI.getValue();
                            
                            scm.addRemote(name, url, function(err){
                                remoteMenu.enable();
                                
                                if (err) {
                                    return alert("Could Not Add Remote",
                                        "Received Error While Adding Remote",
                                        err.message || err);
                                }
                                
                                REMOTES[name] = url;
                                
                                remoteName.clear();
                                remoteURI.clear();
                                remoteMenu.hide();
                                
                                var node = nodeRemote.map[name] = {
                                    label: name,
                                    path: "remotes/" + name
                                };
                                nodeRemote.children.push(node);
                                branchesTree.refresh();
                                
                                refresh();
                            });
                        }
                    })
                ]
            });
            
            container.$int.addEventListener("click", function(e){
                if (e.target.className == "remote-button") {
                    var b = e.target.getBoundingClientRect();
                    remoteMenu.display(b.left, b.top + b.height);
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
                new MenuItem({ caption: "Remove All Local Merged Branches", onclick: function(){  alert("Not Implemented"); } }, plugin),
                new MenuItem({ caption: "Remove All Remote Merged Branches", onclick: function(){  alert("Not Implemented"); } }, plugin), // https://gist.github.com/schacon/942899
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
            children: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        var primaryRemote = {
            label: "primary remote branches",
            className: "heading",
            children: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        var pullRequests = {
            label: "pull requests",
            className: "heading",
            isPR: true,
            children: [
                {
                    label: "Open",
                    children: [],
                    isOpen: true,
                    isFolder: true
                },
                {
                    label: "Closed",
                    children: [],
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
            children: [],
            isOpen: true,
            isFolder: true,
            map: {},
            noSelect: true,
            $sorted: true
        };
        var all = {
            label: "all",
            className: "heading",
            children: [],
            isOpen: true,
            isFolder: true,
            noSelect: true,
            $sorted: true
        };
        var branchesRoot = { 
            path: "",
            children: [recentLocal, primaryRemote, pullRequests, recentActive, all]
        };
        var committersRoot = { 
            path: "",
            children: []
        }
        
        var nodeRemote;
        function loadBranches(data){
            var root = branchesRoot;
            root.children.forEach(function(n){
                if (n.isPR) {
                    n.children[0].children.length = 0;
                    n.children[1].children.length = 0;
                    n.children[0].map = {};
                    n.children[1].map = {};
                }
                else {
                    n.children.length = 0;
                    n.map = {};
                }
            });
            root.map = {};
            
            function isPrimary(path){
                var primary = settings.getJson("project/scm/@primary");
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
                        primaryRemote.children.push(copyNode(x));
                }
                
                var node = all;
                parts.forEach(function(p) {
                    var items = node.children || (node.children = []);
                    var map = node.map || (node.map = {});
                    if (map[p]) node = map[p];
                    else {
                        node = map[p] = {
                            label: p,
                            path: (node.path || "") + p + "/"
                        };
                        if (p == "remotes") {
                            node.isOpen = true;
                            node.isRemote = true;
                            nodeRemote = node;
                        }
                        items.push(node);
                    }
                });
                var items = node.children || (node.children = []);
                var map = node.map || (node.map = {});
                map[x.name] = x;
                items.push(x);
            });
            
            // Check for empty remotes
            if (!nodeRemote) {
                nodeRemote = { label: "remotes", isOpen: true, map: {}, children: [] };
                all.children.push(nodeRemote);
                all.map["remotes"] = nodeRemote;
            }   
            
            for (var name in REMOTES) {
                if (!nodeRemote.map[name]) {
                    var node = nodeRemote.map[name] = {
                        label: name,
                        path: "remotes/" + name
                    };
                    nodeRemote.children.push(node);
                }
            }
            
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
            // TODO in committers view move current user to the top and auto expand, show current branch in bold
            var n;
            
            recentLocal.limit = ITEM_THRESHOLD_LOCAL;
            recentLocal.cache = local;
            recentLocal.children = 
            recentLocal.children = local.slice(0, ITEM_THRESHOLD_LOCAL);
            if (local.length > ITEM_THRESHOLD_LOCAL) {
                n = { showall: true, label: "Show All (" + local.length + ")..." };
                recentLocal.children.push(n);
                local.push(n);
            }
            
            recentActive.limit = ITEM_THRESHOLD_REMOTE;
            recentActive.cache = remote;
            recentActive.children = 
            recentActive.children = remote.slice(0, ITEM_THRESHOLD_REMOTE);
            if (remote.length > ITEM_THRESHOLD_REMOTE) {
                n = { showall: true, label: "Show All (" + remote.length + ")..." };
                recentActive.children.push(n);
                remote.push(n);
            }
            
            // Remove empty blocks
            root.children = root.children.filter(function(n){
                if (n == all) return true;
                if (n.isPR) return n.children[0].length + n.children[1].length;
                return n.children.length;
            });
            
            // Reset committers root
            committersRoot.children.length = 0;
        }
        
        function showBranches(){
            branchesTree.filterProperty = "path";
            branchesTree.filterRoot = lastData;
            branchesTree.setRoot(branchesRoot.children);
        }
        function showCommitters(){
            if (!committersRoot.children.length) {
                var data = lastData;
                var users = {}, emails = {};
                data.forEach(function(x) {
                    var user = x.authorname || "[None]";
                    if (!emails[user]) emails[user] = x.authoremail;
                    (users[user] || (users[user] = [])).push(x);
                });
                for (var user in users) {
                    committersRoot.children.push({
                        label: user,
                        authorname: user,
                        email: emails[user],
                        type: "user",
                        children: users[user],
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
            branchesTree.setRoot(committersRoot.children);
        }
        
        function refresh(){
            async.parallel([
                function (next) {
                    scm.listAllRefs(function(err, data) {
                        lastData = data;
                        next(err);
                    });
                },
                function (next) {
                    scm.getRemotes(function(err, remotes){
                        if (!err) REMOTES = remotes;
                        next();
                    });
                },
                function (next) {
                    scm.getCurrentBranch(function(err, branch){
                        if (!err) CURBRANCH = "refs/heads/" + branch;
                        next();
                    });
                }
            ], function(err){
                // if (!REMOTES["test"]) debugger;
                
                if (err) {
                    branchesTree.emptyMessage = "Error while loading\n" + escapeHTML(err.message);
                    branchesTree.setRoot(null);
                    return console.error(err);
                }
                
                loadBranches(lastData);
                
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