/* jshint browser: true */
/* globals $: false, alert: false */
'use strict';

var log = require('npmlog');

process.on('uncaughtException', function(err) {
    log.error('[' + process.pid + '] UNCAUGHT', err.stack);
});

var gui = require('nw.gui');
var win = gui.Window.get();

var starting = false;

var tray;
var Writable = require('stream').Writable;
var logger = new Writable();
var path = require('path');
var nwDir = path.dirname(process.execPath);

var logelm = document.getElementById('logger');
logger._write = function(chunk, encoding, callback) {
    chunk = (chunk ||  '').toString();
    if (chunk) {
        logelm.value += chunk;
        logelm.scrollTop = logelm.scrollHeight;
    }
    callback();
};

log.stream = logger;

var server = false;

var mb;
try {
    mb = new gui.Menu({
        type: 'menubar'
    });
    mb.createMacBuiltin('pangalink-net');
    gui.Window.get().menu = mb;
} catch (E) {}

// Get the minimize event
win.on('minimize', function() {
    // Hide window
    this.hide();

    // Show tray
    tray = new gui.Tray({
        icon: './www/static/favicon.ico'
    });

    // Show window and remove tray when clicked
    tray.on('click', function() {
        win.show();
        this.remove();
        tray = null;
    });
});

win.on('close', function() {
    this.hide(); // Pretend to be closed already
    this.close(true);
});

function updateStatus() {
    switch (server && server.status) {
        case 'started':
            $('#hostname-val').text(server.hostname);
            $('#start').hide();
            $('#running').show();
            break;
        case 'starting':
            $('#start-btn').button('loading');
            break;
        default:
            $('#start').show();
            $('#running').hide();
    }
}

function start(){
    if (starting) {
        return;
    }
    starting = true;
    var port = $('#port').val();
    var hostname = $('#hostname').val();
    var $btn = $('#start-btn').button('loading');

    setTimeout(function() {
        if (!isNaN(port)) {
            localStorage.serverPort = port;
        }
        if (hostname) {
            localStorage.hostname = hostname;
        }

        port = Number(port) || 8080;
        var hostnameValue = hostname || 'localhost';
        if (port !== 80 && port !== 443) {
            hostnameValue += ':' + port;
        }

        if (!server) {
            server = require('../server');
        }

        server.start({
            hostname: hostnameValue,
            port: port,
            data: gui.App.dataPath,
            pathOpenSSL: path.join(nwDir, 'openssl', 'openssl.exe'),
            pathOpenSSLConf: path.join(nwDir, 'openssl', 'openssl.cnf')
        }, function(err) {
            starting = false;
            $btn.button('reset');
            if (err) {
                alert('Serveri käivitamisel ilmnes viga.\n' + err.message);
                return;
            }

            updateStatus();
        });
    }, 150);
}

$('#start-server').submit(function(event) {
    event.preventDefault();
    start();
});

$('#open-web').on('click', function() {
    gui.Shell.openExternal('http://' + server.hostname + '/');
});

$('#server-autostart').on('click', function() {
    localStorage.serverAutostart = this.checked ? 'true' : 'false';
});

$('#server-autostart').on('change', function() {
    localStorage.serverAutostart = this.checked ? 'true' : 'false';
});

$('#about a').click(function(e) {
    e.preventDefault();
    gui.Shell.openExternal(this.href);
});

if (!isNaN(localStorage.serverPort)) {
    $('#port').val(localStorage.serverPort);
} else {
    $('#port').val(8080);
}

if (localStorage.hostname) {
    $('#hostname').val(localStorage.hostname);
} else {
    $('#hostname').val('localhost');
}

if(localStorage.serverAutostart === 'true'){
    document.getElementById('server-autostart').checked = true;

    setTimeout(function(){
        start();
    }, 100);
}

updateStatus();