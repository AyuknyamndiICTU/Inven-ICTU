FROM postgres:17-alpine
RUN apk add --no-cache age tar gzip
COPY backup.sh /usr/local/bin/labpass-backup
# Tolerate CRLF checkouts on Windows build machines.
RUN sed -i 's/\r$//' /usr/local/bin/labpass-backup && chmod +x /usr/local/bin/labpass-backup
CMD ["labpass-backup", "--schedule"]
