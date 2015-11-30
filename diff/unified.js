define(function(require, exports, module) {
"use strict";
/*eslint semi: 0*/
var oop = require("ace/lib/oop");
var lang = require("ace/lib/lang");
var event = require("ace/lib/event");
var Range = require("ace/range").Range;
var dom = require("ace/lib/dom");
var config = require("ace/config");

var LineWidgets = require("ace/line_widgets").LineWidgets;
var css = require("ace/requirejs/text!./styles.css");
// dom.importCssString(css, "diffview.css");
var diff_match_patch = require("./diff_match_patch").diff_match_patch;


var Editor = require("ace/editor").Editor;
var Renderer = require("ace/virtual_renderer").VirtualRenderer;
var UndoManager = require("ace/undomanager").UndoManager;
var EditSession = require("ace/edit_session").EditSession;

var Mode = require("ace/mode/text").Mode;

var mode = new Mode();

function createEditor(el) {
    if (el instanceof Editor) return el;
    var editor = new Editor(new Renderer(el), null);
    editor.session.setUndoManager(new UndoManager());
    return editor;
}

function DiffView(element, options) {
    this.renderedHeaders = [];
    this.renderHeaders = this.renderHeaders.bind(this);
    // this.onInput = this.onInput.bind(this);
    
    this.options = {};
    var editor = createEditor(element);
    this.container = editor.container;
    this.editor = editor;
    this.attachToEditor(editor);

    oop.mixin(this.options, {
        showDiffs: true,
        maxDiffs: 5000
    }, options);
        
    config.resetOptions(this);
    config._signal("diffView", this);
}


(function() {
    
    /*** theme/session ***/
    this.setValueFromPatch = function(v) {
        var editor = this.editor;
        var lines = editor.session.doc.$split(v);
        
        var states = [];
        var result = [];
        var rowInsert = 0;
        var rowRemove = 0;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i]
            if (line[0] == "d" && line.slice(0, 5) == "diff ") {
                var none = {type: "none"};
                var path = line.split(" b/").pop();
                result.push(path, "", "", "", "");
                states.push({type: "file"}, none, none, none, none);
                while (i + 1 < lines.length && lines[i + 1][0] != "@")
                    i++;
            }
            else if (line[0] == "@") {
                var m = line.match(/^@@ -(\d+)(,\d+) \+(\d+)(,\d+) @@/)
                if (m) {
                    rowRemove = parseInt(m[1], 10);
                    rowInsert = parseInt(m[3], 10);
                    result.push(line)
                    states.push({type: "header"})
                }
            }
            else if (line[0] == " ") {
                result.push(line.substr(1));
                states.push({type: "context", row2: rowInsert, row1: rowRemove});
                rowInsert++;
                rowRemove++;
            }
            else if (line[0] == "+") {
                result.push(line.substr(1));
                states.push({type: "insert", row2: rowInsert, row1: ""});
                rowInsert++;
            }
            else if (line[0] == "-") {
                result.push(line.substr(1));
                states.push({type: "remove", row2: "", row1: rowRemove});
                rowRemove++;
            }
        }
        v = result.join("\n");
        editor.setValue(v, -1);
        editor.session.bgTokenizer.diffStates = states;
        editor.session.bgTokenizer.stop();
        editor.setReadOnly(true);
        editor.session.bgTokenizer.getLineTokens = function(row) {
            var line = this.session.getLine(row)
            var type = this.diffStates[row];
            return [{
                value: line,
                type: "uniDiff_" + type
            }];
        };
    };
    
    this.attachToEditor = function(editor) {
        editor.session.setMode(mode);
        editor.session.removeMarker(editor.session.mi);
        editor.session.mi = editor.session.addDynamicMarker(new DiffHighlight);
        editor.renderer.on("afterRender", this.renderHeaders);
        editor.session.diffView = this;
        editor.renderer.$gutterLayer.$cells = [];
        editor.renderer.$gutterLayer.element.innerHTML = "";
        editor.renderer.$gutterLayer.gutterWidth = NaN;
        editor.renderer.$gutterLayer.$padding = null;
        editor.renderer.$gutterLayer.update = this.updateGutter;
    };

    this.updateGutter= function(config) {
        var session = this.session;
        var firstRow = config.firstRow;
        var lastRow = Math.min(config.lastRow + config.gutterOffset,  // needed to compensate for hor scollbar
            session.getLength() - 1);
        var fold = session.getNextFoldLine(firstRow);
        var foldStart = fold ? fold.start.row : Infinity;
        var foldWidgets = this.$showFoldWidgets && session.foldWidgets;
        var firstLineNumber = session.$firstLineNumber;
        
        var diffStates = session.bgTokenizer.diffStates;
        
        if (!diffStates)
            return;

        var cell = null;
        var index = -1;
        var row = firstRow;
        while (true) {
            if (row > foldStart) {
                row = fold.end.row + 1;
                fold = session.getNextFoldLine(row, fold);
                foldStart = fold ? fold.start.row : Infinity;
            }
            if (row > lastRow) {
                while (this.$cells.length > index + 1) {
                    cell = this.$cells.pop();
                    this.element.removeChild(cell.element);
                }
                break;
            }

            cell = this.$cells[++index];
            if (!cell) {
                cell = {element: null, textNode: null, foldWidget: null};
                cell.element = dom.createElement("div");
                cell.textNode = document.createTextNode('');
                cell.element1 = dom.createElement("span");
                cell.element2 = dom.createElement("span");
                cell.element1.className = "unidiff-cell first";
                cell.element2.className = "unidiff-cell";
                cell.element.appendChild(cell.element1);
                cell.element.appendChild(cell.element2);
                this.element.appendChild(cell.element);
                this.$cells[index] = cell;
            }

            var line = session.getLine(row);
            var state = diffStates[row];
            var className = "unidiff_gutter-cell unidiff " + state.type;
            
            if (cell.element.className != className)
                cell.element.className = className;

            var height = session.getRowLength(row) * config.lineHeight + "px";
            if (height != cell.element.style.height)
                cell.element.style.height = height;

            if (foldWidgets) {
                var c = foldWidgets[row];
                // check if cached value is invalidated and we need to recompute
                if (c == null)
                    c = foldWidgets[row] = session.getFoldWidget(row);
            }

            if (c) {
                if (!cell.foldWidget) {
                    cell.foldWidget = dom.createElement("span");
                    cell.element.appendChild(cell.foldWidget);
                }
                var className = "ace_fold-widget ace_" + c;
                if (c == "start" && row == foldStart && row < fold.end.row)
                    className += " ace_closed";
                else
                    className += " ace_open";
                if (cell.foldWidget.className != className)
                    cell.foldWidget.className = className;

                var height = config.lineHeight + "px";
                if (cell.foldWidget.style.height != height)
                    cell.foldWidget.style.height = height;
            } else {
                if (cell.foldWidget) {
                    cell.element.removeChild(cell.foldWidget);
                    cell.foldWidget = null;
                }
            }
            
            if (line[0] == "@") {
                cell.element1.innerHTML = 
                cell.element2.innerHTML = "<span style='cursor:pointer'>\xb7\xb7\xb7</span>";
            } else {
                cell.element1.textContent = state.row1 || "\x1b";
                cell.element2.textContent = state.row2 || "\x1b";
            }
            row++;
        }

        this.element.style.height = config.minHeight + "px";

        var gutterWidth = 2 * 6 * config.characterWidth;
        
        var padding = this.$padding || this.$computePadding();
        gutterWidth += padding.left + padding.right;
        if (gutterWidth !== this.gutterWidth && !isNaN(gutterWidth)) {
            this.gutterWidth = gutterWidth;
            this.element.style.width = Math.ceil(this.gutterWidth) + "px";
            this._emit("changeGutterWidth", gutterWidth);
        }
    };

    this.createWidget = function(row, renderedHeaders) {
        var w = {
            row: row,
            el: document.createElement("div"),
            rowCount: 0,
            pixelHeight: 0,
            coverLine: 1,
            coverGutter: 1,
            fixedWidth: true
        };
        renderedHeaders.push(w);
        return w
        
    };
    this.populateWidget = function(w, i) {
        var editor = this.editor
        var session = editor.session;
        var line = session.getLine(i);
        var lineHeight = editor.renderer.layerConfig.lineHeight;
        w.el.innerHTML = '<div class="unidiff_fileHeaderInner">\
            <span class="ace_fold-widget ace_start ace_open"\
            style="height:1.5em;left: -20px;\
            position: relative;display: inline-block;"></span>'
            + " " +  lang.escapeHTML(line) + " "
            +'<div>'
        
        w.el.className ="unidiff_fileHeader ace_lineWidgetContainer";
        w.el.style.height = lineHeight * 3 + "px";
        w.el.firstChild.style.height = lineHeight * 3 + "px";
        w.el.firstChild.style.marginTop = lineHeight + "px";
    };
    this.renderHeaders = function(e, renderer) {
        var config = renderer.layerConfig;
        var diffStates = renderer.session.bgTokenizer.diffStates;
        if (!diffStates)
            return;
        var first = Math.min(this.firstRow, config.firstRow - 5);
        var last = Math.max(this.lastRow, config.lastRow);
        
        this.firstRow = config.firstRow;
        this.lastRow = config.lastRow;

        var renderedHeaders = this.renderedHeaders;
        var j = 0
        renderer.$cursorLayer.config = config;
        for (var i = first; i <= last; i++) {
            var state = diffStates[i];
            if (!state || diffStates[i].type != "file") continue;
            var w = renderedHeaders[j] || this.createWidget(i, renderedHeaders);
            j++;
            this.populateWidget(w, i);
            if (!w._inDocument) {
                w._inDocument = true;
                renderer.container.appendChild(w.el);
            }
            var top = renderer.$cursorLayer.getPixelPosition({row: i, column:0}, true).top;
            w.el.style.top = top - config.offset + "px";
            
            var left = w.coverGutter ? 0 : renderer.gutterWidth;
            w.el.style.left = left + "px";
            
            if (w.fixedWidth) {
                w.el.style.right = renderer.scrollBar.getWidth() + "px";
            } else {
                w.el.style.right = "";
            }
        }
        for (var k = j; k < renderedHeaders.length; k++) {
            var h = renderedHeaders[k];
            if (h.el) h.el.remove();
        }
        renderedHeaders.length = j;
    };
    
    /*** patch ***/
    this.createPatch = function(options) {
        var chunks = this.chunks;
        var editLines = this.edit.session.doc.getAllLines();
        var origLines = this.orig.session.doc.getAllLines();
        var path1 = options.path1 || options.path || "_";
        var path2 = options.path2 || path1;
        var patch = [
            "diff --git a/" + path1 + " b/" + path2,
            "--- a/" + path1,
            "+++ b/" + path2,
        ].join("\n");
        
        if (!chunks.length) {
            chunks = [{
                origStart: 0,
                origEnd: 0,
                editStart: 0,
                editEnd: 0
            }];
        }
        
        function header(s1, c1, s2, c2) {
            return "@@ -" + (c1 ? s1 + 1 : s1) +  "," + c1
                + " +" + (c2 ? s2 + 1 : s2)  + "," + c2 + " @@";
        }
        
        var context = options.context || 0;
        // changed newline at the end of file
        var editEOF = !editLines[editLines.length - 1];
        var origEOF = !origLines[origLines.length - 1];
        if (editEOF)
            editLines.pop();
        if (origEOF)
            origLines.pop();
        if (editEOF != origEOF) {
            chunks = chunks.slice();
            var last = chunks.pop();
            chunks.push(last = {
                origStart: Math.min(last.origStart, origLines.length - 1),
                origEnd: Math.min(last.origEnd, origLines.length),
                editStart: Math.min(last.editStart, editLines.length - 1),
                editEnd: Math.min(last.editEnd, editLines.length)
            });
        }
        
        var hunk = "";
        var start1 = 0;
        var start2 = 0;
        var end1 = 0;
        var end2 = 0;
        var length1 = 0;
        var length2 = 0;
        var mergeWithNext = false;
        for (var i = 0; i < chunks.length; i++) {
            var ch = chunks[i];
            var s1 = ch.origStart;
            var e1 = ch.origEnd;
            var s2 = ch.editStart;
            var e2 = ch.editEnd;
            var next = chunks[i + 1];
            
            
            start1 = Math.max(s1 - context, end1);
            start2 = Math.max(s2 - context, end2);
            end1 = Math.min(e1 + context, origLines.length);
            end2 = Math.min(e2 + context, editLines.length);
            
            mergeWithNext = false;
            if (next) {
                if (end1 >= next.origStart - context) {
                    end1 = next.origStart;
                    end2 = next.editStart;
                    mergeWithNext = true;
                }
            }
            
            for (var j = start1; j < s1; j++)
                hunk += "\n " + origLines[j];
            for (var j = s1; j < e1; j++)
                hunk += "\n-" + origLines[j];
            if (ch == last && editEOF)
                hunk += "\n\\ No newline at end of file";
            for (var j = s2; j < e2; j++)
                hunk += "\n+" + editLines[j];
            if (ch == last && origEOF)
                hunk += "\n\\ No newline at end of file";
            for (var j = e1; j < end1; j++)
                hunk += "\n " + origLines[j];
            
            length1 += end1 - start1;
            length2 += end2 - start2;
            if (mergeWithNext)
                continue;
                
            patch += "\n" + header(end1 - length1, length1, end2 - length2, length2) + hunk;
            length2 = length1 = 0;
            hunk = "";
        }
        
        if (!editEOF && !origEOF && end1 == origLines.length) {
            patch +=  "\n\\ No newline at end of file";
        }
        
        return patch;
    };
    
    this.applyPatch = function(oldStr, uniDiff) {
        var lines = uniDiff.split("\n");
        var hunks = [];
        var i = 0;
        var EOFChanged = 0;
    
        // Skip to the first change hunk
        while (i < lines.length && !(/^@@/.test(lines[i]))) {
            i++;
        }
    
        // Parse the unified diff
        for (; i < lines.length; i++) {
            var tag = lines[i][0];
            var line = lines[i].substr(1);
            if (tag === "@") {
                var chunkHeader = /@@ -(\d+)(?:,(\d*))? \+(\d+)(?:,(\d*)) @@/.exec(line);
                hunks.unshift({
                    start: +chunkHeader[1],
                    oldlength: +chunkHeader[2] || 1,
                    removed: [],
                    added: []
                });
            }
            else if (tag === "+") {
                hunks[0].added.push(line);
            }
            else if (tag === "-") {
                hunks[0].removed.push(line);
            }
            else if (tag === " ") {
                hunks[0].added.push(line);
                hunks[0].removed.push(line);
            }
            else if (tag === "\\") {
                if (lines[i - 1][0] === "+")
                    EOFChanged = 1;
                else if (lines[i - 1][0] === "-")
                    EOFChanged = -1;
            }
        }
    
        // Apply the diff to the input
        lines = oldStr.split("\n");
        for (i = hunks.length - 1; i >= 0; i--) {
            var hunk = hunks[i];
            // Sanity check the input string. Bail if we don't match.
            for (var j = 0; j < hunk.oldlength; j++) {
                if (lines[hunk.start - 1 + j] !== hunk.removed[j]) {
                    return false;
                }
            }
            lines.splice.apply(lines, [hunk.start - 1, hunk.oldlength].concat(hunk.added));
        }
    
        // Handle EOFNL insertion/removal
        if (EOFChanged == -1) {
            while (!lines[lines.length - 1]) {
                lines.pop();
            }
        }
        else if (EOFChanged == 1) {
            lines.push("");
        }
        return lines.join("\n");
    };
    
    /*** options ***/
    config.defineOptions(this, "editor", {
        alignDiffs: {
            set: function(val) {
                if (val)
                    this.align();
            },
            initialValue: false
        },
    });
}).call(DiffView.prototype);

function findChunkIndex(chunks, row, orig) {
    if (orig) {
        for (var i = 0; i < chunks.length; i++) {
            var ch = chunks[i];
            if (ch.origEnd < row) continue;
            if (ch.origStart > row) break;
        }
    }
    else {
        for (var i = 0; i < chunks.length; i++) {
            var ch = chunks[i];
            if (ch.editEnd < row) continue;
            if (ch.editStart > row) break;
        }
    }
    return i - 1;
}



var DiffHighlight = function(diffView, type) {
    this.diffView = diffView;
    this.type = type;
};

(function() {
    this.MAX_RANGES = 500;

    this.update = function(html, markerLayer, session, config) {
        var start = config.firstRow;
        var end = config.lastRow;

        var diffView = this.diffView;
        var chunks = diffView.chunks;
        var isOrig = this.type == -1;
        var type = this.type;
        var index = findChunkIndex(chunks, start, isOrig);
        if (index == -1 && chunks.length && (isOrig ? chunks[0].origStart : chunks[0].editStart) > start)
            index = 0;
        var chunk = chunks[index];
        while (chunk) {
            if (isOrig) {
                if (chunk.origStart > end && chunk.origStart != chunk.origEnd)
                    return;
                var range = new Range(chunk.origStart, 0, chunk.origEnd - 1, 1);
                var l1 = chunk.origEnd - chunk.origStart;
                var l2 = chunk.editEnd - chunk.editStart;
            }
            else {
                if (chunk.editStart > end && chunk.editStart != chunk.editEnd)
                    return;
                range = new Range(chunk.editStart, 0, chunk.editEnd - 1, 1);
                l1 = chunk.origEnd - chunk.origStart;
                l2 = chunk.editEnd - chunk.editStart;
            }
            var className = "";
            if (!l1 && isOrig || !l2 && !isOrig) {
                className = range.start.row == session.getLength() ? "insertEnd" : "insertStart";
            }
            className += chunk.type == -1 ? " delete" : chunk.type == 1 ? " insert" : "";

            markerLayer.drawFullLineMarker(html, range.toScreenRange(session),
                "unidiff " + className, config);
            var inlineChanges = chunk.inlineChanges;
            var row = range.start.row;
            var column = 0;
            for (var j = 0; j < inlineChanges.length; j++) {
                var diff = inlineChanges[j];
                if (diff[0] == 0) {
                    if (diff[1]) {
                        row += diff[1];
                        column = diff[2];
                    }
                    else {
                        column += diff[2];
                    }
                }
                else {
                    range.start.row = row;
                    range.start.column = column;
                    if (row > end)
                        break;
                    if (diff[0] == (isOrig ? -1 : 1)) {
                        type = isOrig ? "delete" : "insert";
                        if (diff[1]) {
                            row += diff[1];
                            column = diff[2];
                        }
                        else {
                            column += diff[2];
                        }
                    }
                    else {
                        type = isOrig ? "insert" : "delete";
                    }
                    if (row < start)
                        continue;
                    range.end.row = row;
                    range.end.column = column;
                    if (range.isEmpty())
                        type += " empty";
                    
                    var screenRange = range.clipRows(start, end).toScreenRange(session);
                    if (screenRange.isMultiLine()) {
                        markerLayer.drawTextMarker(html, screenRange, "unidiff inline " + type, config);
                    }
                    else {
                        markerLayer.drawSingleLineMarker(html, screenRange, "unidiff inline " + type, config);
                    }
                }
            }
            chunk = chunks[++index];
        }
    };

}).call(DiffHighlight.prototype);


var DiffHighlight = function(diffView, type) {
    this.diffView = diffView;
};

(function() {
    this.MAX_RANGES = 500;

    this.update = function(html, markerLayer, session, config) {
        var start = config.firstRow;
        var end = config.lastRow;
        var states = session.bgTokenizer.diffStates;
        var range = new Range(0, 0, 0, 1);
        for (var i = start; i < end; i++) {
            range.start.row = range.end.row = i
            var type = states[i].type;
            if (type == "insert")
                markerLayer.drawFullLineMarker(html, range.toScreenRange(session),
                    "unidiff marker " + "insert", config);  
            else if (type == "remove")
                markerLayer.drawFullLineMarker(html, range.toScreenRange(session),
                    "unidiff marker " + "remove", config);  
            else if (type == "header")
                markerLayer.drawFullLineMarker(html, range.toScreenRange(session),
                    "unidiff marker " + "header", config);  
        }
    };

}).call(DiffHighlight.prototype);


require("ace/lib/dom").importCssString("\
.ace_editor {color: #333}\
.unidiff.marker {\
    position:absolute;\
}\
.unidiff.insert {\
    background: #EAFFEA;\
}\
.blob-code-addition .x {\
    background-color: #a6f3a6;\
}\
.blob-code-deletion .x {\
    background-color: #f8cbcb;\
}\
\
.unidiff.remove {\
    background: #FFECEC;\
}\
.unidiff.header {\
    background: #EDF2F9;\
}\
.unidiff_fileHeaderInner {\
    background: #f7f7f7;\
    font: inherit;\
    padding: 15px 4em;\
    box-sizing: border-box;\
    border: 1px solid #d8d8d8;\
    // border-style: solid none;\
    border-style: solid;\
    border-radius: 5px 5px 0 0;\
    font-size: 11px;\
}\
.unidiff_fileHeader{\
    background: inherit;\
    border-top: 1px solid #d8d8d8;\
}\
.unidiff_gutter-cell { padding-right: 13px}\
.ace_diff-container .ace_gutter { border-left: 1px solid #DEDEDE; }\
.ace_diff-container .ace_scroller { border-right: 1px solid #DEDEDE; }\
.unidiff-cell{ width: 3em; display:inline-block;\
    padding-right: 5px;\
    margin-right: -5px}\
.unidiff-cell.first{border-right: 1px solid #d8d8d8; margin-right: 0px};\
\
")


module.exports.DiffView = DiffView;

});
