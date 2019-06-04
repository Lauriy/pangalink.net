'use strict';

var config = require('config');
var log = require('npmlog');

// Force support for self-signed certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

log.info('[' + process.pid + '] SERVER', 'Starting server with Node.js v%s', process.versions.node);

// Handle error conditions
process.on('SIGTERM', function() {
    log.warn('[' + process.pid + '] PROCESS', 'Exited on SIGTERM');
    process.exit(0);
});

process.on('SIGINT', function() {
    log.warn('[' + process.pid + '] PROCESS', 'Exited on SIGINT');
    process.exit(0);
});

process.on('uncaughtException', function(err) {
    log.error('[' + process.pid + '] UNCAUGHT', err.stack);
    process.exit(1);
});

if (config.group) {
    try {
        process.setgid(config.group);
    } catch (E) {
        log.error('Init', 'Could not change group to %s, running as gid:%s', config.group, process.getgid());
    }
}

if (config.user) {
    try {
        process.setuid(config.user);
    } catch (E) {
        log.error('Init', 'Could not change user to %s, running as uid:%s', config.user, process.getuid());
    }
}

require('./server').start({}, function() {});