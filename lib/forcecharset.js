'use strict';

var encodinglib = require('encoding');
var onHeaders = require('on-headers');

module.exports = function(req, res, next) {
    // proxy

    var write = res.write;
    var end = res.end;
    var buffer;
    var bufferLen;

    res.write = function(chunk, encoding) {
        if (!buffer && !/^utf[\-_]?8$/i.test(res.forceCharset)) {
            buffer = [];
            bufferLen = 0;
        }

        if (!buffer) {
            write.call(res, chunk, encoding);
        } else {
            if (encoding && typeof chunk === 'string') {
                chunk = new Buffer(chunk, encoding);
            }
            buffer.push(chunk);
            bufferLen += chunk.length;
        }

        return true;
    };

    res.end = function (chunk, encoding) {
        if (chunk) {
            res.write(chunk, encoding);
        }

        if (buffer) {
            if (buffer == '') {
                buffer = [new Buffer([])];
            }
            var buf = Buffer.concat(buffer, [bufferLen]);
            var out = encodinglib.convert(buf, res.forceCharset);

            res.setHeader('Content-Length', out.length);

            if (res.forceCharset) {
                var type = res.getHeader('content-type').split(';').shift();
                res.setHeader('content-type', type + '; charset=' + res.forceCharset);
            }

            write.call(res, out, 'buffer');
        }
        return end.call(res);
    };

    onHeaders(res, function() {
        // head
        if (req.method === 'HEAD') {
            return;
        }

        if (!/^utf[\-_]?8$/i.test(res.forceCharset)) {
            buffer = [];
            bufferLen = 0;
        }
    });

    next();
};
