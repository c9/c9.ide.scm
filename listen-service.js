module.exports = function (vfs, options, register) { 
    var stream;
    
    var exec = require("child_process").execFile;
    var Stream = require('stream');
    
    var defaultArgs = ["status", "--porcelain", "-b", "-z", "--untracked-files=all"];
    var timer;
    
    function start(){
        clearTimeout(timer);
        timer = setTimeout(getStatus.bind(this, detectChanges), 1000);
    }
    
    function stop(){
        clearTimeout(timer);
    }
    
    function getStatus(args, callback){
        if (typeof args == "function")
            callback = args, args = null;
        
        if (!args)
            args = defaultArgs;
        
        if (args === defaultArgs)
            stop();
        
        exec("git", args, {
            cwd: vfs.workspaceDir
        }, function(stdout, stderr){
            callback(null, stderr);
            
            if (args === defaultArgs)
                start();
        });
    }
    
    var cache;
    function detectChanges(err, status){
        if (err) return;
        
        if (status !== cache) {
            stream.emit("data", { status: status });
            cache = status;
        }
    }

    register(null, {
        connect: function (callback) {
            if (stream) return callback(null, { stream: stream });
            
            stream = new Stream();
            stream.readable = true;
            stream.writable = true;
            
            start();
            callback(null, { stream: stream });
        },
        
        getStatus: getStatus,
        
        disconnect: function(){
            stop();
            stream = null;
        },
        
        destroy: function(){
            this.disconnect();
        }
    });
};