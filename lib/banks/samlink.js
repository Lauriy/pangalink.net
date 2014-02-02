var config = require("../../config/" + (process.env.NODE_ENV || "development") + ".json"),
    util = require("util"),
    banks = require("../banks"),
    tools = require("../tools"),
    db = require("../db"),
    crypto = require("crypto"),
    moment = require("moment"),
    fetchUrl = require("fetch").fetchUrl,
    urllib = require("url"),
    querystring = require("querystring");

module.exports = Samlink;

function Samlink(bank, fields, charset){
    this.bank = (typeof bank == "string" ? banks[bank] || banks.ipizza || {} : bank) || {};
    this.fields = fields || {};

    this.normalizeValues();

    this.version = Samlink.detectVersion(this.bank, this.fields);

    this.language = Samlink.defaultLanguage;
    this.charset = charset || Samlink.detectCharset(this.bank, this.fields);

    this.uid = this.fields.NET_SELLER_ID;

    this.service = "PAYMENT-IN";
}

Samlink.detectLanguage = function(bank, fields){
    return Samlink.defaultLanguage;
};

Samlink.detectVersion = function(bank, fields){
    return fields.NET_VERSION || "002";
};

Samlink.detectCharset = function(bank, fields){
    var bank = (typeof bank == "string" ? banks[bank] || banks.ipizza || {} : bank) || {};

    return bank.defaultCharset || config.samlink.defaultCharset;
};

Samlink.versions = ["002"];

Samlink.allowedCurrencies = ["EUR"];

Samlink.defaultLanguage = "FIN";

Samlink.serviceFields = {

    // Maksekorraldus
    "PAYMENT-IN": [
        'NET_VERSION',
        'NET_STAMP',
        'NET_SELLER_ID',
        'NET_AMOUNT',
        'NET_REF',
        'NET_TAX_CODE',
        'NET_DATE',
        'NET_MSG',
        'NET_RETURN',
        'NET_CANCEL',
        'NET_REJECT',
        'NET_MAC',
        'NET_CONFIRM',
        'NET_CUR',
        'NET_LOGON'
    ]
};

Samlink.signatureOrder = {
    "002":{
        "PAYMENT-IN": [
            'NET_VERSION',
            'NET_STAMP',
            'NET_SELLER_ID',
            'NET_AMOUNT',
            'NET_REF',
            'NET_DATE',
            'NET_CUR'
        ],
        "PAYMENT-OUT": [
            'NET_RETURN_VERSION',
            'NET_RETURN_STAMP',
            'NET_RETURN_REF',
            'NET_RETURN_PAID'
        ]
    }

};

// ++ kohustuslikud meetodid

Samlink.prototype.validateClient = function(callback){
    db.findOne("project", {uid: this.uid}, (function(err, record){
        if(err){
            return callback(err);
        }
        if(!record){
            return callback(null, {success: false, errors: [
                {field: "NET_SELLER_ID", value: (this.fields["NET_SELLER_ID"] || "").toString(),
                error: "Sellise kliendi tunnusega makselahendust ei leitud. Juhul kui sertifikaat on aegunud, tuleks see uuesti genereerida"}], warnings: false});
        }
        if(this.bank.key != record.bank){
            return callback(null, {success: false, errors: [
                {field: "NET_SELLER_ID", value: (this.fields["NET_SELLER_ID"] || "").toString(),
                error: util.format("Valitud kliendi tunnus kehtib ainult '%s' makselahenduse jaoks, hetkel on valitud '%s'", banks[record.bank].name, this.bank.name)}], warnings: false});
        }

        this.record = record;
        callback(null, {
            success: true,
            errors: false,
            warnings: false
        });

    }).bind(this));
};

Samlink.prototype.validateSignature = function(callback){
    this.calculateHash();

    var mac;

    try{
        mac = crypto.createHash(this.record.soloAlgo).update(this.sourceHash).digest("hex").toUpperCase();
    }catch(E){
        return callback(E);
    }

    if(mac == this.fields["NET_MAC"]){
        return callback(null, {success: true, errors: false, warnings: false});
    }

    callback(null, {
        success: false,
        errors: {field: this.fields["NET_MAC"],
                error: util.format("Allkirja parameetri %s valideerimine ebaõnnestus. Makse detailvaatest saad alla laadida PHP skripti, mis genereerib samade andmetega korrektse allkirja.", "NET_MAC")},
        warnings: false
    });
};

Samlink.prototype.sign = function(callback){
    this.calculateHash();

    try{
        this.fields["NET_RETURN_MAC"] = crypto.createHash(this.record.soloAlgo).update(this.sourceHash).digest("hex").toUpperCase();
    }catch(E){
        return callback(E);
    }

    callback(null, true);
};

Samlink.prototype.validateRequest = function(callback){

    this.errors = [];

    if(this.errors.length > 3){
        return callback(null, {
            success: !this.errors.length,
            errors: this.errors.length && this.errors || false,
            warnings: false
        });
    }

    var validator = new SamlinkValidator(this.bank, this.fields, this.service, this.version, this.record.soloAlgo);
    validator.validateFields();
    this.errors = this.errors.concat(validator.errors);
    this.warnings = validator.warnings;

    callback(null, {
        success: !this.errors.length,
        errors: this.errors.length && this.errors || false,
        warnings: this.warnings.length && this.warnings || false
    });
};

Samlink.prototype.getUid = function(){
    return this.fields["NET_SELLER_ID"];
};

Samlink.prototype.getCharset = function(){
    return this.charset;
};

Samlink.prototype.getLanguage = function(){
    return tools.languages[this.language] || "et";
};

Samlink.prototype.getSourceHash = function(){
    return this.sourceHash || false;
};

Samlink.prototype.getType = function(){
    return "PAYMENT";
};

Samlink.prototype.getAmount = function(){
    return this.fields["NET_AMOUNT"] || "0";
};

Samlink.prototype.getReferenceCode = function(){
    return this.fields["NET_REF"] || false;
};

Samlink.prototype.getMessage = function(){
    return this.fields["NET_MSG"] || false;
};

Samlink.prototype.getCurrency = function(){
    return this.fields["NET_CUR"] || "EUR";
};

Samlink.prototype.getReceiverName = function(){
    return this.fields["NET_SELLER_NAME"] || false;
};

Samlink.prototype.getReceiverAccount = function(){
    return this.fields["NET_SELLER_ACCOUNT"] || false;
};

Samlink.prototype.editSenderName = function(){
    return true;
};

Samlink.prototype.showSenderName = function(){
    return false;
};

Samlink.prototype.editSenderAccount = function(){
    return true;
};

Samlink.prototype.showSenderAccount = function(){
    return false;
};

Samlink.prototype.showReceiverName = function(){
    return !!this.getReceiverName();
};

Samlink.prototype.showReceiverAccount = function(){
    return !!this.getReceiverAccount();
};

Samlink.prototype.getSuccessTarget = function(){
    return this.fields[this.bank.returnAddress] || "";
};

Samlink.prototype.getCancelTarget = function(){
    return this.fields[this.bank.cancelAddress] || this.fields[this.bank.returnAddress] || "";
};

Samlink.prototype.getRejectTarget = function(){
    return this.fields[this.bank.rejectAddress] || this.fields[this.bank.returnAddress] || "";
};

// -- kohustuslikud meetodid

Samlink.prototype.calculateHash = function(){
    var list = [];

    if(!Samlink.signatureOrder[this.version]){
        return;
    }

    if(!Samlink.signatureOrder[this.version][this.service]){
        return;
    }

    Samlink.signatureOrder[this.version][this.service].forEach((function(vk){
        var val = this.fields[vk] || "";
        if(val){
            list.push(val);
        }
    }).bind(this));

    list.push(this.record.secret);
    list.push("");

    this.sourceHash = list.join("&");
};

Samlink.prototype.normalizeValues = function(){
    var keys = Object.keys(this.fields);

    for(var i = 0, len = keys.length; i < len; i++){
        if(this.fields[keys[i]] || this.fields[keys[i]]===0){
            this.fields[keys[i]] = (this.fields[keys[i]]).toString().trim();
        }else{
            this.fields[keys[i]] = "";
        }
    }
};

Samlink.prototype.getFields = function(){
    var fields = {};
    Samlink.signatureOrder[this.version][this.service].forEach((function(key){
        if(this.fields[key]){
            fields[key] = this.fields[key];
        }
    }).bind(this));

    if(this.fields["NET_RETURN_MAC"]){
        fields["NET_RETURN_MAC"] = this.fields["NET_RETURN_MAC"];
    }


    return fields;
};

function SamlinkValidator(bank, fields, service, version, soloAlgo){
    this.bank = (typeof bank == "string" ? banks[bank] || banks.ipizza || {} : bank) || {};
    this.fields = fields || {};
    this.service = service || "PAYMENT-IN";
    this.version = version || "002";
    this.soloAlgo = (soloAlgo || "md5").toUpperCase();

    this.errors = [];
    this.warnings = [];
}

SamlinkValidator.prototype.validateFields = function(){
    this.errors = [];
    this.warnings = [];

    Samlink.serviceFields[this.service].forEach((function(field){
        if(!this["validate_" + field]){
            return;
        }

        var response = this["validate_" + field](),
            value = (this.fields[field] || "").toString();
            
        if(typeof response == "string"){
            this.errors.push({field: field, value: (this.fields[field] || "").toString(), error: response});
        }else if(this.bank.fieldLength && 
          this.bank.fieldLength[field] && 
          value.length > this.bank.fieldLength[field]){
            this.warnings.push({
                field: field, 
                value: value, 
                warning: util.format("Välja %s pikkus on %s sümbolit, lubatud on %s", field, value.length, this.bank.fieldLength[field])
            });
        }
    }).bind(this));
};


/* VERSION */
SamlinkValidator.prototype.validate_NET_VERSION = function(){
    var value = (this.fields["NET_VERSION"] || "").toString();

    if(!value){
        return util.format("Teenuse versiooni %s väärtust ei leitud", "NET_VERSION");
    }

    if(!value.match(/^\d{3}$/)){
        return util.format("Teenuse versiooni %s (\"%s\") väärtus peab olema kolmekohaline number", "NET_VERSION", value);
    }

    if(Samlink.versions.indexOf(value) < 0){
        return util.format("Teenuskoodi %s (\"%s\") väärtus ei ole toetatud. Kasutada saab järgmisi väärtuseid: %s", "NET_VERSION", value, Samlink.versions.join(", "));
    }

    return true;
};

/* MAC */
SamlinkValidator.prototype.validate_NET_MAC = function(){
    var value = (this.fields["NET_MAC"] || "").toString();

    if(!value){
        return util.format("Allkirja parameeter %s peab olema määratud", "NET_MAC");
    }

    if(!value.match(/^[A-F0-9]+$/)){
        return util.format("Allkirja parameeter %s peab olema HEX formaadis ning sisaldama ainult suurtähti ning numbreid", "NET_MAC");
    }

    var len = value.length;

    if(this.soloAlgo == "md5" && len != 32){
        if(len == 40){
            return util.format("Allkirja parameeter %s peab olema MD5 formaadis, kuid tundub olevat SHA1 formaadis", "NET_MAC");
        }
    }

    if(this.soloAlgo == "sha1" && len != 40){
        if(len == 32){
            return util.format("Allkirja parameeter %s peab olema SHA1 formaadis, kuid tundub olevat MD5 formaadis", "NET_MAC");
        }
    }

    return true;
};

/* STAMP */
SamlinkValidator.prototype.validate_NET_STAMP = function(){
    var value = (this.fields["NET_STAMP"] || "").toString();

    if(!value){
        return util.format("Maksekorralduse kood %s peab olema määratud", "NET_STAMP");
    }

    if(!value.match(/^\d+$/)){
        return util.format("Maksekorralduse kood %s peab olema numbriline väärtus", "NET_STAMP");
    }

    return true;
};

/* SELLER_ID */
SamlinkValidator.prototype.validate_NET_SELLER_ID = function(){
    var value = (this.fields["NET_SELLER_ID"] || "").toString();

    if(!value){
        return util.format("Päringu koostaja tunnus %s peab olema määratud", "NET_SELLER_ID");
    }

    return true;
};

/* AMOUNT */
SamlinkValidator.prototype.validate_NET_AMOUNT = function(){
    var value = (this.fields["NET_AMOUNT"] || "").toString();

    if(!value){
        return util.format("Makse summa %s peab olema määratud", "NET_AMOUNT");
    }

    if(!value.match(/^\d{0,}(\.\d{1,2})?$/)){
        return util.format("Makse summa %s peab olema kujul \"123.45\"", "NET_AMOUNT");
    }

    return true;
};

/* REF */
SamlinkValidator.prototype.validate_NET_REF = function(){
    var value = (this.fields["NET_REF"] || "").toString(),
        refNumber;

    if(!value){
        return true;
    }

    if(!value.match(/^\d{2,}$/)){
        return util.format("Viitenumber %s (\"%s\") peab olema vähemalt kahekohaline number", "NET_REF", value);
    }

    refNumber = tools.getReferenceCode(value.substr(0, value.length - 1));

    if(refNumber != value){
        return util.format("Viitenumber %s on vigane - oodati väärtust \"%s\", tegelik väärtus on \"%s\"", "NET_REF", refNumber, value);
    }

    return true;
};

/* DATE */
SamlinkValidator.prototype.validate_NET_DATE = function(){
    var value = (this.fields["NET_DATE"] || "").toString();

    if(!value){
        return util.format("Maksekorralduse tähtaeg %s peab olema määratud", "NET_DATE");
    }

    if(value.toUpperCase() != "EXPRESS"){
        return util.format("Maksekorralduse tähtaaja %s ainus lubatud väärtus on %s", "NET_DATE", "EXPRESS");
    }

    return true;
};

/* MSG */
SamlinkValidator.prototype.validate_NET_MSG = function(){
    var value = (this.fields["NET_MSG"] || "").toString();

    if(!value){
        return util.format("Maksekorralduse selgitus %s peab olema määratud", "NET_MSG");
    }

    if(value.length > 210){
        return util.format("Maksekorralduse selgituse %s maksimaalne lubatud pikkus on %s sümbolit (hetkel on kasutatud %s)", "NET_MSG", 210, value.length);
    }

    return true;
};

/* RETURN */
SamlinkValidator.prototype.validate_NET_RETURN = function(){
    var value = (this.fields["NET_RETURN"] || "").toString();

    if(!value){
        return util.format("Tagasisuunamise aadress %s peab olema määratud", "NET_RETURN");
    }

    if(!tools.validateUrl(value)){
        return util.format("Tagasisuunamise aadress %s peab olema korrektne URL", "NET_RETURN");
    }

    return true;
};

/* CANCEL */
SamlinkValidator.prototype.validate_NET_CANCEL = function(){
    var value = (this.fields["NET_CANCEL"] || "").toString();

    if(!value){
        return util.format("Tagasisuunamise aadress %s peab olema määratud", "NET_CANCEL");
    }

    if(!tools.validateUrl(value)){
        return util.format("Tagasisuunamise aadress %s peab olema korrektne URL", "NET_CANCEL");
    }

    return true;
};

/* REJECT */
SamlinkValidator.prototype.validate_NET_REJECT = function(){
    var value = (this.fields["NET_REJECT"] || "").toString();

    if(!value){
        return util.format("Tagasisuunamise aadress %s peab olema määratud", "NET_REJECT");
    }

    if(!tools.validateUrl(value)){
        return util.format("Tagasisuunamise aadress %s peab olema korrektne URL", "NET_REJECT");
    }

    return true;
};

/* CONFIRM */
SamlinkValidator.prototype.validate_NET_CONFIRM = function(){
    var value = (this.fields["NET_CONFIRM"] || "").toString();

    if(!value){
        return util.format("Maksekorralduse kinnitus %s peab olema määratud", "NET_CONFIRM");
    }

    if(value.toUpperCase() != "YES"){
        return util.format("Maksekorralduse kinnituse %s ainus lubatud väärtus on %s, vastasel korral ei saa makse õnnestumisest teada", "NET_CONFIRM", "YES");
    }

    return true;
};

/* CUR */
SamlinkValidator.prototype.validate_NET_CUR = function(){
    var value = (this.fields["NET_CUR"] || "").toString();

    if(!value){
        return util.format("Valuuta %s peab olema määratud", "NET_CUR");
    }

    if(Samlink.allowedCurrencies.indexOf(value) < 0){
        return util.format("Valuuta %s on tundmatu väärtusega %s, kuid lubatud on %s", "NET_CUR", value, Samlink.allowedCurrencies.join(", "));
    }

    return true;
};

Samlink.genPaidCode = function(nr){
    var date = new Date(),
        year = date.getFullYear(),
        month = date.getMonth()+1,
        day = date.getDate(),
        stamp = String(year) + (month<10?"0":"") + month + (day<10?"0":"") + day;

    return stamp + (nr && String(nr).lpad(12) || Math.floor(1+ Math.random()* 1000000000000));
};

Samlink.generateForm = function(payment, project, callback){
    tools.incrTransactionCounter(function(err, transactionId){
        if(err){
            return callback(err);
        }

        var paymentFields = {};
        payment.fields.forEach(function(field){
            paymentFields[field.key] = field.value;
        });

        var transaction = new Samlink(project.bank, paymentFields, payment.charset);
        transaction.service = "PAYMENT-OUT";
        transaction.record = project;

        paymentFields["NET_RETURN_VERSION"] = paymentFields["NET_VERSION"];
        paymentFields["NET_RETURN_STAMP"] = paymentFields["NET_STAMP"];
        paymentFields["NET_RETURN_REF"] = paymentFields["NET_REF"];
        paymentFields["NET_RETURN_PAID"] = payment.state == "PAYED" ? Samlink.genPaidCode(transactionId) : "";

        transaction.sign(function(err){
            if(err){
                return callback(err);
            }

            var method = "GET",
                fields = transaction.getFields(),
                payload = tools.stringifyQuery(fields, payment.charset),
                url = payment.state == "PAYED" ? payment.successTarget : (payment.state == "REJECTED" ? payment.rejectTarget : payment.cancelTarget),
                hostname = (urllib.parse(url).hostname || "").toLowerCase().trim(),
                localhost = !!hostname.match(/^localhost|127\.0\.0\.1$/);

            url += (url.match(/\?/) ? "&" : "?") + payload;

            payment.responseFields = fields;
            payment.responseHash = transaction.sourceHash;
            payment.returnMethod = method;
            callback(null, {method: method, url: url, payload: payload});
        });
    });
};