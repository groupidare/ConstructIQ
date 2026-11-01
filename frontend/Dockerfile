FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* variables are inlined into the client bundle at build time,
# not read at runtime — must be passed as Docker build arguments (Render:
# set each as a "Build Argument", not just an environment variable), or the
# deployed frontend silently falls back to bad defaults (localhost API calls,
# a missing/broken Google sign-in button) with no visible error.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
# Matches Render's own injected PORT (it sets this regardless of what this
# image declares, and routes external traffic there).
EXPOSE 10000
ENV PORT=10000
# The standalone server defaults to binding only to localhost inside the
# container unless told otherwise — fine for a request originating inside
# the same container, but Render's proxy connects from outside it, so every
# request 502'd even though the app logged "Ready"/"live" and never crashed.
# 0.0.0.0 makes it accept connections on any interface, not just loopback.
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
