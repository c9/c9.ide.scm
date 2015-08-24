define(function(require, exports, module) {
    main.consumes = [
        "SCMPanel", "settings", "panels", "prefs", "Tree", "layout", "scm"
    ];
    main.provides = ["scm.log"];
    return main;

    function main(options, imports, register) {
        var SCMPanel = imports.SCMPanel;
        var settings = imports.settings;
        var panels = imports.panels;
        var scm = imports.scm;
        var prefs = imports.preferences;
        var Tree = imports.Tree;
        var layout = imports.layout;
        
        var GitGraph = require("./log/log");

        /***** Initialization *****/

        var plugin = new SCMPanel("Ajax.org", main.consumes, {
            caption: "Log View",
            index: 200,
            // splitter: true,
            style: "flex:1;-webkit-flex:1"
        });
        var emit = plugin.getEmitter();
        
        var tree;
        
        function load() {
            panels.on("afterAnimate", function(){
                if (panels.isActive("changes"))
                    tree && tree.resize();
            });
            
            // settings.on("read", function(){
            //     settings.setDefaults("user/test", [["collapsegroups", false]]);
            // }, plugin);
            
            // prefs.add({
            //     "Test" : {
            //         position: 1000,
            //         "Test Runner" : {
            //             position: 100,
            //             "Collapse Passed and Skipped Groups" : {
            //                 type: "checkbox",
            //                 position: 200,
            //                 setting: "user/test/@collapsegroups"
            //             }
            //         }
            //     }
            // }, plugin);
        }
        
        var drawn = false;
        function draw(opts) {
            if (drawn) return;
            drawn = true;
            
            tree = new Tree({
                container: opts.html,
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
            
            tree.container.style.position = "absolute";
            tree.container.style.left = "10px";
            tree.container.style.top = "0";
            tree.container.style.right = "10px";
            tree.container.style.bottom = "0";
            tree.container.style.height = "";
            
            // Enable Git Graph
            new GitGraph().attachToTree(tree.tree);
            
            // tree.tooltip = new Tooltip(tree);
            // logTree.tooltip = new Tooltip(logTree);
            
            // layout.on("eachTheme", function(e){
            //     var height = parseInt(ui.getStyleRule(".filetree .tree-row", "height"), 10) || 22;
            //     model.rowHeightInner = height;
            //     model.rowHeight = height + 1;
            //     logModel.rowHeightInner = height;
            //     logModel.rowHeight = height + 1;
            //     if (branchesTree) {
            //         branchesTree.model.rowHeightInner = height;
            //         branchesTree.model.rowHeight = height + 1;
            //     }
            //     if (e.changed) {
            //         tree && tree.resize();
            //         logTree && logTree.resize();
            //         branchesTree && branchesTree.resize();
            //     }
            // });
            
            tree.on("userSelect", function(e) {
                var options = {};
                var nodes = tree.selectedNodes;
                
                if (!nodes[0]) 
                    return;
                    
                options.hash = nodes[0].hash;
                if (nodes[0].parents)
                    options.base = nodes[0].parents.match(/\S*/)[0] || "4b825dc6";
                
                if (nodes[1])
                    options.base = nodes[1].hash;
                
                emit("select", options);
            });
            
            // tree.setRoot(rootNode = new Node({
            //     label: "root",
            //     tree: tree
            // }));
            
            // tree.on("focus", function(){
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
            //         tree.refresh();
            //     }
            // }, plugin);
            
            scm.on("log", function(node){
                tree.loadData(node);
            }, plugin);
        }
        
        /***** Methods *****/
        
        /***** Lifecycle *****/
        
        plugin.on("load", function() {
            load();
        });
        plugin.on("draw", function(e) {
            draw(e);
        });
        plugin.on("show", function(e) {
            // txtFilter.focus();
            // txtFilter.select();
        });
        plugin.on("hide", function(e) {
            // Cancel Preview
            // tabs.preview({ cancel: true });
        });
        plugin.on("unload", function(){
            drawn = false;
        });
        
        /***** Register and define API *****/
        
        /**
         */
        plugin.freezePublicAPI({
            /**
             * @property {Object}  The tree implementation
             * @private
             */
            get tree() { return tree; }
        });
        
        register(null, {
            "scm.log": plugin
        });
    }
});