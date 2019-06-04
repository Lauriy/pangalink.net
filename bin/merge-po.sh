#!/bin/bash

for lang in `find ./i18n -type f -name "*.po"`; do
    dir=`dirname $lang`
    msgmerge -o ${dir}/messages.po.tmp ${dir}/messages.po ./i18n/messages.pot
    mv ${dir}/messages.po.tmp ${dir}/messages.po
done