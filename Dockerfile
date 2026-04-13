ARG DEBIAN_VERSION=bookworm
ARG DEBIAN_FLAVOR=slim
ARG PORT=3000
FROM debian:${DEBIAN_VERSION}-${DEBIAN_FLAVOR}

ENV DEBIAN_FRONTEND=noninteractive
ENV PORT=${PORT}
ENV API_TOKEN=default
ENV DEFAULT_TIMEOUT=30
ENV API_MAX_BODY_BYTES=2097152
ENV API_MAX_BUFFER=1048576

RUN apt-get update && apt-get install -y --no-install-recommends \
	bash \
	ca-certificates \
	build-essential \
	curl \
	git \
	iproute2 \
	iputils-ping \
	less \
	nano \
	net-tools \
	nodejs \
	procps \
	python3 \
	unzip \
	xz-utils \
	tini \
	wget \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY control_api.js /app/control_api.js

EXPOSE ${PORT}

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/control_api.js"]
