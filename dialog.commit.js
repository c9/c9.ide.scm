define(function(require, module, exports) {
    main.consumes = ["Dialog", "util", "scm", "ui", "commands"];
    main.provides = ["dialog.commit"];
    return main;
    
    function main(options, imports, register) {
        var Dialog = imports.Dialog;
        var util = imports.util;
        var scm = imports.scm;
        var ui = imports.ui;
        var commands = imports.commands;
        
        /***** Initialization *****/
        
        var plugin = new Dialog("Ajax.org", main.consumes, {
            name: "dialog.commit",
            title: "Commit Changes",
            class: "scm-commit",
            allowClose: true,
            modal: true,
            width: 500,
            height: 500,
            resizable: true
            // elements: []
        });
        var emit = plugin.getEmitter();
        
        var body, commitBox, ammendCb, commitBtn, onclick;
        var container;
        
        function load(){
            commands.addCommand({
                name: "commit",
                group: "scm",
                bindKey: { mac: "Cmd-Shift-C", win: "Ctrl-Shift-C" },
                exec: function(editor, args){ 
                    if (args.message) commit(args.message, args.amend);
                    else plugin.show();
                }
            }, plugin);
        }
        
        var drawn = false;
        function draw(options) {
            if (drawn) return;
            drawn = true;
            
            body = { html: document.createElement("div") };
            options.html.parentNode.replaceChild(body.html, options.html);
            
            new ui.vbox({ 
              htmlNode: body.html, 
              style: "position:absolute;left:0;right:0;top:0;bottom:0",
              childNodes: [
                new ui.bar({
                    class: "form-bar", 
                    childNodes: [
                        commitBox = new apf.codebox({}),
                        new ui.hbox({
                            padding: 5,
                            childNodes: [
                                ammendCb = new ui.checkbox({ 
                                    label: "amend",
                                    skin: "checkbox_black",
                                    margin: "5 0 0 0"
                                }),
                                new ui.filler(),
                                commitBtn = new ui.button({
                                    caption: "Commit",
                                    skin: "btn-default-css3",
                                    class: "btn-green",
                                    margin: "5 0 0 0",
                                    onclick: onclick
                                })
                            ]
                        })
                    ]
                }),
                container = new ui.bar({
                    style: "padding: 10px 0 10px 0;overflow:auto;flex:1"
                })
            ] });
            
            commitBox.ace.setOption("minLines", 1);
            commitBox.ace.commands.addCommand({
                bindKey: "Esc",
                exec: function() {
                    plugin.hide();
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
        }
        
        /***** Methods *****/
        
        
        
        /***** Lifecycle *****/
            
        plugin.on("load", function(options) {
            load();
        });
        plugin.on("draw", function(options) {
            draw(options);
        });
        plugin.on("show", function() {
            commitBox.focus();
        });
        
        /***** Register *****/
        
        plugin.freezePublicAPI({
            get onclick(){ return onclick; },
            set onclick(v){ onclick = v; },
            
            get container(){ return container.$int; },
            
            get button(){ return commitBtn; },
            get message(){ return commitBox.ace.getValue(); },
            get amend(){ return ammendCb.checked; },
            
            enable: function(){
                ammendCb.enable();
                commitBox.enable();
                commitBtn.enable();
            },
            
            disable: function(){
                ammendCb.disable();
                commitBox.disable();
                commitBtn.disable();
            },
            
            clear: function(){
                ammendCb.uncheck();
                commitBox.ace.setValue("");
            }
        });
        
        register("", {
            "dialog.commit": plugin,
        });
    }
});