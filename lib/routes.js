'use strict';

var config = require('config');
var banklink = require('./banklink');
var db = require('./db');
var util = require('util');
var urllib = require('url');
var banks = require('./banks.json');
var tools = require('./tools');
var moment = require('moment');
var pem = require('pem');
var log = require('npmlog');
var packer = require('zip-stream');
var punycode = require('punycode');
var removeDiacritics = require('diacritics').remove;
var randomString = require('random-string');
var IBAN = require('iban');

moment.locale('et');

// Main router function
module.exports = function(app) {
    app.get('/', serveFront);
    app.post('/', serveFront);

    app.get('/info', serveInfo);

    app.get('/banklink/:version/:bank', banklink.serveBanklink);
    app.post('/banklink/:version/:bank', banklink.serveBanklink);

    app.get('/banklink/:bank', banklink.serveBanklink);
    app.post('/banklink/:bank', banklink.serveBanklink);

    app.get('/projects/:pageNumber', serveProjects);
    app.get('/projects', serveProjects);

    app.get('/add-project', serveAddProject);
    app.post('/add-project', handleAddProject);

    app.get('/edit-project/:project', serveEditProject);
    app.post('/edit-project', handleEditProject);

    app.get('/delete-project/:project', serveDeleteProject);

    app.get('/project/:project/example/render/:type.php', serveRenderedExamplePayment);
    app.get('/project/:project/example/:type.php', serveExamplePayment);
    app.get('/project/:project/regenerate', handleRegenerateProjectCertificate);
    app.get('/project/:project/:key([^.]+).pem', serveKey);
    app.get('/project/:project', serveProject);
    app.post('/project/:project', serveProject);
    app.get('/project/:project/page/:pageNumber', serveProject);
    app.get('/project/:project/page', serveProject);
    app.get('/project/:project/:tab', serveProject);

    app.get('/preview/:payment', banklink.servePaymentPreview);

    app.post('/final', servePaymentFinal);
    app.post('/final/:payment', servePaymentFinal);

    app.get('/payment/:payment/scripts/:direction([^.]+).php', servePayment);
    app.get('/payment/:payment', servePayment);

    app.get('/keys', serveKeys);
    app.post('/keys', handleKeys);

    app.get('/api', serveAPI);

    app.get('/api/banks', serveAPIListBanks);
    app.get('/api/project', serveAPIListProject);
    app.get('/api/project/:project', serveAPIGetProject);
    app.post('/api/project', serveAPIPostProject);
    app.delete('/api/project/:project', serveAPIDeleteProject);

    app.get('/docs/:name', serveDocs);
};

/**
 * Serves frontpage (/) of the website
 *
 * @param {Object} req HTTP Request object
 * @param {Object} req HTTP Response object
 */
function serveFront(req, res) {
    serve(req, res, {
        page: '/',
        values: {}
    });
}

function serveInfo(req, res) {
    serve(req, res, {
        page: '/info'
    });
}

function serveKeys(req, res) {
    serve(req, res, {
        page: '/keys'
    });
}

function serveAPI(req, res) {
    var hostname = (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, '');
    var apiHost = config.apiHost || hostname + '/api';

    db.find('project', {}, {}, {
        sort: [
            ['name', 'asc']
        ],
        limit: 10,
        skip: 0
    }, function(err, records) {
        serve(req, res, {
            page: '/api',
            values: {
                list: records || [],
                apiHost: apiHost,
                banks: banks
            }
        });
    });
}

function serveAddProject(req, res) {
    serve(req, res, {
        page: '/add-project',
        values: {
            name: req.query.name || '',
            description: req.query.description || '',
            keyBitsize: Number(req.query.keyBitsize) || 2048,
            soloAlgo: req.query.soloAlgo || '',
            soloAutoResponse: !!(req.query.soloAutoResponse || ''),
            ecUrl: req.query.ecUrl || '',
            ipizzaReceiverName: req.query.ipizzaReceiverName || '',
            ipizzaReceiverAccount: req.query.ipizzaReceiverAccount || '',
            id: req.query.id || '',
            action: 'add',
            bank: req.query.bank || '',
            banks: banks,
            validation: {}
        }
    });
}

function serveProjects(req, res) {
    var pageNumber = Number(req.params.pageNumber || req.query.pageNumber) || 1;

    db.count('project', {}, function(err, total) {

        var pageCount = Math.ceil(total / config.pagingCount);

        if (pageNumber > pageCount) {
            pageNumber = pageCount || 1;
        }

        var start_index = (pageNumber - 1) * config.pagingCount;

        db.find('project', {}, {}, {
            sort: [
                ['name', 'asc']
            ],
            limit: config.pagingCount,
            skip: start_index
        }, function(err, records) {
            if (err) {
                req.flash('error', err.message || err || req.gettext('Andmebaasi viga'));
                res.redirect('/' + req.lang + '/');
                return;
            }
            serve(req, res, {
                page: '/projects',
                values: {
                    start_index: start_index,
                    pageNumber: pageNumber,
                    pageCount: pageCount,
                    pagePath: '/projects',
                    banks: banks,
                    paging: tools.paging(pageNumber, pageCount),
                    projects: (records || []).map(function(project) {
                        project.formattedDate = project.updatedDate ? moment(project.updatedDate).calendar() : '';
                        return project;
                    })
                }
            });
        });

    });

}

function serveEditProject(req, res) {
    var id = (req.params.project || req.query.project || '').toString();

    if (!id.match(/^\w+$/)) {
        req.flash('error', req.gettext('Vigane makselahenduse identifikaator'));
        res.redirect('/' + req.lang + '/');
        return;
    }

    db.findOne('project', {
        _id: id
    }, function(err, record) {
        if (err) {
            req.flash('error', err.message || err || req.gettext('Andmebaasi viga'));
            res.redirect('/' + req.lang + '/');
            return;
        }
        if (!record) {
            req.flash('error', req.gettext('Sellise identifikaatoriga makselahendust ei leitud'));
            res.redirect('/' + req.lang + '/');
            return;
        }

        serve(req, res, {
            page: '/edit-project',
            values: {
                name: req.body.name || record.name || '',
                description: req.body.description || record.description || '',
                id: id,
                keyBitsize: Number(req.body.keyBitsize) || Number(record.keyBitsize) || 1024,
                soloAlgo: req.body.soloAlgo || record.soloAlgo || '',
                soloAutoResponse: !!(req.body.soloAutoResponse || record.soloAutoResponse || ''),
                ecUrl: req.body.ecUrl || record.ecUrl || '',
                ipizzaReceiverName: req.body.ipizzaReceiverName || record.ipizzaReceiverName || '',
                ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || record.ipizzaReceiverAccount || '',
                action: 'modify',
                userCertificate: record.userCertificate,
                bank: req.body.bank || record.bank || '',
                banks: banks,
                validation: {}
            }
        });
    });
}

function serveDeleteProject(req, res) {
    var id = (req.params.project || req.query.project || '').toString();

    if (!id.match(/^\w+$/)) {
        req.flash('error', req.gettext('Vigane makselahenduse identifikaator'));
        res.redirect('/' + req.lang + '/');
        return;
    }

    db.findOne('project', {
        _id: id
    }, function(err, record) {
        if (err) {
            req.flash('error', err.message || err || 'Andmebaasi viga');
            res.redirect('/' + req.lang + '/');
            return;
        }
        if (!record) {
            req.flash('error', req.gettext('Sellise identifikaatoriga makselahendust ei leitud'));
            res.redirect('/' + req.lang + '/');
            return;
        }

        db.remove('project', {
            _id: id
        }, function() {
            db.remove('payment', {
                project: id
            }, function() {
                req.flash('success', util.format(req.gettext('Makselahendus nimega "%s" on kustutatud'), record.name));
                res.redirect('/' + req.lang + '/projects');
                return;
            });
        });
    });
}

function serveProject(req, res) {
    var id = (req.params.project || req.query.project || '').toString(),
        pageNumber = Number(req.params.pageNumber || req.query.pageNumber) || 1;

    if (!id.match(/^\w+$/)) {
        req.flash('error', req.gettext('Vigane makselahenduse identifikaator'));
        res.redirect('/' + req.lang + '/');
        return;
    }

    db.findOne('project', {
        _id: id
    }, function(err, record) {
        if (err) {
            req.flash('error', err.message || err || req.gettext('Andmebaasi viga'));
            res.redirect('/' + req.lang + '/');
            return;
        }
        if (!record) {
            req.flash('error', req.gettext('Sellise identifikaatoriga makselahendust ei leitud'));
            res.redirect('/' + req.lang + '/');
            return;
        }

        db.count('payment', {
            project: id
        }, function(err, total) {

            var pageCount = Math.ceil(total / config.pagingCount);

            if (pageNumber > pageCount) {
                pageNumber = pageCount || 1;
            }

            var start_index = (pageNumber - 1) * config.pagingCount;

            db.find('payment', {
                project: id
            }, {}, {
                sort: [
                    ['date', 'desc']
                ],
                limit: config.pagingCount,
                skip: start_index
            }, function(err, records) {
                if (err) {
                    req.flash('error', err.message || err || req.gettext('Andmebaasi viga'));
                    res.redirect('/' + req.lang + '/');
                    return;
                }

                serve(req, res, {
                    page: '/project',
                    values: {
                        project: record,
                        banks: banks,
                        tab: req.params.tab || 'payments',
                        id: id,

                        start_index: start_index,
                        pageNumber: pageNumber,
                        pageCount: pageCount,
                        pagePath: '/project/' + id + '/page',
                        paging: tools.paging(pageNumber, pageCount),
                        payments: (records || []).map(function(payment) {
                            payment.date = moment(payment.date).calendar();
                            payment.amount = tools.formatCurrency(payment.amount, payment.currency || 'EUR');
                            payment.typeName = ({
                                'PAYMENT': req.gettext('Maksekorraldus'),
                                'IDENTIFICATION': req.gettext('Autentimine')
                            })[payment.type] || '';
                            return payment;
                        }),
                        languages: tools.languageNames,
                        countries: tools.countryCodes,
                        labels: tools.processLabels
                    }
                });
            });
        });
    });
}

function servePayment(req, res) {
    var id = (req.params.payment || req.query.payment || '').toString();

    if (!id.match(/^\w+$/)) {
        req.flash('error', req.gettext('Vigane maksekorralduse identifikaator'));
        res.redirect('/' + req.lang + '/');
        return;
    }

    db.findOne('payment', {
        _id: id
    }, function(err, payment) {
        if (err) {
            req.flash('error', err.message || err || req.gettext('Andmebaasi viga'));
            res.redirect('/' + req.lang + '/');
            return;
        }
        if (!payment) {
            req.flash('error', req.gettext('Sellise identifikaatoriga maksekorraldust ei leitud'));
            res.redirect('/' + req.lang + '/');
            return;
        }

        db.findOne('project', {
            _id: payment.project
        }, function(err, project) {
            if (err) {
                req.flash('error', err.message || err || req.gettext('Andmebaasi viga'));
                res.redirect('/' + req.lang + '/');
                return;
            }
            if (!project) {
                req.flash('error', req.gettext('Sellise identifikaatoriga makselahendust ei leitud'));
                res.redirect('/' + req.lang + '/');
                return;
            }

            if (['pay', 'receive'].indexOf(req.params.direction) >= 0) {

                payment.isAuth = payment.type === 'IDENTIFICATION';

                tools.getCounter('total', function(err, paymentCounter) {

                    res.forceCharset = payment.charset;
                    res.set('Content-Description', 'File Transfer');
                    res.set('content-type', 'text/plain; charset=' + payment.forceCharset);
                    res.set('Content-Disposition', util.format('attachment; filename="%s"', req.params.direction + '.php'));
                    res.render('scripts/' + req.params.direction + '.' + payment.bank + '.ejs', {
                        title: config.title || (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:\d+$/, '').toLowerCase().replace(/^./, function(s) {
                            return s.toUpperCase();
                        }),
                        proto: config.proto || 'http',
                        hostname: (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, ''),
                        payment: payment,
                        project: project,
                        bank: banks[project.bank || 'ipizza'] || banks.ipizza,
                        signatureOrder: banklink.signatureOrder(payment.bank),
                        googleAnalyticsID: config.googleAnalyticsID,
                        paymentCounter: paymentCounter || 0
                    });

                });
            } else {
                serve(req, res, {
                    page: '/payment',
                    values: {
                        payment: payment,
                        project: project,
                        bank: banks[project.bank],

                        inspect: util.inspect.bind(util),

                        host: urllib.parse(payment.state === 'PAYED' ? payment.successTarget : (payment.state === 'REJECTED' ? payment.rejectTarget : payment.cancelTarget)).host,

                        date: moment(payment.date).calendar(),
                        amount: tools.formatCurrency(payment.amount, payment.currency || 'EUR'),
                        typeName: ({
                            'PAYMENT': req.gettext('Maksekorraldus'),
                            'IDENTIFICATION': req.gettext('Autentimine')
                        })[payment.type] || '',

                        languages: tools.languageNames,
                        countries: tools.countryCodes,
                        labels: tools.processLabels
                    }
                });
            }
        });
    });
}

function serveRenderedExamplePayment(req, res) {
    req.renderHTML = true;
    serveExamplePayment(req, res);
}

function serveExamplePayment(req, res) {
    var id = (req.params.project || req.query.project || '').toString();

    if (['auth', 'pay'].indexOf(req.params.type) < 0) {
        req.flash('error', req.gettext('Tundmatu rakendus'));
        res.redirect('/' + req.lang + '/');
        return;
    }

    if (!id.match(/^\w+$/)) {
        req.flash('error', req.gettext('Vigane makselahenduse identifikaator'));
        res.redirect('/' + req.lang + '/');
        return;
    }

    var urlPrefix = (config.proto || 'http') + '://' + (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, '');
    var isAuth = req.params.type === 'auth';

    banklink.samplePayment(id, urlPrefix, isAuth, req.query, function(err, paymentObj, charset) {
        if (err) {
            req.flash('error', err.message);
            res.redirect('/' + req.lang + '/');
            return;
        }

        var payment = {
                charset: charset,
                bank: paymentObj.bank.type,
                fields: Object.keys(paymentObj.fields).map(function(key) {
                    return {
                        key: key,
                        value: paymentObj.fields[key]
                    };
                }),
                isAuth: paymentObj.isAuth,
                editable: paymentObj.editable
            },
            project = paymentObj.record;

        res.charset = payment.charset;
        res.forceCharset = payment.charset;

        if (!req.renderHTML) {
            res.set('Content-Description', 'File Transfer');
            res.set('content-type', 'text/plain; charset=' + res.forceCharset);
            res.set('Content-Disposition', util.format('attachment; filename="%s"', isAuth ? 'auth.php' : 'pay.php'));
        } else {
            res.set('content-type', 'text/html; charset=' + res.forceCharset);
        }

        tools.getCounter('total', function(err, paymentCounter) {

            res.render('scripts/' + (req.renderHTML ? 'rendered.pay' : 'pay.' + payment.bank) + '.ejs', {
                title: config.title || (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:\d+$/, '').toLowerCase().replace(/^./, function(s) {
                    return s.toUpperCase();
                }),
                proto: config.proto || 'http',
                hostname: (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, ''),
                payment: payment,
                project: project,
                queryString: urllib.parse(req.originalUrl).search || '',
                query: req.query || {},
                bank: banks[project.bank || 'ipizza'] || banks.ipizza,
                signatureOrder: banklink.signatureOrder(payment.bank),
                googleAnalyticsID: config.googleAnalyticsID,
                paymentCounter: paymentCounter || 0
            });

        });
    });
}

function handleKeys(req, res) {
    Object.keys(req.body).forEach(function(key) {
        req.body[key] = req.body[key].trim();

        if (key === 'commonName') {
            req.body[key] = punycode.toASCII(req.body[key].replace(/^https?:\/+/i, '').split('/').shift().toLowerCase().trim());
        }

        if (key === 'hash') {
            if (['sha1', 'md5', 'sha256'].indexOf(req.body[key].toLowerCase()) < 0) {
                req.body[key] = 'sha1';
            }
        }

        if (key === 'keyBitsize') {
            req.body[key] = Number(req.body[key].trim()) || 1024;
            if ([1024, 2048, 4096].indexOf(req.body[key]) < 0) {
                req.body[key] = 1024;
            }
        }

        if (key === 'emailAddress') {
            req.body[key] = req.body[key].replace(/@(.*)$/, function(o, domain) {
                return '@' + punycode.toASCII(domain.split('/').shift().toLowerCase().trim());
            });
        }

        if (typeof req.body[key] === 'string') {
            req.body[key] = removeDiacritics(req.body[key]);
        }

    });

    pem.createCSR(req.body, function(err, keys) {
        if (err) {
            req.flash('error', err && err.message || err);
            serve(req, res, {
                page: '/keys'
            });
            return;
        }

        var archive = new packer({
                comment: 'Generated by ' + config.proto + '://' + config.hostname
            }),
            chunks = [];

        archive.on('error', function(err) {
            req.flash('error', err && err.message || err);
            serve(req, res, {
                page: '/keys'
            });
        });

        archive.on('data', function(chunk) {
            if (chunk && chunk.length) {
                chunks.push(chunk);
            }
            return true;
        });

        archive.on('end', function(chunk) {
            if (chunk && chunk.length) {
                chunks.push(chunk);
            }

            res.status(200);
            res.set('Content-Description', 'File Transfer');
            res.set('Content-Type', 'application/octet-stream');
            res.set('Content-Disposition', util.format('attachment; filename="%s"', 'banklink.zip'));

            res.send(Buffer.concat(chunks));
        });

        archive.entry(keys.clientKey, {
            name: 'private_key.pem'
        }, function(err) {
            if (err) {
                req.flash('error', err && err.message || err);
                serve(req, res, {
                    page: '/keys'
                });
                return;
            }

            archive.entry(keys.csr, {
                name: 'csr.pem'
            }, function(err) {
                if (err) {
                    req.flash('error', err && err.message || err);
                    serve(req, res, {
                        page: '/keys'
                    });
                    return;
                }

                archive.finish();
            });
        });
    });
}

function handleAddProject(req, res) {
    var validationErrors = {},
        error = false;

    req.body.id = (req.body.id || '').toString().trim();
    req.body.name = (req.body.name || '').toString().trim();
    req.body.description = (req.body.description || '').toString().trim();
    req.body.bank = (req.body.bank || '').toString().trim();

    req.body.keyBitsize = Number(req.body.keyBitsize) || 1024;

    req.body.soloAlgo = (req.body.soloAlgo || '').toString().toLowerCase().trim();
    req.body.soloAutoResponse = !!((req.body.soloAutoResponse || '').toString().trim());

    req.body.ecUrl = (req.body.ecUrl || '').toString().trim();

    req.body.ipizzaReceiverName = (req.body.ipizzaReceiverName || '').toString().trim();
    req.body.ipizzaReceiverAccount = (req.body.ipizzaReceiverAccount || '').toString().trim();

    if (!req.body.name) {
        error = true;
        validationErrors.name = req.gettext('Makselahenduse nimetuse täitmine on kohustuslik');
    }

    if (!banks[req.body.bank]) {
        error = true;
        validationErrors.bank = req.gettext('Panga tüüp on valimata');
    }

    if (req.body.keyBitsize && [1024, 2048, 4096].indexOf(req.body.keyBitsize) < 0) {
        error = true;
        validationErrors.keyBitsize = req.gettext('Vigane võtme pikkus');
    }

    if (['nordea', 'tapiola', 'alandsbanken', 'handelsbanken', 'aktiasppop'].indexOf(req.body.bank) >= 0 && (!req.body.soloAlgo || ['md5', 'sha1', 'sha256'].indexOf(req.body.soloAlgo) < 0)) {
        error = true;
        validationErrors.soloAlgo = req.gettext('Vigane algoritm');
    }

    if (req.body.bank === 'ec' && (!req.body.ecUrl || !tools.validateUrl(req.body.ecUrl))) {
        error = true;
        validationErrors.ecUrl = req.gettext('Vigane tagasisuunamise aadress, peab olema korrektne URL');
    }

    if (req.body.ipizzaReceiverAccount && !IBAN.isValid(req.body.ipizzaReceiverAccount)) {
        error = true;
        validationErrors.ipizzaReceiverAccount = req.gettext('Saaja konto peab olema IBAN formaadis');
    }

    if (['nordea', 'tapiola', 'alandsbanken', 'handelsbanken', 'aktiasppop'].indexOf(req.body.bank) < 0) {
        req.body.soloAlgo = '';
        req.body.soloAutoReturn = '';
    }

    if (req.body.bank !== 'ec') {
        req.body.ecUrl = '';
    }

    if (error) {
        req.flash('error', req.gettext('Andmete valideerimisel ilmnesid vead'));
        serve(req, res, {
            page: '/add-project',
            values: {
                name: req.body.name || '',
                description: req.body.description || '',
                keyBitsize: Number(req.body.keyBitsize) || 1024,
                soloAlgo: req.body.soloAlgo || '',
                soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                ecUrl: req.body.ecUrl || '',
                ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                id: req.body.id || '',
                action: 'add',
                bank: req.body.bank || '',
                banks: banks,
                validation: validationErrors
            }
        });
        return;
    }

    tools.generateKeys(20 * 365, Number(req.body.keyBitsize) || 1024, function(err, userCertificate, bankCertificate) {
        if (err) {
            log.error('SSL', err.message);
            req.flash('error', req.gettext('Sertifikaadi genereerimisel tekkis viga'));
            serve(req, res, {
                page: '/add-project',
                values: {
                    name: req.body.name || '',
                    description: req.body.description || '',
                    id: req.body.id || '',
                    keyBitsize: Number(req.body.keyBitsize) || 1024,
                    soloAlgo: req.body.soloAlgo || '',
                    soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                    bank: req.body.bank || '',
                    banks: banks,
                    ecUrl: req.body.ecUrl || '',
                    ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                    ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                    action: 'add',
                    validation: validationErrors
                }
            });
            return;
        }

        var project = {
            name: req.body.name,
            description: req.body.description,
            keyBitsize: req.body.keyBitsize,
            soloAlgo: req.body.soloAlgo,
            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
            bank: req.body.bank,
            ecUrl: req.body.ecUrl,
            ipizzaReceiverName: req.body.ipizzaReceiverName,
            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount,
            created: new Date(),
            userCertificate: userCertificate,
            bankCertificate: bankCertificate,
            secret: randomString({
                length: 32
            })
        };

        tools.incrIdCounter(function(err, id) {
            if (err) {
                req.flash('error', req.gettext('Andmebaasi viga'));
                serve(req, res, {
                    page: '/add-project',
                    values: {
                        name: req.body.name || '',
                        description: req.body.description || '',
                        id: req.body.id || '',
                        keyBitsize: Number(req.body.keyBitsize) || 1024,
                        soloAlgo: req.body.soloAlgo || '',
                        soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                        bank: req.body.bank || '',
                        banks: banks,
                        ecUrl: req.body.ecUrl || '',
                        ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                        ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                        action: 'add',
                        validation: validationErrors
                    }
                });
                return;
            }

            if (['nordea', 'tapiola', 'alandsbanken', 'handelsbanken', 'aktiasppop'].indexOf(req.body.bank) >= 0) {
                project.uid = (10000000 + Number(tools.getReferenceCode(id))).toString();
            } else {
                project.uid = 'uid' + tools.getReferenceCode(id);
            }

            db.save('project', project, function(err, id) {
                if (err) {
                    req.flash('error', req.gettext('Andmebaasi viga'));
                    serve(req, res, {
                        page: '/add-project',
                        values: {
                            name: req.body.name || '',
                            description: req.body.description || '',
                            id: req.body.id || '',
                            keyBitsize: Number(req.body.keyBitsize) || 1024,
                            soloAlgo: req.body.soloAlgo || '',
                            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                            bank: req.body.bank || '',
                            banks: banks,
                            ecUrl: req.body.ecUrl || '',
                            ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                            action: 'add',
                            validation: validationErrors
                        }
                    });
                    return;
                }
                if (id) {
                    req.flash('success', req.gettext('Makselahendus on loodud'));
                    res.redirect('/' + req.lang + '/project/' + id.toString() + '/certs');
                } else {
                    req.flash('error', req.gettext('Makselahenduse loomine ebaõnnestus'));
                    serve(req, res, {
                        page: '/add-project',
                        values: {
                            name: req.body.name || '',
                            description: req.body.description || '',
                            id: req.body.id || '',
                            keyBitsize: Number(req.body.soloAlgo) || 1024,
                            soloAlgo: req.body.soloAlgo || '',
                            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                            bank: req.body.bank || '',
                            banks: banks,
                            ecUrl: req.body.ecUrl || '',
                            ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                            action: 'add',
                            validation: validationErrors
                        }
                    });
                    return;
                }
            });
        });
    });
}

function handleEditProject(req, res) {
    var validationErrors = {},
        error = false;

    req.body.id = (req.body.id || '').toString().trim();
    req.body.name = (req.body.name || '').toString().trim();
    req.body.description = (req.body.description || '').toString().trim();

    req.body.keyBitsize = Number(req.body.keyBitsize) || 1024;

    req.body.soloAlgo = (req.body.soloAlgo || '').toString().toLowerCase().trim();
    req.body.soloAutoResponse = !!((req.body.soloAutoResponse || '').toString().trim());

    req.body.ecUrl = (req.body.ecUrl || '').toString().trim();

    req.body.ipizzaReceiverName = (req.body.ipizzaReceiverName || '').toString().trim();
    req.body.ipizzaReceiverAccount = (req.body.ipizzaReceiverAccount || '').toString().trim();

    if (!req.body.id.match(/^\w+$/)) {
        req.flash('error', req.gettext('Vigane makselahenduse identifikaator'));
        res.redirect('/' + req.lang + '/');
        return;
    }

    if (!req.body.name) {
        error = true;
        validationErrors.name = req.gettext('Makselahenduse nimetuse täitmine on kohustuslik');
    }

    db.findOne('project', {
        _id: req.body.id
    }, function(err, record) {
        if (err) {
            req.flash('error', err.message || err || req.gettext('Andmebaasi viga'));
            res.redirect('/' + req.lang + '/');
            return;
        }
        if (!record) {
            req.flash('error', req.gettext('Sellise identifikaatoriga makselahendust ei leitud'));
            res.redirect('/' + req.lang + '/');
            return;
        }
        if (req.body.keyBitsize && [1024, 2048, 4096].indexOf(req.body.keyBitsize) < 0) {
            error = true;
            validationErrors.keyBitsize = req.gettext('Vigane võtme pikkus');
        }

        if (record.bank === 'nordea' && (!req.body.soloAlgo || ['md5', 'sha1', 'sha256'].indexOf(req.body.soloAlgo) < 0)) {
            error = true;
            validationErrors.soloAlgo = req.gettext('Vigane algoritm');
        }

        if (record.bank === 'ec' && (!req.body.ecUrl || !tools.validateUrl(req.body.ecUrl))) {
            error = true;
            validationErrors.ecUrl = req.gettext('Vigane tagasisuunamise aadress, peab olema korrektne URL');
        }

        if (req.body.ipizzaReceiverAccount && req.body.ipizzaReceiverAccount !== record.ipizzaReceiverAccount && !IBAN.isValid(req.body.ipizzaReceiverAccount)) {
            error = true;
            validationErrors.ipizzaReceiverAccount = req.gettext('Saaja konto peab olema IBAN formaadis');
        }

        if (record.bank !== 'nordea') {
            req.body.soloAlgo = '';
            req.body.soloAutoResponse = '';
        }

        if (record.bank !== 'ec') {
            req.body.ecUrl = '';
        }

        if (error) {
            req.flash('error', req.gettext('Andmete valideerimisel ilmnesid vead'));
            serve(req, res, {
                page: '/edit-project',
                values: {
                    name: req.body.name || '',
                    description: req.body.description || '',
                    id: req.body.id || '',
                    keyBitsize: Number(req.body.keyBitsize) || 1024,
                    soloAlgo: req.body.soloAlgo || '',
                    soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                    ecUrl: req.body.ecUrl || '',
                    ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                    ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                    action: 'modify',
                    bank: req.body.bank || '',
                    banks: banks,
                    userCertificate: record.userCertificate,
                    validation: validationErrors
                }
            });
            return;
        }

        tools.generateKeys(20 * 365, Number(req.body.keyBitsize) || 1024, function(err, userCertificate, bankCertificate) {
            if (err && req.body.regenerate) {
                req.flash('error', req.gettext('Sertifikaadi genereerimisel tekkis viga'));
                serve(req, res, {
                    page: '/edit-project',
                    values: {
                        name: req.body.name || '',
                        description: req.body.description || '',
                        id: req.body.id || '',
                        keyBitsize: Number(req.body.keyBitsize) || 1024,
                        soloAlgo: req.body.soloAlgo || '',
                        soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                        ecUrl: req.body.ecUrl || '',
                        ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                        ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                        action: 'modify',
                        bank: req.body.bank || '',
                        banks: banks,
                        userCertificate: record.userCertificate,
                        validation: validationErrors
                    }
                });
                return;
            }

            record.name = req.body.name;
            record.description = req.body.description;
            record.updated = new Date();
            record.keyBitsize = Number(req.body.keyBitsize) || 1024;
            record.soloAlgo = req.body.soloAlgo || '';
            record.soloAutoResponse = !!(req.body.soloAutoResponse || '');

            record.ecUrl = req.body.ecUrl || '';
            record.ipizzaReceiverName = req.body.ipizzaReceiverName || '';
            record.ipizzaReceiverAccount = req.body.ipizzaReceiverAccount || '';

            if (req.body.regenerate) {
                record.userCertificate = userCertificate;
                record.bankCertificate = bankCertificate;
                record.secret = randomString({
                    length: 32
                });
            }

            db.save('project', record, function(err, id) {
                if (err) {
                    req.flash('error', req.gettext('Andmebaasi viga'));
                    serve(req, res, {
                        page: '/edit-project',
                        values: {
                            name: req.body.name || '',
                            description: req.body.description || '',
                            id: req.body.id || '',
                            keyBitsize: Number(req.body.keyBitsize) || 1024,
                            soloAlgo: req.body.soloAlgo || '',
                            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                            ecUrl: req.body.ecUrl || '',
                            ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                            action: 'modify',
                            bank: req.body.bank || '',
                            banks: banks,
                            userCertificate: record.userCertificate,
                            validation: validationErrors
                        }
                    });
                    return;
                }
                if (id) {
                    req.flash('success', req.gettext('Makselahenduse andmed on uuendatud'));
                    if (req.body.regenerate) {
                        req.flash('success', req.gettext('Genereeriti uus sertifikaat'));
                    }
                    res.redirect('/' + req.lang + '/project/' + id.toString() + '/certs');
                } else {
                    req.flash('error', req.gettext('Makselahenduse andmete uuendamine ebaõnnestus'));
                    serve(req, res, {
                        page: '/edit-project',
                        values: {
                            name: req.body.name || '',
                            description: req.body.description || '',
                            id: req.body.id || '',
                            keyBitsize: Number(req.body.keyBitsize) || 1024,
                            soloAlgo: req.body.soloAlgo || '',
                            soloAutoResponse: !!(req.body.soloAutoResponse || ''),
                            ecUrl: req.body.ecUrl || '',
                            ipizzaReceiverName: req.body.ipizzaReceiverName || '',
                            ipizzaReceiverAccount: req.body.ipizzaReceiverAccount || '',
                            action: 'modify',
                            bank: req.body.bank || '',
                            banks: banks,
                            userCertificate: record.userCertificate,
                            validation: validationErrors
                        }
                    });
                    return;
                }
            });
        });
    });
}

function serveKey(req, res) {
    var id = (req.params.project || '').toString().trim();

    if (!id.match(/^\w+$/)) {
        req.flash('error', req.gettext('Vigane makselahenduse identifikaator'));
        res.redirect('/' + req.lang + '/');
        return;
    }

    db.findOne('project', {
        _id: id
    }, function(err, record) {
        if (err) {
            req.flash('error', err.message || err || req.gettext('Andmebaasi viga'));
            res.redirect('/' + req.lang + '/');
            return;
        }
        if (!record) {
            req.flash('error', req.gettext('Sellise identifikaatoriga makselahendust ei leitud'));
            res.redirect('/' + req.lang + '/');
            return;
        }

        var filename = req.params.key + '.pem',
            certificate;

        switch (req.params.key) {
            case 'user_key':
                certificate = record.userCertificate.clientKey;
                break;
            case 'user_cert':
                certificate = record.userCertificate.certificate;
                break;
            case 'bank_key':
                certificate = record.bankCertificate.clientKey;
                break;
            case 'bank_cert':
                certificate = record.bankCertificate.certificate;
                break;
            default:
                req.flash('error', req.gettext('Sellist võtmefaili ei leitud'));
                res.redirect('/' + req.lang + '/project/' + req.params.project + '/certs');
                return;
        }

        res.status(200);
        res.set('Content-Description', 'File Transfer');
        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Disposition', util.format('attachment; filename="%s"', filename));

        res.send(certificate);
    });
}

function handleRegenerateProjectCertificate(req, res) {
    var id = (req.params.project || '').toString().trim();

    if (!id.match(/^\w+$/)) {
        req.flash('error', req.gettext('Vigane makselahenduse identifikaator'));
        res.redirect('/' + req.lang + '/');
        return;
    }

    db.findOne('project', {
        _id: id
    }, function(err, record) {
        if (err) {
            req.flash('error', err.message || err || req.gettext('Andmebaasi viga'));
            res.redirect('/' + req.lang + '/');
            return;
        }
        if (!record) {
            req.flash('error', req.gettext('Sellise identifikaatoriga makselahendust ei leitud'));
            res.redirect('/' + req.lang + '/');
            return;
        }

        tools.generateKeys(20 * 365, record.keyBitsize || 1024, function(err, userCertificate, bankCertificate) {
            if (err) {
                req.flash('error', req.gettext('Sertifikaadi genereerimisel tekkis viga'));
                res.redirect('/' + req.lang + '/project/' + id.toString() + '/certs');
                return;
            }

            record.userCertificate = userCertificate;
            record.bankCertificate = bankCertificate;
            record.secret = randomString({
                length: 32
            });

            db.save('project', record, function(err, id) {
                if (err) {
                    req.flash('error', req.gettext('Andmebaasi viga'));
                    res.redirect('/' + req.lang + '/project/' + id.toString() + '/certs');
                    return;
                }

                if (id) {
                    req.flash('success', req.gettext('Genereeriti uus sertifikaat'));
                    res.redirect('/' + req.lang + '/project/' + id.toString() + '/certs');
                } else {
                    req.flash('error', req.gettext('Makselahenduse andmete uuendamine ebaõnnestus'));
                    res.redirect('/' + req.lang + '/project/' + id.toString() + '/certs');
                    return;
                }
            });
        });
    });
}

function servePaymentFinal(req, res) {
    var id = (req.params.payment || req.body.payment || req.query.payment || '').toString();

    if (!id.match(/^\w+$/)) {
        req.flash('error', req.gettext('Vigane maksekorralduse identifikaator'));
        res.redirect('/' + req.lang + '/');
        return;
    }

    banklink.makePayment(id, req.body, function(err, data) {
        if (err) {
            req.flash('error', err.message || err);
            res.redirect(err.redirectUrl || '/');
            return;
        }

        res.forceCharset = data.forceCharset;
        res.set('content-type', 'text/html; charset=' + res.forceCharset);

        data.title = config.title || (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:\d+$/, '').toLowerCase().replace(/^./, function(s) {
            return s.toUpperCase();
        });
        data.proto = config.proto || 'http';
        data.hostname = config.hostname || (req && req.headers && req.headers.host) || 'localhost';
        data.googleAnalyticsID = config.googleAnalyticsID;

        tools.getCounter('total', function(err, paymentCounter) {
            data.paymentCounter = paymentCounter || 0;
            res.render('banklink/final', data);
        });
    });
}

function serveDocs(req, res) {
    tools.renderDocs(req.params.name, function(err, content) {
        if (err) {
            req.flash('error', err.message || err || req.gettext('Dokumentatsiooni viga'));
            res.redirect('/' + req.lang + '/');
            return;
        }
        serve(req, res, {
            page: '/docs',
            values: {
                content: content
            }
        });
    });
}

function serve(req, res, options) {
    if (typeof options === 'string') {
        options = {
            page: options
        };
    }

    options = options || {};
    options.status = options.status || 200;
    options.contentType = options.contentType || 'text/html';
    options.page = options.page || '/';
    options.title = options.title || false;

    tools.getCounter('total', function(err, paymentCounter) {
        var defaultValues = {
                title: config.title || (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:\d+$/, '').toLowerCase().replace(/^./, function(s) {
                    return s.toUpperCase();
                }),
                proto: config.proto || 'http',
                hostname: (config.hostname || (req && req.headers && req.headers.host) || 'localhost').replace(/:(80|443)$/, ''),
                messages: {
                    success: req.flash('success'),
                    error: req.flash('error'),
                    info: req.flash('info')
                },
                pageTitle: options.title,
                page: options.page,
                googleAnalyticsID: config.googleAnalyticsID,
                paymentCounter: paymentCounter || 0
            },
            localValues = options.values || {};

        Object.keys(defaultValues).forEach(function(key) {
            if (!(key in localValues)) {
                localValues[key] = defaultValues[key];
            }
        });

        res.status(options.status);
        res.set('Content-Type', options.contentType);
        res.render('index', localValues);
    });
}

// API related functions

function apiResponse(req, res, err, data) {
    var response = {};

    if (err) {
        response.success = false;
        response.error = err.message || err;

        if (err.fields) {
            response.fields = err.fields;
        }
    } else {
        response.success = true;
        response.data = data;
    }

    res.status(200);
    res.set('Content-Type', 'application/json; charset=utf-8');

    res.end(JSON.stringify(response, null, '    ') + '\n');
}

function serveAPIListBanks(req, res) {
    apiResponse(req, res, false, Object.keys(banks).sort().map(function(bank) {
        return {
            type: bank,
            name: banks[bank].name
        };
    }));
}

function serveAPIListProject(req, res) {
    var start = Number((req.query.start_index || '0').toString().trim()) || 0;

    apiActionList(req, start, function(err, list) {
        if (err) {
            return apiResponse(req, res, err);
        }
        apiResponse(req, res, false, list);
    });
}

function serveAPIGetProject(req, res) {
    var projectId = (req.params.project || '').toString().trim();

    apiActionGet(req, projectId, function(err, project) {
        if (err) {
            return apiResponse(req, res, err);
        }
        apiResponse(req, res, false, project);
    });
}

function serveAPIPostProject(req, res) {
    var project;

    try {
        project = JSON.parse(req.rawBody.toString('utf-8'));
    } catch (E) {
        return apiResponse(req, res, new Error(req.gettext('Vigane sisend')));
    }

    apiActionPost(req, project, function(err, projectId) {
        if (err) {
            return apiResponse(req, res, err);
        }
        apiActionGet(req, projectId, function(err, project) {
            if (err) {
                return apiResponse(req, res, err);
            }
            apiResponse(req, res, false, project);
        });
    });
}

function serveAPIDeleteProject(req, res) {
    var projectId = (req.params.project || '').toString().trim();

    apiActionDelete(req, projectId, function(err, deleted) {
        if (err) {
            return apiResponse(req, res, err);
        }
        apiResponse(req, res, false, deleted);
    });
}

function apiActionGet(req, projectId, callback) {

    projectId = (projectId || '').toString().trim();

    if (!projectId.match(/^\w+$/)) {
        return callback(new Error(req.gettext('Vigane makselahenduse identifikaator')));
    }

    db.findOne('project', {
        _id: projectId
    }, function(err, project) {
        var responseObject = {};
        if (err) {
            return callback(err || new Error(req.gettext('Andmebaasi viga')));
        }

        if (!project) {
            return callback(new Error(req.gettext('Sellise identifikaatoriga makselahendust ei leitud')));
        }

        responseObject.id = project._id.toString();
        responseObject.client_id = project.uid.toString();
        responseObject.payment_url = 'https://' + config.hostname + '/banklink/' + project.bank;
        responseObject.type = project.bank;
        responseObject.name = project.name || undefined;
        responseObject.description = project.description || undefined;

        if (banks[project.bank].type === 'ipizza') {
            responseObject.account_owner = project.ipizzaReceiverName || undefined;
            responseObject.account_nr = project.ipizzaReceiverAccount || undefined;
        }

        if (['ipizza', 'ec'].indexOf(banks[project.bank].type) >= 0) {
            responseObject.key_size = project.keyBitsize || undefined;
            responseObject.private_key = project.userCertificate.clientKey;
            responseObject.bank_certificate = project.bankCertificate.certificate;
        }

        if (banks[project.bank].type === 'ec') {
            responseObject.return_url = project.ecUrl || undefined;
        }

        if (banks[project.bank].type === 'solo') {
            responseObject.mac_key = project.secret || undefined;
            responseObject.algo = project.soloAlgo || undefined;
            responseObject.auto_response = !!project.soloAutoResponse;
        }

        if (['aab', 'samlink'].indexOf(banks[project.bank].type) >= 0) {
            responseObject.mac_key = project.secret || undefined;
            responseObject.algo = project.soloAlgo || 'md5';
        }

        return callback(null, responseObject);
    });
}

function apiActionList(req, start, callback) {

    start = start || 0;

    db.count('project', {}, function(err, total) {
        if (start > total) {
            start = Math.floor(total / 20) * 20;
        }
        if (start < 0) {
            start = 0;
        }
        db.find('project', {}, {
            _id: true,
            name: true,
            bank: true
        }, {
            sort: [
                ['created', 'desc']
            ],
            limit: 20,
            skip: start
        }, function(err, records) {
            if (err) {
                return callback(err);
            }

            var list = [].concat(records || []).map(function(record) {
                return {
                    id: record._id.toString(),
                    name: record.name || undefined,
                    type: record.bank
                };
            });

            callback(null, {
                total: total,
                start_index: start,
                end_index: start + list.length - 1,
                list: list
            });
        });
    });



}


function apiActionPost(req, project, callback) {

    var validationErrors = {};
    var error = false;

    project.type = (project.type || '').toString().trim();
    project.name = (project.name || '').toString().trim();
    project.description = (project.description || '').toString().trim();

    project.account_owner = (project.account_owner || '').toString().trim();
    project.account_nr = (project.account_nr || '').toString().trim();

    project.key_size = Number(project.key_size) || 1024;

    project.return_url = (project.return_url || '').toString().trim();

    project.algo = (project.algo || '').toString().toLowerCase().trim();
    if (typeof project.auto_response === 'string') {
        project.auto_response = (project.auto_response.toLowerCase().trim() === 'true');
    } else {
        project.auto_response = !!project.auto_response;
    }

    if (!project.name) {
        error = true;
        validationErrors.name = req.gettext('Makselahenduse nimetuse täitmine on kohustuslik');
    }

    if (!banks[project.type]) {
        error = true;
        validationErrors.type = req.gettext('Panga tüüp on valimata');
    }

    if (project.key_size && [1024, 2048, 4096].indexOf(project.key_size) < 0) {
        error = true;
        validationErrors.key_size = req.gettext('Vigane võtme pikkus');
    }

    if (project.type === 'nordea' && (!project.algo || ['md5', 'sha1', 'sha256'].indexOf(project.algo) < 0)) {
        error = true;
        validationErrors.algo = req.gettext('Vigane algoritm');
    }

    if (project.type === 'ec' && (!project.return_url || !tools.validateUrl(project.return_url))) {
        error = true;
        validationErrors.return_url = req.gettext('Vigane tagasisuunamise aadress, peab olema korrektne URL');
    }

    if (project.type !== 'nordea') {
        project.algo = '';
        project.auto_return = false;
    }

    if (project.type !== 'ec') {
        project.return_url = '';
    }

    if (error) {
        error = new Error(req.gettext('Andmete valideerimisel ilmnesid vead'));
        error.fields = validationErrors;
        return callback(error);
    }

    tools.generateKeys(20 * 365, Number(project.key_size) || 1024, function(err, userCertificate, bankCertificate) {
        if (err) {
            return callback(new Error(req.gettext('Sertifikaadi genereerimisel tekkis viga')));
        }

        var record = {
            name: project.name,
            description: project.description,
            keyBitsize: project.key_size,
            soloAlgo: project.algo,
            soloAutoResponse: !!project.auto_response,
            bank: project.type,
            ecUrl: project.return_url,
            ipizzaReceiverName: project.account_owner,
            ipizzaReceiverAccount: project.account_nr,
            created: new Date(),
            userCertificate: userCertificate,
            bankCertificate: bankCertificate,
            secret: randomString({
                length: 32
            })
        };

        tools.incrIdCounter(function(err, id) {
            if (err) {
                return callback(new Error(req.gettext('Andmebaasi viga')));
            }

            if (['nordea', 'tapiola', 'alandsbanken', 'handelsbanken', 'aktiasppop'].indexOf(req.body.bank) >= 0) {
                record.uid = (10000000 + Number(tools.getReferenceCode(id))).toString();
            } else {
                record.uid = 'uid' + tools.getReferenceCode(id);
            }

            db.save('project', record, function(err, id) {
                if (err) {
                    return callback(new Error(req.gettext('Andmebaasi viga')));
                }
                if (id) {
                    return callback(null, id.toString());
                } else {
                    return callback(new Error(req.gettext('Makselahenduse loomine ebaõnnestus')));
                }
            });
        });
    });
}

function apiActionDelete(req, projectId, callback) {

    projectId = (projectId || '').toString().trim();

    if (!projectId.match(/^\w+$/)) {
        return callback(new Error(req.gettext('Vigane makselahenduse identifikaator')));
    }

    db.findOne('project', {
        _id: projectId
    }, function(err, project) {
        if (err) {
            return callback(err || new Error(req.gettext('Andmebaasi viga')));
        }

        if (!project) {
            return callback(new Error(req.gettext('Sellise identifikaatoriga makselahendust ei leitud')));
        }

        db.remove('project', {
            _id: projectId
        }, function(err) {
            if (err) {
                return callback(err);
            }

            db.remove('payment', {
                project: projectId
            }, function() {
                return callback(null, true);
            });
        });
    });
}