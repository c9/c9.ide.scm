define(function(require, exports, module) {
"use strict";

var oop = require("ace/lib/oop");
var Base = require("ace_tree/data_provider");
var escapeHTML = require("ace/lib/lang").escapeHTML;

var ListData = function(array) {
    Base.call(this);
};

oop.inherits(ListData, Base);

(function() {
    
    this.isLoading = function() {};
    
    this.getEmptyMessage = function(){
        if (!this.keyword)
            return this.isLoading()
                ? "Loading file list. One moment please..."
                : "No files found.";
        else
            return "No files found that match '" + this.keyword + "'";
    };
    
}).call(ListData.prototype);

return ListData;
});