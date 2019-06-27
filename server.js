'use strict';

var config = require('config');
var pathlib = require('path');
var express = require('express');
var app = express();
var flash = require('connect-flash');
var session = require('express-session');
var RedisStore = require('connect-redis')(session);
var routes = require('./lib/routes');
var cookieParser = require('cookie-parser');
var morgan = require('morgan');
var compression = require('compression');
var i18n = require('i18n-abide');
var http = require('http');
var tools = require('./lib/tools');
var db = require('./lib/db');
var st = require('st');
var log = require('npmlog');
var os = require('os');

// setup static cache
var mount = st({
    path: pathlib.join(__dirname, 'www', 'static'),
    url: '/',
    dot: false,
    index: false,
    passthrough: true,

    cache: {
        content: {
            max: 1024 * 1024 * 64
        }
    },

    gzip: false
});

app.disable('x-powered-by');

// Define path to EJS templates
app.set('views', pathlib.join(__dirname, 'www', 'views'));

// Set remote address for logging
app.use(function(req, res, next) {
    req.headers['x-client-remote-address'] = req.headers['x-forwarded-for'] ||  req.connection.remoteAddress;
    next();
});

// Use gzip compression
app.use(compression());

// if res.forceCharset is set, convert ecoding for output
app.use(require('./lib/forcecharset'));

// Define static content path
//app.use(express['static'](pathlib.join(__dirname, 'www', 'static')));
app.use(function(req, res, next) {
    mount(req, res, function() {
        next();
    });
});

// Parse cookies
app.use(cookieParser(config.session.secret));

// Parse POST requests
app.use(require('./lib/bodyparser'));
app.use(tools.checkEncoding);

app.use(session({
    store: new RedisStore({
        host: config.redis.host,
        db: config.redis.db,
        ttl: config.session.ttl
    }),
    secret: config.session.secret,
    saveUninitialized: false,
    resave: false
}));

app.use(i18n.abide({
    supported_languages: ['et', 'it-CH'],
    default_lang: 'et',
    debug_lang: 'it-CH',
    translation_directory: 'i18n',
    locale_on_url: true
}));

app.use(flash());

// Log requests to console
app.use(morgan(config.loggerInterface, {
    stream: {
        write: function(message) {
            message = (message || '').toString();
            if (message) {
                log.info('[' + process.pid + '] HTTP', message.replace('\n', '').trim());
            }
        }
    },
    skip: function(req, res) {
        // ignore ping requests
        if (res && req.query && req.query.monitor === 'true') {
            return true;
        }
        return false;
    }
}));

// Use EJS template engine
app.set('view engine', 'ejs');

// Use routes from routes.js
routes(app);

module.exports.status = 'not started';
module.exports.start = function(opts, callback) {
    if (!callback && typeof opts === 'function') {
        callback = opts;
        opts = undefined;
    }

    if (opts) {
        Object.keys(opts).forEach(function(key) {
            config[key] = opts[key];
        });
    }

    if (opts.pathOpenSSL && /^win/i.test(process.platform)) {
        require('pem').config({
            pathOpenSSL: opts.pathOpenSSL
        });
        process.env.OPENSSL_CONF = opts.pathOpenSSLConf;
        log.info('SSL', 'Using OpenSSL executable from <%s>', opts.pathOpenSSL);
    }

    if (!config.hostname) {
        if (config.port !== 80) {
            config.hostname = (os.hostname() || 'localhost') + ':' + config.port;
        } else {
            config.hostname = os.hostname() || 'localhost';
        }
    }

    app.set('port', config.port);
    module.exports.status = 'starting';

    db.init(function(err) {
        if (err) {
            log.err('[' + process.pid + '] DB', err);
            module.exports.status = 'error';
            return callback(err);
        }
        log.info('[' + process.pid + '] DB', 'Database opened');
        var serverapp = http.createServer(app);
        var returned = false;
        serverapp.on('error', function(err) {
            if (!returned) {
                callback(err);
                returned = true;
            }
        });
        serverapp.listen(app.get('port'), function(err) {
            if (err) {
                log.err('[' + process.pid + '] SERVER', err);
                log.err(err);
                module.exports.status = 'error';
                if (!returned) {
                    callback(err);
                    returned = true;
                }
                return;
            }
            log.info('[' + process.pid + '] SERVER', 'Web server running on port ' + app.get('port'));
            module.exports.status = 'started';
            module.exports.hostname = config.hostname;

            if (!returned) {
                callback(null, true);
                returned = true;
            }
        });
    });
};