FROM node:8-alpine AS builder

# RUN apk update && apk --no-cache add g++ gcc libgcc make python

RUN apk update && apk add git

WORKDIR /home/pangalink

COPY package.json ./

RUN npm install

FROM node:8-alpine AS deployer

MAINTAINER Lauri Elias <lauri@indoorsman.ee>

RUN apk --no-cache add openssl

WORKDIR /home/pangalink

COPY --from=builder /home/pangalink/node_modules ./node_modules

COPY index.js server.js LICENSE ./

COPY lib ./lib

COPY config ./config

COPY docs ./docs

COPY www ./www

COPY nw ./nw

COPY i18n ./i18n

COPY data ./data

EXPOSE 3480

CMD ["node", "index.js"]