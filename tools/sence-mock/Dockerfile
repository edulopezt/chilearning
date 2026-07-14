# Local RCE mock (SENCE) — container for CI. Zero runtime dependencies: just Node >= 24,
# which strips TypeScript types natively, so we run the single-file server directly.
#
# Build:  docker build -f tools/sence-mock/Dockerfile -t sence-mock .
# Run:    docker run --rm -p 4010:4010 sence-mock
# Health: curl http://127.0.0.1:4010/_mock/health
#
# The mock NEVER talks to the real SENCE and only serves the `rcetest` environment
# (requests to /rce/* are refused). See ./README.md.

FROM node:24-alpine

WORKDIR /app

# A minimal package.json marks the dir as ESM so Node skips the "reparsing as ES module"
# warning. It is local to the image and never touches the repo's own package.json.
RUN printf '{\n  "name": "sence-mock",\n  "private": true,\n  "type": "module"\n}\n' > package.json

# Only the server file is needed — no install step, no lockfile, no node_modules.
COPY tools/sence-mock/server.ts ./server.ts

ENV PORT=4010
# Bind to all interfaces so `docker run -p 4010:4010` can reach the mock. This also exposes the
# mutable /_mock/* control plane (config/token/roster/scenarios) on every container interface —
# safe ONLY because this image is a throwaway CI test double on an isolated network. Never
# publish its port beyond CI; anyone who can reach it can reprogram the mock.
ENV SENCE_MOCK_HOST=0.0.0.0
EXPOSE 4010

# Run as the built-in unprivileged user shipped by the node image.
USER node

# Container-level healthcheck hits the control endpoint (never the protocol routes).
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4010)+'/_mock/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.ts"]
