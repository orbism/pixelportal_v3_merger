##############################
# BUILD FOR LOCAL DEVELOPMENT
##############################
# alpine distros are not supported well by canvas dependency
# https://github.com/Automattic/node-canvas/issues/866
FROM node:20-bullseye as development

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

RUN npm ci

COPY --chown=node:node . .

# generate prisma client
RUN npm run prisma:generate

USER node

##############################
# BUILD FOR PRODUCTION
##############################
FROM node:20-bullseye as build

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

# copy over node modules from dev build so we have access to dev dependencies
COPY --chown=node:node --from=development /usr/src/app/node_modules ./node_modules
COPY --chown=node:node . .

# Run the build command which creates the production bundle
RUN npm run build

# this is prod!
ENV NODE_ENV production

## install only prod deps: `prisma` is a prod dependecy since we need it for `prisma migrate` in the prod container
RUN npm ci --omit=dev

USER node

##############################
# PRODUCTION
##############################
FROM node:20-bullseye as production

# Copy the bundled code from the build stage to the production image
COPY --chown=node:node --from=build /usr/src/app/prisma ./prisma
COPY --chown=node:node --from=build /usr/src/app/package.json ./package.json
COPY --chown=node:node --from=build /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=build /usr/src/app/dist ./dist

# Migrate db & start build
CMD [ "npm", "run", "start:migrate:prod" ]
