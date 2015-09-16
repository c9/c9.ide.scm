define(function(require, exports, module) {
"use strict";

var dom = require("ace/lib/dom");
var event = require("ace/lib/event");

var MAX_GAP = 20;


function GitGraph(editor) {
    this.colors = this.themes[0];
    
    
}

(function() {
    this.themes = [ 
        [
            "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
            "#bcbd22", "#17becf"
        ],
        [
            "#1f77b4", "#aec7e8", "#ff7f0e", "#ffbb78", "#2ca02c", "#98df8a", "#d62728", "#ff9896",
            "#9467bd", "#c5b0d5", "#8c564b", "#c49c94", "#e377c2", "#f7b6d2", "#7f7f7f", "#c7c7c7",
            "#bcbd22", "#dbdb8d","#17becf", "#9edae5"
        ],
        [
            "#393b79", "#5254a3", "#6b6ecf", "#9c9ede", "#637939", "#8ca252", "#b5cf6b", "#cedb9c",
            "#8c6d31", "#bd9e39", "#e7ba52", "#e7cb94", "#843c39", "#ad494a", "#d6616b", "#e7969c",
            "#7b4173", "#a55194", "#ce6dbd", "#de9ed6"
        ],
        [
            "#3182bd", "#6baed6", "#9ecae1", "#c6dbef", "#e6550d", "#fd8d3c", "#fdae6b", "#fdd0a2",
            "#31a354", "#74c476", "#a1d99b", "#c7e9c0", "#756bb1", "#9e9ac8", "#bcbddc", "#dadaeb",
            "#636363", "#969696", "#bdbdbd", "#d9d9d9"
        ]
    ];
    
    this.setLineHeight = function(lineHeight) {
        var config = {};
        var circleRadius = 0.2;
        var circleStroke = 0.08;
        var branchSpacing = 1;
        var strokeWidth = 0.1;
        
        config.circleRadius = lineHeight * circleRadius;
        config.circleStroke = lineHeight * circleStroke;
        config.lineHeight = lineHeight;
        config.columnWidth = lineHeight * branchSpacing;
        config.strokeWidth = lineHeight * strokeWidth;
        this.config = config;
    };
    
    this.setColumns = function(data) {
        var bySha = {};

        for (var i = 0; i < data.length; i++) {
            var d = data[i];
            bySha[d.hash] = d;
        }
        for (var i = 0; i < data.length; i++) {
            var d = data[i];
            var parents = d.parents ? d.parents.split(" ") : [];
            d.parent = bySha[parents[0]];
            if (d.parent && !d.parent.firstChild)
                d.parent.firstChild = d;
            d.parent2 = parents.length > 1 && parents.slice(1).map(function(x) {
                return bySha[x];
            })
            d.row = i;
        }

        
        
        var lines = [];
        var colors = this.colors;
        for (var i = 0; i < data.length; i++) {
            var d = data[i];
            var found = false;
            var emptyLine = lines.length;
            for (var j = 0; j < lines.length; j++) {
                var path = lines[j];
                if (!path && emptyLine > j) {
                    emptyLine = j;
                }
                if (path && path.last.parent == d) {
                    if (found) {
                        lines[j] = null;
                    } else {
                        path.last = d;
                        found = true;
                        d.row = i;
                        d.column = j;
                        d.color = colors[j%colors.length];
                    }
                }
                if (path && path.last.row == i - 1) {
                    if (j && path.last.parent && path.last.parent.row - path.last.row > MAX_GAP) {
                        lines[j] = null;
                        path.last.gap = path.last.parent || 1;
                        if (path.last.parent)
                            path.last.parent.cogap = path.last;
                    }
                    if (!path.last.parent)
                        lines[j] = null;
                }
            }
            if (!found) {
                lines[emptyLine] = ({
                    last: d
                });
                d.row = i;
                d.column = emptyLine;
                d.color = colors[emptyLine%colors.length];
            }
        }
    };
    
    
    this.draw = function(start, end) {
        var config = this.config;
        var lineHeight = config.lineHeight;
        var columnWidth = config.columnWidth;
        var data = this.data;
        
        var container = this.container;
        
        var svg = this.svg;
        var desc = this.desc;
        desc.innerHTML = svg.innerHTML = "";
        
        var lineGroup = svg.appendChild(createSvg("g"));
        var circleGroup = svg.appendChild(createSvg("g"));
    
        circleGroup.setAttribute("stoke-width", config.circleStroke);
        circleGroup.setAttribute("stroke", "#000");
        
        lineGroup.setAttribute("stroke", "#000");
        lineGroup.setAttribute("stroke-width", config.strokeWidth);
        lineGroup.setAttribute("fill", "none");
        
        svg.setAttribute("width", 1000);
        svg.setAttribute("height", 1000);
        
        var offset = start;
        var lines = [], prevLength;
        start = Math.max(start - 2, 0);
        for (var i = start; i < end; i++) {
            var d = data[i];
            
            var col = d.column;
            var path = lines[col];
            if (!path || path.last.row > d.row) {
                lines[col] = path = {};
                path.el = createSvg("path");
                path.last = d;
            }
            
            if (lines.length > prevLength)
                prevLength = lines.length;
            
            path.d = lineTo(path.last, d, 1, path.d, offset, columnWidth, lineHeight);
            path.last = d;
            
            if (!d.parent || d.parent.column != col) {
                var d1 = d.parent;
                if (d1) {
                    path.d = lineTo(path.last, d1, 1, path.d, offset, columnWidth, lineHeight);
                }
                lines[col] = undefined;
                while (lines.length > 2 && !lines[lines.length - 1]) {
                    lines.length = lines.length - 1;
                }
                path.el.setAttribute("d", path.d);
                lineGroup.appendChild(path.el);
            }
            path.el.setAttribute("d", path.d);
            lineGroup.appendChild(path.el);
            
            if (d.parent2) {
                d.parent2.forEach(function(x) {
                    if (!x) return;
                    var el = createSvg("path");
                    var pathd = lineTo(d, x, -1, "", offset, columnWidth, lineHeight);
                    el.setAttribute("d", pathd);
                    lineGroup.appendChild(el);
                    
                    if (!lines[x.column]) {
                        lines[x.column] = {
                            el: el,
                            last: x,
                            d: pathd
                        };
                    }
                });
            }
            
            var x = (d.column + 0.5) * columnWidth;
            var y = (d.row - offset + 0.5) * lineHeight;
            
            if (d.gap) {
                var el = createSvg("polygon");
                el.setAttribute("points", x +"," + (y +lineHeight / 2 + 8) + " " + (x-5) +"," + (y+lineHeight / 2) + " " + (x+5) +"," + (y+lineHeight / 2));
                el.setAttribute("style", "fill:lime;stroke:purple;stroke-width:1");
                circleGroup.appendChild(el);
            }
            
            if (d.cogap) {
                var el = createSvg("polygon");
                el.setAttribute("points", x +"," + (y  - lineHeight / 2 - 8) + " " + (x-5) +"," + (y - lineHeight / 2) + " " + (x+5) +"," + (y-lineHeight / 2));
                el.setAttribute("style", "fill:lime;stroke:purple;stroke-width:1");
                circleGroup.appendChild(el);
            }
            
            
            if (d.parent2) {
                var circle = circleGroup.appendChild(createSvg("rect"));
                var w = config.circleRadius;
                circle.setAttribute("width", 2 * w);
                circle.setAttribute("height", 2 * w);
                circle.setAttribute("x", x - w);
                circle.setAttribute("y", y - w);
            } else {
                var circle = circleGroup.appendChild(createSvg("circle"));
                circle.setAttribute("r", config.circleRadius);
                circle.setAttribute("cx", x);
                circle.setAttribute("cy", y);            
            }
            circle.setAttribute("fill", d.color);
            
            
            if (y >= 0) {
                var p = document.createElement("div");
                // p.textContent = d.hash + " " ;
                p.className = this.getRowClass(d, d.row);
                p.style.height = this.vsize + "px";
                if (d.branches) {
                    var s = document.createElement("span");
                    s.textContent = d.branches;
                    s.className = "branch";
                    p.appendChild(s);
                }
                s = document.createElement("span");
                s.textContent = d.label;
                p.appendChild(s);
                
                p.style.paddingLeft = (Math.max(lines.length, prevLength || 0) + 0)*columnWidth+"px";
                prevLength = lines.length;
                desc.appendChild(p);
            }
        }
        
        lines.forEach(function(path) {
            if (path) {            
                path.el.setAttribute("d", path.d);
                lineGroup.appendChild(path.el);
            }
        });
        
        svg.style.left = (columnWidth / 2) + "px";
        container.appendChild(svg);
        
        svg.setAttribute("width", 1000);
        svg.setAttribute("height", 100*1000);
    };
    
    this.attachToTree = function(tree) {
        this.tree = tree;
        tree.renderer.$cellLayer.update = this.update;
        tree.renderer.$cellLayer.graph = this;
        this.container = tree.renderer.$cellLayer.element;
        this.container.className += " gitGraph";
        this.container.style.position = "relative";
        
        this.desc = document.createElement("div");
        this.container.appendChild(this.desc);
        this.svg = createSvg("svg");
        this.svg.style.top = 0;
        this.svg.style.position = "absolute";
        this.container.appendChild(this.svg);
        tree.renderer.$cellLayer.element = this.desc;
        
        var that = this;
        tree.model.loadData = function(data) {
            this.visibleItems = data;
            that.setColumns(data);
            that.data = data;
            this._signal("change");
        };
        
        tree.model.getClassName = function(node) {
            return (node.className || "") + (node.parent2 ? " merge" : "");
        };
    };
    
    this.update = function(config) {
        var provider = this.provider;
        var graph = this.graph;
        
        var row, html = [], view = config.view, datarow;
        var firstRow = config.firstRow, lastRow = config.lastRow + 1;
        var vsize = provider.rowHeightInner || provider.rowHeight;
        
        if (firstRow === 0 && lastRow === 0) {
            this.renderPlaceHolder(provider, html, config);
        } else {
            graph.getRowClass = this.getRowClass.bind(this);
            graph.vsize = vsize;
            graph.setLineHeight(provider.rowHeight);
            graph.draw(firstRow, lastRow);
        }
    };
    
}).call(GitGraph.prototype);


function createSvg(type) {
    return document.createElementNS("http://www.w3.org/2000/svg", type);
}

function lineTo(from, to, curv, path, offset, columnWidth, lineHeight) {
    var x = (from.column + 0.5) * columnWidth;
    var y = (from.row - offset + 0.5) * lineHeight;
    
    var x1 = (to.column + 0.5) * columnWidth;
    var y1 = (to.row - offset + 0.5) * lineHeight;
    
    if (!path)
        path = "M " + x + "," + y;
    
    if (to.row - from.row > MAX_GAP && from.column != 0) {
        if (to.column == from.column) {
            y1 = y + lineHeight / 2;
            x1 = x;
        } else {
            y1 = y;
            x1 = x1 > x ? x + 0.5 * columnWidth : x - 0.5 * columnWidth;
            path += " L" + x1 + ',' + y1;
            return path;
        }
    }
    
    if (x1 == x) {
        if (y1 != y)
            path += " L" + x1 + ',' + y1;
    } else {
        var sign = x1 > x ? 1 : -1; 
        if (curv > 0) {
            if (y1 - lineHeight > y)
                path += " L" + x + ',' + (y1 - lineHeight);
            path += " C" + x + ',' + (y1 - 5)
                + " " + (x - 5) + ',' + y1
                + " " + (x + sign * columnWidth) + ',' + y1;
            if (x1 != x + sign * columnWidth)
                path += " L" + x1 + ',' + y1;
        } else {
            if (x1 - sign * columnWidth != x)
                path += " L" + (x1 - sign * columnWidth) + ',' + y;                
            path += " C" + (x1 - sign * 5) + ',' + y
                + " " + x1 + ',' + (y + 5)
                + " " + x1 + ',' + (y + lineHeight);
            if (y + lineHeight < y1)
                path += " L" + x1 + ',' + y1;
        }
    }
    return path;
}



module.exports = GitGraph;

});
/*



var config = setConfig(20, 0);



var colors = config.color_list;




    




setColumns(data);
draw(0, 1000);
var o = 0;
window.addEventListener("wheel", function(e) {
    console.log(e.deltaY);
    e.preventDefault();
    f(e.deltaY);
});
var f = function(x) {
    o += x > 0 ? 3 : -3;
    draw(o, o + 30);
};
detail.addEventListener("mousemove", function(e) {
   //  console.log(e)
});*/
