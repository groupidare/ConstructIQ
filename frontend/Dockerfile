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
# Render always injects its own PORT (10000) into the container at runtime,
# overriding whatever this image's own ENV PORT sets — and routes external
# traffic to whatever port EXPOSE declares, not to PORT's actual value. Since
# the standalone server.js reads process.env.PORT to decide what to bind to,
# leaving EXPOSE/PORT at Next.js's usual 3000 here meant the app ended up
# listening on 10000 (Render's injected value) while Render's proxy kept
# routing to 3000 — a permanent 502 on every request, nothing ever listening
# on the port being proxied to. Matching both to Render's actual port closes
# that mismatch regardless of which value technically "wins".
EXPOSE 10000
ENV PORT=10000
CMD ["node", "server.js"]
