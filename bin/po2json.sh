#!/bin/bash

for lang in `find ./i18n -type f -name "*.po"`; do
    dir=`dirname $lang`
    ./node_modules/.bin/po2json $lang ${dir}/messages.json -F --format=raw
    node -e "var fs = require('fs');fs.writeFileSync('${dir}/messages.json',JSON.stringify({messages: JSON.parse(fs.readFileSync('${dir}/messages.json'))}, false, 4))"
done