'use strict';

var config = require('config');
var path = require('path');
var fs = require('fs');
var Datastore = require('nedb');
var log = require('npmlog');

var db = {};

var databases = ['project', 'payment', 'counter'];

module.exports.init = function(callback) {
    var indexes = [{
        collection: 'project',
        data: {
            authorized: 1
        }
    }, {
        collection: 'project',
        data: {
            name: 1
        }
    }, {
        collection: 'project',
        data: {
            uid: 1
        }
    }, {
        collection: 'project',
        data: {
            created: -1
        }
    }, {
        collection: 'payment',
        data: {
            date: -1
        }
    }, {
        collection: 'payment',
        data: {
            project: 1
        }
    }];

    var ensureIndexes = function() {
        var index = indexes.shift();
        if (!index) {
            return callback(null, db);
        }
        db[index.collection].ensureIndex(index.data, ensureIndexes);
    };

    var dbc = 0;

    function ensureDatabases() {
        if (dbc >= databases.length) {
            return ensureIndexes();
        }
        var name = databases[dbc++];

        var filename = path.join(config.data, name + '.nedb');
        var stats;

        try {
            stats = fs.statSync(filename);
        } catch (E) {
            if (E.code === 'ENOENT') {
                try {
                    fs.writeFileSync(filename, '');
                } catch (E) {
                    log.error('DB', 'Could not write to database file at %s', filename);
                    log.error('DB', E);
                    process.exit(1);
                }
            } else {
                log.error('DB', 'Could not access database file at %s', filename);
                log.error('DB', E);
                process.exit(1);
            }
        }

        db[name] = new Datastore({
            filename: filename,
            autoload: true
        });
        db[name].persistence.setAutocompactionInterval(3600 * 1000);
        setImmediate(ensureDatabases);
    }

    ensureDatabases();
};

module.exports.save = function(collection, record, callback) {
    record = record || {};
    var id = record._id;

    if (!id) {
        db[collection].insert(record, function(err, record) {
            if (err) {
                return callback(err);
            }
            return callback(null, record && (id || record._id) || false);
        });
    } else {
        db[collection].update({
            _id: id
        }, record, {
            upsert: true
        }, function(err, record) {
            if (err) {
                return callback(err);
            }
            return callback(null, record && (id || record._id) || false);
        });
    }
};

module.exports.findOne = function(collection, query, callback) {
    db[collection].findOne(query, function(err, record) {
        if (err) {
            return callback(err);
        }
        callback(null, record || false);
    });
};

module.exports.count = function(collection, query, callback) {
    db[collection].count(query, function(err, count) {
        if (err) {
            return callback(err);
        }
        return callback(null, Number(count) || 0);
    });
};

module.exports.find = function(collection, query, fields, options, callback) {
    if (!callback && typeof options === 'function') {
        callback = options;
        options = undefined;
    }
    if (!callback && typeof fields === 'function') {
        callback = fields;
        fields = undefined;
    }
    options = options || {};

    db[collection].find(query).skip(options.skip || 0).limit(options.limit || 1000).exec(function(err, docs) {
        if (err) {
            return callback(err);
        }
        return callback(null, [].concat(docs || []));
    });
};

module.exports.remove = function(collection, query, callback) {
    db[collection].remove(query, {
        safe: true
    }, function(err, record) {
        if (err) {
            return callback(err);
        }
        callback(null, !!record);
    });
};