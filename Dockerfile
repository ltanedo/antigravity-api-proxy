FROM node:22-slim

# Install dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install production dependencies
# use --ignore-scripts to prevent 'prepare' script from running (which fails because source files aren't copied yet)
RUN npm ci --ignore-scripts

# Copy the rest of the application code
COPY . .

# Rebuild native modules (since we ignored scripts) and build CSS
RUN npm rebuild && npm run build:css

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
