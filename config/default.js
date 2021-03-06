'use strict';

module.exports = {

    // Teenuse nimi
    title: 'Pangalink-net',

    // Linkides kasutatud protokoll
    proto: 'http',
    // Linkides kasutatud domeeninimi
    hostname: 'localhost:3480',
    // port millel kuulata
    port: 3480,

    // sessiooni andmed
    session: {
        // salajane sesssioonide krüpteerimise võti
        secret: '-- enter secret value --',
        ttl: 3600
    },

    // redis andmebaasi andmed
    redis: {
        host: 'redis',
        port: 6379,
        db: 3 // numbriline väärtus
    },

    // mitu kirjet ühel lehel kuvada
    pagingCount: 30,

    // mitut järgmist ja eelmist lehenumbrit kuvada
    pagingRange: 5,

    // vaikimisi võtmete pikkus
    keyBitsize: 2048,

    // Kui väärtus on määratud, siis lisatakse igale lehele Google Analytics kood
    googleAnalyticsID: '',

    // HTTP access log vorming
    loggerInterface: ':req[x-client-remote-address] ":method :url HTTP/:http-version" :status - :response-time ms',

    // andmefailide kaust
    data: require('path').join(__dirname,'../data'),

    // vali user ja group kelle õigustes rakendus töötab
    // jälgi, et sellel kasutajal oleks andmete kaustas kirjutusõigus
    user: false, // näiteks 'nobody'
    group: false // näiteks 'nogroup'
};