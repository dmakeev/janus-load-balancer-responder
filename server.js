var http = require('http');
var fs = require('fs');
var express = require('express');
var io = require('socket.io')();
const shell = require('shelljs');
var diskspace = require('diskspace');

var app = express();
var httpServer = http.createServer(app);
httpServer.listen(8890);
io.listen(httpServer);

logIt('Monitor started');

io.sockets.on('connection', function(socket) {
    logIt('somebody connected');

    socket.on('status', function () {
        var data = getLoad();
        diskspace.check('/', function (err, result)
        {
            data.hdd = Math.round(result.free / 1024 / 1024);
            socket.emit('status', { 'code': 200, 'message': '', 'data': data });
        });
    });
});

function getLoad() {
    result = {};
    var getted = shell.exec("TERM=vt100 top -b -n 1 | grep 'load average: '", {'silent': true});
    if (getted && getted.stdout) {
        var usage = getted.stdout.match(/([\d\.]+),\s([\d\.]+),\s([\d\.]+)/, '');
        result.cpu = usage[1];
    }

    var getted = shell.exec("TERM=vt100 top -b -n 1 | grep 'KiB Mem'", {'silent': true});
    if (getted && getted.stdout) {
        var usage = getted.stdout.match(/KiB Mem : (\d+) total, (\d+) free/, '');
        result.ram = usage ? Math.round(usage[2] / 1024) : '';
        //result.ram = usage ? Math.round(100 * (usage[2] / usage[1])) : '';
    }
    return result;
}

function logIt( message, ip ) {
    if (typeof message === 'object') {
        message = JSON.stringify(message);
    }
    var row = new Date().toLocaleString('ru-RU') + '\t' + (ip ? ip : '') + '\t' + message;
    fs.appendFile("./server.log", row + "\r\n", function(err) {
        if(err) {
            return console.log(err);
        }
        console.log( row );
    });
}
