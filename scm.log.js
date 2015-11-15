define(function(require, exports, module) {
    main.consumes = [
        "Editor", "editors", "ui", "save", "scm", "Datagrid", "Tree",
        "layout", "settings", "tabManager", "commands", "Divider", "MenuItem",
        "console", "Menu"
    ];
    main.provides = ["scm.log"];
    return main;

    function main(options, imports, register) {
        var ui = imports.ui;
        var save = imports.save;
        var Editor = imports.Editor;
        var Tree = imports.Tree;
        var Datagrid = imports.Datagrid;
        var editors = imports.editors;
        var layout = imports.layout;
        var Menu = imports.Menu;
        var Divider = imports.Divider;
        var MenuItem = imports.MenuItem;
        var tabManager = imports.tabManager;
        var settings = imports.settings;
        var cnsl = imports.console;
        var commands = imports.commands;
        var scm = imports.scm;
        
        var GitGraph = require("./log/log");
        
        var basename = require("path").basename;
        var dirname = require("path").dirname;
        var escapeHTML = require("ace/lib/lang").escapeHTML;
        
        /***** Initialization *****/
        
        var extensions = [];
        
        var handle = editors.register("scmlog", "SCM Log Viewer", LogView, extensions);
        
        handle.on("load", function(){
            // commands.addCommand({
            //     name: "opencoverageview",
            //     // hint: "runs the selected test(s) in the test panel",
            //     // bindKey: { mac: "F6", win: "F6" },
            //     group: "Test",
            //     exec: function(editor, args){
            //         var tab;
            //         if (tabManager.getTabs().some(function(t){
            //             if (t.editorType == "coverageview") {
            //                 tab = t;
            //                 return true;
            //             }
            //         })) {
            //             tabManager.focusTab(tab);
            //         }
            //         else {
            //             cnsl.show();
            //             tabManager.open({
            //                 editorType: "coverageview", 
            //                 focus: true, 
            //                 pane: cnsl.getPanes()[0]
            //             }, function(){});
            //         }
            //     }
            // }, handle);
        });
                          
        function LogView(){
            var plugin = new Editor("Ajax.org", main.consumes, extensions);
            var emit = plugin.getEmitter();
            
            var datagrid, dropdown, label, tree, detail;
            
            var arrayCache = [];
            
            var BGCOLOR = { 
                "flat-light": "#f7f7f7", 
                "flat-dark": "#3D3D3D",
                "light": "#D3D3D3", 
                "light-gray": "#D3D3D3",
                "dark": "#3D3D3D",
                "dark-gray": "#3D3D3D" 
            };
            
            plugin.on("draw", function(e) {
                var container = new ui.bar();
                detail = new ui.bar({
                    width: "25%",
                    class: "scm-statusbar detail-root",
                    visible: false // TODO remember this in state
                });
                var hbox = e.tab.appendChild(new ui.hsplitbox({
                    splitter: true,
                    childNodes: [ container, detail ]
                }));
                
                detail.$int.innerHTML = "<div class='detail-label'></div><div class='detail-tree'></div>";
                label = detail.$int.firstChild;
                label.host = { textselect: true };
                
                drawLog(container.$int);
                drawDetail(detail.$int.lastChild);
            });
            
            function drawDetail(parentHtml) {
                tree = new Tree({
                    container: parentHtml,
                    scrollMargin: [10, 0],
                    theme: "filetree",
                    enableDragdrop: true,
                
                    getIconHTML: function(node) {
                        var icon = node.isFolder ? "folder" : "status-icon-" + node.type;
                        // if (node.parent == conflicts)
                        //     icon = "status-icon-conflict";
                        // if (node.status === "loading") icon = "loading";
                        // if (tree.model.twoWay && !node.isFolder)
                        //     icon += " clickable";
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
                
                tree.container.style.position = "absolute";
                tree.container.style.left = "0";
                tree.container.style.top = "0";
                tree.container.style.right = "0";
                tree.container.style.bottom = "0";
                tree.container.style.height = "";
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
                
                tree.commands.bindKey("Left", function(e) {
                    datagrid.focus();
                });
                tree.commands.bindKey("Tab", function(e) {
                    datagrid.focus();
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
                        } else if (e.target == changed) {
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
                
                scm.on("resize", function(){
                    tree && tree.resize();
                });
                
                plugin.on("select", function(options){
                    if (options && detail.visible) 
                        reload(options, function(){});
                }, plugin);
                
                // Context Menu
                // menuContext = new Menu({ items: [
                //     new MenuItem({ match: "file", class: "strong", caption: "Open Diff", onclick: openSelection }, plugin),
                //     new MenuItem({ match: "file", caption: "Open", onclick: openSelectedFiles }, plugin),
                //     new MenuItem({ match: "file", caption: "Reveal in File Tree", onclick: reveal }, plugin),
                // ]});
                // opts.aml.setAttribute("contextmenu", menuContext.aml);
                
                reload({ hash: 0, force: true }, function(){});
            }
                
            function drawLog(parentHtml) {
                datagrid = new Datagrid({
                    container: parentHtml,
                    scrollMargin: [10, 0],
                    // theme: "filetree",
                    
                    columns : [
                        {
                            caption: "Date",
                            width: "100",
                            getText: function(node){
                                return "Today";
                            }
                        }, 
                        {
                            caption: "User",
                            value: "test",
                            width: "100"
                        },
                        {
                            caption: "Commit Message",
                            value: "label",
                            width: "100%",
                            type: "tree"
                        }, 
                    ],
                
                    isLoading: function() {},
        
                    getEmptyMessage: function(){
                        return "Loading log...";
                    }
                }, plugin);
                
                datagrid.container.style.position = "absolute";
                datagrid.container.style.left = "0";
                datagrid.container.style.top = "0";
                datagrid.container.style.right = "0px";
                datagrid.container.style.bottom = "0";
                datagrid.container.style.height = "";
                
                datagrid.renderer.scrollBarV.$minWidth = 10;
                
                // Enable Git Graph
                new GitGraph().attachToTree(datagrid.acetree);
                
                // datagrid.tooltip = new Tooltip(tree);
                // logdatagrid.tooltip = new Tooltip(logTree);
                
                layout.on("eachTheme", function(e){
                    var height = parseInt(ui.getStyleRule(".filetree .tree-row", "height"), 10) || 20;
                    datagrid.rowHeightInner = height;
                    datagrid.rowHeight = height;
                    if (e.changed)
                        datagrid.resize();
                }, plugin);
                
                datagrid.commands.bindKey("Space", function(e) {
                    // TODO show diff of entire commit
                });
                
                datagrid.commands.bindKey("Enter", function(e) {
                    // Toggle detail
                    if (detail.visible) detail.hide();
                    else {
                        detail.show();
                        datagrid.select(datagrid.selectedNodes); // Todo async callback and then show
                    }
                });
                
                var switchToTree = function(e) {
                    tree.focus();
                    if (!tree.selectedNode)
                        tree.select(tree.root[0]);
                };
                datagrid.commands.bindKey("Right", switchToTree);
                datagrid.commands.bindKey("Tab", switchToTree);
                
                datagrid.on("userSelect", function(e) {
                    var options = {};
                    var nodes = datagrid.selectedNodes;
                    
                    if (!nodes[0]) 
                        return;
                        
                    options.hash = nodes[0].hash;
                    if (nodes[0].parents)
                        options.base = nodes[0].parents.match(/\S*/)[0] || "4b825dc6";
                    
                    if (nodes[1])
                        options.base = nodes[1].hash;
                    
                    if (!nodes[1] && !options.hash)
                        options.twoWay = true;
                        
                    if (!nodes[1]) {
                        options.commit = nodes[0];
                    }
                    
                    emit("select", options);
                });
                
                // datagrid.setRoot(rootNode = new Node({
                //     label: "root",
                //     tree: tree
                // }));
                
                // datagrid.on("focus", function(){
                //     scm.focussedPanel = plugin;
                // });
                
                // settings.on("read", function(){
                //     scm.settingsMenu.append(new MenuItem({ 
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
                //         datagrid.refresh();
                //     }
                // }, plugin);
                
                scm.on("log", function(node){
                    datagrid.model.loadData(node);
                }, plugin);
                    
                    // scm.on("resize", function(){
                    //     tree && datagrid.resize();
                    // });
                
                // new Datagrid({
                //     container: container.$int,
                
                //     columns : [
                //         {
                //             caption: "Hierarchy",
                //             value: "label",
                //             width: "60%",
                //             type: "tree"
                //         }, 
                //         {
                //             caption: "Covered (%)",
                //             width: "20%",
                //             getText: function(node){
                //                 return node.covered + "%";
                //             }
                //         }, 
                //         {
                //             caption: "Not Covered",
                //             value: "uncovered",
                //             width: "20%"
                //         }
                //     ]
                // }, plugin);
                
                // e.htmlNode.style.padding = 0;
            }
            
            /***** Method *****/
            
            function reload(options, cb) {
                if (!options) options = {hash: 0};
                if (!tree.meta.options) tree.meta.options = {};
                if (!options.force)
                if (tree.meta.options.hash == options.hash && tree.meta.options.base == options.base)
                    return;
                
                scm.getStatus(options, function(e, status) {
                    var root = [];
                    var i, name, x;
                    // var twoWay = options.twoWay;
                    
                    status = (status || "").split("\x00");
                    console.log(status);
                        for (i = 0; i < status.length; i += 2) {
                            x = status[i];
                            name = status[i + 1];
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
                        
                        if (options.commit) {
                            label.innerHTML =  "<span class='hash'>" + escapeHTML(options.hash) + "</span> "
                                + "<span>" + escapeHTML(options.commit.authorname) + "</span>"
                                + "<div>" + escapeHTML(options.commit.label) + "</div>";
                        } else {
                            label.innerHTML =  "<span class='hash'>" + escapeHTML(options.hash) + "</span>"
                                + " ... "
                                + "<span class='hash'>" + escapeHTML(options.base) + "</span> ";
                        }
                        label.style.display = "block";
                    
                    tree.setRoot(root);
                    tree.select(null);
                    tree.meta.options = options;
                    // tree.model.twoWay = twoWay;
                });
            }
            
            
            /***** Lifecycle *****/
            
            plugin.on("documentLoad", function(e) {
                var doc = e.doc;
                
                function setTheme(e) {
                    var tab = doc.tab;
                    var isDark = e.theme == "dark";
                    
                    tab.backgroundColor = BGCOLOR[e.theme];
                    
                    if (isDark) tab.classList.add("dark");
                    else tab.classList.remove("dark");
                }
                
                layout.on("themeChange", setTheme, doc);
                setTheme({ theme: settings.get("user/general/@skin") });
                
                doc.title = "Version Log";
            });
            
            plugin.on("documentActivate", function(e) {
                
            });
            
            plugin.on("resize", function(e) {
                datagrid && datagrid.resize();
            });
            
            /***** Register and define API *****/
            
            plugin.freezePublicAPI({});
            
            plugin.load(null, "scmlog");
            
            return plugin;
        }
        
        register(null, {
            "scm.log": handle
        });
    }
});
