var config = require("../config/" + (process.env.NODE_ENV || "development") + ".json"),
    urllib = require("url"),
    banks = require("./banks"),
    encoding = require("encoding"),
    ipizza = require("./banks/ipizza"),
    solo = require("./banks/solo"),
    ec = require("./banks/ec"),
    os = require("os"),
    pathlib = require("path"),
    fs = require("fs"),
    crypto = require("crypto"),
    pem = require("pem"),
    redis = require("redis"),
    redisClient = redis.createClient(config.redis.port, config.redis.host);

module.exports.processLabels = {
    "ERROR": {type: "important", name: "Vigane päring"},
    "IN PROCESS": {type: "warning", name: "Pooleli olev"},
    "PAYED": {type: "success", name: "Teostatud"},
    "CANCELLED": {type: "info", name: "Katkestatud"},
    "REJECTED": {type: "inverse", name: "Tagasi lükatud"}
};

module.exports.languages = {
    "EST": "et",
    "ENG": "en",
    "RUS": "ru",
    "LAT": "lv",
    "LIT": "lt",
    "FIN": "fi",
    "SWE": "se",
    "GER": "de"
};

module.exports.countryCodes = {
    "et": "ee",
    "en": "gb",
    "ru": "ru",
    "lv": "lv",
    "lt": "lt",
    "fi": "fi",
    "se": "se",
    "de": "de"
};

module.exports.languageNames = {
    "et": "Eesti",
    "en": "Inglise",
    "ru": "Vene",
    "lv": "Läti",
    "lt": "Leedu",
    "fi": "Soome",
    "se": "Rootsi",
    "de": "Saksa"
};

module.exports.currencies = {
    "EUR": "€",
    "LVL": "LVL",
    "LTL": "LTL",
    "USD": "$"
};

module.exports.generateExampleAccountNr = function(prefix, length, seed){
    var codeLength = length - String(prefix).length - 1,
        code;
    seed = seed && crypto.createHash("md5").update(String(seed)).digest("hex") || crypto.randomBytes(30).toString("hex");
    code = parseInt(seed.substr(0, 11), 16);
    if(code < 1000000000){
        code += 1000000000;
    }
    return module.exports.getReferenceCode(String(prefix) + String(code).substr(0, codeLength));
};

module.exports.formatCurrency = function(nr, currency){
    var parts = (Number(nr) || 0).toFixed(2).split("."),
        euros = parts[0] || "0",
        cents = parts[1];

    return (euros.substr(0, euros.length % 3) + euros.substr(euros.length % 3).replace(/\d{3}/g," $&")).trim() + "," + cents + (currency ? " " + currency : "");
};

module.exports.getReferenceCode = function(code){
    code = code === 0 ? "0" : (code || "").toString();

    var multiplier = [7, 3, 1],
        sum = 0;

    if(!code || code.match(/\D/)){
        return false;
    }

    for(var i = code.length - 1, mod = 0; i >= 0; i--, mod++){
        sum += Number(code[i]) * multiplier[mod % 3];
    }

    return code + (Math.round(Math.ceil(sum/10) * 10) - sum);
};

module.exports.validateReturnURL = function(url){
    var urlParts = urllib.parse(url, true),
        keys = Object.keys(urlParts.query || {}),
        list = [];

    for(var i=0, len = keys.length; i<len; i++){
        if(keys[i].substr(0, 3)=="VK_"){
            list.push(keys[i]);
        }
    }

    return list;
};

module.exports.joinAsString = function(arr, s, f, d, y){
    if(!arr){
        return "";
    }

    if(!Array.isArray(arr)){
        return arr.toString();
    }

    arr = JSON.parse(JSON.stringify(arr));

    if(typeof d != "undefined"){
        for(var i=0; i<arr.length; i++){
            if(arr[i] == d){
                arr[i] += y;
            }
        }
    }

    if(arr.length <2){
        return arr.join("");
    }
    return arr.slice(0,arr.length-1).join(s || "") + f + arr[arr.length-1];
};

module.exports.checkEncoding = function(req, res, next){

    if(!req.rawBody || !req.rawBody.length){
        return next();
    }

    var urlParts = urllib.parse(req.url),
        match = urlParts.pathname.match(/^\/banklink\/(?:\d+\/)?([^\/\?]+)/),
        bank = banks[match && (match[1] || "").trim().toLowerCase()],
        charset = "UTF-8",
        banklib;

    if(!bank){
        return next();
    }

    switch(bank.type){

        case "ipizza":
            banklib = ipizza;
            break;

        case "solo":
            banklib = solo;
            break;

        case "ec":
            banklib = ec;
            break;

        default:
            return next();

    }

    charset = banklib.detectCharset(bank, req.body);

    if(!charset.match(/^UTF[\-_]?8$/)){
        Object.keys(req.body).forEach(function(key){
            req.body[key] = encoding.convert(req.encodedBody[key], "UTF-8", charset).toString("utf-8");
        });
    }

    req.banklink = {
        headers: req.headers,
        bank: bank,
        charset: charset,
        type: bank.type,
        language: module.exports.languages[banklib.detectLanguage(bank, req.body)] || "et",
        fields: req.body
    };

    next();
};


module.exports.genClientSecret = function(){
    var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz",
        string_length = 32,
        randomstring = '';
    for (var i=0; i<string_length; i++) {
        var rnum = Math.floor(Math.random() * chars.length);
        randomstring += chars.substring(rnum,rnum+1);
    }
    return randomstring;
};


module.exports.opensslVerify = function(data, signature, cert, charset, format, callback){
    var result;

    if(!callback && typeof format == "function"){
        callback = format;
        format = false;
    }

    if(!callback && typeof charset == "function"){
        callback = charset;
        charset = false;
    }

    format = format || "base64";
    data = encoding.convert(data, charset);

    try{
        var verifier = crypto.createVerify("SHA1");
        verifier.update(data);
        result = verifier.verify(cert, signature, format);
    }catch(E){
        return callback(E);
    }

    return callback(null, !!result);
};

module.exports.opensslSign = function(data, key, charset, format, callback){
    var result;

    if(!callback && typeof format == "function"){
        callback = format;
        format = false;
    }

    if(!callback && typeof charset == "function"){
        callback = charset;
        charset = false;
    }

    format = format || "base64";
    data = encoding.convert(data, charset);

    try{
        var signer = crypto.createSign("SHA1");
        signer.update(data);
        result = signer.sign(key, format);
    }catch(E){
        return callback(E);
    }

    return callback(null, result);
};

// Original source at: http://lehelk.com/2011/05/06/script-to-remove-diacritics/
var diacriticsRemovalMap = [
    {'base':'A', 'letters':/[\u0041\u24B6\uFF21\u00C0\u00C1\u00C2\u1EA6\u1EA4\u1EAA\u1EA8\u00C3\u0100\u0102\u1EB0\u1EAE\u1EB4\u1EB2\u0226\u01E0\u00C4\u01DE\u1EA2\u00C5\u01FA\u01CD\u0200\u0202\u1EA0\u1EAC\u1EB6\u1E00\u0104\u023A\u2C6F]/g},
    {'base':'AA','letters':/[\uA732]/g},
    {'base':'AE','letters':/[\u00C6\u01FC\u01E2]/g},
    {'base':'AO','letters':/[\uA734]/g},
    {'base':'AU','letters':/[\uA736]/g},
    {'base':'AV','letters':/[\uA738\uA73A]/g},
    {'base':'AY','letters':/[\uA73C]/g},
    {'base':'B', 'letters':/[\u0042\u24B7\uFF22\u1E02\u1E04\u1E06\u0243\u0182\u0181]/g},
    {'base':'C', 'letters':/[\u0043\u24B8\uFF23\u0106\u0108\u010A\u010C\u00C7\u1E08\u0187\u023B\uA73E]/g},
    {'base':'D', 'letters':/[\u0044\u24B9\uFF24\u1E0A\u010E\u1E0C\u1E10\u1E12\u1E0E\u0110\u018B\u018A\u0189\uA779]/g},
    {'base':'DZ','letters':/[\u01F1\u01C4]/g},
    {'base':'Dz','letters':/[\u01F2\u01C5]/g},
    {'base':'E', 'letters':/[\u0045\u24BA\uFF25\u00C8\u00C9\u00CA\u1EC0\u1EBE\u1EC4\u1EC2\u1EBC\u0112\u1E14\u1E16\u0114\u0116\u00CB\u1EBA\u011A\u0204\u0206\u1EB8\u1EC6\u0228\u1E1C\u0118\u1E18\u1E1A\u0190\u018E]/g},
    {'base':'F', 'letters':/[\u0046\u24BB\uFF26\u1E1E\u0191\uA77B]/g},
    {'base':'G', 'letters':/[\u0047\u24BC\uFF27\u01F4\u011C\u1E20\u011E\u0120\u01E6\u0122\u01E4\u0193\uA7A0\uA77D\uA77E]/g},
    {'base':'H', 'letters':/[\u0048\u24BD\uFF28\u0124\u1E22\u1E26\u021E\u1E24\u1E28\u1E2A\u0126\u2C67\u2C75\uA78D]/g},
    {'base':'I', 'letters':/[\u0049\u24BE\uFF29\u00CC\u00CD\u00CE\u0128\u012A\u012C\u0130\u00CF\u1E2E\u1EC8\u01CF\u0208\u020A\u1ECA\u012E\u1E2C\u0197]/g},
    {'base':'J', 'letters':/[\u004A\u24BF\uFF2A\u0134\u0248]/g},
    {'base':'K', 'letters':/[\u004B\u24C0\uFF2B\u1E30\u01E8\u1E32\u0136\u1E34\u0198\u2C69\uA740\uA742\uA744\uA7A2]/g},
    {'base':'L', 'letters':/[\u004C\u24C1\uFF2C\u013F\u0139\u013D\u1E36\u1E38\u013B\u1E3C\u1E3A\u0141\u023D\u2C62\u2C60\uA748\uA746\uA780]/g},
    {'base':'LJ','letters':/[\u01C7]/g},
    {'base':'Lj','letters':/[\u01C8]/g},
    {'base':'M', 'letters':/[\u004D\u24C2\uFF2D\u1E3E\u1E40\u1E42\u2C6E\u019C]/g},
    {'base':'N', 'letters':/[\u004E\u24C3\uFF2E\u01F8\u0143\u00D1\u1E44\u0147\u1E46\u0145\u1E4A\u1E48\u0220\u019D\uA790\uA7A4]/g},
    {'base':'NJ','letters':/[\u01CA]/g},
    {'base':'Nj','letters':/[\u01CB]/g},
    {'base':'O', 'letters':/[\u004F\u24C4\uFF2F\u00D2\u00D3\u00D4\u1ED2\u1ED0\u1ED6\u1ED4\u00D5\u1E4C\u022C\u1E4E\u014C\u1E50\u1E52\u014E\u022E\u0230\u00D6\u022A\u1ECE\u0150\u01D1\u020C\u020E\u01A0\u1EDC\u1EDA\u1EE0\u1EDE\u1EE2\u1ECC\u1ED8\u01EA\u01EC\u00D8\u01FE\u0186\u019F\uA74A\uA74C]/g},
    {'base':'OI','letters':/[\u01A2]/g},
    {'base':'OO','letters':/[\uA74E]/g},
    {'base':'OU','letters':/[\u0222]/g},
    {'base':'P', 'letters':/[\u0050\u24C5\uFF30\u1E54\u1E56\u01A4\u2C63\uA750\uA752\uA754]/g},
    {'base':'Q', 'letters':/[\u0051\u24C6\uFF31\uA756\uA758\u024A]/g},
    {'base':'R', 'letters':/[\u0052\u24C7\uFF32\u0154\u1E58\u0158\u0210\u0212\u1E5A\u1E5C\u0156\u1E5E\u024C\u2C64\uA75A\uA7A6\uA782]/g},
    {'base':'S', 'letters':/[\u0053\u24C8\uFF33\u1E9E\u015A\u1E64\u015C\u1E60\u0160\u1E66\u1E62\u1E68\u0218\u015E\u2C7E\uA7A8\uA784]/g},
    {'base':'T', 'letters':/[\u0054\u24C9\uFF34\u1E6A\u0164\u1E6C\u021A\u0162\u1E70\u1E6E\u0166\u01AC\u01AE\u023E\uA786]/g},
    {'base':'TZ','letters':/[\uA728]/g},
    {'base':'U', 'letters':/[\u0055\u24CA\uFF35\u00D9\u00DA\u00DB\u0168\u1E78\u016A\u1E7A\u016C\u00DC\u01DB\u01D7\u01D5\u01D9\u1EE6\u016E\u0170\u01D3\u0214\u0216\u01AF\u1EEA\u1EE8\u1EEE\u1EEC\u1EF0\u1EE4\u1E72\u0172\u1E76\u1E74\u0244]/g},
    {'base':'V', 'letters':/[\u0056\u24CB\uFF36\u1E7C\u1E7E\u01B2\uA75E\u0245]/g},
    {'base':'VY','letters':/[\uA760]/g},
    {'base':'W', 'letters':/[\u0057\u24CC\uFF37\u1E80\u1E82\u0174\u1E86\u1E84\u1E88\u2C72]/g},
    {'base':'X', 'letters':/[\u0058\u24CD\uFF38\u1E8A\u1E8C]/g},
    {'base':'Y', 'letters':/[\u0059\u24CE\uFF39\u1EF2\u00DD\u0176\u1EF8\u0232\u1E8E\u0178\u1EF6\u1EF4\u01B3\u024E\u1EFE]/g},
    {'base':'Z', 'letters':/[\u005A\u24CF\uFF3A\u0179\u1E90\u017B\u017D\u1E92\u1E94\u01B5\u0224\u2C7F\u2C6B\uA762]/g},
    {'base':'a', 'letters':/[\u0061\u24D0\uFF41\u1E9A\u00E0\u00E1\u00E2\u1EA7\u1EA5\u1EAB\u1EA9\u00E3\u0101\u0103\u1EB1\u1EAF\u1EB5\u1EB3\u0227\u01E1\u00E4\u01DF\u1EA3\u00E5\u01FB\u01CE\u0201\u0203\u1EA1\u1EAD\u1EB7\u1E01\u0105\u2C65\u0250]/g},
    {'base':'aa','letters':/[\uA733]/g},
    {'base':'ae','letters':/[\u00E6\u01FD\u01E3]/g},
    {'base':'ao','letters':/[\uA735]/g},
    {'base':'au','letters':/[\uA737]/g},
    {'base':'av','letters':/[\uA739\uA73B]/g},
    {'base':'ay','letters':/[\uA73D]/g},
    {'base':'b', 'letters':/[\u0062\u24D1\uFF42\u1E03\u1E05\u1E07\u0180\u0183\u0253]/g},
    {'base':'c', 'letters':/[\u0063\u24D2\uFF43\u0107\u0109\u010B\u010D\u00E7\u1E09\u0188\u023C\uA73F\u2184]/g},
    {'base':'d', 'letters':/[\u0064\u24D3\uFF44\u1E0B\u010F\u1E0D\u1E11\u1E13\u1E0F\u0111\u018C\u0256\u0257\uA77A]/g},
    {'base':'dz','letters':/[\u01F3\u01C6]/g},
    {'base':'e', 'letters':/[\u0065\u24D4\uFF45\u00E8\u00E9\u00EA\u1EC1\u1EBF\u1EC5\u1EC3\u1EBD\u0113\u1E15\u1E17\u0115\u0117\u00EB\u1EBB\u011B\u0205\u0207\u1EB9\u1EC7\u0229\u1E1D\u0119\u1E19\u1E1B\u0247\u025B\u01DD]/g},
    {'base':'f', 'letters':/[\u0066\u24D5\uFF46\u1E1F\u0192\uA77C]/g},
    {'base':'g', 'letters':/[\u0067\u24D6\uFF47\u01F5\u011D\u1E21\u011F\u0121\u01E7\u0123\u01E5\u0260\uA7A1\u1D79\uA77F]/g},
    {'base':'h', 'letters':/[\u0068\u24D7\uFF48\u0125\u1E23\u1E27\u021F\u1E25\u1E29\u1E2B\u1E96\u0127\u2C68\u2C76\u0265]/g},
    {'base':'hv','letters':/[\u0195]/g},
    {'base':'i', 'letters':/[\u0069\u24D8\uFF49\u00EC\u00ED\u00EE\u0129\u012B\u012D\u00EF\u1E2F\u1EC9\u01D0\u0209\u020B\u1ECB\u012F\u1E2D\u0268\u0131]/g},
    {'base':'j', 'letters':/[\u006A\u24D9\uFF4A\u0135\u01F0\u0249]/g},
    {'base':'k', 'letters':/[\u006B\u24DA\uFF4B\u1E31\u01E9\u1E33\u0137\u1E35\u0199\u2C6A\uA741\uA743\uA745\uA7A3]/g},
    {'base':'l', 'letters':/[\u006C\u24DB\uFF4C\u0140\u013A\u013E\u1E37\u1E39\u013C\u1E3D\u1E3B\u017F\u0142\u019A\u026B\u2C61\uA749\uA781\uA747]/g},
    {'base':'lj','letters':/[\u01C9]/g},
    {'base':'m', 'letters':/[\u006D\u24DC\uFF4D\u1E3F\u1E41\u1E43\u0271\u026F]/g},
    {'base':'n', 'letters':/[\u006E\u24DD\uFF4E\u01F9\u0144\u00F1\u1E45\u0148\u1E47\u0146\u1E4B\u1E49\u019E\u0272\u0149\uA791\uA7A5]/g},
    {'base':'nj','letters':/[\u01CC]/g},
    {'base':'o', 'letters':/[\u006F\u24DE\uFF4F\u00F2\u00F3\u00F4\u1ED3\u1ED1\u1ED7\u1ED5\u00F5\u1E4D\u022D\u1E4F\u014D\u1E51\u1E53\u014F\u022F\u0231\u00F6\u022B\u1ECF\u0151\u01D2\u020D\u020F\u01A1\u1EDD\u1EDB\u1EE1\u1EDF\u1EE3\u1ECD\u1ED9\u01EB\u01ED\u00F8\u01FF\u0254\uA74B\uA74D\u0275]/g},
    {'base':'oi','letters':/[\u01A3]/g},
    {'base':'ou','letters':/[\u0223]/g},
    {'base':'oo','letters':/[\uA74F]/g},
    {'base':'p','letters':/[\u0070\u24DF\uFF50\u1E55\u1E57\u01A5\u1D7D\uA751\uA753\uA755]/g},
    {'base':'q','letters':/[\u0071\u24E0\uFF51\u024B\uA757\uA759]/g},
    {'base':'r','letters':/[\u0072\u24E1\uFF52\u0155\u1E59\u0159\u0211\u0213\u1E5B\u1E5D\u0157\u1E5F\u024D\u027D\uA75B\uA7A7\uA783]/g},
    {'base':'s','letters':/[\u0073\u24E2\uFF53\u00DF\u015B\u1E65\u015D\u1E61\u0161\u1E67\u1E63\u1E69\u0219\u015F\u023F\uA7A9\uA785\u1E9B]/g},
    {'base':'t','letters':/[\u0074\u24E3\uFF54\u1E6B\u1E97\u0165\u1E6D\u021B\u0163\u1E71\u1E6F\u0167\u01AD\u0288\u2C66\uA787]/g},
    {'base':'tz','letters':/[\uA729]/g},
    {'base':'u','letters':/[\u0075\u24E4\uFF55\u00F9\u00FA\u00FB\u0169\u1E79\u016B\u1E7B\u016D\u00FC\u01DC\u01D8\u01D6\u01DA\u1EE7\u016F\u0171\u01D4\u0215\u0217\u01B0\u1EEB\u1EE9\u1EEF\u1EED\u1EF1\u1EE5\u1E73\u0173\u1E77\u1E75\u0289]/g},
    {'base':'v','letters':/[\u0076\u24E5\uFF56\u1E7D\u1E7F\u028B\uA75F\u028C]/g},
    {'base':'vy','letters':/[\uA761]/g},
    {'base':'w','letters':/[\u0077\u24E6\uFF57\u1E81\u1E83\u0175\u1E87\u1E85\u1E98\u1E89\u2C73]/g},
    {'base':'x','letters':/[\u0078\u24E7\uFF58\u1E8B\u1E8D]/g},
    {'base':'y','letters':/[\u0079\u24E8\uFF59\u1EF3\u00FD\u0177\u1EF9\u0233\u1E8F\u00FF\u1EF7\u1E99\u1EF5\u01B4\u024F\u1EFF]/g},
    {'base':'z','letters':/[\u007A\u24E9\uFF5A\u017A\u1E91\u017C\u017E\u1E93\u1E95\u01B6\u0225\u0240\u2C6C\uA763]/g}
];

module.exports.removeDiacritics = function(str) {
    for(var i=0; i < diacriticsRemovalMap.length; i++) {
        str = str.replace(diacriticsRemovalMap[i].letters, diacriticsRemovalMap[i].base);
    }
    return str;
};

if(!("lpad" in String.prototype)){
    Object.defineProperty(String.prototype, "lpad", {
        enumerable: false,
        value: function(length, str){
            length = Math.abs(length) || 0;
            str = str || "0";
            if(!length || length <= this.length){
                return this;
            }
            return Array(length - this.length + 1).join(str) + this;
        }
    });
}

if(!("rpad" in String.prototype)){
    Object.defineProperty(String.prototype, "rpad", {
        enumerable: false,
        value: function(length, str){
            length = Math.abs(length) || 0;
            str = str || "0";
            if(!length || length<=this.length){
                return this;
            }
            return this + Array(length - this.length + 1).join(str);
        }
    });
}


module.exports.paging = function(pageNumber, pageCount){
    var visible = config.pagingRange,
        rangeMin = pageNumber - Math.round(visible/2),
        rangeMax = pageNumber + Math.round(visible/2),
        pageList = [];

    if(pageCount <= visible){
        rangeMin = 1;
        rangeMax = pageCount;
    }else{
        if(rangeMin < 1){
            rangeMax += Math.abs(rangeMin) + 1;
            rangeMin = 1;
        }else if(rangeMax > pageCount){
            rangeMin -= rangeMax - pageCount;
            rangeMax = pageCount;
        }
    }

    for(var i=rangeMin; i<=rangeMax; i++){
        pageList.push({
            pageNumber: i,
            active: i == pageNumber
        });
    }

    if(rangeMin > 1){
        pageList.unshift({disabled: true});
    }

    if(rangeMax < pageCount){
        pageList.push({disabled: true});
    }

    return pageList;
};

module.exports.validateUrl = function(url){
    return url.match(/(http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/);
};

module.exports.generateKeys = function(user, days, keyBitsize, callback){
    module.exports.generateKeyPair(user, days, keyBitsize, function(err, userCertificate){
        if(err){
            return callback(err);
        }
        module.exports.generateKeyPair(user, days, keyBitsize, function(err, bankCertificate){
            if(err){
                return callback(err);
            }
            return callback(null, userCertificate, bankCertificate);
        });
    });
};

module.exports.generateKeyPair = function(user, days, keyBitsize, callback){
    if(!callback && typeof keyBitsize == "function"){
        callback = keyBitsize;
        keyBitsize = undefined;
    }

    if(!callback && typeof days == "function"){
        callback = days;
        days = undefined;
    }

    keyBitsize = keyBitsize || config.keyBitsize;

    days = days || 181;

    var csr = {
        keyBitsize: keyBitsize,
        hash: "sha1",
        country: "EE",
        state: "Harjumaa",
        locality: "Tallinn",
        organization: module.exports.removeDiacritics(user.company || config.title),
        organizationUnit: "banklink",
        commonName: config.hostname,
        emailAddress: user.id,
        selfSigned: true,
        days: days
    };

    pem.createCertificate(csr, function(err, keyData){
        if(err){
            return callback(err);
        }

        keyData.expires = new Date(Date.now() + 1000 * 3600 * 24 * days);
        return callback(err, keyData);
    });
};

module.exports.incrCounter = function(counter, min, callback){
    if(callback && typeof min == "function"){
        callback = min;
        min = undefined;
    }

    min = Math.abs(Number(min) || 0);

    redisClient.multi().
        select(config.redis.db).
        setnx("count-"+counter, min).
        incr("count-"+counter).
        exec(function(err, replies){
            if(err){
                return callback(err);
            }
            return callback(null, Number(replies && replies[2]) || 0);
        });
};

module.exports.incrIdCounter = function(callback){
    return module.exports.incrCounter("id", 40000, callback);
};

module.exports.incrTransactionCounter = function(callback){
    return module.exports.incrCounter("trans", 40000, callback);
};

module.exports.stringifyQuery = function(obj, charset){
    var values;

    obj = obj || {};

    values = Object.keys(obj).map(function(key){
        var value = encoding.convert(obj[key], charset),
            str = "";

        for(var i=0, len = value.length; i < len; i++){
            if((value[i] >= 48 && value[i] <= 57) || (value[i] >= 65 && value[i] <= 90) || (value[i] >= 97 && value[i] <= 122) || [45, 46, 95, 126].indexOf(value[i])>=0){
                str += String.fromCharCode(value[i]);
            }else{
                str += "%" + (value[i]<16?"0":"") + value[i].toString(16).toUpperCase();
            }
        }

        return encodeURIComponent(key) + "=" + str;
    });

    return values.join("&");
};
