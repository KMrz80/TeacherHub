FROM alpine:3.22

ARG PB_VERSION=0.39.10

RUN apk add --no-cache ca-certificates unzip wget \
    && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -O /tmp/pocketbase.zip \
    && unzip /tmp/pocketbase.zip -d /pb \
    && rm /tmp/pocketbase.zip \
    && mkdir -p /pb/pb_data

WORKDIR /pb

COPY pb_hooks/ /pb/pb_hooks/
COPY pocketbase/pb_migrations/ /pb/pb_migrations/

EXPOSE 8080

CMD ["sh", "-c", "exec /pb/pocketbase serve --http=0.0.0.0:${PORT:-8080} --dir=/pb/pb_data --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations"]
