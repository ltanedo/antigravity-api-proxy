FROM mcr.microsoft.com/devcontainers/javascript-node:22

# Install CA certificates and build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    python3 \
    make \
    g++ \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Copy pre-downloaded npm cache from host (run `npm ci --cache .npm-cache` on host first)
COPY .npm-cache /tmp/npm-cache

# Install from local cache — no npm registry access needed inside the container.
# --prefer-offline: use cached tarballs; only hits network if a package is missing from cache.
# --ignore-scripts: skip 'prepare' (build:css) since source files aren't copied yet.
# Native modules (better-sqlite3) compile from source inside the container using the build tools above.
RUN npm ci --cache /tmp/npm-cache --prefer-offline --ignore-scripts

# Copy the rest of the application code
COPY . .

# Build CSS (native modules already compiled by npm ci)
RUN npm run build:css

# Create directory for config persistence
RUN mkdir -p /root/.config/antigravity-proxy

# Expose the main application port
EXPOSE 8082

# Expose OAuth callback ports (Primary + Fallbacks)
# Maps to OAUTH_CALLBACK_PORT and fallback ports in src/constants.js
EXPOSE 51121 51122 51123 51124 51125 51126

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8082
ENV HOST=0.0.0.0
ENV OAUTH_CALLBACK_PORT=51121

# Volume for persistent configuration
VOLUME ["/root/.config/antigravity-proxy"]

# Start the application
CMD ["npm", "start"]
