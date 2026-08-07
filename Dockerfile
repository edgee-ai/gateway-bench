FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy TypeScript config
COPY tsconfig.json ./

# Copy source code and configuration
COPY src ./src
COPY models.json ./
COPY prompts.json ./

# No secrets are baked into the image: every credential is supplied at runtime
# through environment variables (see cloud-run-jobs/create-jobs.sh).

# Build TypeScript
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Expose web server port
EXPOSE 3000

# Set default command to web server
CMD ["npm", "run", "bench", "run"]
