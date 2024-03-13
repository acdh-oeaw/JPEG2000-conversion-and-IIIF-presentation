FROM ghcr.io/acdh-oeaw/iipsrv/iipsrv as builder

FROM node:18-alpine3.19

RUN echo '@edgemain http://dl-4.alpinelinux.org/alpine/edge/main' >> /etc/apk/repositories &&\
    echo '@edgecommunity http://dl-4.alpinelinux.org/alpine/edge/community' >> /etc/apk/repositories &&\
    apk add --no-cache zlib tiff libjpeg-turbo fcgi libmemcached libpng lcms2 \
      libimagequant@edgemain fftw@edgemain vips vips-tools &&\
    apk add lighttpd && apk del lighttpd &&\
    rm -rf /var/cache/apk/* &&\
    adduser node www-data &&\
    sed -i s/100:101/100:82/ /etc/passwd
# change the primary group of node to www-data
COPY --from=builder /usr/lib/libopenjp2.so* /usr/lib/libopenjp2.a* /usr/lib/
COPY --from=builder /usr/bin/opj_* /usr/bin/
COPY . /app/
RUN cd /app && npm install
WORKDIR /app
EXPOSE 3000
# we need to run as lighttpd because lighttpd WebDAV only sets user rw.
USER 100
ENV IMAGE_DATA_PATH=/mnt/data/upload\
    IMAGE_MD5_CHECKSUMS_PATH=/mnt/data/upload/md5\
    IIIF_DATA_PATH=/mnt/data/forIIIF\
    NO_VALIDATION_AT_STARTUP=true\
    DEFAULT_COLLECTION=default

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD [ "/usr/bin/wget", "localhost:3000/images/", "-O", "-", "--spider", "-q" ]

CMD ["/app/node_modules/.bin/nodemon"]